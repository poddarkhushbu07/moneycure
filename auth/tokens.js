/**
 * JWT access token for local auth.
 * Expiry: 7 days. Payload: userId, role, customerId.
 * Sent via Authorization: Bearer <token>
 * Required env: JWT_SECRET. Tokens must not be logged.
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_EXPIRY = '7d';

function ensureJwtSecret() {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
}

/**
 * Create a JWT access token.
 * @param {{ userId: string, role: string, customerId: string|null }} payload
 * @returns {string} JWT
 */
function createAccessToken(payload) {
  ensureJwtSecret();
  return jwt.sign(
    {
      userId: payload.userId,
      role: payload.role,
      customerId: payload.customerId ?? null,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Verify and decode access token. Returns payload or throws.
 * @param {string} token
 * @returns {{ userId: string, role: string, customerId: string|null }}
 */
function verifyAccessToken(token) {
  ensureJwtSecret();
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  createAccessToken,
  verifyAccessToken,
};
