// Pure diagnostic formatting: no SQL execution or error message interpolation.
const STEPS = new Set([
  'BEGIN', 'ACTIVE_FLAG', 'SET_LOCK_TIMEOUT', 'SET_STATEMENT_TIMEOUT',
  'SET_IDLE_TIMEOUT', 'ADVISORY_LOCK', 'TABLE_LOCK', 'CURRENT_DATABASE',
  'DATABASE_MATCH', 'ROLLBACK'
]);
const SQLSTATES = new Set([
  '42501', '42P01', '42704', '55P03', '57014', '40P01', '40001',
  '25001', '25P02', '22023', '08000', '08001', '08003', '08004',
  '08006', '08007', '08P01', '53300', '57P01', '57P02', '57P03', 'XX000'
]);
class DatabaseMismatchDiagnostic extends Error {
  constructor() { super('Unexpected database'); }
}
export function transactionDatabaseMismatch() { return new DatabaseMismatchDiagnostic(); }
export function transactionDiagnostic(step, error) {
  const safeStep = STEPS.has(step) ? step : 'UNKNOWN';
  const sqlstate = SQLSTATES.has(error?.code) ? error.code
    : error?.code === undefined ? 'NOT_PROVIDED' : 'UNCLASSIFIED';
  const code = error instanceof DatabaseMismatchDiagnostic
    ? 'TRANSACTION_DATABASE_MISMATCH' : `TRANSACTION_${safeStep}_FAILED`;
  return `diagnostic=${code}; transaction_step=${safeStep}; sqlstate=${sqlstate}`;
}
export function rollbackStatus(active, attempted, failed) {
  if (!active) return 'NOT_REQUIRED';
  if (!attempted) return 'NOT_ATTEMPTED';
  return failed ? 'FAILED' : 'SUCCEEDED';
}
