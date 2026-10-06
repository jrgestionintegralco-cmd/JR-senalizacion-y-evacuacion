import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';
import { saveProjectAndReload } from './project-save';
import { projectCodeFromForm } from './project-code';
afterEach(() => vi.unstubAllGlobals());
const payload = {
  clientId: '11111111-1111-4111-8111-111111111111', establishmentId: '22222222-2222-4222-8222-222222222222',
  code: 'TEST-001', name: 'Proyecto Demo SAFE ENTER',
  description: 'Proyecto de prueba para validar la gestión de clientes, establecimientos y proyectos en SAFE ENTER 360.',
  startsOn: '2026-10-05', dueOn: '2026-10-12'
};
const save = () => api('/projects', { method: 'POST', body: JSON.stringify(payload) });
it('guarda el payload de prueba y después recarga la lista', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'project-id' }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ projects: [{ ...payload, id: 'project-id' }] })));
  vi.stubGlobal('fetch', fetch);
  let projects: unknown[] = [];
  const result = await saveProjectAndReload(save, async () => { projects = (await api<{ projects: unknown[] }>('/projects')).projects; });
  expect(result).toEqual({ saved: true });
  expect(projects).toHaveLength(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
});
it('un rechazo muestra su motivo y no recarga ni comunica éxito', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'INVALID_INPUT', details: { fieldErrors: { establishmentId: ['UUID inválido'] } } }), { status: 400 })));
  const reload = vi.fn();
  const result = await saveProjectAndReload(save, reload);
  expect(result.saved).toBe(false);
  if (!result.saved) expect((result.error as Error).message).toBe('Establecimiento: UUID inválido');
  expect(reload).not.toHaveBeenCalled();
});
it('un fallo de recarga conserva el éxito de creación y no repite POST', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Lista temporalmente no disponible' }), { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const result = await saveProjectAndReload(save, () => api('/projects'));
  expect(result.saved).toBe(true);
  if (result.saved) expect(result.reloadError).toMatchObject({ message: 'Lista temporalmente no disponible' });
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it.each(['TEST-001', 'JR-001', 'OBRA_001', 'PROY.2026'])(
  'envía %s desde el formulario a POST /api/projects y recarga tras el éxito', async (code) => {
    const data = new FormData(); data.set('code', code);
    const fetch = vi.fn().mockResolvedValue(new Response('{"id":"synthetic-project"}', { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const reload = vi.fn().mockResolvedValue(undefined);
    const result = await saveProjectAndReload(
      () => api('/projects', { method: 'POST', body: JSON.stringify({ ...payload, code: projectCodeFromForm(data) }) }), reload
    );
    expect(result).toEqual({ saved: true });
    expect(fetch.mock.calls[0][0]).toBe('/api/projects');
    expect(fetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetch.mock.calls[0][1].body).code).toBe(code);
    expect(reload).toHaveBeenCalledOnce();
  }
);
