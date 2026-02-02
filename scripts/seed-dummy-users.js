/**
 * Seed dummy login users (admin, staff, customer) with password 123456.
 * Run from backend: node scripts/seed-dummy-users.js
 * Requires: DATABASE_URL (from .env or env), users + customers tables.
 */

const path = require('path');
const fs = require('fs');
// Load .env from backend root if present
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const bcrypt = require('bcrypt');
const pool = require('../db');

const DUMMY_PASSWORD = '123456';
const DUMMY_USERS = [
  { email: 'admin@gmail.com', role: 'admin', customer_id: null },
  { email: 'staff@gmail.com', role: 'staff', customer_id: null },
  { email: 'customer@gmail.com', role: 'customer', customer_id: null }, // set after creating customer
];

async function run() {
  const hash = await bcrypt.hash(DUMMY_PASSWORD, 10);

  // Ensure a dummy customer exists for customer@ user
  let customerId = null;
  const custRes = await pool.query(
    `SELECT id FROM customers WHERE name = 'Dummy Customer' AND phone = '0000000000' LIMIT 1`
  );
  if (custRes.rows.length > 0) {
    customerId = custRes.rows[0].id;
  } else {
    const insertCust = await pool.query(
      `INSERT INTO customers (name, phone, city, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      ['Dummy Customer', '0000000000', null, 'new']
    );
    customerId = insertCust.rows[0].id;
  }
  DUMMY_USERS[2].customer_id = customerId;

  for (const u of DUMMY_USERS) {
    await pool.query(
      `INSERT INTO users (email, password_hash, role, customer_id, auth_provider, oauth_provider, oauth_provider_id)
       VALUES ($1, $2, $3, $4, 'local', 'local', $1)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         customer_id = EXCLUDED.customer_id,
         auth_provider = 'local',
         oauth_provider = 'local',
         oauth_provider_id = EXCLUDED.email`,
      [u.email, hash, u.role, u.customer_id]
    );
    console.log(`Seeded user: ${u.email} (${u.role})`);
  }

  console.log('Done. Use password: 123456 for all three.');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
