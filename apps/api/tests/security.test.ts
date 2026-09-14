import { describe, expect, it } from 'vitest';
import { assertSafeObjectKey, createSessionToken, hashPassword, hashSessionToken, normalizeEmail, verifyPassword } from '../src/security.js';

describe('seguridad de credenciales y sesiones', () => {
  it('genera hashes scrypt verificables sin guardar la contraseña', async () => {
    const password = 'Una-Clave-Segura-2026!';
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword('Incorrecta-2026!', hash)).resolves.toBe(false);
  });

  it('rechaza contraseñas débiles', async () => {
    await expect(hashPassword('corta')).rejects.toThrow('12 caracteres');
  });

  it('crea tokens aleatorios y almacena solo su huella', () => {
    const first = createSessionToken();
    const second = createSessionToken();
    expect(first).not.toBe(second);
    expect(hashSessionToken(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normaliza correos y bloquea recorridos de ruta', () => {
    expect(normalizeEmail(' ADMIN@JR.COM ')).toBe('admin@jr.com');
    expect(() => assertSafeObjectKey('../secreto.pdf')).toThrow('no permitido');
    expect(assertSafeObjectKey('Acta visita 01.pdf')).toBe('Acta-visita-01.pdf');
  });
});
