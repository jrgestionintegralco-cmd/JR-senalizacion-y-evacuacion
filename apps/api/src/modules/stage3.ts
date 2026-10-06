import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import type { createStorage } from '../storage.js';
import { assertSafeObjectKey } from '../security.js';
import { recordAudit } from '../audit.js';
import { PlanFileError } from '../plan-validation.js';

type Storage = ReturnType<typeof createStorage>;
const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]).optional().transform((value) => value || null);
const idSchema = z.object({ id: z.uuid() });
const entityStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
const listSchema = z.object({ projectId: z.uuid().optional(), buildingId: z.uuid().optional(), floorId: z.uuid().optional() });

export const buildingInputSchema = z.object({
  projectId: z.uuid(), code: nullableText(40), name: z.string().trim().min(2).max(160), description: nullableText(1000)
});
export const floorInputSchema = z.object({
  buildingId: z.uuid(), code: nullableText(40), name: z.string().trim().min(2).max(120),
  levelNumber: z.number().int().min(-20).max(300), elevationM: z.number().min(-1000).max(10000).nullable().optional().transform((value) => value ?? null),
  description: nullableText(1000)
});
const floorUpdateSchema = floorInputSchema.omit({ buildingId: true });
const allowedPlanTypes = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export const planUploadSchema = z.object({
  name: z.string().trim().min(1).max(180),
  title: z.string().trim().min(2).max(180),
  contentType: z.enum(allowedPlanTypes),
  sizeBytes: z.number().int().positive()
});

function constraintResponse(error: unknown, reply: FastifyReply, message: string) {
  const code = (error as { code?: string })?.code;
  if (code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message });
  if (code === '23503' || code === '23514') return reply.code(409).send({ error: 'INVALID_RELATION', message: 'La relación o el estado solicitado no es válido.' });
  throw error;
}

export async function registerStage3Routes(app: FastifyInstance, db: Database, storage: Storage, maxUploadBytes: number, guard: (permission: string) => any[]) {
  app.get('/buildings', { preHandler: guard('buildings.read') }, async (request, reply) => {
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.query(
      `SELECT b.id,b.project_id AS "projectId",p.name AS "projectName",p.establishment_id AS "establishmentId",e.name AS "establishmentName",
              b.code,b.name,b.description,b.status,b.created_at AS "createdAt",b.updated_at AS "updatedAt",count(DISTINCT f.id)::int AS "floorCount"
       FROM buildings b JOIN projects p ON p.id=b.project_id AND p.organization_id=b.organization_id
       JOIN establishments e ON e.id=p.establishment_id AND e.organization_id=p.organization_id
       LEFT JOIN floors f ON f.building_id=b.id AND f.organization_id=b.organization_id
       WHERE b.organization_id=$1 AND ($2::uuid IS NULL OR b.project_id=$2)
       GROUP BY b.id,p.name,p.establishment_id,e.name ORDER BY p.name,b.name`,
      [request.authUser!.organizationId, parsed.data.projectId ?? null]
    );
    return { buildings: result.rows };
  });

  app.post('/buildings', { preHandler: guard('buildings.manage') }, async (request, reply) => {
    const parsed = buildingInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const data = parsed.data;
    try {
      const result = await db.query<{ id: string }>(
        `INSERT INTO buildings (organization_id,project_id,code,name,description)
         SELECT $1,p.id,$3,$4,$5 FROM projects p WHERE p.id=$2 AND p.organization_id=$1 AND p.status NOT IN ('completed','cancelled') RETURNING id`,
        [request.authUser!.organizationId, data.projectId, data.code, data.name, data.description]
      );
      if (!result.rowCount) return reply.code(409).send({ error: 'PROJECT_UNAVAILABLE', message: 'El proyecto no existe o está cerrado.' });
      const id = result.rows[0].id;
      await recordAudit(db, request, 'building.create', 'building', id, { projectId: data.projectId, name: data.name });
      return reply.code(201).send({ id });
    } catch (error) { return constraintResponse(error, reply, 'Ya existe un edificio con ese nombre o código en el proyecto.'); }
  });

  app.put('/buildings/:id', { preHandler: guard('buildings.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = buildingInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const data = parsed.data;
    try {
      const result = await db.query(
        `UPDATE buildings b SET project_id=p.id,code=$3,name=$4,description=$5 FROM projects p
         WHERE b.id=$6 AND b.organization_id=$1 AND p.id=$2 AND p.organization_id=$1 AND p.status NOT IN ('completed','cancelled') RETURNING b.id`,
        [request.authUser!.organizationId, data.projectId, data.code, data.name, data.description, params.data.id]
      );
      if (!result.rowCount) return reply.code(409).send({ error: 'INVALID_RELATION', message: 'El edificio o proyecto no está disponible.' });
      await recordAudit(db, request, 'building.update', 'building', params.data.id, { projectId: data.projectId, name: data.name });
      return { id: params.data.id };
    } catch (error) { return constraintResponse(error, reply, 'Ya existe un edificio con ese nombre o código en el proyecto.'); }
  });

  app.patch('/buildings/:id/status', { preHandler: guard('buildings.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = entityStatusSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.query('UPDATE buildings SET status=$1 WHERE id=$2 AND organization_id=$3 RETURNING id', [parsed.data.status, params.data.id, request.authUser!.organizationId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND' });
    await recordAudit(db, request, 'building.status.change', 'building', params.data.id, parsed.data);
    return { id: params.data.id, status: parsed.data.status };
  });

  app.get('/floors', { preHandler: guard('floors.read') }, async (request, reply) => {
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.query(
      `SELECT f.id,f.building_id AS "buildingId",b.name AS "buildingName",b.project_id AS "projectId",p.name AS "projectName",
              f.code,f.name,f.level_number AS "levelNumber",f.elevation_m::float8 AS "elevationM",f.description,f.status,
              f.created_at AS "createdAt",f.updated_at AS "updatedAt",count(DISTINCT fp.id)::int AS "planCount"
       FROM floors f JOIN buildings b ON b.id=f.building_id AND b.organization_id=f.organization_id
       JOIN projects p ON p.id=b.project_id AND p.organization_id=b.organization_id
       LEFT JOIN floor_plans fp ON fp.floor_id=f.id AND fp.organization_id=f.organization_id AND fp.status <> 'rejected'
       WHERE f.organization_id=$1 AND ($2::uuid IS NULL OR f.building_id=$2)
       GROUP BY f.id,b.name,b.project_id,p.name ORDER BY p.name,b.name,f.level_number`,
      [request.authUser!.organizationId, parsed.data.buildingId ?? null]
    );
    return { floors: result.rows };
  });

  app.post('/floors', { preHandler: guard('floors.manage') }, async (request, reply) => {
    const parsed = floorInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const data = parsed.data;
    try {
      const result = await db.query<{ id: string }>(
        `INSERT INTO floors (organization_id,building_id,code,name,level_number,elevation_m,description)
         SELECT $1,b.id,$3,$4,$5,$6,$7 FROM buildings b WHERE b.id=$2 AND b.organization_id=$1 AND b.status='active' RETURNING id`,
        [request.authUser!.organizationId, data.buildingId, data.code, data.name, data.levelNumber, data.elevationM, data.description]
      );
      if (!result.rowCount) return reply.code(409).send({ error: 'BUILDING_UNAVAILABLE', message: 'El edificio no existe o está inactivo.' });
      const id = result.rows[0].id;
      await recordAudit(db, request, 'floor.create', 'floor', id, { buildingId: data.buildingId, name: data.name, levelNumber: data.levelNumber });
      return reply.code(201).send({ id });
    } catch (error) { return constraintResponse(error, reply, 'Ya existe una planta con ese nivel o código en el edificio.'); }
  });

  app.put('/floors/:id', { preHandler: guard('floors.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = floorUpdateSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const data = parsed.data;
    try {
      const result = await db.query(
        `UPDATE floors SET code=$1,name=$2,level_number=$3,elevation_m=$4,description=$5 WHERE id=$6 AND organization_id=$7 RETURNING id`,
        [data.code, data.name, data.levelNumber, data.elevationM, data.description, params.data.id, request.authUser!.organizationId]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND' });
      await recordAudit(db, request, 'floor.update', 'floor', params.data.id, { name: data.name, levelNumber: data.levelNumber });
      return { id: params.data.id };
    } catch (error) { return constraintResponse(error, reply, 'Ya existe una planta con ese nivel o código en el edificio.'); }
  });

  app.patch('/floors/:id/status', { preHandler: guard('floors.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = entityStatusSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.query('UPDATE floors SET status=$1 WHERE id=$2 AND organization_id=$3 RETURNING id', [parsed.data.status, params.data.id, request.authUser!.organizationId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND' });
    await recordAudit(db, request, 'floor.status.change', 'floor', params.data.id, parsed.data);
    return { id: params.data.id, status: parsed.data.status };
  });

  app.get('/floor-plans', { preHandler: guard('plans.read') }, async (request, reply) => {
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.query(
      `SELECT fp.id,fp.floor_id AS "floorId",f.name AS "floorName",f.building_id AS "buildingId",b.name AS "buildingName",
              b.project_id AS "projectId",p.name AS "projectName",fp.title,fp.version,fp.status,
              sf.original_name AS "fileName",sf.content_type AS "contentType",sf.size_bytes::float8 AS "sizeBytes",
              fp.created_at AS "createdAt",fp.ready_at AS "readyAt"
       FROM floor_plans fp JOIN floors f ON f.id=fp.floor_id AND f.organization_id=fp.organization_id
       JOIN buildings b ON b.id=f.building_id AND b.organization_id=f.organization_id
       JOIN projects p ON p.id=b.project_id AND p.organization_id=b.organization_id
       JOIN stored_files sf ON sf.id=fp.stored_file_id AND sf.organization_id=fp.organization_id
       WHERE fp.organization_id=$1 AND ($2::uuid IS NULL OR fp.floor_id=$2)
       ORDER BY fp.created_at DESC`,
      [request.authUser!.organizationId, parsed.data.floorId ?? null]
    );
    return { plans: result.rows };
  });

  app.post('/floors/:id/plans/presign', { preHandler: guard('plans.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = planUploadSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.success ? undefined : parsed.error.flatten() });
    if (parsed.data.sizeBytes > maxUploadBytes) return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: 'El plano supera el límite configurado.' });
    const organizationId = request.authUser!.organizationId;
    try {
      await storage.ensurePlanStorageAvailable();
      const floor = await db.query('SELECT id FROM floors WHERE id=$1 AND organization_id=$2 AND status=$3', [params.data.id, organizationId, 'active']);
      if (!floor.rowCount) return reply.code(409).send({ error: 'FLOOR_UNAVAILABLE', message: 'La planta no existe o está inactiva.' });
      const id = crypto.randomUUID();
      const intent = {
        ...parsed.data, id, organizationId, userId: request.authUser!.id, floorId: params.data.id,
        objectKey: `${organizationId}/plans/${params.data.id}/staging/${id}/${assertSafeObjectKey(parsed.data.name)}`,
        expiresAt: Date.now() + 15 * 60_000
      };
      const uploadUrl = await storage.createUploadUrl(intent.objectKey, intent.contentType, intent.sizeBytes);
      // No version/file/audit rows are written until the bytes are uploaded and verified.
      return reply.code(201).send({ id, uploadToken: storage.signPlanUploadIntent(intent), uploadUrl, expiresInSeconds: 300 });
    } catch (error) {
      if (error instanceof PlanFileError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE', message: 'No fue posible preparar la carga. No se creó ninguna versión.' });
    }
  });

  app.post('/floor-plans/:id/complete', { preHandler: guard('plans.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (request.body !== undefined && request.body !== null) {
      const body = z.object({ uploadToken: z.string().min(1).max(8192) }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
      try {
        const intent = storage.verifyPlanUploadIntent(body.data.uploadToken);
        if (intent.id !== params.data.id || intent.organizationId !== request.authUser!.organizationId ||
            intent.userId !== request.authUser!.id || intent.sizeBytes > maxUploadBytes) {
          return reply.code(403).send({ error: 'UPLOAD_NOT_AUTHORIZED', message: 'Esta autorización no corresponde a la carga.' });
        }
        const existing = await db.query<{ status: string; version: number }>('SELECT status,version FROM floor_plans WHERE id=$1 AND organization_id=$2', [intent.id, intent.organizationId]);
        if (existing.rowCount) return { id: intent.id, ...existing.rows[0] };
        // Read, validate, seal and reread the actual S3 bytes BEFORE opening the DB transaction.
        const sealed = await storage.finalizePlan(intent.objectKey, intent.sizeBytes, intent.contentType, intent.organizationId, intent.floorId);
        const connection = await db.connect();
        try {
          await connection.query('BEGIN');
          const floor = await connection.query('SELECT status FROM floors WHERE id=$1 AND organization_id=$2 FOR UPDATE', [intent.floorId, intent.organizationId]);
          if (floor.rows[0]?.status !== 'active') {
            await connection.query('ROLLBACK');
            return reply.code(409).send({ error: 'FLOOR_UNAVAILABLE', message: 'La planta está inactiva.' });
          }
          const duplicate = await connection.query<{ status: string; version: number }>('SELECT status,version FROM floor_plans WHERE id=$1 AND organization_id=$2', [intent.id, intent.organizationId]);
          if (duplicate.rowCount) {
            await connection.query('ROLLBACK');
            return { id: intent.id, ...duplicate.rows[0] };
          }
          const file = await connection.query<{ id: string }>(
            `INSERT INTO stored_files (organization_id,uploaded_by,object_key,original_name,content_type,size_bytes,status,checksum_sha256,verified_at)
             VALUES ($1,$2,$3,$4,$5,$6,'ready',$7,now()) RETURNING id`,
            [intent.organizationId, intent.userId, sealed.objectKey, intent.name, intent.contentType, intent.sizeBytes, sealed.checksum]
          );
          await connection.query("UPDATE floor_plans SET status='superseded' WHERE organization_id=$1 AND floor_id=$2 AND status='ready'", [intent.organizationId, intent.floorId]);
          const plan = await connection.query<{ version: number }>(
            `INSERT INTO floor_plans (id,organization_id,floor_id,stored_file_id,title,version,uploaded_by,status,ready_at)
             SELECT $1,$2,$3,$4,$5,COALESCE(MAX(version),0)+1,$6,'ready',now() FROM floor_plans WHERE organization_id=$2 AND floor_id=$3 RETURNING version`,
            [intent.id, intent.organizationId, intent.floorId, file.rows[0].id, intent.title, intent.userId]
          );
          await recordAudit(connection, request, 'plan.upload.request', 'floor_plan', intent.id, { floorId: intent.floorId, name: intent.name, version: plan.rows[0].version });
          await recordAudit(connection, request, 'plan.upload.complete', 'floor_plan', intent.id, { version: plan.rows[0].version, status: 'ready', checksumSha256: sealed.checksum });
          await connection.query('COMMIT');
          return { id: intent.id, status: 'ready', version: plan.rows[0].version };
        } catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
      } catch (error) {
        if (error instanceof PlanFileError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
        if ((error as { name?: string }).name === 'NoSuchKey') return reply.code(409).send({ error: 'UPLOAD_NOT_FOUND', message: 'El archivo no fue transferido; no se creó ninguna versión.' });
        return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE', message: 'No se pudo confirmar la carga. Reintenta la confirmación con la misma autorización.' });
      }
    }
    // Compatibility for previously registered pending versions. No automatic retries or cleanup.
    type PendingPlan = { object_key: string; size_bytes: string; content_type: string; floor_id: string; status: string; version: number };
    const organizationId = request.authUser!.organizationId;
    const plan = await db.query<PendingPlan>(
      `SELECT sf.object_key,sf.size_bytes::text,sf.content_type,fp.floor_id,fp.status,fp.version FROM floor_plans fp
       JOIN stored_files sf ON sf.id=fp.stored_file_id AND sf.organization_id=fp.organization_id
       WHERE fp.id=$1 AND fp.organization_id=$2`,
      [params.data.id, organizationId]
    );
    if (!plan.rowCount) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plano no encontrado.' });
    const current = plan.rows[0];
    if (['ready', 'superseded'].includes(current.status)) return { id: params.data.id, status: current.status };
    if (current.status !== 'pending') return reply.code(409).send({ error: 'PLAN_REJECTED', message: 'Esta carga no está disponible.' });
    let sealed: { objectKey: string; checksum: string };
    try {
      sealed = await storage.finalizePlan(current.object_key, Number(current.size_bytes), current.content_type, organizationId, current.floor_id);
    } catch (error) {
      if (error instanceof PlanFileError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      if ((error as { name?: string }).name === 'NoSuchKey') return reply.code(409).send({ error: 'UPLOAD_NOT_FOUND', message: 'El archivo aún no aparece en el almacenamiento.' });
      request.log.error({ err: error }, 'Plan verification unavailable');
      return reply.code(503).send({ error: 'STORAGE_UNAVAILABLE', message: 'No fue posible verificar el archivo. Puedes volver a confirmar la carga.' });
    }
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const floor = await connection.query('SELECT status FROM floors WHERE id=$1 AND organization_id=$2 FOR UPDATE', [current.floor_id, organizationId]);
      const fresh = await connection.query<{ status: string }>('SELECT status FROM floor_plans WHERE id=$1 AND organization_id=$2 FOR UPDATE', [params.data.id, organizationId]);
      if (fresh.rows[0]?.status !== 'pending') {
        await connection.query('ROLLBACK');
        if (['ready', 'superseded'].includes(fresh.rows[0]?.status)) return { id: params.data.id, status: fresh.rows[0].status };
        return reply.code(409).send({ error: 'PLAN_UNAVAILABLE' });
      }
      if (floor.rows[0]?.status !== 'active') {
        await connection.query('ROLLBACK');
        return reply.code(409).send({ error: 'FLOOR_UNAVAILABLE', message: 'La planta está inactiva.' });
      }
      const newer = await connection.query("SELECT id FROM floor_plans WHERE organization_id=$1 AND floor_id=$2 AND version>$3 AND status IN ('ready','superseded') LIMIT 1", [organizationId, current.floor_id, current.version]);
      const status = newer.rowCount ? 'superseded' : 'ready';
      if (status === 'ready') await connection.query(`UPDATE floor_plans SET status='superseded' WHERE organization_id=$1 AND floor_id=$2 AND status='ready'`, [organizationId, current.floor_id]);
      await connection.query(`UPDATE floor_plans SET status=$3,ready_at=now() WHERE id=$1 AND organization_id=$2`, [params.data.id, organizationId, status]);
      await connection.query(`UPDATE stored_files sf SET status='ready',object_key=$3,checksum_sha256=$4,verified_at=now() FROM floor_plans fp WHERE fp.id=$1 AND fp.organization_id=$2 AND fp.stored_file_id=sf.id AND sf.organization_id=$2`, [params.data.id, organizationId, sealed.objectKey, sealed.checksum]);
      await recordAudit(connection, request, 'plan.upload.complete', 'floor_plan', params.data.id, { version: current.version, status, checksumSha256: sealed.checksum });
      await connection.query('COMMIT');
      return { id: params.data.id, status };
    } catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
  });

  app.get('/floor-plans/:id/download', { preHandler: guard('plans.read') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.query<{ object_key: string; original_name: string }>(
      `SELECT sf.object_key,sf.original_name FROM floor_plans fp JOIN stored_files sf ON sf.id=fp.stored_file_id AND sf.organization_id=fp.organization_id
       WHERE fp.id=$1 AND fp.organization_id=$2 AND fp.status IN ('ready','superseded') AND sf.status='ready'`,
      [params.data.id, request.authUser!.organizationId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plano disponible no encontrado.' });
    const downloadUrl = await storage.createDownloadUrl(result.rows[0].object_key, result.rows[0].original_name);
    await recordAudit(db, request, 'plan.download', 'floor_plan', params.data.id);
    return { downloadUrl, expiresInSeconds: 300 };
  });
}
