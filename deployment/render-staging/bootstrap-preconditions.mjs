import { readFileSync } from 'node:fs';

// Called only after bootstrap authorization/identity checks and connection.
// Use the existing connection and the approved SQL unchanged, in its own
// transaction. Never invokes schema initialization, seeds or user creation.
export async function prepareBootstrapPreconditions(client) {
  const sql = readFileSync(new URL('./bootstrap-preconditions.sql', import.meta.url), 'utf8');
  try {
    await client.query(sql);
  } catch {
    try { await client.query('ROLLBACK'); }
    catch { throw new Error('PRECONDITIONS_FAILED_ROLLBACK_UNCONFIRMED'); }
    throw new Error('PRECONDITIONS_FAILED_ROLLBACK_COMPLETED');
  }
}
