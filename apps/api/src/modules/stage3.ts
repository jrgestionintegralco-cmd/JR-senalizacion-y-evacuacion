import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import type { createStorage } from '../storage.js';
import { assertSafeObjectKey } from '../security.js';
import { recordAudit } from '../audit.js';

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
    const floor = await db.query('SELECT id FROM floors WHERE id=$1 AND organization_id=$2 AND status=$3', [params.data.id, organizationId, 'active']);
    if (!floor.rowCount) return reply.code(409).send({ error: 'FLOOR_UNAVAILABLE', message: 'La planta no existe o está inactiva.' });
    const safeName = assertSafeObjectKey(parsed.data.name);
    const objectKey = `${organizationId}/plans/${params.data.id}/${crypto.randomUUID()}/${safeName}`;
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const file = await connection.query<{ id: string }>(
        `INSERT INTO stored_files (organization_id,uploaded_by,object_key,original_name,content_type,size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [organizationId, request.authUser!.id, objectKey, parsed.data.name, parsed.data.contentType, parsed.data.sizeBytes]
      );
      const plan = await connection.query<{ id: string; version: number }>(
        `INSERT INTO floor_plans (organization_id,floor_id,stored_file_id,title,version,uploaded_by)
         SELECT $1,$2,$3,$4,COALESCE(MAX(version),0)+1,$5 FROM floor_plans WHERE organization_id=$1 AND floor_id=$2 RETURNING id,version`,
        [organizationId, params.data.id, file.rows[0].id, parsed.data.title, request.authUser!.id]
      );
      await connection.query('COMMIT');
      const uploadUrl = await storage.createUploadUrl(objectKey, parsed.data.contentType);
      await recordAudit(db, request, 'plan.upload.request', 'floor_plan', plan.rows[0].id, { floorId: params.data.id, name: parsed.data.name, version: plan.rows[0].version });
      return reply.code(201).send({ id: plan.rows[0].id, version: plan.rows[0].version, uploadUrl, expiresInSeconds: 300 });
    } catch (error) {
      await connection.query('ROLLBACK'); throw error;
    } finally { connection.release(); }
  });

  app.post('/floor-plans/:id/complete', { preHandler: guard('plans.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const plan = await db.query<{ object_key: string; size_bytes: string; content_type: string; floor_id: string }>(
      `SELECT sf.object_key,sf.size_bytes::text,sf.content_type,fp.floor_id FROM floor_plans fp
       JOIN stored_files sf ON sf.id=fp.stored_file_id AND sf.organization_id=fp.organization_id
       WHERE fp.id=$1 AND fp.organization_id=$2 AND fp.status='pending'`,
      [params.data.id, request.authUser!.organizationId]
    );
    if (!plan.rowCount) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Carga pendiente no encontrada.' });
    try {
      const metadata = await storage.getMetadata(plan.rows[0].object_key);
      if (metadata.sizeBytes !== Number(plan.rows[0].size_bytes)) return reply.code(409).send({ error: 'SIZE_MISMATCH', message: 'El tamaño cargado no coincide con el registrado.' });
    } catch {
      return reply.code(409).send({ error: 'UPLOAD_NOT_FOUND', message: 'El archivo aún no aparece en el almacenamiento.' });
    }
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`UPDATE floor_plans SET status='superseded' WHERE organization_id=$1 AND floor_id=$2 AND status='ready'`, [request.authUser!.organizationId, plan.rows[0].floor_id]);
      await connection.query(`UPDATE floor_plans SET status='ready',ready_at=now() WHERE id=$1 AND organization_id=$2`, [params.data.id, request.authUser!.organizationId]);
      await connection.query(`UPDATE stored_files sf SET status='ready' FROM floor_plans fp WHERE fp.id=$1 AND fp.stored_file_id=sf.id AND sf.organization_id=$2`, [params.data.id, request.authUser!.organizationId]);
      await connection.query('COMMIT');
    } catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
    await recordAudit(db, request, 'plan.upload.complete', 'floor_plan', params.data.id);
    return { id: params.data.id, status: 'ready' };
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
