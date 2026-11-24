'use strict';

// Revisão pré-publicação (24/11/2026): uploads (ZIP bomb, XXE, macro,
// poliglota), auditoria sem segredos, testes sem rede e escopo de condomínio.

const zlib = require('zlib');
const http = require('http');
const https = require('https');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { sessao, PERFIL } = require('./helpers/tokens');
const { detectarTipo, validarArquivo } = require('../src/helpers/uploadPolicy');
const { _sanitizar } = require('../src/helpers/auditoria');

const { on, callsMatching } = fakeDb._fake;
const comToken = (req, token) => req.set('Authorization', `Bearer ${token}`);

// ZIP com entradas stored (metodo 0) ou deflate (metodo 8).
function zip(entradas) {
  const locais = [];
  const centrais = [];
  let offset = 0;
  for (const entrada of entradas) {
    const nomeBuf = Buffer.from(entrada.nome, 'utf8');
    const original = Buffer.from(entrada.conteudo || '', 'utf8');
    const metodo = entrada.deflate ? 8 : 0;
    const dados = metodo === 8 ? zlib.deflateRawSync(original) : original;
    const descomprimido = entrada.descomprimido ?? original.length;
    const comprimido = entrada.comprimido ?? dados.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(comprimido >>> 0, 18);
    local.writeUInt32LE(descomprimido >>> 0, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    locais.push(local, nomeBuf, dados);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(comprimido >>> 0, 20);
    central.writeUInt32LE(descomprimido >>> 0, 24);
    central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrais.push(central, nomeBuf);
    offset += 30 + nomeBuf.length + dados.length;
  }
  const cd = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, cd, eocd]);
}

const CT = { nome: '[Content_Types].xml', conteudo: '<?xml version="1.0"?><Types/>', deflate: true };
const DOC = { nome: 'word/document.xml', conteudo: '<?xml version="1.0"?><w:document/>', deflate: true };

describe('Uploads OOXML: ZIP bomb, XXE e macros', () => {
  test('DOCX legítimo (deflate) é aceito', () => {
    expect(detectarTipo(zip([CT, DOC]), { contexto: 'documento' })).toBe('docx');
  });

  test('ZIP bomb por razão de compressão é recusado', () => {
    const bomba = { nome: 'word/media/x.bin', conteudo: 'a', descomprimido: 50 * 1024 * 1024, comprimido: 10 };
    expect(detectarTipo(zip([CT, DOC, bomba]), { contexto: 'documento' })).toBeNull();
  });

  test('ZIP64 (tamanho 0xFFFFFFFF) é recusado', () => {
    const z64 = { nome: 'word/x.bin', conteudo: 'a', descomprimido: 0xffffffff, comprimido: 0xffffffff };
    expect(detectarTipo(zip([CT, DOC, z64]), { contexto: 'documento' })).toBeNull();
  });

  test('XXE: parte XML com DOCTYPE/ENTITY é recusada', () => {
    const xxe = { nome: 'word/document.xml', conteudo: '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>', deflate: true };
    expect(detectarTipo(zip([CT, xxe]), { contexto: 'documento' })).toBeNull();
  });

  test('macro VBA (vbaProject.bin) e activeX são recusados', () => {
    expect(detectarTipo(zip([CT, DOC, { nome: 'word/vbaProject.bin', conteudo: 'x' }]), { contexto: 'documento' })).toBeNull();
    expect(detectarTipo(zip([CT, DOC, { nome: 'word/activeX/activeX1.xml', conteudo: '<x/>' }]), { contexto: 'documento' })).toBeNull();
  });
});

describe('Uploads: arquivos poliglotas e PDF ativo', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const arquivo = (buffer) => ({ buffer, originalname: 'x', fieldname: 'f' });

  test('PNG com <?php embutido é recusado', () => {
    expect(validarArquivo(arquivo(Buffer.concat([PNG, Buffer.from('....<?php system($_GET[c]); ?>')])), 'imagem').ok).toBe(false);
  });

  test('PNG com <svg/<script embutido é recusado', () => {
    expect(validarArquivo(arquivo(Buffer.concat([PNG, Buffer.from('<svg onload=alert(1)>')])), 'imagem').ok).toBe(false);
    expect(validarArquivo(arquivo(Buffer.concat([PNG, Buffer.from('<script>x</script>')])), 'imagem').ok).toBe(false);
  });

  test('PDF com /JavaScript, /Launch ou /EmbeddedFile é recusado; PDF simples é aceito', () => {
    expect(validarArquivo(arquivo(Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>')), 'documento').ok).toBe(false);
    expect(validarArquivo(arquivo(Buffer.from('%PDF-1.7\n1 0 obj << /S /Launch /F (cmd.exe) >>')), 'documento').ok).toBe(false);
    expect(validarArquivo(arquivo(Buffer.from('%PDF-1.7\n1 0 obj << /Type /EmbeddedFile >>')), 'documento').ok).toBe(false);
    expect(validarArquivo(arquivo(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >>\n%%EOF')), 'documento').ok).toBe(true);
  });

  test('PNG simples continua aceito', () => {
    expect(validarArquivo(arquivo(Buffer.concat([PNG, Buffer.alloc(64)])), 'imagem').ok).toBe(true);
  });
});

describe('Auditoria nunca grava segredos', () => {
  test('_sanitizar omite por chave e por valor', () => {
    const saida = _sanitizar({
      senha_atual: 'Senha#1',
      password: 'x',
      client_secret: 'abc',
      client_id: 'id-do-banco',
      authorization: 'Bearer abcdefghijklmnop',
      chave_privada: '-----BEGIN PRIVATE KEY-----',
      jwt: 'qualquer',
      nested: { token: 't', ok: 'valor' },
      valor_jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6NTZ9.assinatura',
      valor_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz012345',
      valor_blob: 'vercel_blob_rw_ABCDEF123',
      valor_pem: '-----BEGIN CERTIFICATE-----\nMII...',
      campos: ['email', 'senha'],
      rota: '/api/condominio/financeiro/integracao-bancaria/1'
    });
    for (const chave of ['senha_atual', 'password', 'client_secret', 'client_id', 'authorization', 'chave_privada', 'jwt',
      'valor_jwt', 'valor_hash', 'valor_blob', 'valor_pem']) {
      expect(saida[chave]).toBe('[omitido]');
    }
    expect(saida.nested).toEqual({ token: '[omitido]', ok: 'valor' });
    expect(saida.campos).toEqual(['email', 'senha']); // nomes de campos, não valores
    expect(saida.rota).toBe('/api/condominio/financeiro/integracao-bancaria/1');
  });

  test('reautenticação com senha errada: nenhuma escrita no banco contém a senha', async () => {
    const hash = await bcrypt.hash('SenhaAtual#1', 4);
    on(/SELECT senha_hash FROM "condominio-bh"\."tb-usuarios" WHERE id = :id/, () => [{ senha_hash: hash }]);
    const senhaDigitada = 'SenhaErrada#Secreta99';
    const res = await comToken(request(app).put('/api/condominio/financeiro/integracao-bancaria/1'), sessao({ id: 20, perfil: PERFIL.SINDICO }))
      .send({ multa_percentual: 2, senha_atual: senhaDigitada, client_secret: 'segredo-do-banco' });
    expect(res.status).toBe(422);
    const escritas = fakeDb._fake.state.calls.filter((c) => /^\s*(INSERT|UPDATE)/i.test(c.sql));
    expect(escritas.length).toBeGreaterThan(0);
    const tudo = JSON.stringify(escritas.map((c) => c.replacements));
    expect(tudo).not.toContain(senhaDigitada);
    expect(tudo).not.toContain('segredo-do-banco');
  });
});

describe('Testes sem rede', () => {
  test('fetch nativo é bloqueado por padrão', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow(/Rede bloqueada/);
  });

  test('node-fetch é bloqueado (delega ao fetch bloqueado)', async () => {
    await expect(require('node-fetch')('https://example.com')).rejects.toThrow(/Rede bloqueada/);
  });

  test('https.request / https.get são bloqueados', () => {
    expect(() => https.request('https://cdpj.partners.bancointer.com.br/oauth/v2/token')).toThrow(/Rede bloqueada/);
    expect(() => https.get({ hostname: 'api.telegram.org', path: '/' })).toThrow(/Rede bloqueada/);
  });

  test('http.request para host externo é bloqueado (loopback do supertest continua)', () => {
    expect(() => http.request({ hostname: 'example.com', path: '/' })).toThrow(/Rede bloqueada/);
  });

  test('axios é bloqueado', async () => {
    await expect(require('axios').post('https://example.com')).rejects.toThrow(/Rede bloqueada/);
  });
});

describe('Escopo de condomínio: Admin local x outro condomínio', () => {
  const adminLocal = () => sessao({ id: 56, perfil: PERFIL.ADMIN, condominio: 282 });

  test('GET /usuarios/condominio/3 → 403', async () => {
    const res = await comToken(request(app).get('/api/condominio/usuarios/condominio/3'), adminLocal());
    expect(res.status).toBe(403);
  });

  test('GET /condominios/3 → não encontra (filtro pelo condomínio do token)', async () => {
    on(/FROM "condominio-bh"\."tb-condominios" c\s+WHERE c\.id = :id/, () => [{ id: 3, nome: 'Outro' }]);
    const res = await comToken(request(app).get('/api/condominio/condominios/3'), adminLocal());
    expect([403, 404]).toContain(res.status);
  });

  test('GET /manutencao/rotinas?id_condominio=3 → 403', async () => {
    const res = await comToken(request(app).get('/api/condominio/manutencao/rotinas').query({ id_condominio: 3 }), adminLocal());
    expect(res.status).toBe(403);
  });

  test('super-admin (allowlist) pode consultar outro condomínio', async () => {
    process.env.SUPERADMIN_USER_IDS = '56';
    try {
      const res = await comToken(request(app).get('/api/condominio/manutencao/rotinas').query({ id_condominio: 3 }), adminLocal());
      expect(res.status).not.toBe(403);
      const consulta = callsMatching(/tb_manutencao_rotina|rotina/i).find((c) => c.replacements && c.replacements.id_condominio !== undefined);
      if (consulta) expect(consulta.replacements.id_condominio).toBe(3);
    } finally {
      delete process.env.SUPERADMIN_USER_IDS;
    }
  });
});
