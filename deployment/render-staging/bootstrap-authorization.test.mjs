// Pure checks only: never import/execute bootstrap-admin or access a database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBootstrapAuthorization, bootstrapAuthorizationDiagnostic } from './bootstrap-authorization.mjs';
const ARGV = ['node', 'bootstrap-admin.mjs', '--execute-once'];
function environment() {
  return { RENDER: 'true', CONFIRM_RENDER_STAGING: 'safe_enter_render_staging',
    STAGING_BOOTSTRAP_CONFIRM: 'CREATE_FIRST_JR_RENDER_STAGING_ADMIN',
    RENDER_EXTERNAL_URL: 'https://example.onrender.com' };
}
test('valid authorization passes without changing environment', () => {
  const env = environment();
  const before = { ...env };
  validateBootstrapAuthorization(ARGV, env);
  assert.deepEqual(env, before);
});
test('exact diagnostic for each rejected authorization condition', () => {
  const cases = [
    [ARGV.slice(0, 2), {}, 'BOOTSTRAP_ARGUMENT_INVALID'],
    [[...ARGV, 'extra'], {}, 'BOOTSTRAP_ARGUMENT_INVALID'],
    [['node', 'script', '--wrong'], {}, 'BOOTSTRAP_ARGUMENT_INVALID'],
    [ARGV, { RENDER: undefined }, 'RENDER_ABSENT'],
    [ARGV, { RENDER: 'false' }, 'RENDER_VALUE_INVALID'],
    [ARGV, { RENDER: 'TRUE' }, 'RENDER_VALUE_INVALID'],
    [ARGV, { RENDER: '' }, 'RENDER_VALUE_INVALID'],
    [ARGV, { CONFIRM_RENDER_STAGING: 'wrong' }, 'STAGING_DATABASE_CONFIRMATION_INVALID'],
    [ARGV, { STAGING_BOOTSTRAP_CONFIRM: 'wrong' }, 'STAGING_BOOTSTRAP_CONFIRMATION_INVALID'],
    [ARGV, { RENDER_EXTERNAL_URL: undefined }, 'RENDER_EXTERNAL_URL_ABSENT'],
    [ARGV, { RENDER_EXTERNAL_URL: '' }, 'RENDER_EXTERNAL_URL_ABSENT'],
    [ARGV, { RENDER_EXTERNAL_URL: 'fake-secret-invalid-url' }, 'RENDER_EXTERNAL_URL_FORMAT_INVALID'],
    [ARGV, { RENDER_EXTERNAL_URL: 'http://example.onrender.com' }, 'RENDER_EXTERNAL_URL_PROTOCOL_INVALID'],
    [ARGV, { RENDER_EXTERNAL_URL: 'https://fake-user:fake-secret@private.test/?token=fake-token' }, 'RENDER_EXTERNAL_URL_HOSTNAME_INVALID']
  ];
  for (const [argv, overrides, expected] of cases) {
    assert.throws(() => validateBootstrapAuthorization(argv, { ...environment(), ...overrides }), error => {
      assert.equal(bootstrapAuthorizationDiagnostic(error), expected);
      assert.doesNotMatch(`${error.message} ${error.stack} ${bootstrapAuthorizationDiagnostic(error)}`,
        /fake-secret|fake-user|fake-token|private\.test/);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
test('same acceptance conditions as previous authorization logic', () => {
  function previous(argv, env) {
    try {
      if (argv.length !== 3 || argv[2] !== '--execute-once' || env.RENDER !== 'true' ||
          env.CONFIRM_RENDER_STAGING !== 'safe_enter_render_staging' ||
          env.STAGING_BOOTSTRAP_CONFIRM !== 'CREATE_FIRST_JR_RENDER_STAGING_ADMIN') return false;
      const origin = new URL(env.RENDER_EXTERNAL_URL ?? '');
      return origin.protocol === 'https:' && origin.hostname.endsWith('.onrender.com');
    } catch { return false; }
  }
  for (const value of [undefined, '', 'not-a-url', 'http://x.onrender.com', 'https://x.onrender.com',
    'https://onrender.com', 'https://x.onrender.com.evil.test', 'https://X.ONRENDER.COM', 'https://x.onrender.com:443/path']) {
    const env = { ...environment(), RENDER_EXTERNAL_URL: value };
    let actual = true;
    try { validateBootstrapAuthorization(ARGV, env); } catch { actual = false; }
    assert.equal(actual, previous(ARGV, env));
  }
});
test('unknown exceptions and spoofed codes are never exposed', () => {
  for (const error of [new Error('fake-secret'), { code: 'RENDER_ABSENT' }, null]) {
    assert.equal(bootstrapAuthorizationDiagnostic(error), 'NO_AUTHORIZATION_DIAGNOSTIC');
  }
});
