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

function _detectarOfficeZip(buf) {
  // OOXML é um ZIP; o tipo vem do primeiro diretório interno conhecido.
  const amostra = buf.slice(0, Math.min(buf.length, 4096)).toString('latin1');
  if (amostra.includes('word/')) return 'docx';
  if (amostra.includes('xl/')) return 'xlsx';
  if (amostra.includes('ppt/')) return 'pptx';
  if (amostra.includes('[Content_Types].xml')) {
    const maior = buf.toString('latin1');
    if (maior.includes('word/')) return 'docx';
    if (maior.includes('xl/')) return 'xlsx';
    if (maior.includes('ppt/')) return 'pptx';
  }
  return null;
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

function _nomeSeguro(nome) {
  const base = String(nome || 'arquivo').split(/[\\/]/).pop();
  const limpo = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '_').trim();
  return (limpo || 'arquivo').slice(0, 150);
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
      arquivo.originalname = _nomeSeguro(arquivo.originalname);
    }
    return next();
  };
}

module.exports = {
  CONTEXTOS,
  TIPOS,
  detectarTipo,
  validarArquivo,
  validarUploads
};
