import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { pool } from './pool.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Creates the target database if it does not exist yet, so a fresh checkout
 * runs with nothing more than a reachable PostgreSQL server.
 * Failing here is non-fatal: the user may lack CREATEDB but the DB may exist.
 */
export async function ensureDatabase() {
  const url = new URL(config.databaseUrl);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName) return;

  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  try {
    await admin.connect();
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount === 0) {
      // Identifiers cannot be parameterised; quote and escape explicitly.
      await admin.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
      logger.info('Created database', { dbName });
    }
  } catch (err) {
    logger.warn('Could not verify/create database (continuing)', { err });
  } finally {
    await admin.end().catch(() => {});
  }
}

/** Applies every *.sql file in migrations/ exactly once, in filename order. */
export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info('Applied migration', { file });
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
    }
  } finally {
    client.release();
  }
}

// Allow `npm run migrate` as a standalone command.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await ensureDatabase();
    await runMigrations();
    logger.info('Migrations complete');
  } catch (err) {
    logger.error('Migration failed', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
