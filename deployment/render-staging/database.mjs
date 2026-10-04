import pg from 'pg';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hashPassword, normalizeEmail } from '../../apps/api/dist/security.js';
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.pathname !== '/safe_enter_render_staging' || process.env.CONFIRM_RENDER_STAGING !== 'safe_enter_render_staging') throw new Error('Only explicitly confirmed, isolated Render staging database is allowed');
const mode = process.argv[2];
if (!['schema', 'reviewer'].includes(mode)) throw new Error('Use schema or reviewer; never run automatically at startup');
const client = new pg.Client({ connectionString: url.href });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(764031902)");
  if (mode === 'schema') {
    const hashes = JSON.parse(readFileSync(new URL('./migration-checksums.json', import.meta.url)));
    for (const [name, expected] of Object.entries(hashes)) {
      const actual = createHash('sha256').update(readFileSync(new URL(`../../infra/db/init/${name}`, import.meta.url))).digest('hex');
      if (actual !== expected) throw new Error('Upstream migration changed: review isolated schema before execution');
    }
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'spatial_ref_sys'");
    if (tables.rowCount) throw new Error('Database is not empty; initialization refused');
    await client.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    const counts = await client.query('SELECT (SELECT count(*) FROM organizations)::int AS organizations, (SELECT count(*) FROM users)::int AS users');
    if (counts.rows[0].organizations || counts.rows[0].users) throw new Error('Unexpected seeded identities');
  } else {
    const email = normalizeEmail(process.env.STAGING_REVIEWER_EMAIL ?? '');
    const password = process.env.STAGING_REVIEWER_PASSWORD ?? '';
    if (!email.includes('@') || password.length < 12) throw new Error('Provide new staging-only reviewer email and password (12+ characters)');
    const counts = await client.query('SELECT (SELECT count(*) FROM organizations)::int AS organizations, (SELECT count(*) FROM users)::int AS users');
    if (counts.rows[0].organizations || counts.rows[0].users) throw new Error('Reviewer provisioning requires zero organizations and users; no overwrite or duplicate allowed');
    const org = await client.query("INSERT INTO organizations(name,legal_name) VALUES ('JR Revisión Staging','JR Revisión Staging') RETURNING id");
    const role = await client.query("INSERT INTO roles(organization_id,code,name,is_system) VALUES ($1,'administrator','Administración de prueba',true) RETURNING id", [org.rows[0].id]);
    await client.query('INSERT INTO role_permissions(role_id,permission_code) SELECT $1,code FROM permissions', [role.rows[0].id]);
    const user = await client.query("INSERT INTO users(organization_id,email,full_name,password_hash) VALUES ($1,$2,'Revisión visual',$3) RETURNING id", [org.rows[0].id,email,await hashPassword(password)]);
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user.rows[0].id,role.rows[0].id]);
    await client.query("INSERT INTO app_settings(organization_id,key,value) VALUES($1,'organization.profile',$2::jsonb)", [org.rows[0].id,JSON.stringify({timezone:'America/Bogota',locale:'es-CO',name:'JR Revisión Staging'})]);
  }
  await client.query('COMMIT');
  console.log(`Staging ${mode} completed; no production data used`);
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
