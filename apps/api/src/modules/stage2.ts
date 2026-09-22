import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { recordAudit } from '../audit.js';

const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]).optional()
  .transform((value) => value || null);
const nullableEmail = z.union([z.email(), z.literal(''), z.null()]).optional()
  .transform((value) => value || null);
const nullableDate = z.union([z.iso.date(), z.literal(''), z.null()]).optional()
  .transform((value) => value || null);

export const clientInputSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tradeName: nullableText(160),
  documentType: z.enum(['nit', 'cc', 'ce', 'passport', 'other']),
  documentNumber: z.string().trim().regex(/^[A-Za-z0-9.-]{3,40}$/),
  contactName: nullableText(120),
  email: nullableEmail,
  phone: nullableText(40),
  address: nullableText(240),
  city: nullableText(100),
  notes: nullableText(1000)
});

const establishmentFields = z.object({
  clientId: z.uuid(),
  code: nullableText(40),
  name: z.string().trim().min(2).max(160),
  address: z.string().trim().min(3).max(240),
  city: z.string().trim().min(2).max(100),
  department: nullableText(100),
  country: z.string().trim().min(2).max(100).default('Colombia'),
  latitude: z.number().min(-90).max(90).nullable().optional().transform((value) => value ?? null),
  longitude: z.number().min(-180).max(180).nullable().optional().transform((value) => value ?? null),
  contactName: nullableText(120),
  email: nullableEmail,
  phone: nullableText(40)
});
const coordinatesArePaired = (value: { latitude?: number | null; longitude?: number | null }) =>
  (value.latitude == null) === (value.longitude == null);
export const establishmentInputSchema = establishmentFields.refine(coordinatesArePaired, {
  message: 'La latitud y la longitud deben registrarse juntas.', path: ['latitude']
});
export const establishmentUpdateSchema = establishmentFields.omit({ clientId: true }).refine(coordinatesArePaired, {
  message: 'La latitud y la longitud deben registrarse juntas.', path: ['latitude']
});

const projectFields = z.object({
  clientId: z.uuid(),
  establishmentId: z.uuid(),
  code: z.string().trim().regex(/^[A-Za-z0-9._-]{2,40}$/),
  name: z.string().trim().min(2).max(160),
  description: nullableText(1000),
  startsOn: nullableDate,
  dueOn: nullableDate
});
const datesAreOrdered = (value: { startsOn?: string | null; dueOn?: string | null }) =>
  !value.startsOn || !value.dueOn || value.dueOn >= value.startsOn;
export const projectInputSchema = projectFields.refine(datesAreOrdered, {
  message: 'La fecha límite no puede ser anterior a la fecha de inicio.', path: ['dueOn']
});

const entityStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export const projectStatusSchema = z.object({ status: z.enum(['draft', 'active', 'on_hold', 'completed', 'cancelled']) });
const idSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
  clientId: z.uuid().optional(),
  establishmentId: z.uuid().optional()
});

function constraintResponse(error: unknown, reply: FastifyReply, duplicateMessage: string) {
  const code = (error as { code?: string })?.code;
  if (code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: duplicateMessage });
  if (code === '23503' || code === '23514') {
    return reply.code(409).send({ error: 'INVALID_RELATION', message: 'La relación o el estado solicitado no es válido.' });
  }
  throw error;
}

export async function registerStage2Routes(app: FastifyInstance, db: Database, guard: (permission: string) => any[]) {
  app.get('/clients', { preHandler: guard('clients.read') }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const { search = null, status = null } = parsed.data;
    const result = await db.query(
      `SELECT c.id, c.legal_name AS "legalName", c.trade_name AS "tradeName",
              c.document_type AS "documentType", c.document_number AS "documentNumber",
              c.contact_name AS "contactName", c.email, c.phone, c.address, c.city, c.notes,
              c.status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
              count(DISTINCT e.id)::int AS "establishmentCount",
              count(DISTINCT p.id)::int AS "projectCount"
       FROM clients c
       LEFT JOIN establishments e ON e.organization_id=c.organization_id AND e.client_id=c.id
       LEFT JOIN projects p ON p.organization_id=c.organization_id AND p.client_id=c.id
       WHERE c.organization_id=$1
         AND ($2::text IS NULL OR c.legal_name ILIKE '%' || $2 || '%' OR COALESCE(c.trade_name,'') ILIKE '%' || $2 || '%' OR c.document_number ILIKE '%' || $2 || '%')
         AND ($3::text IS NULL OR c.status=$3)
       GROUP BY c.id ORDER BY c.legal_name LIMIT 250`,
      [request.authUser!.organizationId, search, status]
    );
    return { clients: result.rows };
  });

  app.post('/clients', { preHandler: guard('clients.manage') }, async (request, reply) => {
    const parsed = clientInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const data = parsed.data;
    try {
      const result = await db.query<{ id: string }>(
        `INSERT INTO clients (organization_id,legal_name,trade_name,document_type,document_number,contact_name,email,phone,address,city,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [request.authUser!.organizationId, data.legalName, data.tradeName, data.documentType, data.documentNumber, data.contactName, data.email, data.phone, data.address, data.city, data.notes]
      );
      const id = result.rows[0].id;
      await recordAudit(db, request, 'client.create', 'client', id, { legalName: data.legalName });
      return reply.code(201).send({ id });
    } catch (error) { return constraintResponse(error, reply, 'Ya existe un cliente con ese tipo y número de identificación.'); }
  });

  app.put('/clients/:id', { preHandler: guard('clients.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = clientInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const data = parsed.data;
    try {
      const result = await db.query(
        `UPDATE clients SET legal_name=$1,trade_name=$2,document_type=$3,document_number=$4,contact_name=$5,email=$6,phone=$7,address=$8,city=$9,notes=$10
         WHERE id=$11 AND organization_id=$12 RETURNING id`,
        [data.legalName, data.tradeName, data.documentType, data.documentNumber, data.contactName, data.email, data.phone, data.address, data.city, data.notes, params.data.id, request.authUser!.organizationId]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Cliente no encontrado.' });
      await recordAudit(db, request, 'client.update', 'client', params.data.id, { legalName: data.legalName });
      return { id: params.data.id };
    } catch (error) { return constraintResponse(error, reply, 'Ya existe un cliente con ese tipo y número de identificación.'); }
  });

  app.patch('/clients/:id/status', { preHandler: guard('clients.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = entityStatusSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.query('UPDATE clients SET status=$1 WHERE id=$2 AND organization_id=$3 RETURNING id', [parsed.data.status, params.data.id, request.authUser!.organizationId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Cliente no encontrado.' });
    await recordAudit(db, request, 'client.status.change', 'client', params.data.id, parsed.data);
    return { id: params.data.id, status: parsed.data.status };
  });

  app.get('/establishments', { preHandler: guard('establishments.read') }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const { search = null, status = null, clientId = null } = parsed.data;
    const result = await db.query(
      `SELECT e.id,e.client_id AS "clientId",c.legal_name AS "clientName",e.code,e.name,e.address,e.city,e.department,e.country,e.latitude,e.longitude,
              e.contact_name AS "contactName",e.email,e.phone,e.status,e.created_at AS "createdAt",e.updated_at AS "updatedAt",
              count(DISTINCT p.id)::int AS "projectCount"
       FROM establishments e
       JOIN clients c ON c.id=e.client_id AND c.organization_id=e.organization_id
       LEFT JOIN projects p ON p.establishment_id=e.id AND p.organization_id=e.organization_id
       WHERE e.organization_id=$1
         AND ($2::text IS NULL OR e.name ILIKE '%' || $2 || '%' OR e.city ILIKE '%' || $2 || '%' OR COALESCE(e.code,'') ILIKE '%' || $2 || '%')
         AND ($3::text IS NULL OR e.status=$3) AND ($4::uuid IS NULL OR e.client_id=$4)
       GROUP BY e.id,c.legal_name ORDER BY c.legal_name,e.name LIMIT 250`,
      [request.authUser!.organizationId, search, status, clientId]
    );
    return { establishments: result.rows };
  });

  app.post('/establishments', { preHandler: guard('establishments.manage') }, async (request, reply) => {
    const parsed = establishmentInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const data = parsed.data;
    try {
      const result = await db.query<{ id: string }>(
        `INSERT INTO establishments (organization_id,client_id,code,name,address,city,department,country,latitude,longitude,contact_name,email,phone)
         SELECT $1,c.id,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13 FROM clients c
         WHERE c.id=$2 AND c.organization_id=$1 AND c.status='active' RETURNING id`,
        [request.authUser!.organizationId, data.clientId, data.code, data.name, data.address, data.city, data.department, data.country, data.latitude, data.longitude, data.contactName, data.email, data.phone]
      );
      if (!result.rowCount) return reply.code(409).send({ error: 'CLIENT_UNAVAILABLE', message: 'El cliente no existe o está inactivo.' });
      const id = result.rows[0].id;
      await recordAudit(db, request, 'establishment.create', 'establishment', id, { name: data.name, clientId: data.clientId });
      return reply.code(201).send({ id });
    } catch (error) { return constraintResponse(error, reply, 'Ya existe un establecimiento con ese código para el cliente.'); }
  });

  app.put('/establishments/:id', { preHandler: guard('establishments.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = establishmentUpdateSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const data = parsed.data;
    try {
      const result = await db.query(
        `UPDATE establishments SET code=$1,name=$2,address=$3,city=$4,department=$5,country=$6,latitude=$7,longitude=$8,contact_name=$9,email=$10,phone=$11
         WHERE id=$12 AND organization_id=$13 RETURNING id`,
        [data.code, data.name, data.address, data.city, data.department, data.country, data.latitude, data.longitude, data.contactName, data.email, data.phone, params.data.id, request.authUser!.organizationId]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Establecimiento no encontrado.' });
      await recordAudit(db, request, 'establishment.update', 'establishment', params.data.id, { name: data.name });
      return { id: params.data.id };
    } catch (error) { return constraintResponse(error, reply, 'Ya existe un establecimiento con ese código para el cliente.'); }
  });

  app.patch('/establishments/:id/status', { preHandler: guard('establishments.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = entityStatusSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.query('UPDATE establishments SET status=$1 WHERE id=$2 AND organization_id=$3 RETURNING id', [parsed.data.status, params.data.id, request.authUser!.organizationId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Establecimiento no encontrado.' });
    await recordAudit(db, request, 'establishment.status.change', 'establishment', params.data.id, parsed.data);
    return { id: params.data.id, status: parsed.data.status };
  });

  app.get('/projects', { preHandler: guard('projects.read') }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const { search = null, status = null, clientId = null, establishmentId = null } = parsed.data;
    const result = await db.query(
      `SELECT p.id,p.client_id AS "clientId",c.legal_name AS "clientName",p.establishment_id AS "establishmentId",e.name AS "establishmentName",
              p.code,p.name,p.description,p.status,p.starts_on AS "startsOn",p.due_on AS "dueOn",p.created_at AS "createdAt",p.updated_at AS "updatedAt"
       FROM projects p JOIN clients c ON c.id=p.client_id AND c.organization_id=p.organization_id
       JOIN establishments e ON e.id=p.establishment_id AND e.organization_id=p.organization_id
       WHERE p.organization_id=$1
         AND ($2::text IS NULL OR p.name ILIKE '%' || $2 || '%' OR p.code ILIKE '%' || $2 || '%')
         AND ($3::text IS NULL OR p.status=$3) AND ($4::uuid IS NULL OR p.client_id=$4) AND ($5::uuid IS NULL OR p.establishment_id=$5)
       ORDER BY p.updated_at DESC LIMIT 250`,
      [request.authUser!.organizationId, search, status, clientId, establishmentId]
    );
    return { projects: result.rows };
  });

  app.post('/projects', { preHandler: guard('projects.manage') }, async (request, reply) => {
    const parsed = projectInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    const data = parsed.data;
    try {
      const result = await db.query<{ id: string }>(
        `INSERT INTO projects (organization_id,client_id,establishment_id,code,name,description,starts_on,due_on)
         SELECT $1,e.client_id,e.id,$4,$5,$6,$7,$8 FROM establishments e
         JOIN clients c ON c.id=e.client_id AND c.organization_id=e.organization_id
         WHERE e.id=$3 AND e.client_id=$2 AND e.organization_id=$1 AND e.status='active' AND c.status='active' RETURNING id`,
        [request.authUser!.organizationId, data.clientId, data.establishmentId, data.code, data.name, data.description, data.startsOn, data.dueOn]
      );
      if (!result.rowCount) return reply.code(409).send({ error: 'ESTABLISHMENT_UNAVAILABLE', message: 'El cliente o establecimiento no existe, está inactivo o no corresponde.' });
      const id = result.rows[0].id;
      await recordAudit(db, request, 'project.create', 'project', id, { code: data.code, clientId: data.clientId, establishmentId: data.establishmentId });
      return reply.code(201).send({ id });
    } catch (error) { return constraintResponse(error, reply, 'Ya existe un proyecto con ese código.'); }
  });

  app.put('/projects/:id', { preHandler: guard('projects.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = projectInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const data = parsed.data;
    try {
      const result = await db.query(
        `UPDATE projects p SET client_id=e.client_id,establishment_id=e.id,code=$4,name=$5,description=$6,starts_on=$7,due_on=$8
         FROM establishments e JOIN clients c ON c.id=e.client_id AND c.organization_id=e.organization_id
         WHERE p.id=$9 AND p.organization_id=$1 AND e.id=$3 AND e.client_id=$2 AND e.organization_id=$1
           AND e.status='active' AND c.status='active' RETURNING p.id`,
        [request.authUser!.organizationId, data.clientId, data.establishmentId, data.code, data.name, data.description, data.startsOn, data.dueOn, params.data.id]
      );
      if (!result.rowCount) return reply.code(409).send({ error: 'INVALID_RELATION', message: 'El proyecto o su relación con cliente y establecimiento no es válida.' });
      await recordAudit(db, request, 'project.update', 'project', params.data.id, { code: data.code });
      return { id: params.data.id };
    } catch (error) { return constraintResponse(error, reply, 'Ya existe un proyecto con ese código.'); }
  });

  app.patch('/projects/:id/status', { preHandler: guard('projects.manage') }, async (request, reply) => {
    const params = idSchema.safeParse(request.params); const parsed = projectStatusSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.query('UPDATE projects SET status=$1 WHERE id=$2 AND organization_id=$3 RETURNING id', [parsed.data.status, params.data.id, request.authUser!.organizationId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Proyecto no encontrado.' });
    await recordAudit(db, request, 'project.status.change', 'project', params.data.id, parsed.data);
    return { id: params.data.id, status: parsed.data.status };
  });
}
