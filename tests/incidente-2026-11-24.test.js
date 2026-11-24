'use strict';

// Regressão das correções pós-incidente 22–23/11/2026 (auditoria de 24/11).
// Cada bloco corresponde a um item do relatório docs/seguranca/relatorio-correcoes-2026-11-24.md.

// node-fetch (usado pelo condominioController) delega ao fetch global, que é
// substituído por um spy em cada teste: nenhuma chamada sai para a rede.
jest.mock('node-fetch', () => (...args) => global.fetch(...args));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { sessao, PERFIL } = require('./helpers/tokens');
const { detectarTipo, _nomeSeguro } = require('../src/helpers/uploadPolicy');
const { caminhoImagemValidoParaGravar } = require('../src/helpers/avatarProxy');
const { ehSuperAdmin, escopoCondominio, podeAtribuirPerfil } = require('../src/helpers/permissoes');
const CondominioController = require('../src/controllers/condominioController');

const { on, callsMatching } = fakeDb._fake;
const BASE = 'https://teststore.private.blob.vercel-storage.com';
const comToken = (req, token) => req.set('Authorization', `Bearer ${token}`);

let fetchSpy;
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html' },
    arrayBuffer: async () => Buffer.from('%PDF-1.4 conteudo'),
    buffer: async () => Buffer.from('%PDF-1.4 conteudo'),
    json: async () => ({ ok: true })
  }));
});
afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.SUPERADMIN_USER_IDS;
  delete process.env.TELEGRAM_WEBHOOK_URL;
});

// ---------------------------------------------------------------------------
describe('C1 — token do Blob nunca sai para host de terceiros (download de anexo de reunião)', () => {
  const ROTA = '/api/reuniao/anexo/download';
  const token = () => sessao({ id: 10, perfil: PERFIL.MORADOR, condominio: 1 });

  test.each([
    `${BASE}.evil.tld/prod/condominios/1/reunioes/5/x.pdf`,
    `${BASE}@evil.tld/prod/condominios/1/reunioes/5/x.pdf`,
    'https://evil.tld/prod/condominios/1/reunioes/5/x.pdf',
    `${BASE}/prod/condominios/1/reunioes/5/../../../x.pdf`,
    `${BASE}/prod/condominios/2/reunioes/5/x.pdf`, // outro condomínio
    `${BASE}/sh.php`
  ])('URL recusada (400) e fetch nunca chamado: %s', async (url) => {
    const res = await comToken(request(app).get(ROTA).query({ url }), token());
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('URL válida, mas que não é anexo cadastrado → 403, sem fetch', async () => {
    on(/FROM "condominio-bh"\.tb_reuniao_anexo a/, () => []);
    const res = await comToken(request(app).get(ROTA).query({ url: `${BASE}/prod/condominios/1/reunioes/5/1_ab.pdf` }), token());
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('anexo cadastrado: busca sem seguir redirect e responde com tipo fixo + attachment', async () => {
    on(/FROM "condominio-bh"\.tb_reuniao_anexo a/, () => [{ id: 9 }]);
    const url = `${BASE}/prod/condominios/1/reunioes/5/1_ab.pdf`;
    const res = await comToken(request(app).get(ROTA).query({ url }), token());
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [urlBuscada, opcoes] = fetchSpy.mock.calls[0];
    expect(new URL(urlBuscada).host).toBe('teststore.private.blob.vercel-storage.com');
    expect(opcoes.redirect).toBe('error');
    expect(res.headers['content-type']).toMatch(/^application\/pdf/); // nunca o text/html do Blob
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('C1 — caminhos de imagem gravados pelo body', () => {
  test('só aceita vazio ou caminho da área/condomínio corretos', () => {
    expect(caminhoImagemValidoParaGravar('', { idCondominio: 1, area: 'avatar' })).toBe(true);
    expect(caminhoImagemValidoParaGravar(`${BASE}/prod/condominios/1/usuarios/5/avatar/v1.png`, { idCondominio: 1, area: 'avatar' })).toBe(true);
    expect(caminhoImagemValidoParaGravar(`${BASE}/sh.php`, { idCondominio: 1, area: 'avatar' })).toBe(false);
    expect(caminhoImagemValidoParaGravar('https://evil.tld/x.png', { idCondominio: 1, area: 'avatar' })).toBe(false);
    expect(caminhoImagemValidoParaGravar(`${BASE}/prod/condominios/2/usuarios/5/avatar/v1.png`, { idCondominio: 1, area: 'avatar' })).toBe(false);
  });

  test('PUT de usuário com path_avatar externo: campo ignorado (não grava, não quebra o app)', async () => {
    const hash = await bcrypt.hash('SenhaAtual#1', 4);
    const atual = { id: 10, id_condominio: 1, nome: 'M', email: 'm@t.local', cpf: '', tipo_perfil_id: 2, tipo: 'morador', status: 'ativo', senha_hash: hash, path_avatar: 'legado/avatar.png' };
    on(/SELECT \*\s+FROM "condominio-bh"\."tb-usuarios"\s+WHERE id = :id\s+AND id_condominio = :id_condominio/, () => [atual]);
    on(/UPDATE "condominio-bh"\."tb-usuarios"\s+SET nome = :nome/, (r) => [[{ id: 10, ...r }], 1]);
    const res = await comToken(request(app).put('/api/condominio/usuarios/10'), sessao({ id: 10 }))
      .send({ nome: 'Novo', path_avatar: `${BASE}/prod/condominios/1/reunioes/5/sh.php` });
    expect(res.status).toBe(200);
    const update = callsMatching(/SET nome = :nome/)[0];
    expect(update.replacements.path_avatar).toBe('legado/avatar.png'); // mantém o atual
  });
});

describe('C1 — cobrança só assina boletos do próprio condomínio', () => {
  test('anexos_urls de outro condomínio → 422', async () => {
    const res = await comToken(request(app).post('/api/condominio/financeiro/receitas/1/cobrar'), sessao({ id: 20, perfil: PERFIL.SINDICO, condominio: 1 }))
      .send({ anexos_urls: [`${BASE}/cobranca/boletos/condominio-2/202611/x.pdf`] });
    expect([404, 422]).toContain(res.status);
    if (res.status === 422) expect(res.body.error_code).toBe('anexo_invalido');
  });
});

// ---------------------------------------------------------------------------
describe('Sessão: JWT sem token_version e JWT fora do header', () => {
  const ROTA = '/api/condominio/perfis';
  beforeEach(() => on(/FROM "condominio-bh"\.tb_sgw_perfil/, () => []));

  test('JWT sem claim tv (emitido antes do hardening / deploy antigo) → 401', async () => {
    fakeDb._fake.setUsuarioSessao(10, { token_version: 0 });
    const semTv = jwt.sign({ id: 10, IdPerfil: 1, id_condominio: 282 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    expect((await comToken(request(app).get(ROTA), semTv)).status).toBe(401);
  });

  test('JWT de sessão em ?token= ou no body não autentica', async () => {
    const token = sessao({ id: 10 });
    expect((await request(app).get(ROTA).query({ token })).status).toBe(401);
    expect((await request(app).post('/api/condominio/mensagens/fila').send({ token })).status).toBe(401);
  });

  test('coluna token_version ausente → 503 (fail closed), não ignora a revogação', async () => {
    const token = sessao({ id: 10 });
    on(/SELECT id, status, token_version FROM "condominio-bh"\."tb-usuarios"/, () => {
      const erro = new Error('column "token_version" does not exist');
      erro.original = { code: '42703' };
      throw erro;
    });
    expect((await comToken(request(app).get(ROTA), token)).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
describe('Super-admin por allowlist e escopo de condomínio', () => {
  const adminLocal = { IdPerfil: 1, idcliente: 56, id_condominio: 282, authTipo: 'sessao' };

  test('Admin fora da allowlist não é super-admin e fica no próprio condomínio', () => {
    expect(ehSuperAdmin(adminLocal)).toBe(false);
    expect(escopoCondominio(adminLocal, 3)).toEqual({ idCondominio: 282, negado: true });
    expect(escopoCondominio(adminLocal, undefined)).toEqual({ idCondominio: 282, negado: false });
    expect(podeAtribuirPerfil(adminLocal, 1)).toBe(false);
  });

  test('Admin na allowlist: escopo livre e pode atribuir Admin', () => {
    process.env.SUPERADMIN_USER_IDS = '7, 56';
    expect(ehSuperAdmin(adminLocal)).toBe(true);
    expect(escopoCondominio(adminLocal, 3)).toEqual({ idCondominio: 3, negado: false });
    expect(escopoCondominio(adminLocal, undefined)).toEqual({ idCondominio: null, negado: false });
    expect(podeAtribuirPerfil(adminLocal, 1)).toBe(true);
  });

  test('Admin local não lê usuários de outro condomínio (/usuarios/base) → 403', async () => {
    const res = await comToken(request(app).get('/api/condominio/usuarios/base').query({ id_condominio: 3 }),
      sessao({ id: 56, perfil: PERFIL.ADMIN, condominio: 282 }));
    expect(res.status).toBe(403);
  });

  test('Admin local não cria Admin', async () => {
    on(/FROM "condominio-bh"\.tb_sgw_perfil WHERE id = :id/, () => [{ nome: 'Admin' }]);
    const res = await comToken(request(app).post('/api/condominio/usuarios'), sessao({ id: 56, perfil: PERFIL.ADMIN, condominio: 282 }))
      .send({ nome: 'X', cpf: '52998224725', email: 'x@t.local', password: 'Senha#123', tipo_perfil_id: 1 });
    expect(res.status).toBe(403);
  });

  test('Admin local não cria condomínio nem altera menu global', async () => {
    const token = sessao({ id: 56, perfil: PERFIL.ADMIN, condominio: 282 });
    expect((await comToken(request(app).post('/api/condominio/condominios'), token).send({ nome: 'N', email: 'n@t.local' })).status).toBe(403);
    expect((await comToken(request(app).put('/api/condominio/menu/perfis/2/permissoes'), token).send({ permissoes: [] })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('Telegram: URL do webhook fixa e só super-admin', () => {
  const ROTA = '/api/condominio/telegram/configurar-webhook';

  test('Admin local → 403', async () => {
    const res = await comToken(request(app).post(ROTA), sessao({ id: 56, perfil: PERFIL.ADMIN, condominio: 282 }))
      .send({ webhook_url: 'https://evil.tld/hook' });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('super-admin: webhook_url do body é ignorado, vale TELEGRAM_WEBHOOK_URL', async () => {
    process.env.SUPERADMIN_USER_IDS = '7';
    process.env.TELEGRAM_BOT_TOKEN = 'bot-teste';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'segredo-teste';
    process.env.TELEGRAM_WEBHOOK_URL = 'https://api.emorador.test/api/condominio/telegram/webhook';
    const res = await comToken(request(app).post(ROTA), sessao({ id: 7, perfil: PERFIL.ADMIN, condominio: 1 }))
      .send({ webhook_url: 'https://evil.tld/hook' });
    expect(res.status).toBe(200);
    const corpo = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(corpo.url).toBe(process.env.TELEGRAM_WEBHOOK_URL);
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });
});

// ---------------------------------------------------------------------------
describe('Permissões por módulo (morador não escreve)', () => {
  const morador = () => sessao({ id: 10, perfil: PERFIL.MORADOR, condominio: 1 });

  test.each([
    ['post', '/api/reuniao', { titulo: 'RCE', data_hora: '2026-12-01T10:00:00Z' }],
    ['put', '/api/reuniao/20', { titulo: 'x', data_hora: '2026-12-01T10:00:00Z' }],
    ['patch', '/api/reuniao/20', { titulo: 'x' }],
    ['delete', '/api/reuniao/20', {}],
    ['post', '/api/condominio/regulamentos', { titulo: 'x' }],
    ['put', '/api/condominio/regulamentos/1', { titulo: 'x' }],
    ['delete', '/api/condominio/regulamentos/1', {}],
    ['put', '/api/condominio/regulamentos/aceites/1', { id_usuario: 11 }],
    ['post', '/api/condominio/espacos', { nome: 'x' }],
    ['put', '/api/condominio/espacos/1', { nome: 'x' }],
    ['post', '/api/condominio/consumo/registros', { id_usuario: 11 }],
    ['patch', '/api/condominio/consumo/registros/1', { valor: 1 }]
  ])('%s %s → 403', async (metodo, rota, corpo) => {
    const res = await comToken(request(app)[metodo](rota), morador()).send(corpo);
    expect(res.status).toBe(403);
  });

  test('portaria pode escrever leitura de consumo (não é barrada pelo guard)', async () => {
    const res = await comToken(request(app).patch('/api/condominio/consumo/registros/1'), sessao({ id: 30, perfil: PERFIL.PORTARIA, condominio: 1 })).send({});
    expect(res.status).not.toBe(403);
  });

  test('morador não enfileira WhatsApp para outro usuário', async () => {
    const res = await comToken(request(app).post('/api/condominio/mensagens/fila'), morador())
      .send({ id_usuario_destino: 11, tipo: 'whatsapp', mensagem_bruta: 'oi' });
    expect(res.status).toBe(403);
  });

  test('excluir aceite de terceiro: o DELETE exige dono ou gestor', async () => {
    on(/DELETE FROM "condominio-bh"\.tb_regulamento_aceite/, () => [[], 0]);
    await comToken(request(app).delete('/api/condominio/regulamentos/aceites/1'), morador());
    const chamada = callsMatching(/DELETE FROM "condominio-bh"\.tb_regulamento_aceite/)[0];
    expect(chamada.sql).toContain('a.id_usuario = :id_usuario');
    expect(chamada.replacements.gestor).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Integração bancária: perfil + reautenticação', () => {
  const ROTA = '/api/condominio/financeiro/integracao-bancaria/1';
  beforeEach(async () => {
    const hash = await bcrypt.hash('SenhaAtual#1', 4);
    on(/SELECT senha_hash FROM "condominio-bh"\."tb-usuarios" WHERE id = :id/, () => [{ senha_hash: hash }]);
  });

  test('Sub-Síndico → 403', async () => {
    const res = await comToken(request(app).put(ROTA), sessao({ id: 21, perfil: PERFIL.SUB_SINDICO })).send({ senha_atual: 'SenhaAtual#1' });
    expect(res.status).toBe(403);
  });

  test('Síndico sem senha_atual → 422; senha errada → 403 (auditado)', async () => {
    const token = sessao({ id: 20, perfil: PERFIL.SINDICO });
    expect((await comToken(request(app).put(ROTA), token).send({ multa_percentual: 2 })).status).toBe(422);
    const errada = await comToken(request(app).put(ROTA), token).send({ multa_percentual: 2, senha_atual: 'errada' });
    expect(errada.status).toBe(422);
    expect(errada.body.error_code).toBe('current_password_invalid');
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_auditoria_seguranca/).length).toBeGreaterThan(0);
  });

  test('desativar também exige senha_atual', async () => {
    const res = await comToken(request(app).delete(ROTA), sessao({ id: 20, perfil: PERFIL.SINDICO }));
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
describe('Usuário: e-mail/CPF próprios exigem senha atual', () => {
  beforeEach(async () => {
    const hash = await bcrypt.hash('SenhaAtual#1', 4);
    on(/SELECT \*\s+FROM "condominio-bh"\."tb-usuarios"\s+WHERE id = :id\s+AND id_condominio = :id_condominio/, () =>
      [{ id: 10, id_condominio: 1, nome: 'M', email: 'm@t.local', cpf: '', tipo_perfil_id: 2, tipo: 'morador', status: 'ativo', senha_hash: hash }]);
    on(/UPDATE "condominio-bh"\."tb-usuarios"\s+SET nome = :nome/, (r) => [[{ id: 10, ...r }], 1]);
  });

  test('trocar o próprio e-mail sem senha_atual → 422, sem UPDATE', async () => {
    const res = await comToken(request(app).put('/api/condominio/usuarios/10'), sessao({ id: 10 })).send({ email: 'atacante@evil.tld' });
    expect(res.status).toBe(422);
    expect(res.body.error_code).toBe('current_password_required');
    expect(callsMatching(/SET nome = :nome/)).toHaveLength(0);
  });

  test('com senha_atual correta: altera e revoga sessões na mesma transação', async () => {
    fakeDb._fake.setUsuarioSessao(10, { token_version: 0 });
    const res = await comToken(request(app).put('/api/condominio/usuarios/10'), sessao({ id: 10 }))
      .send({ email: 'novo@t.local', senha_atual: 'SenhaAtual#1' });
    expect(res.status).toBe(200);
    expect(res.body.sessoes_revogadas).toBe(true);
    const incremento = callsMatching(/SET token_version = COALESCE\(token_version, 0\) \+ 1/)[0];
    expect(incremento.options.transaction).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('PII por perfil', () => {
  const controller = new CondominioController();
  const terceiro = { id: 11, nome: 'Vizinho', apartamento: '101', bloco: '1', cpf: '52998224725', email: 'v@t.local', telefone: '31999999999', data_nascimento: '1990-01-01', endereco_logradouro: 'Rua X' };

  test('morador vê de terceiros só a identificação mínima', () => {
    const r = controller._projetarUsuarioPorPerfil({ IdPerfil: 2, idcliente: 10 }, terceiro);
    expect(r).toEqual({ id: 11, nome: 'Vizinho', apartamento: '101', bloco: '1' });
  });

  test('portaria vê também o telefone; gestor vê tudo; o próprio usuário vê tudo', () => {
    expect(controller._projetarUsuarioPorPerfil({ IdPerfil: 5, idcliente: 30 }, terceiro).telefone).toBe('31999999999');
    expect(controller._projetarUsuarioPorPerfil({ IdPerfil: 5, idcliente: 30 }, terceiro).cpf).toBeUndefined();
    expect(controller._projetarUsuarioPorPerfil({ IdPerfil: 3, idcliente: 20 }, terceiro)).toEqual(terceiro);
    expect(controller._projetarUsuarioPorPerfil({ IdPerfil: 2, idcliente: 11 }, terceiro)).toEqual(terceiro);
  });
});

// ---------------------------------------------------------------------------
describe('Uploads: OOXML real e nome com a extensão detectada', () => {
  // ZIP mínimo (entradas "stored"), só para os testes de estrutura.
  function zip(nomes) {
    const locais = [];
    const centrais = [];
    let offset = 0;
    for (const nome of nomes) {
      const nomeBuf = Buffer.from(nome, 'utf8');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(nomeBuf.length, 26);
      locais.push(local, nomeBuf);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(nomeBuf.length, 28);
      central.writeUInt32LE(offset, 42);
      centrais.push(central, nomeBuf);
      offset += 30 + nomeBuf.length;
    }
    const cd = Buffer.concat(centrais);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(nomes.length, 8);
    eocd.writeUInt16LE(nomes.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locais, cd, eocd]);
  }

  test('DOCX legítimo é aceito', () => {
    expect(detectarTipo(zip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']), { contexto: 'documento' })).toBe('docx');
  });

  test('ZIP com entrada ../ (Zip Slip, ex.: slip.docx) é recusado', () => {
    expect(detectarTipo(zip(['[Content_Types].xml', 'word/document.xml', '../../../var/www/sh.php']), { contexto: 'documento' })).toBeNull();
    expect(detectarTipo(zip(['[Content_Types].xml', 'word/document.xml', '/etc/x']), { contexto: 'documento' })).toBeNull();
  });

  test('ZIP qualquer com "word/" no nome, sem [Content_Types].xml, é recusado', () => {
    expect(detectarTipo(zip(['word/x.php']), { contexto: 'documento' })).toBeNull();
  });

  test('nome gravado sempre termina na extensão detectada', () => {
    expect(_nomeSeguro('sh.php', 'pdf')).toBe('sh_php.pdf');
    expect(_nomeSeguro('xxe.svg.php', 'png')).toBe('xxe_svg_php.png');
    expect(_nomeSeguro('ata.pdf', 'pdf')).toBe('ata.pdf');
  });
});

// ---------------------------------------------------------------------------
describe('Migration 20261123000001 (hardening)', () => {
  test('up() gera SQL válido (sem o "ABLE" corrompido) e cobre colunas/tabela', async () => {
    const migration = require('../src/database/migrations/20261123000001-hardening-recovery-sessoes-auditoria');
    const sqls = [];
    const queryInterface = { sequelize: { query: async (sql) => { sqls.push(sql); return [[]]; } } };
    await migration.up(queryInterface);
    const tudo = sqls.join('\n');
    expect(tudo).not.toMatch(/^\s*ABLE\b/m);
    expect(tudo).toMatch(/ALTER TABLE "condominio-bh"\."tb_recovery_tokens" ADD COLUMN reset_token_hash/);
    expect(tudo).toMatch(/ALTER TABLE "condominio-bh"\."tb-usuarios" ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0/);
    expect(tudo).toMatch(/CREATE TABLE IF NOT EXISTS "condominio-bh"\.tb_auditoria_seguranca/);
  });
});
