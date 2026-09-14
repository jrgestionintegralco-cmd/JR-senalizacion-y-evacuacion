import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('alcance e instalación PWA', () => {
  it('declara una aplicación instalable con identidad JR', () => {
    const manifestPath = fileURLToPath(new URL('../public/manifest.webmanifest', import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.name).toContain('JR Gestión Integral');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });

  it('limita la navegación a funciones de Etapa 1', () => {
    const source = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
    for (const section of ['Usuarios', 'Roles y permisos', 'Almacenamiento', 'Auditoría', 'Configuración']) {
      expect(source).toContain(section);
    }
    for (const forbidden of ["label: 'Clientes'", "label: 'Proyectos'", "label: 'Plantas'", "label: 'Rutas'"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
