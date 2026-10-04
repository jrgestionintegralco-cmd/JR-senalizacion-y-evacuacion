import connectionString from 'pg-connection-string';

// Let the existing PostgreSQL driver interpret DATABASE_URL exactly as the API
// does. The deployment's authorized binding, not a Blueprint example name,
// identifies the database. Never return/log credentials or rewrite the URL.
export function bootstrapDatabaseTarget(value) {
  if (typeof value !== 'string' || !/^postgres(?:ql)?:\/\//i.test(value)) {
    throw new Error('Invalid staging database connection configuration');
  }
  let parsed;
  try { parsed = connectionString.parse(value); }
  catch { throw new Error('Invalid staging database connection configuration'); }
  if (!parsed.database || !parsed.host) {
    throw new Error('Explicit staging database and host required');
  }
  return { connectionString: value, database: parsed.database };
}
