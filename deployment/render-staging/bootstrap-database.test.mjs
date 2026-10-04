// Pure connection interpretation tests; no network or bootstrap execution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapDatabaseTarget, bootstrapDatabaseDiagnostic } from './bootstrap-database.mjs';

test('uses original API binding, including Render-assigned database names', () => {
  for (const name of ['safe_enter_render_staging', 'safe_enter_render_staging_ab12', 'render_assigned_staging']) {
    const value = `postgresql://dummy:dummy@internal.test/${name}`;
    const target = bootstrapDatabaseTarget(value);
    assert.equal(target.connectionString, value);
    assert.equal(target.database, name);
  }
});
test('each parsing rejection has an exact sanitized diagnostic', () => {
  const cases = [
    [undefined, 'DATABASE_URL_ABSENT'],
    [null, 'DATABASE_URL_ABSENT'],
    ['', 'DATABASE_URL_EMPTY'],
    [123, 'DATABASE_URL_INVALID_TYPE'],
    ['https://fake-user:fake-secret@private.test/db?token=fake-token', 'DATABASE_URL_INVALID_SCHEME'],
    ['postgres://fake-user:fake-secret@private.test:not-a-port/db', 'DATABASE_URL_PARSER_ERROR'],
    ['postgres://fake-user:fake-secret@/db', 'DATABASE_URL_HOST_ABSENT'],
    ['postgres://fake-user:fake-secret@private.test/', 'DATABASE_URL_DATABASE_ABSENT'],
    ['postgres://', 'DATABASE_URL_HOST_AND_DATABASE_ABSENT']
  ];
  for (const [value, expected] of cases) {
    assert.throws(() => bootstrapDatabaseTarget(value), error => {
      assert.equal(bootstrapDatabaseDiagnostic(error), expected);
      const output = `${error.message} ${error.stack} ${bootstrapDatabaseDiagnostic(error)}`;
      assert.doesNotMatch(output, /fake-user|fake-secret|private\.test|fake-token|postgres:\/\//);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
test('unknown errors or spoofed codes never reveal raw details', () => {
  for (const error of [new Error('fake-secret'), { code: 'DATABASE_URL_PARSER_ERROR', message: 'fake-secret' }, null]) {
    assert.equal(bootstrapDatabaseDiagnostic(error), 'NO_DATABASE_PARSING_DIAGNOSTIC');
  }
});
test('postgres alias, escaped credentials and SSL options remain unchanged', () => {
  const value = 'postgres://dummy:p%40ss@internal.test:5432/staging%5Ftest?sslmode=require';
  assert.deepEqual(bootstrapDatabaseTarget(value), { connectionString: value, database: 'staging_test' });
});
test('rejects missing, malformed and implicit database targets without secrets', () => {
  for (const value of [undefined, '', 'https://dummy:private@internal.test/db', 'postgres://dummy:private@internal.test/', 'postgres://']) {
    assert.throws(() => bootstrapDatabaseTarget(value), error => {
      assert.doesNotMatch(error.message, /private|dummy|internal\.test/);
      return true;
    });
  }
});
