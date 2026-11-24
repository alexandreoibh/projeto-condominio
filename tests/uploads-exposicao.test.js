'use strict';

const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { detectarTipo } = require('../src/helpers/uploadPolicy');
const { resolveBlobUrl } = require('../src/helpers/avatarProxy');
const { sessao, PERFIL } = require('./helpers/tokens');

const { on } = fakeDb._fake;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
const ROTA_AVATAR = '/api/condominio/usuarios/upload-avatar';

describe('Uploads', () => {
  test('sem autenticação → 401', async () => {
    const res = await request(app).post(ROTA_AVATAR).attach('path_avatar', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  test.each([
    ['HTML disfarçado de PNG', Buffer.from('<html><script>alert(1)</script></html>'), 'a.png', 'image/png'],
    ['SVG com script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'a.svg', 'image/svg+xml'],
    ['executável Windows', Buffer.from('4d5a90000300000004000000ffff0000', 'hex'), 'a.exe', 'application/octet-stream'],
    ['script com extensão de imagem', Buffer.from('#!/bin/sh\nrm -rf /'), 'a.jpg', 'image/jpeg']
  ])('%s → 415', async (nome, conteudo, arquivo, tipo) => {
    const res = await request(app).post(ROTA_AVATAR)
      .set('Authorization', `Bearer ${sessao({ id: 10 })}`)
      .field('id_usuario', '10')
      .attach('path_avatar', conteudo, { filename: arquivo, contentType: tipo });
    expect(res.status).toBe(415);
  });

  test('PNG real passa pela política (e só o próprio usuário troca o avatar)', async () => {
    on(/SELECT id, path_avatar\s+FROM "condominio-bh"\."tb-usuarios"/, () => []);
    const proprio = await request(app).post(ROTA_AVATAR)
      .set('Authorization', `Bearer ${sessao({ id: 10 })}`)
      .field('id_usuario', '10')
      .attach('path_avatar', PNG, { filename: '../../etc/a.png', contentType: 'image/png' });
    expect(proprio.status).not.toBe(415);
    expect(proprio.status).not.toBe(403);

    const outro = await request(app).post(ROTA_AVATAR)
      .set('Authorization', `Bearer ${sessao({ id: 10 })}`)
      .field('id_usuario', '11')
      .attach('path_avatar', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(outro.status).toBe(403);
  });

  test('documento financeiro exige PDF/imagem/Office reais', async () => {
    const token = sessao({ id: 20, perfil: PERFIL.SINDICO });
    const res = await request(app).post('/api/condominio/financeiro/receitas/1/documentos')
      .set('Authorization', `Bearer ${token}`)
      .attach('arquivo', Buffer.from('<html></html>'), { filename: 'nota.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(415);
  });

  test('detecção por conteúdo', () => {
    expect(detectarTipo(PNG)).toBe('png');
    expect(detectarTipo(Buffer.from('%PDF-1.7\n'))).toBe('pdf');
    expect(detectarTipo(Buffer.from('ffd8ffe000104a46', 'hex'))).toBe('jpeg');
    expect(detectarTipo(Buffer.from('-----BEGIN CERTIFICATE-----'), { contexto: 'certificado' })).toBe('pem');
    expect(detectarTipo(Buffer.from('-----BEGIN CERTIFICATE-----'), { contexto: 'imagem' })).toBeNull();
    expect(detectarTipo(Buffer.from('<svg/>'))).toBeNull();
  });
});

describe('SSRF / vazamento do token do Blob', () => {
  test.each([
    'https://teststore.private.blob.vercel-storage.com.atacante.tld/x.png',
    'http://169.254.169.254/latest/meta-data/',
    'https://atacante.tld/avatar.png',
    'http://teststore.private.blob.vercel-storage.com/x.png'
  ])('URL externa não é resolvida: %s', (url) => {
    expect(resolveBlobUrl(url)).toBeNull();
  });

  test('blob de outro condomínio ou financeiro não é servido pelo proxy de imagem', () => {
    const base = 'https://teststore.private.blob.vercel-storage.com';
    expect(resolveBlobUrl(`${base}/prod/condominios/2/usuarios/5/avatar/v1.png`, { idCondominio: 1, area: 'avatar' })).toBeNull();
    expect(resolveBlobUrl(`${base}/prod/condominios/1/financeiro/despesas/1/nf.pdf`, { idCondominio: 1, area: 'avatar' })).toBeNull();
    expect(resolveBlobUrl(`${base}/cobranca/boletos/condominio-1/202611/x.pdf`, { idCondominio: 1, area: 'avatar' })).toBeNull();
    expect(resolveBlobUrl(`${base}/prod/condominios/1/usuarios/5/avatar/v1.png`, { idCondominio: 1, area: 'avatar' })).toBe(`${base}/prod/condominios/1/usuarios/5/avatar/v1.png`);
  });

  test('proxy exige a área certa, extensão de imagem e caminho com condomínio', () => {
    const base = 'https://teststore.private.blob.vercel-storage.com';
    const avatar = `${base}/prod/condominios/1/usuarios/5/avatar/v1.png`;
    expect(resolveBlobUrl(avatar, { idCondominio: 1 })).toBeNull(); // sem área
    expect(resolveBlobUrl(avatar, { idCondominio: 1, area: 'consumo' })).toBeNull();
    expect(resolveBlobUrl(`${base}/prod/condominios/1/usuarios/5/avatar/sh.php`, { idCondominio: 1, area: 'avatar' })).toBeNull();
    expect(resolveBlobUrl(`${base}/prod/condominios/1/usuarios/5/avatar/xxe.svg`, { idCondominio: 1, area: 'avatar' })).toBeNull();
    expect(resolveBlobUrl(`${base}/sh.php`, { idCondominio: 1, area: 'avatar' })).toBeNull(); // legado sem condomínio
    expect(resolveBlobUrl(avatar.replace('.com/', '.com.evil.tld/'), { idCondominio: 1, area: 'avatar' })).toBeNull();
  });
});

describe('Exposição de informações', () => {
  test('erros 500 não devolvem detail (mensagem interna/SQL)', async () => {
    on(/FROM "condominio-bh"\.tb_sgw_perfil/, () => { throw new Error('relation "tb_x" does not exist SELECT * FROM segredo'); });
    const res = await request(app).get('/api/condominio/perfis').set('Authorization', `Bearer ${sessao({ perfil: PERFIL.SINDICO })}`);
    expect(res.status).toBe(500);
    expect(res.body.detail).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('segredo');
  });

  test('headers de segurança e sem x-powered-by', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('pastas estáticas não servem scripts legados', async () => {
    expect((await request(app).get('/uploads/transaction/116/swagger-produtos.js')).status).toBe(404);
  });

  test('token inválido não devolve o detalhe do erro JWT', async () => {
    const res = await request(app).get('/api/condominio/perfis').set('Authorization', 'Bearer a.b.c-invalido-qualquer');
    expect(res.status).toBe(401);
    expect(res.body.detail).toBeUndefined();
  });
});
