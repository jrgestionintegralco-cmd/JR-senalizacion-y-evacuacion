import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import type { Config } from '../src/config.js';

const config: Config = {
  NODE_ENV: 'test',
  API_PORT: 4000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://unused',
  SESSION_TTL_HOURS: 8,
  COOKIE_SECURE: false,
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'jr-files',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret-value',
  S3_FORCE_PATH_STYLE: true,
  MAX_UPLOAD_BYTES: 1_000_000
};

function fakeDatabase() {
  return {
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn()
  } as any;
}

describe('contrato HTTP básico', () => {
  it('expone una prueba de vida sin revelar datos internos', async () => {
    const app = await buildServer({ config, db: fakeDatabase() });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'jr-platform-api' });
    await app.close();
  }, 10_000);

  it('protege los módulos administrativos sin una sesión', async () => {
    const app = await buildServer({ config, db: fakeDatabase() });
    const response = await app.inject({ method: 'GET', url: '/users' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'AUTH_REQUIRED' });
    await app.close();
  });
});
