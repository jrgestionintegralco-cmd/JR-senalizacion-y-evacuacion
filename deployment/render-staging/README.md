# SAFE ENTER 360 — isolated Render visual staging

Preparation only: no Render account/resource/deployment, no changes to stages
1–4.0, Oracle package, existing database or storage. No production data restore.

## Proposed topology

Chrome → Render managed HTTPS (*.onrender.com) → one Docker Web Service
→ Nginx on $PORT → static web; /api/ → existing API on loopback:4000
→ separate Render PostgreSQL 16 with PostGIS + pgcrypto.

Nginx and API share one service to keep one origin and minimize free services;
this changes deployment packaging, not application logic. The API has no public
port. Secure, HttpOnly, SameSite=Strict session cookies remain unchanged. Render
terminates TLS; no purchased domain or local certificates are necessary. The
wrapper supplies WEB_ORIGIN from Render's HTTPS RENDER_EXTERNAL_URL (or an exact
explicit WEB_ORIGIN); CORS is never wildcard. No secret comes from Cloud .env.
The wrapper supervises both processes and stops the sibling if either fails.

## Blueprint

`render.yaml` is intentionally nested. Later, select this Blueprint path in
Render; do not move it to the repo root. It requests one free Docker Web Service
and a separate free PostgreSQL 16 database. No account was created, remote YAML
validation performed, or GitHub push made. Free plan availability and database
version/extension support must be confirmed with current Render documentation.
The liveness check permits the service to start before manual DB initialization;
readiness is separately checked at /api/health/ready after initialization.

## Controlled schema and reviewer setup — NOT automatic

Never run npm run seed or mount infra/db/init as automatic init scripts.
`schema.sql` derives the existing schema and permission catalog, excluding the
001 organization, role, role-permission and setting seeds. Later migrations are
included; with no roles they create no associations. The 004 inner transaction
markers are omitted so the whole schema is one atomic transaction.

`database.mjs schema` requires the exact isolated database name, explicit
CONFIRM_RENDER_STAGING, unchanged source migration checksums and an empty public
schema (except spatial_ref_sys). Nonempty databases are refused, never patched.
`database.mjs reviewer` is a separate, explicit operation to create one synthetic
review organization, administrator and user with fresh credentials. It refuses
any existing organizations/users; it cannot silently overwrite passwords or
introduce a second organization. Both operations use an advisory transaction
lock and rollback on failure. Neither runs at build/start/deploy.

After a future authorized deployment, run these from a trusted local machine
with Docker using the staging EXTERNAL database URL, not the Cloud database:

```sh
docker build -t safe-enter-render-staging -f deployment/render-staging/Dockerfile .
docker run --rm --env-file /secure/path/render-initialization.env --entrypoint node safe-enter-render-staging deployment/render-staging/database.mjs schema
docker run --rm --env-file /secure/path/render-initialization.env --entrypoint node safe-enter-render-staging deployment/render-staging/database.mjs reviewer
```

Use an appropriate verified TLS configuration for external PostgreSQL as
specified by Render. Never disable certificate verification. External database
URL, access controls and trusted-machine connectivity require later validation.
No free-service SSH/shell or paid predeploy command is assumed.

## Storage scope

Existing storage clients initialize lazily: login, readiness, session, dashboard
and administrative navigation do not call MinIO. Required S3 config points to
unavailable loopback port 9 with visibly dummy credentials. No replacement
storage or public MinIO is introduced. File upload/download, confirmation,
plan content/validation and object backup/restore are excluded from acceptance.
Some upload-link requests can create pending metadata before the upload fails;
reviewers must avoid all file actions. The application UI is not modified to
hide them. No existing object or stored-file metadata is imported.

## Free tier: conditional, disposable, not durable storage

Historically Render free web instances have 512 MB RAM, sleep after inactivity
(around 15 minutes), cold starts and a shared monthly instance-hour allowance
(around 750 hours). They have ephemeral filesystems and no free persistent disk.
Historically free PostgreSQL has about 1 GB storage, expires around 30 days and
lacks managed backups. These are NOT verified current terms: render.com/docs/free
and /docs/postgresql-extensions returned HTTP 403 in this environment on
2026-10-03. Confirm current limits, signup/payment requirements, PostGIS/pgcrypto,
PostgreSQL 16 and free Blueprint eligibility before creating anything.

Configured intended service cost: $0 only if these free offerings remain
available. No paid fallback, card, paid plan or automatic upgrade is authorized.
Do not put important data here. Cold starts and combined-process RAM must be
assessed on Render; local idle measurements do not guarantee its limits.

## Getting a URL later

After current terms/extension/Blueprint confirmation, Rocío would authorize
publishing these isolated files to GitHub, create/connect a Render account,
select the nested Blueprint, confirm only free plans, initialize the separate
schema and synthetic reviewer explicitly, then validate readiness/login over
HTTPS. The resulting URL comes from Render; no URL exists yet.
