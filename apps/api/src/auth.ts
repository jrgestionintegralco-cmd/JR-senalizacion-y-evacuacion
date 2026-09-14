import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { hashSessionToken } from './security.js';

export const SESSION_COOKIE = 'jr_session';

export function authenticate(db: Database) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'AUTH_REQUIRED', message: 'Debes iniciar sesión.' });

    const result = await db.query<{
      id: string;
      organization_id: string;
      email: string;
      full_name: string;
      permissions: string[];
    }>(
      `SELECT u.id, u.organization_id, u.email, u.full_name,
              COALESCE(array_agg(DISTINCT rp.permission_code)
                FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'
       GROUP BY u.id`,
      [hashSessionToken(token)]
    );
    const user = result.rows[0];
    if (!user) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(401).send({ error: 'SESSION_INVALID', message: 'La sesión venció o fue revocada.' });
    }
    request.authUser = {
      id: user.id,
      organizationId: user.organization_id,
      email: user.email,
      fullName: user.full_name,
      permissions: user.permissions
    };
  };
}

export function authorize(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser?.permissions.includes(permission)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'No tienes permiso para realizar esta acción.' });
    }
  };
}

export function cookieOptions(config: Config, expires?: Date) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.COOKIE_SECURE,
    expires
  };
}
