// Pure diagnostics/source-wiring checks; NEVER runs bootstrap or any SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transactionDiagnostic, transactionDatabaseMismatch, rollbackStatus } from './bootstrap-transaction.mjs';
const source = readFileSync(new URL('./bootstrap-admin.mjs', import.meta.url), 'utf8');
const steps = ['BEGIN', 'ACTIVE_FLAG', 'SET_LOCK_TIMEOUT', 'SET_STATEMENT_TIMEOUT',
  'SET_IDLE_TIMEOUT', 'ADVISORY_LOCK', 'TABLE_LOCK', 'CURRENT_DATABASE', 'DATABASE_MATCH'];
for (const step of steps) {
  test(`${step} emits its fixed diagnostic, without original error details`, () => {
    const error = Object.assign(new Error('fake-secret query private-user'), { code: '42501', detail: 'fake-secret' });
    assert.equal(transactionDiagnostic(step, error),
      `diagnostic=TRANSACTION_${step}_FAILED; transaction_step=${step}; sqlstate=42501`);
  });
}
test('mismatch has its own code without exposing either database name', () => {
  assert.equal(transactionDiagnostic('DATABASE_MATCH', transactionDatabaseMismatch()),
    'diagnostic=TRANSACTION_DATABASE_MISMATCH; transaction_step=DATABASE_MATCH; sqlstate=NOT_PROVIDED');
});
test('SQLSTATE allowlist never echoes arbitrary codes or exception messages', () => {
  for (const code of ['55P03', '57014', '42P01', '40001', '08006']) {
    assert.ok(transactionDiagnostic('TABLE_LOCK', { code }).endsWith(`sqlstate=${code}`));
  }
  for (const code of ['fake-secret', 'ABCDE', '42501\nprivate', 42501, null]) {
    assert.ok(transactionDiagnostic('TABLE_LOCK', { code }).endsWith('sqlstate=UNCLASSIFIED'));
  }
  assert.ok(transactionDiagnostic('BEGIN', new Error('fake-secret')).endsWith('sqlstate=NOT_PROVIDED'));
  assert.ok(transactionDiagnostic('fake-secret', {}).includes('transaction_step=UNKNOWN'));
});
test('rollback failure stays separate from original failure and has its own code', () => {
  const original = transactionDiagnostic('TABLE_LOCK', { code: '42P01' });
  const rollback = transactionDiagnostic('ROLLBACK', { code: '08006' });
  assert.equal(original, 'diagnostic=TRANSACTION_TABLE_LOCK_FAILED; transaction_step=TABLE_LOCK; sqlstate=42P01');
  assert.equal(rollback, 'diagnostic=TRANSACTION_ROLLBACK_FAILED; transaction_step=ROLLBACK; sqlstate=08006');
  assert.equal(rollbackStatus(true, true, true), 'FAILED');
  assert.equal(rollbackStatus(true, true, false), 'SUCCEEDED');
});
test('BEGIN failure does not imply active transaction or require rollback', () => {
  assert.equal(rollbackStatus(false, false, false), 'NOT_REQUIRED');
  assert.match(source, /let transaction = false;/);
  assert.match(source, /transactionStep = 'BEGIN';\s*await client.query\('BEGIN ISOLATION LEVEL SERIALIZABLE'\);\s*transactionStep = 'ACTIVE_FLAG';\s*transaction = true;/);
  assert.match(source, /if \(transaction && client\) \{/);
});
test('all seven transaction steps remain ordered; each timeout has a separate marker', () => {
  let previous = -1;
  for (const step of steps) {
    const index = source.indexOf(`transactionStep = '${step}'`);
    assert.ok(index > previous, step);
    previous = index;
  }
  const pairs = [
    ['SET_LOCK_TIMEOUT', "SET LOCAL lock_timeout = '5s'"],
    ['SET_STATEMENT_TIMEOUT', "SET LOCAL statement_timeout = '15s'"],
    ['SET_IDLE_TIMEOUT', "SET LOCAL idle_in_transaction_session_timeout = '20s'"],
    ['ADVISORY_LOCK', 'SELECT pg_advisory_xact_lock(764031902)'],
    ['TABLE_LOCK', 'LOCK TABLE organizations, roles, permissions, role_permissions,'],
    ['CURRENT_DATABASE', 'SELECT current_database() AS name']
  ];
  for (const [step, sql] of pairs) {
    const marker = source.indexOf(`transactionStep = '${step}'`);
    const next = source.indexOf('transactionStep =', marker + 1);
    const query = source.indexOf(sql, marker);
    assert.ok(query > marker && (next < 0 || query < next), step);
  }
  assert.match(source, /identity.rows\[0\]\?\.name !== target.database/);
  assert.match(source, /transactionDiagnostic\(transactionStep, error\)/);
  assert.match(source, /transactionDiagnostic\('ROLLBACK', rollbackError\)/);
});
