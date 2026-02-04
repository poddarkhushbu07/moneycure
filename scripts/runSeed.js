/**
 * Shared seed logic: run with a pg pool. Used by scripts/seed-dummy-users.js and POST /seed.
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ seeded: { email: string, role: string }[], localUsers: { email: string, role: string }[] }>}
 */
const bcrypt = require('bcrypt');

const DUMMY_PASSWORD = '123456';
const DUMMY_USERS = [
  { email: 'admin@gmail.com', role: 'admin', customer_id: null },
  { email: 'staff@gmail.com', role: 'staff', customer_id: null },
  { email: 'customer@gmail.com', role: 'customer', customer_id: null },
];

async function runSeed(pool) {
  const hash = await bcrypt.hash(DUMMY_PASSWORD, 10);

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

  const hasOauthCols = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'oauth_provider' LIMIT 1`
  ).then((r) => r.rows.length > 0);

  const cols = hasOauthCols
    ? '(email, password_hash, role, customer_id, auth_provider, oauth_provider, oauth_provider_id)'
    : '(email, password_hash, role, customer_id, auth_provider)';
  const vals = hasOauthCols ? '($1, $2, $3, $4, \'local\', \'local\', $1)' : '($1, $2, $3, $4, \'local\')';
  const conflictSet = hasOauthCols
    ? `password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, customer_id = EXCLUDED.customer_id, auth_provider = 'local', oauth_provider = 'local', oauth_provider_id = EXCLUDED.email`
    : `password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, customer_id = EXCLUDED.customer_id, auth_provider = 'local'`;

  const seeded = [];
  for (const u of DUMMY_USERS) {
    const email = u.email.toLowerCase();
    await pool.query(
      `INSERT INTO users ${cols} VALUES ${vals} ON CONFLICT (email) DO UPDATE SET ${conflictSet}`,
      [email, hash, u.role, u.customer_id]
    );
    seeded.push({ email, role: u.role });
  }

  const list = await pool.query(
    `SELECT email, role FROM users WHERE auth_provider = 'local' ORDER BY email`
  );
  const localUsers = list.rows.map((r) => ({ email: r.email, role: r.role }));

  return { seeded, localUsers };
}

module.exports = { runSeed, DUMMY_PASSWORD };
