// Pure connection interpretation tests; no network or bootstrap execution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapDatabaseTarget } from './bootstrap-database.mjs';

test('uses original API binding, including Render-assigned database names', () => {
  for (const name of ['safe_enter_render_staging', 'safe_enter_render_staging_ab12', 'render_assigned_staging']) {
    const value = `postgresql://dummy:dummy@internal.test/${name}`;
    const target = bootstrapDatabaseTarget(value);
    assert.equal(target.connectionString, value);
    assert.equal(target.database, name);
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
