# One-time initial access on Render Free — prepared, not executed

Normal startup remains unchanged when all four temporary variables are absent.
Partial, empty or incorrect authorization stops startup without invoking bootstrap.
Complete authorization runs bootstrap-admin.mjs --execute-once BEFORE API/Nginx.
Success starts the existing services; failure stops startup, without retrying.
The wrapper removes temporary variables from its environment before spawning
API/Nginx. This does not delete secrets stored in Render settings.

## Future execution, requiring separate authorization

1. Authorize commit/push and rebuilding the service with these files. No database
   operation occurs if all temporary variables are absent.
2. In the existing service's Render Environment settings, configure:
   - CONFIRM_RENDER_STAGING=safe_enter_render_staging
   - STAGING_BOOTSTRAP_CONFIRM=CREATE_FIRST_JR_RENDER_STAGING_ADMIN
   - STAGING_BOOTSTRAP_EMAIL: a new staging-only email
   - STAGING_BOOTSTRAP_PASSWORD: a new 12–128-character password from a password
     manager, entered privately. Do not put it in Git, commands or chat.
3. Save all four together and initiate the authorized restart/deploy once.
   Existing internal DATABASE_URL is used, never an external database URL.
   The script also requires Render's RENDER=true and HTTPS RENDER_EXTERNAL_URL
   under onrender.com, and checks the actual database name.
4. Expect a sanitized success message. Only a new user, its association to the
   existing administrator role and an audit marker are inserted transactionally.
   Organization/role/permission discrepancies, existing email or an existing
   active administrator cause refusal. No existing records are overwritten.
5. Immediately remove ALL FOUR temporary variables in Render and apply that
   change. A restart with them still present attempts bootstrap again and fails
   because the durable audit marker refuses reuse. Removing variables restores
   normal startup; it never removes the marker or user.
6. Sign in through the existing HTTPS URL with the selected email and password.

Bootstrap checks all 22 existing stage 1–4.0 administrator permissions. It counts
all exact JR legal-name matches, rejecting duplicates even if inactive, and
requires the sole match to be active. A transaction, table locks and advisory
lock protect checks and writes. The durable audit marker prevents another
successful bootstrap even for a different email while that marker is retained.
No new tables, organizations, roles, permissions or migration are introduced.

On timeout or uncertain commit outcome, stop and inspect state before retrying;
never delete the marker to force a second execution. This is a guarded manual
bootstrap, not a new public endpoint or an automatically retried operation.

## Validation limits

Syntax checks and node --test bootstrap-startup.test.mjs pass. Tests simulate
child processes and verify authorization, ordering, success/failure and removal
of temporary variables. They NEVER execute bootstrap-admin.mjs or connect to a
database. SQL guarantees have been statically reviewed, not exercised against
Render. Existing Dockerfile already copies this directory; no Dockerfile,
Blueprint, application source or Oracle-package change is needed.
