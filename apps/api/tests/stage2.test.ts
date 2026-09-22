import { describe, expect, it } from 'vitest';
import { clientInputSchema, establishmentInputSchema, projectInputSchema, projectStatusSchema } from '../src/modules/stage2.js';

describe('contratos de dominio de la Etapa 2', () => {
  it('valida los datos mínimos de un cliente', () => {
    expect(clientInputSchema.safeParse({
      legalName: 'Cliente de prueba', documentType: 'nit', documentNumber: '900123456-7'
    }).success).toBe(true);
    expect(clientInputSchema.safeParse({
      legalName: 'X', documentType: 'nit', documentNumber: '***'
    }).success).toBe(false);
  });

  it('exige coordenadas completas y válidas en establecimientos', () => {
    const base = {
      clientId: '11111111-1111-4111-8111-111111111111',
      name: 'Sede principal', address: 'Calle 1 # 2-3', city: 'Barranquilla', country: 'Colombia'
    };
    expect(establishmentInputSchema.safeParse({ ...base, latitude: 10.98, longitude: -74.8 }).success).toBe(true);
    expect(establishmentInputSchema.safeParse({ ...base, latitude: 10.98 }).success).toBe(false);
  });

  it('protege la relación temporal y los estados de proyectos', () => {
    const base = {
      clientId: '11111111-1111-4111-8111-111111111111',
      establishmentId: '22222222-2222-4222-8222-222222222222',
      code: 'PR-001', name: 'Proyecto de prueba'
    };
    expect(projectInputSchema.safeParse({ ...base, startsOn: '2026-09-22', dueOn: '2026-10-22' }).success).toBe(true);
    expect(projectInputSchema.safeParse({ ...base, startsOn: '2026-10-22', dueOn: '2026-09-22' }).success).toBe(false);
    expect(projectStatusSchema.safeParse({ status: 'completed' }).success).toBe(true);
    expect(projectStatusSchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});
