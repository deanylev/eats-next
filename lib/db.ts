import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const globalForDb = globalThis as typeof globalThis & {
  pool?: Pool;
};

const getPool = (): Pool => {
  if (globalForDb.pool) {
    return globalForDb.pool;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL environment variable.');
  }

  const pool = new Pool({
    connectionString: databaseUrl
  });

  globalForDb.pool = pool;
  return pool;
};

export const getDb = () => drizzle(getPool(), { schema });

export const closeDb = async (): Promise<void> => {
  if (!globalForDb.pool) {
    return;
  }

  await globalForDb.pool.end();
  globalForDb.pool = undefined;
};
