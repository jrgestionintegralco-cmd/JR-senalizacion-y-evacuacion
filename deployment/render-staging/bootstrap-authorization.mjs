// Pure authorization checks. No database, subprocess, or environment mutation.
const CODES = new Set([
  'BOOTSTRAP_ARGUMENT_INVALID', 'RENDER_ABSENT', 'RENDER_VALUE_INVALID',
  'STAGING_DATABASE_CONFIRMATION_INVALID', 'STAGING_BOOTSTRAP_CONFIRMATION_INVALID',
  'RENDER_EXTERNAL_URL_ABSENT', 'RENDER_EXTERNAL_URL_FORMAT_INVALID',
  'RENDER_EXTERNAL_URL_PROTOCOL_INVALID', 'RENDER_EXTERNAL_URL_HOSTNAME_INVALID'
]);
class AuthorizationDiagnostic extends Error {
  constructor(code) {
    super('Staging bootstrap authorization failed');
    this.code = code;
  }
}
export function bootstrapAuthorizationDiagnostic(error) {
  return error instanceof AuthorizationDiagnostic && CODES.has(error.code)
    ? error.code : 'NO_AUTHORIZATION_DIAGNOSTIC';
}
export function validateBootstrapAuthorization(argv, env) {
  if (argv.length !== 3 || argv[2] !== '--execute-once') {
    throw new AuthorizationDiagnostic('BOOTSTRAP_ARGUMENT_INVALID');
  }
  if (env.RENDER === undefined) throw new AuthorizationDiagnostic('RENDER_ABSENT');
  if (env.RENDER !== 'true') throw new AuthorizationDiagnostic('RENDER_VALUE_INVALID');
  if (env.CONFIRM_RENDER_STAGING !== 'safe_enter_render_staging') {
    throw new AuthorizationDiagnostic('STAGING_DATABASE_CONFIRMATION_INVALID');
  }
  if (env.STAGING_BOOTSTRAP_CONFIRM !== 'CREATE_FIRST_JR_RENDER_STAGING_ADMIN') {
    throw new AuthorizationDiagnostic('STAGING_BOOTSTRAP_CONFIRMATION_INVALID');
  }
  if (env.RENDER_EXTERNAL_URL === undefined || env.RENDER_EXTERNAL_URL === '') {
    throw new AuthorizationDiagnostic('RENDER_EXTERNAL_URL_ABSENT');
  }
  let origin;
  try { origin = new URL(env.RENDER_EXTERNAL_URL); }
  catch { throw new AuthorizationDiagnostic('RENDER_EXTERNAL_URL_FORMAT_INVALID'); }
  if (origin.protocol !== 'https:') {
    throw new AuthorizationDiagnostic('RENDER_EXTERNAL_URL_PROTOCOL_INVALID');
  }
  if (!origin.hostname.endsWith('.onrender.com')) {
    throw new AuthorizationDiagnostic('RENDER_EXTERNAL_URL_HOSTNAME_INVALID');
  }
}
