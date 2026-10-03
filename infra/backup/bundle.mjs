import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { S3Client, GetObjectCommand, PutObjectCommand, HeadBucketCommand, ListObjectsV2Command, CreateBucketCommand, GetBucketPolicyCommand } from '@aws-sdk/client-s3';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (url) => { const u = new URL(url); return { host: u.hostname, port: u.port || '5432', database: decodeURIComponent(u.pathname.slice(1)) }; };
const digest = async (path) => { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); };
const s3 = (config) => new S3Client({ endpoint: config.endpoint, region: config.region || 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey } });
const runPg = (program, args, dbUrl) => new Promise((ok, fail) => {
  const u = new URL(dbUrl);
  const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)) };
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) if (u.searchParams.has(key)) env['PG' + key.toUpperCase()] = u.searchParams.get(key);
  const child = spawn(program, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (part) => { errors = (errors + part).slice(-4000); });
  child.once('error', fail);
  child.once('exit', (code) => code === 0 ? ok() : fail(new Error(`${program} failed (${code}): ${errors}`)));
});

// Snapshot exports a consistent database view. The lock prevents metadata from
// being committed while its referenced objects are copied. Originals are not deleted.
export async function createBundle({ dbUrl, storage, directory }) {
  const output = resolve(directory);
  await mkdir(output, { recursive: false, mode: 0o700 });
  await mkdir(join(output, 'objects'), { mode: 0o700 });
  const client = new pg.Client({ connectionString: dbUrl });
  const store = s3(storage);
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL lock_timeout='15s'");
    // NOWAIT prevents a lock-order deadlock with in-flight uploads/completions.
    // Retry the entire backup in a quiet window if a write is already running.
    await client.query('LOCK TABLE stored_files, floor_plans IN SHARE MODE NOWAIT');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const files = (await client.query("SELECT id,object_key,content_type,size_bytes::text,checksum_sha256,status FROM stored_files WHERE status <> 'deleted' ORDER BY id")).rows;
    const objects = []; const pendingWithoutObject = [];
    for (const file of files) {
      let object;
      try { object = await store.send(new GetObjectCommand({ Bucket: storage.bucket, Key: file.object_key }), { abortSignal: AbortSignal.timeout(120000) }); }
      catch (error) {
        if (file.status === 'pending' && error.$metadata?.httpStatusCode === 404) { pendingWithoutObject.push(file.id); continue; }
        throw error;
      }
      const name = `${hash(file.object_key)}.bin`;
      const checksum = createHash('sha256'); let size = 0;
      await pipeline(object.Body, new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; checksum.update(chunk); callback(null, chunk); } }), createWriteStream(join(output, 'objects', name), { flags: 'wx', mode: 0o600 }));
      const sha256 = checksum.digest('hex');
      if (file.status === 'ready' && (size !== Number(file.size_bytes) || file.checksum_sha256 && file.checksum_sha256 !== sha256)) throw new Error(`Object integrity failed for file ${file.id}`);
      objects.push({ fileId: file.id, key: file.object_key, name, size, sha256, contentType: object.ContentType || file.content_type });
    }
    await runPg('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot}`, `--file=${join(output, 'database.dump')}`], dbUrl);
    const manifest = { format: 'jr-backup-v1', id: randomUUID(), createdAt: new Date().toISOString(), source: { ...identity(dbUrl), bucket: storage.bucket }, databaseSha256: await digest(join(output, 'database.dump')), objects, pendingWithoutObject };
    await client.query('COMMIT');
    const bytes = JSON.stringify(manifest, null, 2);
    await writeFile(join(output, 'manifest.json'), bytes, { flag: 'wx', mode: 0o600 });
    // Written last: absence of this file means an incomplete, non-restorable bundle.
    await writeFile(join(output, 'COMPLETE.sha256'), hash(bytes) + '\n', { flag: 'wx', mode: 0o600 });
    return { directory: output, objects: objects.length, pendingWithoutObject: pendingWithoutObject.length, manifestSha256: hash(bytes) };
  } finally { await client.end(); store.destroy(); }
}

export async function verifyBundle(directory) {
  const root = resolve(directory);
  const bytes = await readFile(join(root, 'manifest.json'));
  if (hash(bytes) !== (await readFile(join(root, 'COMPLETE.sha256'), 'utf8')).trim()) throw new Error('Manifest integrity failed');
  const manifest = JSON.parse(bytes);
  if (manifest.format !== 'jr-backup-v1' || !Array.isArray(manifest.objects)) throw new Error('Unknown backup format');
  if (await digest(join(root, 'database.dump')) !== manifest.databaseSha256) throw new Error('Database integrity failed');
  const keys = new Set();
  for (const object of manifest.objects) {
    if (typeof object.key !== 'string' || keys.has(object.key) || !/^[a-f0-9]{64}\.bin$/.test(object.name) || object.name !== `${hash(object.key)}.bin`) throw new Error('Invalid object manifest');
    keys.add(object.key);
    const path = join(root, 'objects', object.name);
    if ((await stat(path)).size !== object.size || await digest(path) !== object.sha256) throw new Error(`Backup object integrity failed: ${object.fileId}`);
  }
  return manifest;
}

// Deliberately refuses in-place restoration. Switch the application only after
// validating this new database/bucket pair. Never runs pg_restore --clean.
export async function restoreBundle({ dbUrl, storage, directory }) {
  const root = resolve(directory);
  const manifest = await verifyBundle(root);
  const target = identity(dbUrl);
  if (target.database === manifest.source.database || storage.bucket === manifest.source.bucket) throw new Error('Restore requires a DIFFERENT database name and bucket');
  const db = new pg.Client({ connectionString: dbUrl });
  const store = s3(storage);
  try {
    await db.connect();
    if (Number((await db.query("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_schema NOT LIKE 'pg_%'")).rows[0].count)) throw new Error('Target database is not empty');
    try {
      await store.send(new HeadBucketCommand({ Bucket: storage.bucket }));
      if ((await store.send(new ListObjectsV2Command({ Bucket: storage.bucket, MaxKeys: 1 }))).KeyCount) throw new Error('Target bucket is not empty');
      try { await store.send(new GetBucketPolicyCommand({ Bucket: storage.bucket })); throw new Error('Target bucket has a policy: use a new private bucket'); }
      catch (error) { if (error.name !== 'NoSuchBucketPolicy') throw error; }
    } catch (error) {
      if (error.$metadata?.httpStatusCode !== 404) throw error;
      await store.send(new CreateBucketCommand({ Bucket: storage.bucket }));
    }
    for (const object of manifest.objects) {
      await store.send(new PutObjectCommand({ Bucket: storage.bucket, Key: object.key, Body: createReadStream(join(root, 'objects', object.name)), ContentLength: object.size, ContentType: object.contentType, CacheControl: 'private, no-store, max-age=0', ChecksumSHA256: Buffer.from(object.sha256, 'hex').toString('base64'), IfNoneMatch: '*' }));
      const recovered = await store.send(new GetObjectCommand({ Bucket: storage.bucket, Key: object.key }));
      const actual = createHash('sha256'); for await (const chunk of recovered.Body) actual.update(chunk);
      if (actual.digest('hex') !== object.sha256) throw new Error('Restored object integrity failed');
    }
    await runPg('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname=' + target.database, join(root, 'database.dump')], dbUrl);
    // Recovery must not resurrect logged-in sessions.
    await db.query('DELETE FROM sessions');
    const ready = (await db.query("SELECT id,object_key,checksum_sha256,size_bytes::text FROM stored_files WHERE status='ready'")).rows;
    for (const file of ready) {
      const object = manifest.objects.find((item) => item.fileId === file.id && item.key === file.object_key);
      if (!object || object.size !== Number(file.size_bytes) || file.checksum_sha256 && object.sha256 !== file.checksum_sha256) throw new Error('Restored database/object mismatch');
    }
    return { database: target.database, bucket: storage.bucket, objects: manifest.objects.length, readyFiles: ready.length, sessionsRevoked: true };
  } finally { await db.end(); store.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const storage = { endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET, accessKey: process.env.S3_ACCESS_KEY, secretKey: process.env.S3_SECRET_KEY, region: process.env.S3_REGION };
  const [mode, directory] = process.argv.slice(2);
  if (!directory) throw new Error('Usage: bundle.mjs backup|verify|restore DIRECTORY');
  const options = { dbUrl: process.env.DATABASE_URL, storage, directory };
  if (mode === 'backup') console.log(JSON.stringify(await createBundle(options)));
  else if (mode === 'verify') { const m = await verifyBundle(directory); console.log(JSON.stringify({ valid: true, objects: m.objects.length })); }
  else if (mode === 'restore') console.log(JSON.stringify(await restoreBundle(options)));
  else throw new Error('Unknown operation');
}
