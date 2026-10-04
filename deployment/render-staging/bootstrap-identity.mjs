import { z } from 'zod';

const CODES = new Set([
  'STAGING_IDENTITY_EMAIL_INVALID', 'STAGING_IDENTITY_PASSWORD_TOO_SHORT',
  'STAGING_IDENTITY_PASSWORD_TOO_LONG', 'STAGING_IDENTITY_SCRYPT_FAILED'
]);
class IdentityDiagnostic extends Error {
  constructor(code) {
    super('Staging identity validation failed');
    this.code = code;
  }
}
export function bootstrapIdentityDiagnostic(error) {
  return error instanceof IdentityDiagnostic && CODES.has(error.code)
    ? error.code : 'NO_STAGING_IDENTITY_DIAGNOSTIC';
}
// Receives the email already normalized by the existing normalizeEmail().
export function validateBootstrapIdentity(email, password) {
  if (!z.email().safeParse(email).success) throw new IdentityDiagnostic('STAGING_IDENTITY_EMAIL_INVALID');
  if (password.length < 12) throw new IdentityDiagnostic('STAGING_IDENTITY_PASSWORD_TOO_SHORT');
  if (password.length > 128) throw new IdentityDiagnostic('STAGING_IDENTITY_PASSWORD_TOO_LONG');
}
// The caller supplies the unchanged existing hashPassword (scrypt) function.
export async function hashBootstrapIdentity(password, hashPassword) {
  try { return await hashPassword(password); }
  catch { throw new IdentityDiagnostic('STAGING_IDENTITY_SCRYPT_FAILED'); }
}
