// Isolated identity checks only: never imports/executes bootstrap-admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { normalizeEmail, hashPassword, verifyPassword } from '../../apps/api/dist/security.js';
import { validateBootstrapIdentity, hashBootstrapIdentity, bootstrapIdentityDiagnostic } from './bootstrap-identity.mjs';

function checkDiagnostic(error, expected) {
  assert.equal(bootstrapIdentityDiagnostic(error), expected);
  assert.doesNotMatch(`${error.message} ${error.stack} ${bootstrapIdentityDiagnostic(error)}`, /fake-secret|fake-invalid-email|raw-hash-error/);
  assert.equal(error.cause, undefined);
  return true;
}
test('invalid normalized email gets its own sanitized code', () => {
  assert.throws(() => validateBootstrapIdentity(normalizeEmail(' FAKE-INVALID-EMAIL '), 'fake-secret-password'),
    error => checkDiagnostic(error, 'STAGING_IDENTITY_EMAIL_INVALID'));
});
test('short password gets its own sanitized code', () => {
  assert.throws(() => validateBootstrapIdentity(normalizeEmail('review@example.test'), 'short'),
    error => checkDiagnostic(error, 'STAGING_IDENTITY_PASSWORD_TOO_SHORT'));
});
test('long password gets its own sanitized code', () => {
  assert.throws(() => validateBootstrapIdentity(normalizeEmail('review@example.test'), 'x'.repeat(129)),
    error => checkDiagnostic(error, 'STAGING_IDENTITY_PASSWORD_TOO_LONG'));
});
test('hash failure is sanitized without exposing original exception', async () => {
  for (const hash of [() => { throw new Error('raw-hash-error fake-secret'); }, async () => { throw new Error('raw-hash-error fake-secret'); }]) {
    await assert.rejects(hashBootstrapIdentity('fake-secret-password', hash),
      error => checkDiagnostic(error, 'STAGING_IDENTITY_SCRYPT_FAILED'));
  }
});
test('preserves normalized email, original validation and both length boundaries', () => {
  const email = normalizeEmail(' REVIEW@EXAMPLE.TEST ');
  assert.equal(email, 'review@example.test');
  for (const candidate of [email, 'invalid']) {
    for (const length of [0, 11, 12, 128, 129]) {
      const password = 'x'.repeat(length);
      const previous = z.email().safeParse(candidate).success && length >= 12 && length <= 128;
      let accepted = true;
      try { validateBootstrapIdentity(candidate, password); } catch { accepted = false; }
      assert.equal(accepted, previous);
    }
  }
});
test('unchanged scrypt implementation returns only a verifiable salted hash', async () => {
  const password = 'fake-secret-password';
  const hash = await hashBootstrapIdentity(password, hashPassword);
  assert.match(hash, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.ok(!hash.includes(password));
  assert.equal(await verifyPassword(password, hash), true);
});
test('unknown exceptions and spoofed codes never reveal details', () => {
  for (const error of [new Error('fake-secret'), { code: 'STAGING_IDENTITY_SCRYPT_FAILED' }, null]) {
    assert.equal(bootstrapIdentityDiagnostic(error), 'NO_STAGING_IDENTITY_DIAGNOSTIC');
  }
});
