'use strict';

const { RateLimiter } = require('./rate_limiter');

// Per-process, in-memory limiters for the authentication endpoints. See rate_limiter.js for the
// per-process / non-distributed caveat and the distributed-store roadmap note.
const MINUTE = 60 * 1000;

// LOGIN brute-force guard: at most 5 FAILED attempts per IP per 15 minutes. Only failed logins
// are recorded; a successful login resets the counter for that IP.
const loginLimiter = new RateLimiter({ windowMs: 15 * MINUTE, max: 5 });

// SIGNUP abuse guard: at most 10 signup attempts per IP per hour. A normal user signs up once, so
// this protects against automated mass account creation without blocking real users.
const signupLimiter = new RateLimiter({ windowMs: 60 * MINUTE, max: 10 });

// Safest request-IP source available in this app.
//
// The Express app does NOT enable `trust proxy`, so `req.ip` is the socket peer address and the
// spoofable, client-supplied `X-Forwarded-For` header is deliberately NOT trusted. We intentionally
// do not parse X-Forwarded-For ourselves — trusting it without a configured proxy would let an
// attacker rotate fake IPs to evade the limit. Falling back to the raw socket address keeps a
// usable key if `req.ip` is ever absent.
function clientIp(req) {
  return (
    (req && req.ip) ||
    (req && req.socket && req.socket.remoteAddress) ||
    (req && req.connection && req.connection.remoteAddress) ||
    'unknown'
  );
}

// Rate limiting is disabled in local DEV_MODE so it never interferes with normal development.
// In production DEV_MODE is not 'true', so the limiters are active.
function rateLimitEnabled() {
  return process.env.DEV_MODE !== 'true';
}

module.exports = { loginLimiter, signupLimiter, clientIp, rateLimitEnabled };
