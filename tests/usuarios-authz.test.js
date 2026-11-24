'use strict';

const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { sessao, convite, PERFIL } = require('./helpers/tokens');

const { on, callsMatching } = fakeDb._fake;

// Usuários do condomínio 1 (e um do condomínio 2) no banco falso.
let USUARIOS;
beforeEach(async () => {
  const senhaHash = await bcrypt.hash('SenhaAtual#1', 4);
  USUARIOS = {
    10: { id: 10, id_condominio: 1, nome: 'Morador', email: 'm@t.local', cpf: '', tipo_perfil_id: 2, tipo: 'morador', status: 'ativo', senha_hash: senhaHash, morador_principal: false },
    11: { id: 11, id_condominio: 1, nome: 'Vizinho', email: null, cpf: '', tipo_perfil_id: 2, tipo: 'morador', status: 'ativo', senha_hash: senhaHash, morador_principal: false },
    12: { id: 12, id_condominio: 1, nome: 'Admin', email: 'a@t.local', cpf: '', tipo_perfil_id: 1, tipo: 'admin', status: 'ativo', senha_hash: senhaHash, morador_principal: false },
    20: { id: 20, id_condominio: 1, nome: 'Sindico', email: 's@t.local', cpf: '', tipo_perfil_id: 3, tipo: 'sindico', status: 'ativo', senha_hash: senhaHash, morador_principal: false },
    77: { id: 77, id_condominio: 2, nome: 'Outro condominio', email: 'o@t.local', cpf: '', tipo_perfil_id: 2, tipo: 'morador', status: 'ativo', senha_hash: senhaHash, morador_principal: false }
  };
  on(/SELECT \*\s+FROM "condominio-bh"\."tb-usuarios"\s+WHERE id = :id\s+AND id_condominio = :id_condominio/, (r) => {
    const u = USUARIOS[r.id];
    return u && u.id_condominio === r.id_condominio ? [u] : [];
  });
  on(/UPDATE "condominio-bh"\."tb-usuarios"\s+SET nome = :nome/, (r) => [[{ ...USUARIOS[r.id], ...r, senha_hash: undefined }], 1]);
  on(/FROM "condominio-bh"\.tb_sgw_perfil WHERE id = :id/, () => [{ nome: 'Sindico' }]);
});

const put = (id, token, corpo) => request(app).put(`/api/condominio/usuarios/${id}`).set('Authorization', `Bearer ${token}`).send(corpo);

describe('Escalonamento de privilégio (vertical)', () => {
  test('morador não se promove a Admin', async () => {
    const res = await put(10, sessao({ id: 10, perfil: PERFIL.MORADOR }), { tipo_perfil_id: 1 });
    expect(res.status).toBe(403);
    expect(callsMatching(/SET nome = :nome/)).toHaveLength(0);
  });

  test('morador não muda o próprio status nem o tipo', async () => {
    expect((await put(10, sessao({ id: 10 }), { status: 'inativo' })).status).toBe(403);
    // mudar `tipo` (nome do perfil) também é administrativo
    expect((await put(10, sessao({ id: 10 }), { tipo: 'admin' })).status).toBe(403);
    // formulário que reenvia o registro inteiro sem mudanças continua funcionando
    const res = await put(10, sessao({ id: 10 }), { tipo: 'morador', tipo_perfil_id: 2, status: 'ativo', nome: 'Novo Nome' });
    expect(res.status).toBe(200);
    expect(callsMatching(/SET nome = :nome/)[0].replacements.tipo).toBe('morador');
  });

  test('morador não cria usuários', async () => {
    const res = await request(app).post('/api/condominio/usuarios')
      .set('Authorization', `Bearer ${sessao({ id: 10 })}`)
      .send({ nome: 'X', cpf: '52998224725', email: 'x@t.local', password: 'Senha#123', tipo_perfil_id: 2 });
    expect(res.status).toBe(403);
  });

  test('síndico não cria Admin', async () => {
    const res = await request(app).post('/api/condominio/usuarios')
      .set('Authorization', `Bearer ${sessao({ id: 20, perfil: PERFIL.SINDICO })}`)
      .send({ nome: 'X', cpf: '52998224725', email: 'x@t.local', password: 'Senha#123', tipo_perfil_id: 1 });
    expect(res.status).toBe(403);
  });

  test('síndico não promove ninguém a Admin nem edita um Admin', async () => {
    const tokenSindico = sessao({ id: 20, perfil: PERFIL.SINDICO });
    expect((await put(11, tokenSindico, { tipo_perfil_id: 1 })).status).toBe(403);
    expect((await put(12, tokenSindico, { nome: 'Mudei' })).status).toBe(403);
    expect((await put(20, tokenSindico, { tipo_perfil_id: 1 })).status).toBe(403);
  });

  test('sub-síndico não atribui perfil de Síndico', async () => {
    const tokenSub = sessao({ id: 30, perfil: PERFIL.SUB_SINDICO });
    expect((await put(11, tokenSub, { tipo_perfil_id: 3 })).status).toBe(403);
  });
});

describe('Escalonamento horizontal', () => {
  test('morador não edita outro morador (nem a senha dele)', async () => {
    const res = await put(11, sessao({ id: 10 }), { password: 'Invasor#1' });
    expect(res.status).toBe(403);
  });

  test('síndico edita morador do próprio condomínio e a sessão do alvo é revogada ao trocar senha', async () => {
    fakeDb._fake.setUsuarioSessao(11, { token_version: 0 });
    const res = await put(11, sessao({ id: 20, perfil: PERFIL.SINDICO }), { password: 'NovaSenha#1' });
    expect(res.status).toBe(200);
    expect(fakeDb._fake.state.usuarios.get(11).token_version).toBe(1);
    const auditoria = callsMatching(/INSERT INTO "condominio-bh"\.tb_auditoria_seguranca/);
    expect(auditoria.length).toBe(1);
    expect(auditoria[0].replacements.detalhes).not.toMatch(/NovaSenha/);
  });
});

describe('Troca da própria senha (contrato do app: senha_atual / nova_senha)', () => {
  test('sem senha_atual → 422', async () => {
    const res = await request(app).patch('/api/condominio/usuarios/10')
      .set('Authorization', `Bearer ${sessao({ id: 10 })}`)
      .send({ nova_senha: 'Nova#1234', confirmar_senha: 'Nova#1234' });
    expect(res.status).toBe(422);
  });

  test('senha_atual errada → 422 (nunca 401, que o app trataria como sessão expirada)', async () => {
    const res = await request(app).patch('/api/condominio/usuarios/10')
      .set('Authorization', `Bearer ${sessao({ id: 10 })}`)
      .send({ senha_atual: 'errada', nova_senha: 'Nova#1234', confirmar_senha: 'Nova#1234' });
    expect(res.status).toBe(422);
    expect(res.body.error_code).toBe('current_password_invalid');
  });

  test('confirmação divergente → 422', async () => {
    const res = await request(app).patch('/api/condominio/usuarios/10')
      .set('Authorization', `Bearer ${sessao({ id: 10 })}`)
      .send({ senha_atual: 'SenhaAtual#1', nova_senha: 'Nova#1234', confirmar_senha: 'Outra#1234' });
    expect(res.status).toBe(422);
  });

  test('senha_atual correta → 200, grava bcrypt e revoga sessões', async () => {
    const res = await request(app).patch('/api/condominio/usuarios/10')
      .set('Authorization', `Bearer ${sessao({ id: 10 })}`)
      .send({ senha_atual: 'SenhaAtual#1', nova_senha: 'Nova#1234', confirmar_senha: 'Nova#1234' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const gravado = callsMatching(/SET nome = :nome/)[0].replacements.senha_hash;
    expect(await bcrypt.compare('Nova#1234', gravado)).toBe(true);
    expect(res.body.sessoes_revogadas).toBe(true);
  });
});

describe('authOrInviteToken / invite_token', () => {
  test('string qualquer em token/invite_token não pula mais a autenticação', async () => {
    const res = await request(app).put('/api/condominio/usuarios/11').send({ token: 'abc', password: 'x' });
    expect(res.status).toBe(401);
  });

  test('convite de morador (sem id_usuario) não edita ninguém', async () => {
    const res = await request(app).put('/api/condominio/usuarios/11')
      .send({ invite_token: convite(), password: 'Invasor#1' });
    expect(res.status).toBe(403);
    expect(callsMatching(/SET nome = :nome/)).toHaveLength(0);
  });

  test('convite com id_usuario não altera campos sensíveis', async () => {
    const res = await request(app).put('/api/condominio/usuarios/11')
      .send({ invite_token: convite({ id_usuario: 11 }), password: 'Invasor#1', tipo_perfil_id: 1 });
    expect(res.status).toBe(403);
  });

  test('relatórios: criar configuração exige sessão de gestor (convite não basta)', async () => {
    const corpo = { dia_envio: 1, horario_envio: '08:00', emails_destinatarios: ['fora@atacante.tld'], relatorio: 'x' };
    expect((await request(app).post('/api/condominio/relatorios/envio-config').send({ ...corpo, invite_token: convite() })).status).toBe(401);
    expect((await request(app).post('/api/condominio/relatorios/envio-config')
      .set('Authorization', `Bearer ${sessao({ id: 10 })}`).send(corpo)).status).toBe(403);
  });
});
