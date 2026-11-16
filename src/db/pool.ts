import pg from 'pg';

const { Pool, types } = pg;

let parsersInstalled = false;

export function installPgParsers(): void {
  if (parsersInstalled) return;
  types.setTypeParser(20, (value) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`Integer out of safe range: ${value}`);
    }
    return parsed;
  });
  parsersInstalled = true;
}

export function createPool(connectionString: string): pg.Pool {
  installPgParsers();
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (error) => {
    console.error('Postgres pool error', error);
  });
  return pool;
}

export async function migrate(pool: pg.Pool, sql: string): Promise<void> {
  await pool.query(sql);
}
