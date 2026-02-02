/**
 * Local auth routes: email + password login, logout (client-side discard).
 * POST /auth/login  → email, password → JWT + role + customer_id
 * POST /auth/logout → 200 OK (client discards token)
 * JWT_SECRET must come from env (see auth/tokens.js). Do not log tokens.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { createAccessToken } = require('../auth/tokens');

const router = express.Router();

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, role, customer_id
       FROM users
       WHERE email = $1 AND auth_provider = 'local'`,
      [email.trim().toLowerCase()]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const accessToken = createAccessToken({
      userId: user.id,
      role: user.role,
      customerId: user.customer_id ?? null,
    });

    res.json({
      accessToken,
      role: user.role,
      customerId: user.customer_id ?? null,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/logout — client discards JWT; no server-side session
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
