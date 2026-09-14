import pg from 'pg';

const { Pool } = pg;

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'jr-platform-api'
  });

  pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error', error));
  return pool;
}

export type Database = ReturnType<typeof createDatabase>;
