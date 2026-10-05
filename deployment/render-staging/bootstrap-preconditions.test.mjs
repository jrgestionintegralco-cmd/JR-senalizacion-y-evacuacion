// Mock-only tests. Never connects to PostgreSQL or executes SQL/bootstrap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareBootstrapPreconditions } from './bootstrap-preconditions.mjs';
const sql = readFileSync(new URL('./bootstrap-preconditions.sql', import.meta.url), 'utf8');

test('passes the approved transaction unchanged to the existing client', async () => {
  const calls = [];
  await prepareBootstrapPreconditions({ query: async text => { calls.push(text); } });
  assert.deepEqual(calls, [sql]);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+(?:public\.)?users\b|CREATE\s+TABLE|ALTER\s+TABLE/i);
});
test('failure rolls back, does not retry, and exposes only a fixed error', async () => {
  const calls = [];
  await assert.rejects(prepareBootstrapPreconditions({ query: async text => {
    calls.push(text);
    if (text !== 'ROLLBACK') throw new Error('fake-secret');
  } }), { message: 'PRECONDITIONS_FAILED_ROLLBACK_COMPLETED' });
  assert.deepEqual(calls, [sql, 'ROLLBACK']);
});
test('rollback failure is reported separately without original details', async () => {
  const calls = [];
  await assert.rejects(prepareBootstrapPreconditions({ query: async text => {
    calls.push(text);
    throw new Error('fake-secret');
  } }), { message: 'PRECONDITIONS_FAILED_ROLLBACK_UNCONFIRMED' });
  assert.deepEqual(calls, [sql, 'ROLLBACK']);
});
test('integration remains after identity/connection and before administrator transaction', () => {
  const source = readFileSync(new URL('./bootstrap-admin.mjs', import.meta.url), 'utf8');
  const connection = source.indexOf('await client.connect();');
  const preparation = source.indexOf('await prepareBootstrapPreconditions(client);');
  const transaction = source.indexOf("stage = 'transaction';");
  assert.ok(connection < preparation && preparation < transaction);
  assert.ok(source.indexOf('await hashBootstrapIdentity(') < connection);
});
