// One-time Render STAGING bootstrap, invoked only by explicitly authorized startup.
// Run only after separate authorization; do not pass credentials on the CLI.
import pg from 'pg';
import { hashPassword, normalizeEmail } from '../../apps/api/dist/security.js';
import { bootstrapDatabaseTarget, bootstrapDatabaseDiagnostic } from './bootstrap-database.mjs';
import { validateBootstrapAuthorization, bootstrapAuthorizationDiagnostic } from './bootstrap-authorization.mjs';
import { validateBootstrapIdentity, hashBootstrapIdentity, bootstrapIdentityDiagnostic } from './bootstrap-identity.mjs';

const ORGANIZATION = 'JR Gestión Integral S.A.S.';
const ACTION = 'staging.bootstrap_admin.completed';
const REQUIRED_PERMISSIONS = [
  'platform.dashboard.read', 'users.read', 'users.manage', 'roles.read',
  'roles.manage', 'audit.read', 'settings.read', 'settings.manage',
  'files.create', 'files.read', 'clients.read', 'clients.manage',
  'establishments.read', 'establishments.manage', 'projects.read',
  'projects.manage', 'buildings.read', 'buildings.manage', 'floors.read',
  'floors.manage', 'plans.read', 'plans.manage'
];

let client;
let transaction = false;
let stage = 'authorization';
try {
  validateBootstrapAuthorization(process.argv, process.env);
  stage = 'database URL parsing';
  const target = bootstrapDatabaseTarget(process.env.DATABASE_URL);
  stage = 'staging identity validation';
  const email = normalizeEmail(process.env.STAGING_BOOTSTRAP_EMAIL ?? '');
  let password = process.env.STAGING_BOOTSTRAP_PASSWORD ?? '';
  validateBootstrapIdentity(email, password);
  const passwordHash = await hashBootstrapIdentity(password, hashPassword);
  password = '';
  delete process.env.STAGING_BOOTSTRAP_PASSWORD;

  stage = 'database connection';
  client = new pg.Client({ connectionString: target.connectionString, connectionTimeoutMillis: 5000 });
  // Use the service's existing INTERNAL URL. Never weaken TLS verification.
  await client.connect();
  client.on('error', () => {}); // Never log raw driver errors or connection details.
  stage = 'transaction';
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  transaction = true;
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
  await client.query('SELECT pg_advisory_xact_lock(764031902)');
  // Prevent concurrent inserts/updates bypassing the bootstrap advisory lock.
  await client.query(`LOCK TABLE organizations, roles, permissions, role_permissions,
    users, user_roles, audit_events IN SHARE ROW EXCLUSIVE MODE`);
  const identity = await client.query('SELECT current_database() AS name');
  if (identity.rows[0]?.name !== target.database) throw new Error('Unexpected database');

  stage = 'one-time check';
  const marker = await client.query('SELECT 1 FROM audit_events WHERE action = $1 LIMIT 1', [ACTION]);
  if (marker.rowCount) throw new Error('Already consumed');

  stage = 'organization check';
  // Count ALL exact legal-name matches, including inactive duplicates.
  const organizations = await client.query(
    'SELECT id, status FROM organizations WHERE legal_name = $1', [ORGANIZATION]
  );
  if (organizations.rowCount !== 1 || organizations.rows[0].status !== 'active') {
    throw new Error('Missing, duplicate or inactive JR organization');
  }
  const organizationId = organizations.rows[0].id;

  stage = 'administrator role and permissions check';
  const roles = await client.query(
    "SELECT id FROM roles WHERE organization_id = $1 AND code = 'administrator'", [organizationId]
  );
  if (roles.rowCount !== 1) throw new Error('Missing or ambiguous administrator role');
  const roleId = roles.rows[0].id;
  const permissions = await client.query(`SELECT rp.permission_code FROM role_permissions rp
    JOIN permissions p ON p.code = rp.permission_code WHERE rp.role_id = $1`, [roleId]);
  const granted = new Set(permissions.rows.map(row => row.permission_code));
  if (REQUIRED_PERMISSIONS.some(permission => !granted.has(permission))) {
    throw new Error('Incomplete existing administrator permissions');
  }

  stage = 'existing user check';
  // Global, case-insensitive check: the application's login searches by email.
  const existing = await client.query(
    'SELECT 1 FROM users WHERE lower(btrim(email)) = lower($1) LIMIT 1', [email]
  );
  if (existing.rowCount) throw new Error('Existing email must never be overwritten');
  const administrators = await client.query(`SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    WHERE u.organization_id = $1 AND u.status = 'active' AND ur.role_id = $2 LIMIT 1`,
  [organizationId, roleId]);
  if (administrators.rowCount) throw new Error('An active administrator already exists');

  stage = 'new user creation';
  const user = await client.query(`INSERT INTO users
    (organization_id, email, full_name, password_hash, status)
    VALUES ($1, $2, 'Administración de revisión staging', $3, 'active') RETURNING id`,
  [organizationId, email, passwordHash]);
  const userId = user.rows[0].id;
  await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, roleId]);
  // Durable one-use marker: survives removal of secrets/restarts and user deletion.
  // No password, hash, connection details or secrets are written to audit metadata.
  await client.query(`INSERT INTO audit_events
    (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES ($1, $2, $3, 'user', $4, $5::jsonb)`,
  [organizationId, userId, ACTION, userId, JSON.stringify({ purpose: 'first-staging-access', version: 1 })]);
  stage = 'commit';
  await client.query('COMMIT');
  transaction = false;
  console.log('Staging administrator created; one-time bootstrap consumed. Remove temporary bootstrap variables.');
} catch (error) {
  if (transaction && client) {
    try { await client.query('ROLLBACK'); } catch { /* Never reveal driver errors. */ }
  }
  const diagnostic = stage === 'authorization'
    ? bootstrapAuthorizationDiagnostic(error)
    : stage === 'staging identity validation'
      ? bootstrapIdentityDiagnostic(error) : bootstrapDatabaseDiagnostic(error);
  console.error(`Bootstrap stopped at ${stage}; diagnostic=${diagnostic}; no retry or overwrite performed. Inspect database state before retrying if commit outcome is uncertain.`);
  process.exitCode = 1;
} finally {
  delete process.env.STAGING_BOOTSTRAP_PASSWORD;
  if (client) {
    try { await client.end(); } catch { process.exitCode = 1; }
  }
}
