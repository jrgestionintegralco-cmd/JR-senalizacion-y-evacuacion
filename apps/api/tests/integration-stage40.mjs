// Explicit opt-in. Uses fresh database/bucket pairs and keeps them for inspection.
// Run ONLY with the maintenance image; never points the tested API at JR's database.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { buildServer } from '../dist/server.js';
import { loadConfig } from '../dist/config.js';
import { hashSessionToken } from '../dist/security.js';
import { createBundle, restoreBundle, verifyBundle } from '../../../infra/backup/bundle.mjs';

if (process.env.RUN_STAGE40_INTEGRATION !== 'yes') throw new Error('Set RUN_STAGE40_INTEGRATION=yes explicitly');
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const dbName = `jr_stage40_test_${suffix}`;
const restoredName = `jr_stage40_restore_${suffix}`;
const bucket = `jr-stage40-test-${suffix}`;
const restoredBucket = `jr-stage40-restore-${suffix}`;
const baseUrl = new URL(process.env.DATABASE_URL);
const dbUrl = (name) => { const u = new URL(baseUrl); u.pathname = '/' + name; return u.href; };
const administrative = new pg.Client({ connectionString: baseUrl.href });
const storage = { endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, bucket, accessKey: process.env.S3_ACCESS_KEY, secretKey: process.env.S3_SECRET_KEY };
const store = new S3Client({ endpoint: storage.endpoint, region: storage.region || 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: storage.accessKey, secretAccessKey: storage.secretKey } });
let app; let db; let checks = 0;
const pass = (name) => { checks++; console.log(`PASS ${checks}: ${name}`); };
try {
  await administrative.connect();
  for (const name of [dbName, restoredName]) {
    assert.match(name, /^jr_stage40_(test|restore)_[a-f0-9]{12}$/);
    await administrative.query(`CREATE DATABASE "${name}"`);
  }
  await store.send(new CreateBucketCommand({ Bucket: bucket }));
  db = new pg.Pool({ connectionString: dbUrl(dbName), max: 12 });
  for (const file of ['001_platform.sql','002_stage2.sql','003_stage3.sql','004_stage40.sql','004_stage40.sql']) await db.query(await readFile(new URL('../../../infra/db/init/' + file, import.meta.url), 'utf8'));
  pass('migrations including 004 idempotence');
  const org = (await db.query('SELECT id FROM organizations LIMIT 1')).rows[0].id;
  const token = randomUUID();
  const user = (await db.query("INSERT INTO users(organization_id,email,full_name,password_hash) VALUES($1,'stage40@example.invalid','Stage 4.0 Test','no-login') RETURNING id",[org])).rows[0].id;
  await db.query("INSERT INTO user_roles SELECT $1,id FROM roles WHERE organization_id=$2 AND code='administrator'",[user,org]);
  await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user,hashSessionToken(token)]);
  const client = (await db.query("INSERT INTO clients(organization_id,legal_name,document_type,document_number) VALUES($1,'Test','other','test') RETURNING id",[org])).rows[0].id;
  const establishment = (await db.query("INSERT INTO establishments(organization_id,client_id,name,address,city) VALUES($1,$2,'Test','Test','Test') RETURNING id",[org,client])).rows[0].id;
  const project = (await db.query("INSERT INTO projects(organization_id,client_id,establishment_id,code,name) VALUES($1,$2,$3,'TEST','Test') RETURNING id",[org,client,establishment])).rows[0].id;
  const building = (await db.query("INSERT INTO buildings(organization_id,project_id,name) VALUES($1,$2,'Test') RETURNING id",[org,project])).rows[0].id;
  const floor = (await db.query("INSERT INTO floors(organization_id,building_id,name,level_number) VALUES($1,$2,'Test',0) RETURNING id",[org,building])).rows[0].id;
  const config = loadConfig({ ...process.env, NODE_ENV:'test', DATABASE_URL:dbUrl(dbName), S3_BUCKET:bucket, S3_PUBLIC_ENDPOINT:storage.endpoint });
  app = await buildServer({ config, db });
  const request = (method,url,payload,session=token) => app.inject({ method,url,payload,headers: session ? { cookie:'jr_session='+session } : {} });
  const png = await sharp({ create: { width:16,height:16,channels:3,background:'white' } }).png().toBuffer();
  const input = {name:'test.png',title:'Test plan',contentType:'image/png',sizeBytes:png.length};
  const create = () => request('POST',`/floors/${floor}/plans/presign`,input);
  const upload = (plan, bytes=png) => fetch(plan.uploadUrl,{method:'PUT',headers:{'Content-Type':'image/png'},body:bytes});
  const complete = (id) => request('POST',`/floor-plans/${id}/complete`);
  const responses = await Promise.all(Array.from({length:6},create));
  responses.forEach(r => assert.equal(r.statusCode,201,r.body));
  const plans = responses.map(r=>r.json()).sort((a,b)=>a.version-b.version);
  assert.deepEqual(plans.map(p=>p.version),[1,2,3,4,5,6]); pass('concurrent version allocation');
  assert.match(new URL(plans[0].uploadUrl).searchParams.get('X-Amz-SignedHeaders'),/content-length/);
  assert.equal((await upload(plans[0],Buffer.alloc(png.length+1))).ok,false); pass('signed upload size bound');
  for (const plan of plans.slice(0,2)) assert.equal((await upload(plan)).ok,true);
  assert.equal((await complete(plans[1].id)).json().status,'ready');
  assert.equal((await complete(plans[0].id)).json().status,'superseded'); pass('late old upload does not displace newer version');
  assert.equal((await complete(plans[1].id)).json().status,'ready');
  assert.equal(Number((await db.query("SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='plan.upload.complete'",[plans[1].id])).rows[0].count),1); pass('idempotent completion and transactional audit');
  assert.equal((await upload(plans[1],Buffer.alloc(png.length,65))).ok,true);
  const downloaded = await request('GET',`/floor-plans/${plans[1].id}/download`);
  assert.equal(downloaded.statusCode,200,downloaded.body);
  assert.match(downloaded.headers['cache-control'],/no-store/);
  const object = await fetch(downloaded.json().downloadUrl);
  assert.match(object.headers.get('cache-control'),/no-store/);
  assert.deepEqual(Buffer.from(await object.arrayBuffer()),png); pass('reused upload URL cannot overwrite sealed original');
  await upload(plans[2],Buffer.alloc(png.length,65));
  assert.equal((await complete(plans[2].id)).statusCode,422); pass('fake MIME rejected');
  for (const plan of plans.slice(3,5)) assert.equal((await upload(plan)).ok,true);
  const simultaneous = await Promise.all(plans.slice(3,5).map(p=>complete(p.id)));
  simultaneous.forEach(r=>assert.equal(r.statusCode,200,r.body));
  const ready = (await db.query("SELECT version FROM floor_plans WHERE status='ready'")).rows;
  assert.deepEqual(ready,[{version:5}]); pass('concurrent completions leave exactly one current version');
  await assert.rejects(db.query("UPDATE floor_plans SET status='ready' WHERE id=$1",[plans[0].id]),{code:'23505'}); pass('database prevents two current versions');
  assert.equal((await request('GET',`/floor-plans/${plans[1].id}/download`,undefined,null)).statusCode,401); pass('unauthenticated access rejected');
  const otherOrg = (await db.query("INSERT INTO organizations(name,legal_name) VALUES('Other','Other test organization') RETURNING id")).rows[0].id;
  const otherUser = (await db.query("INSERT INTO users(organization_id,email,full_name,password_hash) VALUES($1,'other@example.invalid','Other','no-login') RETURNING id",[otherOrg])).rows[0].id;
  const otherRole = (await db.query("INSERT INTO roles(organization_id,code,name) VALUES($1,'test','Test') RETURNING id",[otherOrg])).rows[0].id;
  await db.query("INSERT INTO role_permissions VALUES($1,'plans.read'),($1,'plans.manage')",[otherRole]);
  await db.query('INSERT INTO user_roles VALUES($1,$2)',[otherUser,otherRole]);
  const otherToken = randomUUID();
  await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[otherUser,hashSessionToken(otherToken)]);
  assert.equal((await request('GET',`/floor-plans/${plans[1].id}/download`,undefined,otherToken)).statusCode,404);
  assert.equal((await request('POST',`/floor-plans/${plans[1].id}/complete`,undefined,otherToken)).statusCode,404); pass('organization isolation');
  await db.query("DELETE FROM role_permissions WHERE role_id=$1 AND permission_code='plans.manage'",[otherRole]);
  assert.equal((await request('POST',`/floors/${floor}/plans/presign`,input,otherToken)).statusCode,403); pass('read-only role cannot upload');
  assert.equal((await request('GET','/clients')).statusCode,200);
  assert.equal((await request('GET','/buildings')).statusCode,200); pass('existing lists still work');
  // Force an audit error to prove all completion metadata is rolled back.
  await upload(plans[5]);
  await db.query("CREATE FUNCTION test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='plan.upload.complete' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_audit_failure()");
  assert.equal((await complete(plans[5].id)).statusCode,500);
  assert.equal((await db.query('SELECT status FROM floor_plans WHERE id=$1',[plans[5].id])).rows[0].status,'pending');
  await db.query('DROP TRIGGER test_audit_failure ON audit_events; DROP FUNCTION test_audit_failure()'); pass('audit failure rolls back completion');
  const documentFloor = (await db.query("INSERT INTO floors(organization_id,building_id,name,level_number) VALUES($1,$2,'Document fixtures',1) RETURNING id",[org,building])).rows[0].id;
  const pdf = await PDFDocument.create();
  pdf.addPage([400,300]).drawRectangle({x:20,y:20,width:360,height:260,borderWidth:2});
  const jpeg = await sharp(png).jpeg().toBuffer();
  for (const [name,type,bytes] of [['plan.pdf','application/pdf',Buffer.from(await pdf.save())],['plan.jpg','image/jpeg',jpeg]]) {
    const created = await request('POST',`/floors/${documentFloor}/plans/presign`,{name,title:'Document fixture',contentType:type,sizeBytes:bytes.length});
    assert.equal(created.statusCode,201,created.body);
    const plan = created.json();
    assert.equal((await fetch(plan.uploadUrl,{method:'PUT',headers:{'Content-Type':type},body:bytes})).ok,true);
    const completed = await complete(plan.id); assert.equal(completed.statusCode,200,completed.body);
    const link = await request('GET',`/floor-plans/${plan.id}/download`);
    const recovered = await fetch(link.json().downloadUrl);
    assert.deepEqual(Buffer.from(await recovered.arrayBuffer()),bytes);
    pass(`${type} upload, validation and exact download`);
  }
  const directory = `/backups/stage40-test-${suffix}`;
  const backup = await createBundle({dbUrl:dbUrl(dbName),storage,directory});
  const manifest = await verifyBundle(directory); assert.ok(manifest.objects.length>=4); pass('database and real files backup with checksums');
  await assert.rejects(restoreBundle({dbUrl:dbUrl(dbName),storage,directory}),/DIFFERENT/); pass('refuses restore over source');
  const restored = await restoreBundle({dbUrl:dbUrl(restoredName),storage:{...storage,bucket:restoredBucket},directory});
  assert.equal(restored.readyFiles,6); pass('isolated restoration and all restored object hashes verified');
  const recoveredDb = new pg.Client({connectionString:dbUrl(restoredName)}); await recoveredDb.connect();
  try {
    assert.equal(Number((await recoveredDb.query('SELECT count(*) FROM sessions')).rows[0].count),0);
    assert.deepEqual((await recoveredDb.query("SELECT version FROM floor_plans WHERE status='ready' AND floor_id=$1",[floor])).rows,[{version:5}]);
    const checksum = createHash('sha256').update(png).digest('hex');
    assert.equal((await recoveredDb.query("SELECT count(*)::int AS n FROM stored_files WHERE status='ready' AND checksum_sha256=$1",[checksum])).rows[0].n,4);
  } finally { await recoveredDb.end(); }
  pass('restored versions, checksums and session revocation');
  console.log(JSON.stringify({passed:checks,dbName,restoredName,bucket,restoredBucket,backup,restored}));
} finally {
  if(app) await app.close(); else if(db) await db.end();
  await administrative.end(); store.destroy();
}
