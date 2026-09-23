import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('requisitos visibles de la Etapa 3', () => {
  it('explica la jerarquía cuando todavía no existe un proyecto', () => {
    const source = readFileSync(fileURLToPath(new URL('./stage3.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("setGuidance('building')");
    expect(source).toContain('Primero debes crear un proyecto');
    expect(source).toContain('Orden requerido: cliente → establecimiento → proyecto → edificio');
    expect(source).toContain('onClick={openNewBuilding}');
  });
});
