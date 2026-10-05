import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, apiErrorMessage, ApiError } from './api';
afterEach(() => vi.unstubAllGlobals());
describe('errores útiles de la API', () => {
  it('muestra el campo y motivo real de INVALID_INPUT sin message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'INVALID_INPUT', details: { formErrors: [], fieldErrors: { dueOn: ['La fecha límite no puede ser anterior a la fecha de inicio.'] } }
    }), { status: 400 })));
    await expect(api('/projects')).rejects.toThrow('Fecha límite: La fecha límite no puede ser anterior a la fecha de inicio.');
  });
  it('conserva message y añade detalles sin duplicar errores generales', () => {
    expect(apiErrorMessage({ message: 'Revisa el formulario.', details: { formErrors: ['Revisa el formulario.'], fieldErrors: { code: ['Código inválido.'] } } }, 400))
      .toBe('Revisa el formulario. Código: Código inválido.');
  });
  it('interpreta errores anidados, issues y problem details', () => {
    expect(apiErrorMessage({ error: { message: 'Datos rechazados', details: [{ path: ['clientId'], message: 'UUID inválido' }] } }, 400))
      .toBe('Datos rechazados Cliente: UUID inválido');
    expect(apiErrorMessage({ title: 'Conflicto', detail: 'Código ya registrado' }, 409)).toBe('Código ya registrado');
  });
  it('muestra código o estado HTTP si no hay detalles y tolera cuerpos inesperados', () => {
    expect(apiErrorMessage({ error: 'ESTABLISHMENT_UNAVAILABLE' }, 409)).toContain('ESTABLISHMENT_UNAVAILABLE');
    for (const body of [null, {}, 5]) expect(apiErrorMessage(body, 502)).toContain('HTTP 502');
  });
  it('mantiene el estado HTTP y el mensaje específico existentes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Ya existe un proyecto con ese código.' }), { status: 409 })));
    const error = await api('/projects').catch(error => error);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw new Error('Se esperaba ApiError');
    expect(error.status).toBe(409);
    expect(error.message).toBe('Ya existe un proyecto con ese código.');
  });
});
