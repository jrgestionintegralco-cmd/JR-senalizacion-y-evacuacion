import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { hashPassword, normalizeEmail } from './security.js';

const config = loadConfig();
const email = normalizeEmail(process.env.INITIAL_ADMIN_EMAIL ?? '');
const password = process.env.INITIAL_ADMIN_PASSWORD ?? '';
if (!email || !password) throw new Error('Define INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD.');

const db = createDatabase(config.DATABASE_URL);
try {
  const hash = await hashPassword(password);
  const result = await db.query<{ id: string }>(
    `WITH org AS (SELECT id FROM organizations WHERE legal_name = 'JR Gestión Integral S.A.S.' LIMIT 1)
     INSERT INTO users (organization_id, email, full_name, password_hash)
     SELECT org.id, $1, 'Administración JR', $2 FROM org
     ON CONFLICT (organization_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'
     RETURNING id`,
    [email, hash]
  );
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, r.id FROM roles r JOIN users u ON u.organization_id = r.organization_id
     WHERE u.id = $1 AND r.code = 'administrator' ON CONFLICT DO NOTHING`,
    [result.rows[0].id]
  );
  console.log(`Administrador preparado: ${email}`);
} finally {
  await db.end();
}
