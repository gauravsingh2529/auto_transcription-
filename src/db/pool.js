import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// BIGSERIAL ids come back as strings by default; our ids stay well below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => logger.error('Idle PostgreSQL client error', err));
