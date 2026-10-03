import type { FastifyRequest } from 'fastify';
import type { Database } from './db.js';

export async function recordAudit(
  db: Pick<Database, 'query'>,
  request: FastifyRequest,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
  outcome: 'success' | 'failure' = 'success'
) {
  await db.query(
    `INSERT INTO audit_events
      (organization_id, actor_user_id, action, entity_type, entity_id, outcome, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8, $9::jsonb)`,
    [
      request.authUser?.organizationId ?? null,
      request.authUser?.id ?? null,
      action,
      entityType,
      entityId,
      outcome,
      request.ip,
      request.headers['user-agent'] ?? null,
      JSON.stringify(metadata)
    ]
  );
}
