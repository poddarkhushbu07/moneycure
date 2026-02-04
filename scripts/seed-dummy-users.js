/**
 * Seed dummy login users (admin, staff, customer) with password 123456.
 *
 * Run from backend: node scripts/seed-dummy-users.js
 * Requires: DATABASE_URL (from .env or env), users + customers tables.
 *
 * Production (Render, no Shell): Set SEED_SECRET in the backend service env, then call:
 *   curl -X POST -H "X-Seed-Secret: YOUR_SEED_SECRET" https://your-backend.onrender.com/seed
 * Password for all: 123456
 */

const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const pool = require('../db');
const { runSeed, DUMMY_PASSWORD } = require('./runSeed');

async function main() {
  const { seeded, localUsers } = await runSeed(pool);
  seeded.forEach((s) => console.log('Seeded user:', s.email, s.role));
  console.log('Done. Use password:', DUMMY_PASSWORD, 'for all three.');
  console.log('Local users in this DB:', localUsers.length);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
