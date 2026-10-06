import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerStage2Routes } from '../src/modules/stage2.js';
const payload = {
  clientId: '11111111-1111-4111-8111-111111111111', establishmentId: '22222222-2222-4222-8222-222222222222',
  code: 'TEST-001', name: 'Proyecto Demo SAFE ENTER',
  description: 'Proyecto de prueba para validar la gestión de clientes, establecimientos y proyectos en SAFE ENTER 360.',
  startsOn: '2026-10-05', dueOn: '2026-10-12'
};
async function setup(query = vi.fn()) {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  await registerStage2Routes(app, { query } as any, () => [async (request: any) => {
    request.authUser = { organizationId: '33333333-3333-4333-8333-333333333333', id: '44444444-4444-4444-8444-444444444444' };
  }]);
  return app;
}
it('POST accepts the demo project, preserves IDs/dates and records creation audit', async () => {
  const id = '55555555-5555-4555-8555-555555555555';
  const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ id }] }).mockResolvedValueOnce({ rows: [] });
  const app = await setup(query);
  try {
    const response = await app.inject({ method: 'POST', url: '/projects', payload });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id });
    expect(query.mock.calls[0][1]).toEqual(['33333333-3333-4333-8333-333333333333', payload.clientId, payload.establishmentId, payload.code, payload.name, payload.description, payload.startsOn, payload.dueOn]);
    expect(query.mock.calls[1][1]).toContain('project.create');
  } finally { await app.close(); }
});
it('POST rejects invalid dates with field details before querying the database', async () => {
  const query = vi.fn();
  const app = await setup(query);
  try {
    const response = await app.inject({ method: 'POST', url: '/projects', payload: { ...payload, dueOn: '2026-10-01' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_INPUT', details: { fieldErrors: { dueOn: ['La fecha límite no puede ser anterior a la fecha de inicio.'] } } });
    expect(query).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
it('POST explains unavailable relationships without attempting audit', async () => {
  const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
  const app = await setup(query);
  try {
    const response = await app.inject({ method: 'POST', url: '/projects', payload });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'ESTABLISHMENT_UNAVAILABLE', message: expect.any(String) });
    expect(query).toHaveBeenCalledTimes(1);
  } finally { await app.close(); }
});

it('POST validates TEST-001 while rejecting a typographic hyphen without weakening the API pattern', async () => {
  const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'project-id' }] }).mockResolvedValueOnce({ rows: [] });
  const app = await setup(query);
  try {
    expect((await app.inject({ method: 'POST', url: '/projects', payload: { ...payload, code: 'TEST-001' } })).statusCode).toBe(201);
    query.mockClear();
    const invalid = await app.inject({ method: 'POST', url: '/projects', payload: { ...payload, code: 'TEST\u2011001' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: 'INVALID_INPUT', details: { fieldErrors: { code: [expect.any(String)] } } });
    expect(query).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
