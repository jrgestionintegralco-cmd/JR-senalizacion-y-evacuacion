import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/jr',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'jr-files',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret-value'
};

describe('configuración', () => {
  it('aplica valores seguros y límites predeterminados', () => {
    const config = loadConfig(base);
    expect(config.API_PORT).toBe(4000);
    expect(config.SESSION_TTL_HOURS).toBe(8);
    expect(config.MAX_UPLOAD_BYTES).toBe(26_214_400);
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('falla de forma explícita cuando faltan servicios críticos', () => {
    expect(() => loadConfig({})).toThrow('Configuración inválida');
  });
});
