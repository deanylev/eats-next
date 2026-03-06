import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../lib/schema';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle');

const getMigrationStatements = (schemaName: string): string[] => {
  return readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()
    .flatMap((fileName) => {
      const filePath = path.join(MIGRATIONS_DIR, fileName);
      const sql = readFileSync(filePath, 'utf8')
        .replaceAll('"public".', `"${schemaName}".`)
        .replaceAll(`REFERENCES "public".`, `REFERENCES "${schemaName}".`);

      return sql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
    });
};

export const hasTestDatabase = Boolean(process.env.DATABASE_URL);

export const createTestDb = async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for DB-backed tests.');
  }

  const schemaName = `test_${randomUUID().replace(/-/g, '')}`;
  const adminPool = new Pool({ connectionString });
  await adminPool.query(`create schema "${schemaName}"`);

  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schemaName}`
  });

  try {
    await pool.query('create extension if not exists pgcrypto');
    for (const statement of getMigrationStatements(schemaName)) {
      await pool.query(statement);
    }
  } catch (error) {
    await pool.end();
    await adminPool.query(`drop schema if exists "${schemaName}" cascade`);
    await adminPool.end();
    throw error;
  }

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    cleanup: async () => {
      await pool.end();
      await adminPool.query(`drop schema if exists "${schemaName}" cascade`);
      await adminPool.end();
    }
  };
};
