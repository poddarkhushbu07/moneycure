/**
 * JWT authentication middleware and role-based authorization guards.
 * Expects Authorization: Bearer <token>. Attaches decoded payload to req.user.
 */

const { verifyAccessToken } = require('./tokens');

/**
 * Authenticate request: verify JWT and set req.user { userId, role, customerId }.
 * Returns 401 if token is missing, invalid, or expired.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      userId: payload.userId,
      role: payload.role,
      customerId: payload.customerId ?? null,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Require admin role. Use after authenticate.
 * Returns 403 if req.user.role !== 'admin'.
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Require staff or admin. Use after authenticate.
 * Returns 403 if role is not staff or admin.
 */
function requireStaffOrAdmin(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'staff') {
    return res.status(403).json({ error: 'Staff or admin access required' });
  }
  next();
}

/**
 * Require access to the customer identified by req.params.id.
 * Allows: admin, staff, or customer if req.user.customerId === req.params.id.
 * Use after authenticate. Expects route param :id (customer id).
 */
function requireCustomerSelf(req, res, next) {
  const customerId = req.params.id;
  if (req.user.role === 'admin' || req.user.role === 'staff') {
    return next();
  }
  if (req.user.role === 'customer' && req.user.customerId === customerId) {
    return next();
  }
  return res.status(403).json({ error: 'Access denied to this customer' });
}

module.exports = {
  authenticate,
  requireAdmin,
  requireStaffOrAdmin,
  requireCustomerSelf,
};
