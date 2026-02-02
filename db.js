/**
 * PostgreSQL connection pool for Railway (or local) deployment.
 * Required env: DATABASE_URL
 * In production (NODE_ENV=production), SSL is enabled with rejectUnauthorized: false for Railway.
 */
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const isProduction = process.env.NODE_ENV === 'production';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(isProduction && {
    ssl: { rejectUnauthorized: false },
  }),
});

module.exports = pool;

