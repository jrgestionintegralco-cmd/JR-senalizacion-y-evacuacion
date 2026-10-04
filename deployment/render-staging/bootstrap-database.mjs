import connectionString from 'pg-connection-string';

const DIAGNOSTIC_CODES = new Set([
  'DATABASE_URL_ABSENT', 'DATABASE_URL_EMPTY', 'DATABASE_URL_INVALID_TYPE',
  'DATABASE_URL_INVALID_SCHEME', 'DATABASE_URL_PARSER_ERROR',
  'DATABASE_URL_HOST_ABSENT', 'DATABASE_URL_DATABASE_ABSENT',
  'DATABASE_URL_HOST_AND_DATABASE_ABSENT'
]);
class DatabaseTargetDiagnostic extends Error {
  constructor(code) {
    super('Staging database connection validation failed');
    this.code = code;
  }
}

// Only fixed, locally defined codes may reach logs. Never expose parser/driver
// messages, causes, stack traces or values from the connection configuration.
export function bootstrapDatabaseDiagnostic(error) {
  return error instanceof DatabaseTargetDiagnostic && DIAGNOSTIC_CODES.has(error.code)
    ? error.code : 'NO_DATABASE_PARSING_DIAGNOSTIC';
}

// Let the existing PostgreSQL driver interpret DATABASE_URL exactly as the API
// does. The deployment's authorized binding, not a Blueprint example name,
// identifies the database. Never return/log credentials or rewrite the URL.
export function bootstrapDatabaseTarget(value) {
  if (value === undefined || value === null) throw new DatabaseTargetDiagnostic('DATABASE_URL_ABSENT');
  if (typeof value !== 'string') throw new DatabaseTargetDiagnostic('DATABASE_URL_INVALID_TYPE');
  if (value === '') throw new DatabaseTargetDiagnostic('DATABASE_URL_EMPTY');
  if (!/^postgres(?:ql)?:\/\//i.test(value)) throw new DatabaseTargetDiagnostic('DATABASE_URL_INVALID_SCHEME');
  let parsed;
  try { parsed = connectionString.parse(value); }
  catch { throw new DatabaseTargetDiagnostic('DATABASE_URL_PARSER_ERROR'); }
  if (!parsed.database || !parsed.host) {
    const code = !parsed.host && !parsed.database ? 'DATABASE_URL_HOST_AND_DATABASE_ABSENT'
      : !parsed.host ? 'DATABASE_URL_HOST_ABSENT' : 'DATABASE_URL_DATABASE_ABSENT';
    throw new DatabaseTargetDiagnostic(code);
  }
  return { connectionString: value, database: parsed.database };
}
