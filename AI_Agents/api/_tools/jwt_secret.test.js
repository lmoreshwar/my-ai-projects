// Regression tests for JWT secret resolution + DEV_MODE bypass policy (P0-1 prod hardening).
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { getJwtSecret, isDevBypassAllowed, DEV_FALLBACK_SECRET } = require('./jwt_secret');
const authMiddleware = require('../middleware/auth');

// Run a test body with a temporary env, always restoring the originals afterwards.
function withEnv(env, fn) {
  const keys = ['NODE_ENV', 'JWT_SECRET', 'DEV_MODE'];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

// ---------- DEVELOPMENT ----------

test('dev: missing JWT_SECRET retains the local fallback behavior', () => {
  withEnv({ NODE_ENV: 'development', JWT_SECRET: undefined }, () => {
    assert.equal(getJwtSecret(), DEV_FALLBACK_SECRET);
  });
});

test('dev: JWT_SECRET unset AND NODE_ENV unset still uses the fallback (unchanged default)', () => {
  withEnv({ NODE_ENV: undefined, JWT_SECRET: undefined }, () => {
    assert.equal(getJwtSecret(), DEV_FALLBACK_SECRET);
  });
});

test('dev: explicit JWT_SECRET takes precedence over the fallback', () => {
  withEnv({ NODE_ENV: 'development', JWT_SECRET: 'local-override' }, () => {
    assert.equal(getJwtSecret(), 'local-override');
  });
});

test('dev: DEV_MODE bypass is allowed locally', () => {
  withEnv({ NODE_ENV: 'development', DEV_MODE: 'true' }, () => {
    assert.equal(isDevBypassAllowed(), true);
  });
});

test('middleware dev: DEV_MODE injects the local dev user and calls next()', () => {
  withEnv({ NODE_ENV: 'development', DEV_MODE: 'true' }, () => {
    const req = { header: () => undefined, headers: {}, query: {} };
    const res = mockRes();
    let nexted = false;
    authMiddleware(req, res, () => { nexted = true; });
    assert.equal(nexted, true);
    assert.deepEqual(req.user, { id: 'dev-user-id', email: 'dev@localhost' });
  });
});

// ---------- PRODUCTION ----------

test('prod: missing JWT_SECRET fails fast (throws, never falls back)', () => {
  withEnv({ NODE_ENV: 'production', JWT_SECRET: undefined }, () => {
    assert.throws(() => getJwtSecret(), /JWT_SECRET must be set in production/);
  });
});

test('prod: the hardcoded development fallback is never returned', () => {
  withEnv({ NODE_ENV: 'production', JWT_SECRET: undefined }, () => {
    let returned;
    try { returned = getJwtSecret(); } catch { returned = undefined; }
    assert.notEqual(returned, DEV_FALLBACK_SECRET);
  });
});

test('prod: DEV_MODE cannot bypass authentication', () => {
  withEnv({ NODE_ENV: 'production', DEV_MODE: 'true' }, () => {
    assert.equal(isDevBypassAllowed(), false);
  });
});

test('middleware prod: DEV_MODE does NOT inject a user and denies the request', () => {
  withEnv({ NODE_ENV: 'production', DEV_MODE: 'true', JWT_SECRET: 'real-prod-secret' }, () => {
    const req = { header: () => undefined, headers: {}, query: {} };
    const res = mockRes();
    let nexted = false;
    authMiddleware(req, res, () => { nexted = true; });
    assert.equal(nexted, false);
    assert.equal(req.user, undefined);
    assert.equal(res.statusCode, 401);
  });
});

test('prod: a configured JWT_SECRET resolves normally', () => {
  withEnv({ NODE_ENV: 'production', JWT_SECRET: 'real-prod-secret' }, () => {
    assert.equal(getJwtSecret(), 'real-prod-secret');
  });
});

test('middleware prod: a valid token signed with the configured secret authenticates', () => {
  withEnv({ NODE_ENV: 'production', DEV_MODE: 'true', JWT_SECRET: 'real-prod-secret' }, () => {
    const token = jwt.sign({ user: { id: 'u1', role: 'user' } }, 'real-prod-secret', { expiresIn: '5h' });
    const req = { header: (h) => (h === 'x-auth-token' ? token : undefined), headers: {}, query: {} };
    const res = mockRes();
    let nexted = false;
    authMiddleware(req, res, () => { nexted = true; });
    assert.equal(nexted, true);
    assert.deepEqual(req.user, { id: 'u1', role: 'user' });
  });
});
