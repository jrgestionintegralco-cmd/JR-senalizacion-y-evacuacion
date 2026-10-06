// Opt-in, disposable PostgreSQL and MinIO ONLY. Never reads DATABASE_URL/S3 env secrets.
import { beforeAll, afterAll, expect, it, describe, vi } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createStorage } from '../src/storage.js';
import { loadConfig } from '../src/config.js';
import { registerStage3Routes } from '../src/modules/stage3.js';

const enabled = process.env.RUN_PLAN_STORAGE_INTEGRATION === '1';
describe.skipIf(!enabled)('real plan storage in disposable PostgreSQL/MinIO', () => {
  const database = new pg.Pool({ host: '127.0.0.1', port: 15433, database: 'plan_regression', user: 'regression', password: 'synthetic-test-only-password' });
  const routeDatabase = { query: database.query.bind(database), connect: () => database.connect() };
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'unused-synthetic', S3_ENDPOINT: 'http://127.0.0.1:19000', S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:19000', S3_BUCKET: 'plan-regression', S3_ACCESS_KEY: 'regression-only', S3_SECRET_KEY: 'synthetic-test-only-password', S3_FORCE_PATH_STYLE: 'true' });
  const s3 = new S3Client({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY } });
  const storage = createStorage(config);
  const app = Fastify();
  let organizationId: string, userId: string, floorId: string;
  let originalUser: string;
  const guard = () => [async (request: any) => { request.authUser = { id: userId, organizationId }; }];
  const count = async () => (await database.query('SELECT count(*)::int AS n FROM floor_plans')).rows[0].n;
  beforeAll(async () => {
    expect((await database.query('SELECT current_database() AS name')).rows[0].name).toBe('plan_regression');
    expect((await database.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].n).toBe(1); // PostGIS spatial_ref_sys
    await database.query(await readFile(new URL('../../../deployment/render-staging/schema.sql', import.meta.url), 'utf8'));
    organizationId = (await database.query("INSERT INTO organizations(name,legal_name) VALUES ('Synthetic storage test','Synthetic storage test') RETURNING id")).rows[0].id;
    userId = (await database.query("INSERT INTO users(organization_id,email,full_name,password_hash) VALUES ($1,'storage-test@example.test','Synthetic user','not-a-login-hash') RETURNING id", [organizationId])).rows[0].id;
    originalUser = userId;
    const clientId = (await database.query("INSERT INTO clients(organization_id,legal_name,document_type,document_number) VALUES ($1,'Synthetic client','other','TEST001') RETURNING id", [organizationId])).rows[0].id;
    const establishmentId = (await database.query("INSERT INTO establishments(organization_id,client_id,name,address,city) VALUES ($1,$2,'Synthetic establishment','Test address','Test city') RETURNING id", [organizationId, clientId])).rows[0].id;
    const projectId = (await database.query("INSERT INTO projects(organization_id,client_id,establishment_id,code,name) VALUES ($1,$2,$3,'TEST-001','Synthetic project') RETURNING id", [organizationId, clientId, establishmentId])).rows[0].id;
    const buildingId = (await database.query("INSERT INTO buildings(organization_id,project_id,name) VALUES ($1,$2,'Synthetic building') RETURNING id", [organizationId, projectId])).rows[0].id;
    floorId = (await database.query("INSERT INTO floors(organization_id,building_id,name,level_number) VALUES ($1,$2,'Synthetic floor',1) RETURNING id", [organizationId, buildingId])).rows[0].id;
    await s3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
    app.decorateRequest('authUser', null);
    await registerStage3Routes(app, routeDatabase as any, storage, config.MAX_UPLOAD_BYTES, guard);
    await app.ready();
  }, 30000);
  afterAll(async () => { await app.close(); await database.end(); s3.destroy(); });
  const authorize = async (type: string, size: number) => {
    const result = await app.inject({ method: 'POST', url: `/floors/${floorId}/plans/presign`, payload: { name: 'synthetic-plan', title: 'Synthetic plan', contentType: type, sizeBytes: size } });
    expect(result.statusCode).toBe(201);
    return result.json();
  };
  const confirm = (issued: any) => app.inject({ method: 'POST', url: `/floor-plans/${issued.id}/complete`, payload: { uploadToken: issued.uploadToken } });
  const realUpload = async (bytes: Buffer, type: string) => {
    const previous = await count();
    const issued = await authorize(type, bytes.length);
    expect(await count()).toBe(previous);
    expect((await fetch(issued.uploadUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: new Uint8Array(bytes) })).status).toBe(200);
    expect(await count()).toBe(previous);
    const completed = await confirm(issued);
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ status: 'ready', id: issued.id });
    const row = (await database.query('SELECT fp.status,sf.object_key,sf.checksum_sha256,sf.status AS file_status FROM floor_plans fp JOIN stored_files sf ON sf.id=fp.stored_file_id WHERE fp.id=$1', [issued.id])).rows[0];
    expect(row).toMatchObject({ status: 'ready', file_status: 'ready', checksum_sha256: createHash('sha256').update(bytes).digest('hex') });
    const object = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: row.object_key }));
    expect(Buffer.from(await object.Body!.transformToByteArray())).toEqual(bytes);
    expect((await database.query('SELECT action FROM audit_events WHERE entity_id=$1 ORDER BY action', [issued.id])).rows.map(row => row.action)).toEqual(['plan.upload.complete', 'plan.upload.request']);
    return issued;
  };
  it('uploads and rereads a real PDF, PNG and JPG; each confirmation keeps one current version and its history', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage([200, 100]);
    const files: [Buffer, string][] = [[Buffer.from(await pdf.save()), 'application/pdf']];
    for (const format of ['png', 'jpeg'] as const) files.push([await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).toFormat(format).toBuffer(), `image/${format}`]);
    for (const [bytes, type] of files) await realUpload(bytes, type);
    const rows = (await database.query('SELECT version,status FROM floor_plans ORDER BY version')).rows;
    expect(rows).toEqual([{ version: 1, status: 'superseded' }, { version: 2, status: 'superseded' }, { version: 3, status: 'ready' }]);
    expect((await database.query("SELECT count(*)::int AS n FROM floor_plans WHERE status='pending'")).rows[0].n).toBe(0);
  }, 30000);
  it('a failed or corrupt transfer creates no plan/file rows; retries of authorization create no pending versions', async () => {
    const before = await count();
    const filesBefore = (await database.query('SELECT count(*)::int AS n FROM stored_files')).rows[0].n;
    const issued = await authorize('image/png', 8);
    expect((await confirm(issued)).statusCode).toBe(409);
    for (let i = 0; i < 3; i++) await authorize('image/png', 8);
    expect((await fetch(issued.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(8) })).status).toBe(200);
    expect((await confirm(issued)).statusCode).toBe(422);
    expect(await count()).toBe(before);
    expect((await database.query('SELECT count(*)::int AS n FROM stored_files')).rows[0].n).toBe(filesBefore);
  }, 15000);
  it('repeating or concurrently confirming the same uploaded intent is idempotent', async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    const issued = await authorize('image/png', bytes.length);
    await fetch(issued.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(bytes) });
    const before = await count();
    const responses = await Promise.all([confirm(issued), confirm(issued)]);
    for (const result of responses) expect(result.statusCode).toBe(200);
    expect(responses[0].json()).toEqual(responses[1].json());
    expect(await count()).toBe(before + 1);
    expect((await confirm(issued)).json()).toEqual(responses[0].json());
    expect((await database.query("SELECT count(*)::int AS n FROM floor_plans WHERE status='ready'")).rows[0].n).toBe(1);
  }, 15000);
  it('unavailable storage and unsafe production public endpoints reject before writing metadata', async () => {
    const spy = vi.spyOn(storage, 'ensurePlanStorageAvailable').mockRejectedValueOnce(new Error('synthetic unavailable'));
    const before = await count();
    const response = await app.inject({ method: 'POST', url: `/floors/${floorId}/plans/presign`, payload: { name: 'plan.png', title: 'Synthetic plan', contentType: 'image/png', sizeBytes: 10 } });
    expect(response.statusCode).toBe(503);expect(await count()).toBe(before);spy.mockRestore();
    await expect(createStorage({ ...config, NODE_ENV: 'production', S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9' }).ensurePlanStorageAvailable()).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
  });
  it('rejects modified upload tokens and tokens belonging to another user without creating a version', async () => {
    const issued = await authorize('image/png', 10);const before = await count();
    const modified = await app.inject({ method: 'POST', url: `/floor-plans/${issued.id}/complete`, payload: { uploadToken: issued.uploadToken + 'x' } });
    expect(modified.statusCode).toBe(400);
    userId = '11111111-1111-4111-8111-111111111111';
    try { expect((await confirm(issued)).statusCode).toBe(403); } finally { userId = originalUser; }
    expect(await count()).toBe(before);
  });
  it('keeps existing V1–V5 pending records intact and numbers the confirmed upload V6', async () => {
    const previousFloor = floorId;
    const buildingId = (await database.query('SELECT building_id FROM floors WHERE id=$1', [floorId])).rows[0].building_id;
    floorId = (await database.query("INSERT INTO floors(organization_id,building_id,name,level_number) VALUES ($1,$2,'Synthetic legacy floor',2) RETURNING id", [organizationId, buildingId])).rows[0].id;
    try {
      for (let version = 1; version <= 5; version++) {
        const fileId = (await database.query("INSERT INTO stored_files(organization_id,object_key,original_name,content_type,size_bytes) VALUES ($1,$2,'legacy.png','image/png',8) RETURNING id", [organizationId, `synthetic/legacy/${version}`])).rows[0].id;
        await database.query("INSERT INTO floor_plans(organization_id,floor_id,stored_file_id,title,version) VALUES ($1,$2,$3,'Synthetic legacy plan',$4)", [organizationId, floorId, fileId, version]);
      }
      const prior = (await database.query('SELECT * FROM floor_plans WHERE floor_id=$1 ORDER BY version', [floorId])).rows;
      const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
      const issued = await realUpload(bytes, 'image/png');
      expect((await confirm(issued)).json()).toMatchObject({ status: 'ready', version: 6 });
      expect((await database.query('SELECT * FROM floor_plans WHERE floor_id=$1 AND version<=5 ORDER BY version', [floorId])).rows).toEqual(prior);
    } finally { floorId = previousFloor; }
  }, 15000);
  it('a confirmation transaction failure rolls back file creation and current-version changes', async () => {
    const before = await count();
    const previous = (await database.query('SELECT id,status FROM floor_plans ORDER BY id')).rows;
    const filesBefore = (await database.query('SELECT count(*)::int AS n FROM stored_files')).rows[0].n;
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    const issued = await authorize('image/png', bytes.length);
    await fetch(issued.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(bytes) });
    const connect = database.connect.bind(database);
    const spy = vi.spyOn(routeDatabase, 'connect').mockImplementationOnce(async () => {
      const connection = await connect();
      const query = connection.query.bind(connection);
      return { query: async (sql: string, values: any[]) => {
        if (sql.includes('INSERT INTO floor_plans')) throw new Error('synthetic transaction failure');
        return query(sql, values);
      }, release: connection.release.bind(connection) } as any;
    });
    try { expect((await confirm(issued)).statusCode).toBe(503); } finally { spy.mockRestore(); }
    expect(await count()).toBe(before);
    expect((await database.query('SELECT id,status FROM floor_plans ORDER BY id')).rows).toEqual(previous);
    expect((await database.query('SELECT count(*)::int AS n FROM stored_files')).rows[0].n).toBe(filesBefore);
  }, 15000);
  it('a real missing bucket rejects authorization without changing rows', async () => {
    const isolated = Fastify(); isolated.decorateRequest('authUser', null);
    await registerStage3Routes(isolated, database, createStorage({ ...config, S3_BUCKET: 'missing-regression-bucket' }), config.MAX_UPLOAD_BYTES, guard);
    const before = await count();
    try {
      const response = await isolated.inject({ method: 'POST', url: `/floors/${floorId}/plans/presign`, payload: { name: 'plan.png', title: 'Synthetic plan', contentType: 'image/png', sizeBytes: 10 } });
      expect(response.statusCode).toBe(503);expect(response.json().error).toBe('STORAGE_UNAVAILABLE');
      expect(await count()).toBe(before);
    } finally { await isolated.close(); }
  });

});
