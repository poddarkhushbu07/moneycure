/**
 * Backend API for deployment on Railway.
 * Required env: DATABASE_URL, JWT_SECRET, FRONTEND_URL, NODE_ENV (optional; set to "production" on Railway).
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRouter = require('./routes/auth');
const { authenticate, requireAdmin, requireStaffOrAdmin, requireCustomerSelf } = require('./auth/middleware');

const app = express();

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);

    try {
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app')) return callback(null, true);
    } catch (e) {}

    // Instead of throwing error, deny by returning false (avoids breaking preflight)
    return callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

// Log each request so Railway logs show traffic (method + path only)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.get('/__ping', (req, res) => {
  res.status(200).send('PING_OK');
});

// Health check (before any auth middleware — for Railway/load balancers)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Database check (unauthenticated)
app.get('/db-check', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1');
    res.json({ ok: true, result: result.rows[0] });
  } catch (error) {
    console.error('Database check failed:', error);
    res.status(500).json({ ok: false, error: 'Database check failed' });
  }
});

// One-time seed (e.g. when Render Shell not available). Requires SEED_SECRET in env.
const { runSeed } = require('./scripts/runSeed');
app.post('/seed', async (req, res) => {
  const secret = process.env.SEED_SECRET;
  const provided = req.headers['x-seed-secret'] || req.query.secret;
  if (!secret || provided !== secret) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const { seeded, localUsers } = await runSeed(pool);
    res.json({ ok: true, seeded, localUsers, message: 'Password for all: 123456' });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Seed failed' });
  }
});

// Local auth: POST /auth/login, POST /auth/logout
app.use('/auth', authRouter);

// Create a new customer — admin only
app.post('/customers', authenticate, requireAdmin, async (req, res) => {
  const { name, phone, city, status, next_followup_date } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customers (name, phone, city, status, next_followup_date)
       VALUES ($1, $2, $3, COALESCE($4, 'new'), $5)
       RETURNING id, name, phone, city, status, next_followup_date, created_at`,
      [name, phone, city || null, status || null, next_followup_date || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// Update a customer (only provided fields: status, next_followup_date) — admin, staff
app.patch('/customers/:id', authenticate, requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, next_followup_date } = req.body;

  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    values.push(status);
    paramIndex += 1;
  }
  if (next_followup_date !== undefined) {
    updates.push(`next_followup_date = $${paramIndex}`);
    values.push(next_followup_date);
    paramIndex += 1;
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    values.push(id);
    const setClause = updates.join(', ');
    const result = await pool.query(
      `UPDATE customers SET ${setClause} WHERE id = $${paramIndex}
       RETURNING id, name, phone, city, status, next_followup_date, created_at`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// Get all customers — admin, staff
app.get('/customers', authenticate, requireStaffOrAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, phone, city, status, next_followup_date, created_at
       FROM customers
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// Format date for system comments: "15 Jun 2026"
function formatCommentDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00.000Z' : ''));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Update customer follow-up date — admin, staff only; full path so route is matched before router
app.put('/customers/:id/followup', authenticate, requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;
  const { next_followup_date } = req.body;

  if (next_followup_date !== null && next_followup_date !== undefined) {
    const dateStr = String(next_followup_date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'next_followup_date must be YYYY-MM-DD or null' });
    }
    const d = new Date(dateStr + 'T00:00:00.000Z');
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: 'next_followup_date is not a valid date' });
    }
  }

  const value = next_followup_date === null || next_followup_date === undefined
    ? null
    : String(next_followup_date).trim();

  try {
    const prev = await pool.query(
      'SELECT next_followup_date FROM customers WHERE id = $1',
      [id]
    );
    if (prev.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const previousDate = prev.rows[0].next_followup_date
      ? String(prev.rows[0].next_followup_date).slice(0, 10)
      : null;
    const newDate = value;

    const result = await pool.query(
      `UPDATE customers SET next_followup_date = $1 WHERE id = $2
       RETURNING id, name, phone, city, status, next_followup_date, created_at`,
      [value, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    if (previousDate !== newDate) {
      let commentText;
      if (newDate === null || newDate === '') {
        commentText = 'Follow-up cleared.';
      } else if (previousDate === null || previousDate === '') {
        commentText = `Follow-up scheduled for ${formatCommentDate(newDate)}.`;
      } else {
        commentText = `Follow-up date changed from ${formatCommentDate(previousDate)} to ${formatCommentDate(newDate)}.`;
      }
      await pool.query(
        'INSERT INTO customer_comments (customer_id, comment) VALUES ($1, $2)',
        [id, commentText]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating follow-up date:', error);
    res.status(500).json({ error: 'Failed to update follow-up date' });
  }
});

// Mark follow-up as done — admin, staff only; full path so route is matched before router
app.post('/customers/:id/followup/done', authenticate, requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE customers SET next_followup_date = NULL WHERE id = $1
       RETURNING id, name, phone, city, status, next_followup_date, created_at`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    await pool.query(
      'INSERT INTO customer_comments (customer_id, comment) VALUES ($1, $2)',
      [id, 'Follow-up marked as done.']
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error marking follow-up done:', error);
    res.status(500).json({ error: 'Failed to mark follow-up done' });
  }
});

// Customer sub-routes: literal paths first so /followups/upcoming is not matched as /:id/...
const customersRouter = express.Router({ mergeParams: false });

// Get customers with follow-ups scheduled for today — admin, staff
customersRouter.get('/followups/today', authenticate, requireStaffOrAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, phone, city, status, next_followup_date, created_at
       FROM customers
       WHERE next_followup_date = CURRENT_DATE
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching today follow-ups:', error);
    res.status(500).json({ error: 'Failed to fetch today follow-ups' });
  }
});

// Get upcoming follow-ups (next 30 days) — admin, staff
customersRouter.get('/followups/upcoming', authenticate, requireStaffOrAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id AS customer_id, name AS customer_name, phone, status, next_followup_date
       FROM customers
       WHERE next_followup_date IS NOT NULL
         AND next_followup_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
       ORDER BY next_followup_date ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching upcoming follow-ups:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming follow-ups' });
  }
});

// Get comments for a customer — admin, staff, or customer self
customersRouter.get('/:id/comments', authenticate, requireCustomerSelf, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, customer_id, comment, created_at
       FROM customer_comments
       WHERE customer_id = $1
       ORDER BY created_at ASC`,
      [id],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching customer comments:', error);
    res.status(500).json({ error: 'Failed to fetch customer comments' });
  }
});

// Add a comment to a customer — admin, staff, or customer self
customersRouter.post('/:id/comments', authenticate, requireCustomerSelf, async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ error: 'comment is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customer_comments (customer_id, comment)
       VALUES ($1, $2)
       RETURNING id, customer_id, comment, created_at`,
      [id, comment],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding customer comment:', error);
    res.status(500).json({ error: 'Failed to add customer comment' });
  }
});

// Log a message for a customer (e.g., WhatsApp) — admin, staff, or customer self
customersRouter.post('/:id/message-logs', authenticate, requireCustomerSelf, async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO message_logs (customer_id, channel, message)
       VALUES ($1, 'whatsapp', $2)
       RETURNING id, customer_id, channel, message, created_at`,
      [id, message],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error logging customer message:', error);
    res.status(500).json({ error: 'Failed to log customer message' });
  }
});

// Add a product for a customer — admin, staff, or customer self
customersRouter.post('/:id/products', authenticate, requireCustomerSelf, async (req, res) => {
  const { id } = req.params;
  const { product_type, product_name, status } = req.body;

  if (!product_type || !product_name || !status) {
    return res
      .status(400)
      .json({ error: 'product_type, product_name and status are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customer_products (customer_id, product_type, product_name, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, customer_id, product_type, product_name, status, created_at`,
      [id, product_type, product_name, status],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding customer product:', error);
    res.status(500).json({ error: 'Failed to add customer product' });
  }
});

// Get products for a customer — admin, staff, or customer self
customersRouter.get('/:id/products', authenticate, requireCustomerSelf, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, customer_id, product_type, product_name, status, created_at
       FROM customer_products
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [id],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching customer products:', error);
    res.status(500).json({ error: 'Failed to fetch customer products' });
  }
});

app.use('/customers', customersRouter);

// 404: return JSON for unknown routes.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler: do not crash on unhandled errors; return clean JSON; no stack in production.
app.use((err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  console.error('Unhandled error:', isProduction ? err.message : err);
  res.status(500).json({
    error: isProduction ? 'Internal server error' : (err.message || 'Internal server error'),
    ...(isProduction ? {} : { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0'; // Required for Railway: accept connections from proxy, not only localhost

const server = app.listen(PORT, HOST, () => {
  console.log(`Server is running on ${HOST}:${PORT}`);
});

// Prevent unhandled rejections from crashing the process.
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  server.close(() => process.exit(1));
});
