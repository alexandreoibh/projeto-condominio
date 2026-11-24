'use strict';

// Política de upload. Roda DEPOIS do multer (memoryStorage) e valida cada
// arquivo pelo conteúdo (magic bytes), não pelo mimetype/extensão declarados
// pelo cliente. Em caso de sucesso:
//   - file.mimetype       ← tipo detectado (o controller grava esse no Blob)
//   - file.extensaoSegura ← extensão derivada do tipo detectado
//   - file.originalname   ← só o nome-base, sem caminho nem caracteres de controle
// Arquivos fora da allowlist do contexto → 415.

const TIPOS = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
  gif: { mime: 'image/gif', ext: 'gif' },
  heic: { mime: 'image/heic', ext: 'heic' },
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
  doc: { mime: 'application/msword', ext: 'doc' },
  xls: { mime: 'application/vnd.ms-excel', ext: 'xls' },
  pem: { mime: 'application/x-pem-file', ext: 'pem' },
  der: { mime: 'application/pkix-cert', ext: 'der' }
};

const CONTEXTOS = {
  imagem: ['jpeg', 'png', 'webp', 'gif', 'heic'],
  documento: ['pdf', 'jpeg', 'png', 'webp', 'heic', 'docx', 'xlsx', 'pptx', 'doc', 'xls'],
  boleto: ['pdf'],
  certificado: ['pem', 'der']
};

function _comeca(buf, bytes, offset = 0) {
  if (!buf || buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

const zlib = require('zlib');

// Limites de ZIP (OOXML). Lidos do central directory, sem extrair nada.
const ZIP_MAX_ENTRADAS = 5000;
const ZIP_MAX_TOTAL_DESCOMPRIMIDO = 100 * 1024 * 1024; // 100 MB
const ZIP_MAX_RAZAO = 100; // descomprimido / comprimido (ZIP bomb)
const XML_MAX_COMPRIMIDO_INSPECAO = 1024 * 1024; // só partes XML até 1 MB
const XML_MAX_DESCOMPRIMIDO_INSPECAO = 10 * 1024 * 1024;

// Lê as entradas pelo *central directory* do ZIP. Retorna null se a
// estrutura for inválida, cifrada ou ZIP64 (não aceito: tamanhos 0xFFFFFFFF
// escondem o tamanho real).
function _listarEntradasZip(buf) {
  // End of central directory: assinatura 0x06054b50, nos últimos 64 KB.
  const inicioBusca = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= inicioBusca; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = buf.readUInt16LE(eocd + 10);
  const tamanhoCd = buf.readUInt32LE(eocd + 12);
  const offsetCd = buf.readUInt32LE(eocd + 16);
  if (total === 0 || total === 0xffff || total > ZIP_MAX_ENTRADAS) return null;
  if (offsetCd === 0xffffffff || offsetCd + tamanhoCd > buf.length) return null;

  const entradas = [];
  let pos = offsetCd;
  for (let n = 0; n < total; n += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) return null;
    const flags = buf.readUInt16LE(pos + 8);
    const metodo = buf.readUInt16LE(pos + 10);
    const comprimido = buf.readUInt32LE(pos + 20);
    const descomprimido = buf.readUInt32LE(pos + 24);
    const tamNome = buf.readUInt16LE(pos + 28);
    const tamExtra = buf.readUInt16LE(pos + 30);
    const tamComentario = buf.readUInt16LE(pos + 32);
    const offsetLocal = buf.readUInt32LE(pos + 42);
    if (pos + 46 + tamNome > buf.length) return null;
    if (flags & 0x1) return null; // entrada cifrada: não é um OOXML legítimo
    if (comprimido === 0xffffffff || descomprimido === 0xffffffff || offsetLocal === 0xffffffff) return null; // ZIP64
    entradas.push({
      nome: buf.slice(pos + 46, pos + 46 + tamNome).toString('utf8'),
      metodo,
      comprimido,
      descomprimido,
      offsetLocal
    });
    pos += 46 + tamNome + tamExtra + tamComentario;
  }
  return entradas;
}

// Zip Slip: caminho absoluto, drive, barra invertida ou ".." em qualquer
// segmento tornam o arquivo inválido (mesmo que o Node nunca extraia, o PHP
// ou um usuário podem extrair depois).
function _entradaZipPerigosa(nome) {
  if (!nome || nome.startsWith('/') || nome.includes('\\') || /^[a-zA-Z]:/.test(nome)) return true;
  if (/[\u0000-\u001f]/.test(nome)) return true;
  return nome.split('/').some((segmento) => segmento === '..');
}

// ZIP bomb: soma descomprimida e razão de compressão.
function _zipBomba(entradas, tamanhoArquivo) {
  let total = 0;
  for (const entrada of entradas) {
    total += entrada.descomprimido;
    if (total > ZIP_MAX_TOTAL_DESCOMPRIMIDO) return true;
    if (entrada.comprimido > 0 && entrada.descomprimido / entrada.comprimido > ZIP_MAX_RAZAO) return true;
    if (entrada.comprimido === 0 && entrada.descomprimido > 0) return true;
  }
  return tamanhoArquivo > 0 && total / tamanhoArquivo > ZIP_MAX_RAZAO;
}

// Conteúdo de uma entrada (stored ou deflate), com teto de saída.
function _lerEntradaZip(buf, entrada) {
  const pos = entrada.offsetLocal;
  if (pos + 30 > buf.length || buf.readUInt32LE(pos) !== 0x04034b50) return null;
  const inicio = pos + 30 + buf.readUInt16LE(pos + 26) + buf.readUInt16LE(pos + 28);
  const dados = buf.slice(inicio, inicio + entrada.comprimido);
  if (entrada.metodo === 0) return dados;
  if (entrada.metodo !== 8) return null;
  try {
    return zlib.inflateRawSync(dados, { maxOutputLength: XML_MAX_DESCOMPRIMIDO_INSPECAO });
  } catch (_) {
    return null;
  }
}

// XXE: nenhuma parte XML do pacote pode declarar DOCTYPE/ENTITY. Partes XML
// grandes demais para inspecionar tornam o arquivo inválido.
function _ooxmlComXmlPerigoso(buf, entradas) {
  for (const entrada of entradas) {
    if (!/\.(xml|rels)$/i.test(entrada.nome)) continue;
    if (entrada.comprimido > XML_MAX_COMPRIMIDO_INSPECAO) return true;
    const conteudo = _lerEntradaZip(buf, entrada);
    if (!conteudo) return true;
    const texto = conteudo.toString('latin1');
    if (/<!DOCTYPE/i.test(texto) || /<!ENTITY/i.test(texto)) return true;
  }
  return false;
}

// Macros/controles ativos (docm/xlsm disfarçados de docx/xlsx).
function _ooxmlComConteudoAtivo(entradas) {
  return entradas.some((entrada) => /(^|\/)vbaProject\.bin$/i.test(entrada.nome) || /(^|\/)activeX\//i.test(entrada.nome));
}

function _detectarOfficeZip(buf) {
  // OOXML é um ZIP com [Content_Types].xml na raiz; o tipo vem do diretório
  // principal (word/, xl/, ppt/). Antes bastava a string aparecer nos
  // primeiros 4 KB, o que aceitava qualquer ZIP (inclusive Zip Slip).
  const entradas = _listarEntradasZip(buf);
  if (!entradas) return null;
  const nomes = entradas.map((entrada) => entrada.nome);
  if (!nomes.includes('[Content_Types].xml')) return null;
  if (nomes.some(_entradaZipPerigosa)) return null;
  if (_zipBomba(entradas, buf.length)) return null;
  if (_ooxmlComConteudoAtivo(entradas)) return null;
  if (_ooxmlComXmlPerigoso(buf, entradas)) return null;
  if (nomes.some((nome) => nome.startsWith('word/'))) return 'docx';
  if (nomes.some((nome) => nome.startsWith('xl/'))) return 'xlsx';
  if (nomes.some((nome) => nome.startsWith('ppt/'))) return 'pptx';
  return null;
}

// Poliglotas: arquivo com assinatura de imagem/PDF/Office válida mas que
// carrega código interpretável (ex.: PNG com "<?php" no comentário, gravado
// depois como .php por um servidor que confie no nome). Buffer.indexOf é
// linear e não depende de parser.
const MARCADORES_CODIGO = ['<?php', '<?=', '<script', '<html', '<svg', '<!doctype html'];

function _contemCodigoEmbutido(buf) {
  const texto = buf.toString('latin1').toLowerCase();
  if (texto.startsWith('#!')) return true;
  return MARCADORES_CODIGO.some((marcador) => texto.includes(marcador));
}

// PDF com conteúdo ativo (JavaScript, abertura de programa, arquivo anexado).
function _pdfComConteudoAtivo(buf) {
  const texto = buf.toString('latin1');
  return /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(texto);
}

function detectarTipo(buffer, { contexto } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (buf.length === 0) return null;

  if (_comeca(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (_comeca(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (_comeca(buf, [0x52, 0x49, 0x46, 0x46]) && _comeca(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (_comeca(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (_comeca(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const marca = buf.slice(8, 12).toString('latin1');
    if (['heic', 'heix', 'mif1', 'msf1', 'heif'].includes(marca)) return 'heic';
  }
  if (_comeca(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (_comeca(buf, [0x50, 0x4b, 0x03, 0x04])) return _detectarOfficeZip(buf);
  if (_comeca(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return contexto === 'documento' ? 'doc' : null; // OLE2: doc/xls legado
  }

  if (contexto === 'certificado') {
    const texto = buf.slice(0, 64).toString('utf8').trimStart();
    if (texto.startsWith('-----BEGIN ')) return 'pem';
    if (buf[0] === 0x30) return 'der'; // ASN.1 SEQUENCE (DER, PFX/P12)
  }

  return null;
}

// Nome exibido/gravado (ex.: tb_reuniao_anexo.nome_arquivo): só o nome-base,
// sem caminho, e SEMPRE com a extensão do tipo detectado. Pontos do nome
// original viram "_" para não sobrar extensão dupla: "sh.php" enviado como
// PDF vira "sh_php.pdf"; "xxe.svg.php" vira "xxe_svg_php.<ext>".
function _nomeSeguro(nome, extensao) {
  const base = String(nome || 'arquivo').split(/[\\/]/).pop();
  const limpo = base.replace(/[\u0000-\u001f\u007f"<>|*?:;%`$&'\\]/g, '_').trim();
  const semExtensaoFinal = limpo.includes('.') ? limpo.slice(0, limpo.lastIndexOf('.')) || limpo : limpo;
  const extOriginal = limpo.includes('.') ? limpo.slice(limpo.lastIndexOf('.') + 1).toLowerCase() : '';
  const corpoBase = extOriginal === extensao ? semExtensaoFinal : limpo;
  const corpo = (corpoBase.replace(/\./g, '_').replace(/^[_\s-]+/, '') || 'arquivo').slice(0, 140);
  return extensao ? `${corpo}.${extensao}` : corpo;
}

function _listarArquivos(req) {
  const lista = [];
  if (req.file) lista.push(req.file);
  if (Array.isArray(req.files)) {
    lista.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    for (const grupo of Object.values(req.files)) {
      if (Array.isArray(grupo)) lista.push(...grupo);
    }
  }
  return lista;
}

function validarArquivo(arquivo, contexto) {
  const permitidos = CONTEXTOS[contexto];
  if (!permitidos) {
    throw new Error(`Contexto de upload desconhecido: ${contexto}`);
  }
  const tipo = detectarTipo(arquivo?.buffer, { contexto });
  if (!tipo || !permitidos.includes(tipo)) {
    return { ok: false };
  }
  // Certificados (PEM/DER) nunca são gravados como arquivo nem servidos.
  if (contexto !== 'certificado') {
    const buf = Buffer.isBuffer(arquivo.buffer) ? arquivo.buffer : Buffer.from(arquivo.buffer || []);
    // OOXML é comprimido: o código embutido só apareceria descomprimido e as
    // partes XML já são inspecionadas em _detectarOfficeZip.
    if (!['docx', 'xlsx', 'pptx'].includes(tipo) && _contemCodigoEmbutido(buf)) {
      return { ok: false, motivo: 'codigo_embutido' };
    }
    if (tipo === 'pdf' && _pdfComConteudoAtivo(buf)) {
      return { ok: false, motivo: 'pdf_conteudo_ativo' };
    }
  }
  return { ok: true, tipo, mime: TIPOS[tipo].mime, ext: TIPOS[tipo].ext };
}

// Middleware: validarUploads('imagem') | ('documento') | ('certificado') | ...
// Também aceita um mapa por campo: validarUploads({ path_avatar: 'imagem' }, 'documento').
function validarUploads(contextoOuMapa, contextoPadrao = null) {
  return (req, res, next) => {
    const arquivos = _listarArquivos(req);
    for (const arquivo of arquivos) {
      const contexto =
        typeof contextoOuMapa === 'string'
          ? contextoOuMapa
          : contextoOuMapa[arquivo.fieldname] || contextoPadrao;
      if (!contexto) {
        return res.status(415).json({ message: `Campo de arquivo não permitido: ${arquivo.fieldname}.` });
      }
      const resultado = validarArquivo(arquivo, contexto);
      if (!resultado.ok) {
        return res.status(415).json({
          message: 'Tipo de arquivo não permitido.',
          campo: arquivo.fieldname,
          tipos_permitidos: CONTEXTOS[contexto].map((t) => TIPOS[t].ext)
        });
      }
      if (contexto !== 'certificado') {
        arquivo.mimetype = resultado.mime;
      }
      arquivo.extensaoSegura = resultado.ext;
      arquivo.originalname = _nomeSeguro(arquivo.originalname, resultado.ext);
    }
    return next();
  };
}

module.exports = {
  _nomeSeguro,
  LIMITES_ZIP: { ZIP_MAX_ENTRADAS, ZIP_MAX_TOTAL_DESCOMPRIMIDO, ZIP_MAX_RAZAO },
  CONTEXTOS,
  TIPOS,
  detectarTipo,
  validarArquivo,
  validarUploads
};
