# MinIO for real staging file acceptance

The application still uses PostgreSQL and MinIO/S3 with direct signed uploads.
No local browser filesystem, alternate storage provider, new schema or migrations
are introduced. This package does NOT provision a MinIO server, public endpoint,
TLS certificate or storage volume. The original free visual staging excluded file
storage; its disabled loopback endpoint cannot be used for file acceptance.

## Render application environment

Update these EXISTING variables in the Render web service, without copying secrets
into source code or sharing them in chat:

| Variable | Required value |
| --- | --- |
| `S3_ENDPOINT` | MinIO API URL reachable from Render, preferably HTTPS; an internal URL is allowed if actually routable from Render. Not the console. |
| `S3_PUBLIC_ENDPOINT` | HTTPS MinIO API URL reachable from Chrome. Publicly resolvable hostname and valid TLS certificate. No localhost, loopback, private-only hostname, console URL or bucket suffix. |
| `S3_BUCKET` | Existing private staging bucket, dedicated to staging files. |
| `S3_REGION` | Region configured in MinIO; normally `us-east-1`. |
| `S3_ACCESS_KEY` | Staging application credential, saved in Render's environment settings. |
| `S3_SECRET_KEY` | Matching secret, saved in Render's environment settings. Also authenticates short-lived upload intents; rotation invalidates outstanding intents. |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO. |

`WEB_ORIGIN`/`RENDER_EXTERNAL_URL` must continue to identify the HTTPS application.
No open CORS is added to the API. Existing application Render URL and `/api` remain.

## MinIO requirements (not applied by this change)

Use the project's existing MinIO infrastructure hosted where Render AND browsers
can reach its API, with persistent disk. Publish only the authenticated S3 API over
HTTPS. Keep the console and administration ports private. Buckets remain private;
anonymous upload/download must be denied. Signed URLs authorize individual keys
for five minutes. Do not embed the MinIO root credentials in the application.

The staging credential needs bucket availability/list access (`s3:ListBucket`) and
object read/write access (`s3:GetObject`, `s3:PutObject`) scoped to this staging bucket.
The availability check uses `HeadBucket`; sealing validates Put/Get access on actual
bytes before any version is recorded. A bucket must already exist; the application
does not create buckets or alter policies.

Configure MinIO CORS for the EXACT application origin (for example the actual
`https://<service>.onrender.com` URL), PUT/GET/HEAD and the Content-Type header.
MinIO's `MINIO_API_CORS_ALLOW_ORIGIN` may be used on the MinIO host to restrict the
origin; verify the preflight response for the installed MinIO version. Do not use
`*`, expose the console, or weaken TLS verification. The reverse proxy, if already
used by the MinIO host, must permit PUT/GET/HEAD/OPTIONS, preserve the signed path,
query and Host, and support the configured upload size. No new proxy is provisioned
by this package.

A Render Free web container has an ephemeral filesystem and is not persistent
MinIO hosting. Render paid disks/private services may incur cost and are NOT
created or authorized here. The MinIO instance inside Codex Cloud is not automatically
reachable from Render or Chrome. Setting variables alone cannot make an unreachable
server accessible. An existing suitable MinIO host/API HTTPS endpoint is required
before real Render uploads can pass; no tunnel or network permission is created here.

## Upload order and version guarantees

1. Check the public endpoint configuration, bucket availability and active floor.
2. Issue a signed S3 PUT URL and an authenticated, user/org/floor-bound upload intent.
   No file, plan or audit rows are inserted. The intent lasts 15 minutes; PUT URL 5.
3. Chrome uploads the bytes directly to MinIO.
4. Chrome confirms with the same intent. The API reads and validates PDF/PNG/JPG,
   seals a fresh server-only object, rereads it and verifies SHA-256.
5. In one PostgreSQL transaction, lock the floor, detect repeated confirmation,
   allocate the next version and insert file/plan rows already `ready`, recording
   the request/completion audit events in that same transaction. Mark only
   the prior current (`ready`) version `superseded`, preserving its file/history.
   Concurrent confirmations for the same floor serialize; only one version is current.

Missing, corrupt or failed uploads create no pending/file rows. Lost confirmation
responses can be retried with the SAME intent, without duplicate versions. Existing
V1–V5 pending rows are preserved and continue to count in version numbering. Legacy
completion requests remain supported; no automatic completion or cleanup is run.
Failed/unconfirmed uploads may leave unreferenced temporary objects in MinIO, not
pending DB rows. Define a scoped staging-object retention policy administratively
only after approval; do not delete existing objects. A DB failure after sealing can
leave an unreferenced sealed object; reconcile separately, never delete blindly.

## Isolated validation

`apps/api/tests/plans-storage.integration.test.ts` is opt-in and deliberately targets
ONLY a disposable `plan_regression` database on loopback port 15433 and a disposable
MinIO on port 19000. It never consumes DATABASE_URL or real S3 secrets. Its synthetic
credentials must never be used for staging. Start isolated containers, then run:

```
RUN_PLAN_STORAGE_INTEGRATION=1 npm test
npm run build
```

Start with empty disposable instances for each run. This validates real PDF/PNG/JPG
PUT, readback/integrity, final DB states, history, duplicate/concurrent confirmation
and failure cases. It does not prove that the saved Render environment has an active,
reachable MinIO endpoint; that acceptance must follow environment configuration.
