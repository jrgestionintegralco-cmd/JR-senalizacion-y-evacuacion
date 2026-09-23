import { describe, expect, it } from 'vitest';
import { buildingInputSchema, floorInputSchema, planUploadSchema } from '../src/modules/stage3.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const buildingId = '22222222-2222-4222-8222-222222222222';

describe('contratos de dominio de la Etapa 3', () => {
  it('valida edificios asociados a proyectos', () => {
    expect(buildingInputSchema.safeParse({ projectId, name: 'Torre administrativa' }).success).toBe(true);
    expect(buildingInputSchema.safeParse({ projectId: 'invalido', name: 'T' }).success).toBe(false);
  });

  it('valida niveles y elevaciones de plantas', () => {
    expect(floorInputSchema.safeParse({ buildingId, name: 'Piso 1', levelNumber: 1, elevationM: 3.2 }).success).toBe(true);
    expect(floorInputSchema.safeParse({ buildingId, name: 'Piso 999', levelNumber: 999 }).success).toBe(false);
  });

  it('acepta únicamente formatos documentales de plano autorizados', () => {
    expect(planUploadSchema.safeParse({ name: 'plano.pdf', title: 'Plano general', contentType: 'application/pdf', sizeBytes: 1024 }).success).toBe(true);
    expect(planUploadSchema.safeParse({ name: 'modelo.exe', title: 'Ejecutable', contentType: 'application/octet-stream', sizeBytes: 1024 }).success).toBe(false);
  });
});
