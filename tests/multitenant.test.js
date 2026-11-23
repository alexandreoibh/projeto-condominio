'use strict';

const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { sessao, PERFIL } = require('./helpers/tokens');

const { on, callsMatching } = fakeDb._fake;

// Síndico do condomínio 1 tentando alcançar recursos do condomínio 2.
const tokenSindicoA = () => sessao({ id: 20, perfil: PERFIL.SINDICO, condominio: 1 });
const auth = (req, token) => req.set('Authorization', `Bearer ${token}`);

describe('Isolamento entre condomínios', () => {
  test('buscar condomínio de outro tenant → 404', async () => {
    on(/FROM "condominio-bh"\."tb-condominios" c\s+WHERE c\.id = :id/, () => [{ id: 2, nome: 'B' }]);
    const res = await auth(request(app).get('/api/condominio/condominios/2'), tokenSindicoA());
    expect(res.status).toBe(404);
  });

  test('listar condomínios fica restrito ao do token (não-Admin)', async () => {
    on(/COUNT\(\*\)::int AS total\s+FROM "condominio-bh"\."tb-condominios"/, () => [{ total: 1 }]);
    await auth(request(app).get('/api/condominio/condominios'), tokenSindicoA());
    const consulta = callsMatching(/FROM "condominio-bh"\."tb-condominios" c/)[0];
    expect(consulta.sql).toContain('c.id = :id_condominio_token');
    expect(consulta.replacements.id_condominio_token).toBe(1);
  });

  test('editar condomínio de outro tenant → 403; morador não edita nem o próprio', async () => {
    expect((await auth(request(app).put('/api/condominio/condominios/2'), tokenSindicoA()).send({ nome: 'x' })).status).toBe(403);
    expect((await auth(request(app).put('/api/condominio/condominios/1'), sessao({ id: 10, condominio: 1 })).send({ nome: 'x' })).status).toBe(403);
  });

  test('criar condomínio exige Admin', async () => {
    const res = await auth(request(app).post('/api/condominio/condominios'), tokenSindicoA()).send({ nome: 'Novo', email: 'n@t.local' });
    expect(res.status).toBe(403);
  });

  test('editar registro do dashboard de outro condomínio → 404, sem UPDATE', async () => {
    on(/FROM "condominio-bh"\.tb_dashboard_registro\s+WHERE id = :id/, (r) =>
      (r.id_condominio_escopo === 2 ? [{ id: 50, id_condominio: 2, id_usuario: 99 }] : []));
    const res = await auth(request(app).put('/api/condominio/dashboard/registros/50'), tokenSindicoA()).send({ titulo: 'x', id_condominio: 2 });
    expect(res.status).toBe(404);
    expect(callsMatching(/UPDATE "condominio-bh"\.tb_dashboard_registro/)).toHaveLength(0);
  });

  test('excluir registro do dashboard de outro condomínio → 404', async () => {
    on(/FROM "condominio-bh"\.tb_dashboard_registro\s+WHERE id = :id/, () => []);
    const res = await auth(request(app).delete('/api/condominio/dashboard/registros/50'), tokenSindicoA());
    expect(res.status).toBe(404);
    expect(callsMatching(/SET status = 'inativo'/)).toHaveLength(0);
  });

  test('morador não altera registro de dashboard de outro morador', async () => {
    on(/FROM "condominio-bh"\.tb_dashboard_registro\s+WHERE id = :id/, () => [{ id: 50, id_condominio: 1, id_usuario: 99 }]);
    const res = await auth(request(app).put('/api/condominio/dashboard/registros/50'), sessao({ id: 10, condominio: 1 })).send({ titulo: 'x' });
    expect(res.status).toBe(403);
  });

  test('editar usuário de outro condomínio → 404', async () => {
    on(/SELECT \*\s+FROM "condominio-bh"\."tb-usuarios"\s+WHERE id = :id\s+AND id_condominio = :id_condominio/, () => []);
    const res = await auth(request(app).put('/api/condominio/usuarios/77'), tokenSindicoA()).send({ nome: 'x' });
    expect(res.status).toBe(404);
    expect(callsMatching(/WHERE id = :id\s+AND id_condominio = :id_condominio/)[0].replacements.id_condominio).toBe(1);
  });

  test('id_condominio no body não muda o tenant do avatar (não-Admin)', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    on(/SELECT id, path_avatar\s+FROM "condominio-bh"\."tb-usuarios"/, () => []);
    await auth(request(app).post('/api/condominio/usuarios/upload-avatar'), tokenSindicoA())
      .field('id_usuario', '77').field('id_condominio', '2')
      .attach('path_avatar', png, { filename: 'a.png', contentType: 'image/png' });
    const consulta = callsMatching(/SELECT id, path_avatar\s+FROM "condominio-bh"\."tb-usuarios"/)[0];
    expect(consulta.replacements.id_condominio).toBe(1);
  });

  test('morador só cancela a própria reserva e não aprova reservas', async () => {
    on(/SELECT id_usuario\s+FROM "condominio-bh"\.tb_espaco_agenda/, () => [{ id_usuario: 99 }]);
    on(/FROM "condominio-bh"\.tb_status_tratamento\s+WHERE id = :id_status/, (r) => [{ id: r.id_status, descricao_status: 'x' }]);
    const token = sessao({ id: 10, condominio: 1 });
    expect((await auth(request(app).patch('/api/condominio/espacos/agenda/5/tratamento'), token).send({ status_code: 3 })).status).toBe(403);
    expect((await auth(request(app).patch('/api/condominio/espacos/agenda/5/tratamento'), token).send({ status_code: 5 })).status).toBe(403);
  });
});

describe('Rotas administrativas globais', () => {
  test('push de teste e instância do WhatsApp exigem Admin', async () => {
    const token = tokenSindicoA();
    expect((await auth(request(app).post('/api/usuario/push/teste'), token).send({ id_usuario: 5, title: 't', body: 'b' })).status).toBe(403);
    expect((await auth(request(app).post('/api/whatsapp/instancia'), token).send({ instance_name: 'x', status: 'CONECTADO' })).status).toBe(403);
  });

  test('tipos de dashboard (tabela global) exigem Admin', async () => {
    expect((await auth(request(app).post('/api/condominio/dashboard/tipos'), tokenSindicoA()).send({ nome: 'x' })).status).toBe(403);
  });
});
