import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import client from 'prom-client';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { loadConfig, type Config } from './config.js';
import { createDatabase, type Database } from './db.js';
import { authenticate, authorize, cookieOptions, SESSION_COOKIE } from './auth.js';
import { createSessionToken, hashPassword, hashSessionToken, normalizeEmail, assertSafeObjectKey, verifyPassword } from './security.js';
import { recordAudit } from './audit.js';
import { createStorage } from './storage.js';
import { registerStage2Routes } from './modules/stage2.js';
import './types.js';

const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(256) });
const createUserSchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(3).max(120),
  password: z.string().min(12).max(128),
  roleIds: z.array(z.uuid()).min(1).max(10)
});
const statusSchema = z.object({ status: z.enum(['active', 'suspended']) });
const roleSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9._-]{2,40}$/),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(240).default(''),
  permissions: z.array(z.string()).min(1)
});
const settingsSchema = z.object({
  timezone: z.string().min(3).max(64),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  sessionNotice: z.string().trim().max(300).default('')
});
const fileSchema = z.object({
  name: z.string().min(1).max(180),
  contentType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  sizeBytes: z.number().int().positive()
});

export async function buildServer(options?: { config?: Config; db?: Database }) {
  const config = options?.config ?? loadConfig();
  const db = options?.db ?? createDatabase(config.DATABASE_URL);
  const storage = createStorage(config);
  const app = Fastify({ logger: { level: config.NODE_ENV === 'test' ? 'silent' : 'info' }, trustProxy: true });

  await app.register(cookie);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });

  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: 'jr_platform_' });
  const httpDuration = new client.Histogram({
    name: 'jr_platform_http_request_duration_seconds',
    help: 'Duración de las solicitudes HTTP',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry]
  });
  app.addHook('onResponse', async (request, reply) => {
    const elapsed = reply.elapsedTime / 1000;
    httpDuration.observe({ method: request.method, route: request.routeOptions.url, status_code: String(reply.statusCode) }, elapsed);
  });

  const requireUser = authenticate(db);
  const guard = (permission: string) => [requireUser, authorize(permission)];

  app.get('/health/live', async () => ({ status: 'ok', service: 'jr-platform-api', timestamp: new Date().toISOString() }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      const result = await db.query<{ postgis_version: string }>('SELECT PostGIS_Version() AS postgis_version');
      return { status: 'ready', database: 'ok', postgis: result.rows[0].postgis_version };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ status: 'not_ready', database: 'error' });
    }
  });
  app.get('/metrics', async (_request, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  app.post('/auth/login', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Correo o contraseña inválidos.' });
    const email = normalizeEmail(parsed.data.email);
    const result = await db.query<{ id: string; organization_id: string; email: string; full_name: string; password_hash: string }>(
      `SELECT id, organization_id, email, full_name, password_hash FROM users WHERE email = $1 AND status = 'active' LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
      await recordAudit(db, request, 'auth.login', 'session', null, { email }, 'failure');
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos.' });
    }

    request.authUser = { id: user.id, organizationId: user.organization_id, email: user.email, fullName: user.full_name, permissions: [] };
    const token = createSessionToken();
    const expires = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000);
    await db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4::inet, $5)`,
      [user.id, hashSessionToken(token), expires, request.ip, request.headers['user-agent'] ?? null]
    );
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await recordAudit(db, request, 'auth.login', 'session', null);
    return reply.setCookie(SESSION_COOKIE, token, cookieOptions(config, expires)).send({ user: { id: user.id, email: user.email, fullName: user.full_name } });
  });

  app.post('/auth/logout', { preHandler: requireUser }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    await recordAudit(db, request, 'auth.logout', 'session', null);
    return reply.clearCookie(SESSION_COOKIE, cookieOptions(config)).code(204).send();
  });

  app.get('/auth/me', { preHandler: requireUser }, async (request) => ({ user: request.authUser }));

  app.get('/platform/summary', { preHandler: guard('platform.dashboard.read') }, async (request) => {
    const org = request.authUser!.organizationId;
    const [users, roles, events, files, clients, establishments, projects] = await Promise.all([
      db.query<{ count: string }>('SELECT count(*) FROM users WHERE organization_id = $1', [org]),
      db.query<{ count: string }>('SELECT count(*) FROM roles WHERE organization_id = $1', [org]),
      db.query<{ count: string }>("SELECT count(*) FROM audit_events WHERE organization_id = $1 AND occurred_at > now() - interval '24 hours'", [org]),
      db.query<{ count: string }>('SELECT count(*) FROM stored_files WHERE organization_id = $1', [org]),
      db.query<{ count: string }>('SELECT count(*) FROM clients WHERE organization_id = $1 AND status = $2', [org, 'active']),
      db.query<{ count: string }>('SELECT count(*) FROM establishments WHERE organization_id = $1 AND status = $2', [org, 'active']),
      db.query<{ count: string }>("SELECT count(*) FROM projects WHERE organization_id = $1 AND status NOT IN ('completed','cancelled')", [org])
    ]);
    return {
      users: Number(users.rows[0].count), roles: Number(roles.rows[0].count),
      events24h: Number(events.rows[0].count), files: Number(files.rows[0].count),
      clients: Number(clients.rows[0].count), establishments: Number(establishments.rows[0].count),
      activeProjects: Number(projects.rows[0].count)
    };
  });

  app.get('/users', { preHandler: guard('users.read') }, async (request) => {
    const result = await db.query(
      `SELECT u.id, u.email, u.full_name AS "fullName", u.status, u.last_login_at AS "lastLoginAt",
              u.created_at AS "createdAt", COALESCE(json_agg(json_build_object('id', r.id, 'name', r.name))
              FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.organization_id = $1 GROUP BY u.id ORDER BY u.full_name`,
      [request.authUser!.organizationId]
    );
    return { users: result.rows };
  });

  app.post('/users', { preHandler: guard('users.manage') }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const data = parsed.data;
    const clientConnection = await db.connect();
    try {
      await clientConnection.query('BEGIN');
      const userResult = await clientConnection.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, full_name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
        [request.authUser!.organizationId, normalizeEmail(data.email), data.fullName, await hashPassword(data.password)]
      );
      const id = userResult.rows[0].id;
      for (const roleId of data.roleIds) {
        await clientConnection.query(
          `INSERT INTO user_roles (user_id, role_id)
           SELECT $1, id FROM roles WHERE id = $2 AND organization_id = $3`,
          [id, roleId, request.authUser!.organizationId]
        );
      }
      await clientConnection.query('COMMIT');
      await recordAudit(db, request, 'user.create', 'user', id, { email: normalizeEmail(data.email), roles: data.roleIds });
      return reply.code(201).send({ id });
    } catch (error: any) {
      await clientConnection.query('ROLLBACK');
      if (error?.code === '23505') return reply.code(409).send({ error: 'EMAIL_EXISTS', message: 'Ya existe un usuario con ese correo.' });
      throw error;
    } finally {
      clientConnection.release();
    }
  });

  app.patch('/users/:id/status', { preHandler: guard('users.manage') }, async (request, reply) => {
    const id = z.uuid().safeParse((request.params as { id: string }).id);
    const body = statusSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (id.data === request.authUser!.id && body.data.status === 'suspended') {
      return reply.code(409).send({ error: 'SELF_SUSPEND', message: 'No puedes suspender tu propio usuario.' });
    }
    const result = await db.query(
      'UPDATE users SET status = $1 WHERE id = $2 AND organization_id = $3 RETURNING id',
      [body.data.status, id.data, request.authUser!.organizationId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (body.data.status === 'suspended') await db.query('DELETE FROM sessions WHERE user_id = $1', [id.data]);
    await recordAudit(db, request, 'user.status.change', 'user', id.data, body.data);
    return { id: id.data, status: body.data.status };
  });

  app.get('/roles', { preHandler: guard('roles.read') }, async (request) => {
    const [roles, permissions] = await Promise.all([
      db.query(
        `SELECT r.id, r.code, r.name, r.description, r.is_system AS "isSystem",
                COALESCE(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions,
                count(DISTINCT ur.user_id)::int AS "userCount"
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN user_roles ur ON ur.role_id = r.id
         WHERE r.organization_id = $1 GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
        [request.authUser!.organizationId]
      ),
      db.query('SELECT code, name, description FROM permissions ORDER BY code')
    ]);
    return { roles: roles.rows, permissions: permissions.rows };
  });

  app.post('/roles', { preHandler: guard('roles.manage') }, async (request, reply) => {
    const parsed = roleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const data = parsed.data;
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const result = await connection.query<{ id: string }>(
        `INSERT INTO roles (organization_id, code, name, description) VALUES ($1, $2, $3, $4) RETURNING id`,
        [request.authUser!.organizationId, data.code, data.name, data.description]
      );
      for (const permission of data.permissions) {
        await connection.query('INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2)', [result.rows[0].id, permission]);
      }
      await connection.query('COMMIT');
      await recordAudit(db, request, 'role.create', 'role', result.rows[0].id, { code: data.code, permissions: data.permissions });
      return reply.code(201).send({ id: result.rows[0].id });
    } catch (error: any) {
      await connection.query('ROLLBACK');
      if (error?.code === '23505') return reply.code(409).send({ error: 'ROLE_EXISTS', message: 'El código de rol ya existe.' });
      if (error?.code === '23503') return reply.code(400).send({ error: 'UNKNOWN_PERMISSION', message: 'Se incluyó un permiso inexistente.' });
      throw error;
    } finally {
      connection.release();
    }
  });

  app.get('/audit', { preHandler: guard('audit.read') }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    const result = await db.query(
      `SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.outcome,
              a.metadata, a.occurred_at AS "occurredAt", u.full_name AS "actorName", u.email AS "actorEmail"
       FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.organization_id = $1 ORDER BY a.occurred_at DESC LIMIT $2`,
      [request.authUser!.organizationId, query.limit]
    );
    return { events: result.rows };
  });

  app.get('/settings', { preHandler: guard('settings.read') }, async (request) => {
    const result = await db.query<{ value: unknown }>(
      `SELECT value FROM app_settings WHERE organization_id = $1 AND key = 'organization.profile' AND is_secret = false`,
      [request.authUser!.organizationId]
    );
    return { settings: result.rows[0]?.value ?? {} };
  });

  app.put('/settings', { preHandler: guard('settings.manage') }, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    await db.query(
      `INSERT INTO app_settings (organization_id, key, value, updated_by)
       VALUES ($1, 'organization.profile', $2::jsonb, $3)
       ON CONFLICT (organization_id, key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [request.authUser!.organizationId, JSON.stringify({ ...parsed.data, name: 'JR Gestión Integral S.A.S.' }), request.authUser!.id]
    );
    await recordAudit(db, request, 'settings.update', 'settings', 'organization.profile', { changedKeys: Object.keys(parsed.data) });
    return { settings: parsed.data };
  });

  app.post('/files/presign', { preHandler: guard('files.create') }, async (request, reply) => {
    const parsed = fileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    if (parsed.data.sizeBytes > config.MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: 'El archivo supera el límite configurado.' });
    }
    const safeName = assertSafeObjectKey(parsed.data.name);
    const objectKey = `${request.authUser!.organizationId}/${crypto.randomUUID()}/${safeName}`;
    const result = await db.query<{ id: string }>(
      `INSERT INTO stored_files (organization_id, uploaded_by, object_key, original_name, content_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [request.authUser!.organizationId, request.authUser!.id, objectKey, parsed.data.name, parsed.data.contentType, parsed.data.sizeBytes]
    );
    const uploadUrl = await storage.createUploadUrl(objectKey, parsed.data.contentType);
    await recordAudit(db, request, 'file.upload.request', 'stored_file', result.rows[0].id, { name: parsed.data.name, sizeBytes: parsed.data.sizeBytes });
    return reply.code(201).send({ id: result.rows[0].id, objectKey, uploadUrl, expiresInSeconds: 300 });
  });

  await registerStage2Routes(app, db, guard);

  app.setErrorHandler(async (error, request, reply) => {
    request.log.error(error);
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado.' });
  });

  app.addHook('onClose', async () => { await db.end(); });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const app = await buildServer({ config });
  await app.listen({ host: '0.0.0.0', port: config.API_PORT });
}
