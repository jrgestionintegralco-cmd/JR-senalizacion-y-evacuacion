# Local validation — 2026-10-03

## Passed

- YAML syntax and expected local structure (not Render API/schema validation).
- Docker build with frozen npm lockfile: TypeScript API and Vite web compile.
- Combined image runs Node 22, Nginx and Sharp. Runtime C++ libraries are copied
  from the same Node build image; missing-library failure found and corrected.
- Generated Nginx configuration passes nginx -t; web HTML serves successfully.
- In a NEW disposable local PostgreSQL16/PostGIS3.4 container, schema creates
  zero organizations/users; explicit reviewer operation creates one synthetic
  organization, one user and 22 permissions. No production/Cloud data copied.
- Repeating either schema initialization or reviewer provisioning is refused;
  counts remain one organization/user, avoiding duplicates.
- Through Nginx /api: PostGIS readiness, real database login, Secure/HttpOnly/
  SameSite=Strict cookie, auth/me and dashboard/users/roles/settings/clients/
  establishments/projects/buildings/floors/floor-plans return expected success.
- No MinIO exists in the test network; storage points to unavailable loopback.
- Idle combined app container about 57 MiB, separate DB about 156 MiB after
  smoke checks. These are not peak/load or Render capacity guarantees.
- All original tracked files unchanged; Oracle package file checksums unchanged.
- Only disposable test containers/network and their own ephemeral database were
  created and removed. Existing services, data, credentials and network policy
  were not changed. Test image retained locally; no image published.

## Pending; do not declare Render-ready

- Current official free-tier, PostGIS/pgcrypto and PostgreSQL16 availability:
  official Render documentation endpoints returned HTTP403 here.
- Blueprint validation by Render and nested-path selection compatibility.
- Managed staging DB extension privileges/version and external TLS connectivity.
- Actual Render HTTPS, exact origin, cookie/session and cold-start behavior.
- Free-plan current account/payment requirements, expiry, quotas and RAM limits.

No account, external resource, deployment, certificate issuance, current Cloud
DB migration or restore was performed. The local SQL test confirms compatibility
with the existing PostgreSQL16/PostGIS3.4 image, not Render managed PostgreSQL.
