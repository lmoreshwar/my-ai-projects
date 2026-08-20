'use strict';

// Regression tests for the additive auth rate limiting (P1-1).
// Deterministic: time-based behaviour uses an injectable clock (no real sleeping).
// Existing tests are NOT modified; this file only adds coverage.

const test = require('node:test');
const assert = require('node:assert');

const { RateLimiter } = require('./rate_limiter');
const { loginLimiter, signupLimiter, clientIp, rateLimitEnabled } = require('./auth_rate_limit');

// ---------------------------------------------------------------------------
// Generic RateLimiter — deterministic clock
// ---------------------------------------------------------------------------

test('RateLimiter: below threshold is not limited', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 1000, max: 3, now: () => now });
  rl.record('k');
  rl.record('k');
  assert.strictEqual(rl.isLimited('k'), false);
});

test('RateLimiter: reaching max makes the key limited', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 1000, max: 3, now: () => now });
  rl.record('k');
  rl.record('k');
  rl.record('k');
  assert.strictEqual(rl.isLimited('k'), true);
});

test('RateLimiter: events aging out of the window free the key (injected clock)', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 1000, max: 3, now: () => now });
  rl.record('k');
  rl.record('k');
  rl.record('k');
  assert.strictEqual(rl.isLimited('k'), true);
  now = 1001; // whole window has elapsed
  assert.strictEqual(rl.isLimited('k'), false);
});

test('RateLimiter: reset clears the key immediately', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 1000, max: 2, now: () => now });
  rl.record('k');
  rl.record('k');
  assert.strictEqual(rl.isLimited('k'), true);
  rl.reset('k');
  assert.strictEqual(rl.isLimited('k'), false);
});

test('RateLimiter: different keys are isolated', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 1000, max: 2, now: () => now });
  rl.record('a');
  rl.record('a');
  assert.strictEqual(rl.isLimited('a'), true);
  assert.strictEqual(rl.isLimited('b'), false);
});

test('RateLimiter: retryAfterMs is positive when limited and 0 otherwise', () => {
  let now = 0;
  const rl = new RateLimiter({ windowMs: 1000, max: 2, now: () => now });
  assert.strictEqual(rl.retryAfterMs('k'), 0);
  rl.record('k');
  rl.record('k');
  now = 400;
  assert.strictEqual(rl.retryAfterMs('k'), 600); // 1000 - (400 - 0)
});

// ---------------------------------------------------------------------------
// clientIp — safest request-IP source (no X-Forwarded-For trust)
// ---------------------------------------------------------------------------

test('clientIp: uses req.ip', () => {
  assert.strictEqual(clientIp({ ip: '203.0.113.9' }), '203.0.113.9');
});

test('clientIp: falls back to socket address when req.ip is absent', () => {
  assert.strictEqual(clientIp({ socket: { remoteAddress: '198.51.100.7' } }), '198.51.100.7');
});

test('clientIp: does NOT trust the spoofable X-Forwarded-For header', () => {
  const req = { ip: '10.0.0.5', headers: { 'x-forwarded-for': '1.2.3.4' } };
  assert.strictEqual(clientIp(req), '10.0.0.5');
});

test('clientIp: returns "unknown" when nothing is available', () => {
  assert.strictEqual(clientIp({}), 'unknown');
});

// ---------------------------------------------------------------------------
// rateLimitEnabled — DEV_MODE bypass keeps local development unaffected
// ---------------------------------------------------------------------------

test('rateLimitEnabled: disabled in local DEV_MODE', () => {
  const prev = process.env.DEV_MODE;
  try {
    process.env.DEV_MODE = 'true';
    assert.strictEqual(rateLimitEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = prev;
  }
});

test('rateLimitEnabled: enabled when DEV_MODE is not "true"', () => {
  const prev = process.env.DEV_MODE;
  try {
    delete process.env.DEV_MODE;
    assert.strictEqual(rateLimitEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = prev;
  }
});

// ---------------------------------------------------------------------------
// Auth limiters wired into the routes — mirror the exact route decision sequence.
// Unique IPs per test avoid cross-test contamination of the module singletons.
// ---------------------------------------------------------------------------

test('login limiter: a fresh IP is allowed (normal login proceeds)', () => {
  assert.strictEqual(loginLimiter.isLimited('login-fresh-1'), false);
});

test('login limiter: only failed attempts accumulate toward the limit', () => {
  const ip = 'login-accum-1';
  loginLimiter.record(ip); // simulate one failed login
  loginLimiter.record(ip);
  assert.strictEqual(loginLimiter.isLimited(ip), false); // still below 5
});

test('login limiter: 4 failures stay below the threshold', () => {
  const ip = 'login-below-1';
  for (let i = 0; i < 4; i++) loginLimiter.record(ip);
  assert.strictEqual(loginLimiter.isLimited(ip), false);
});

test('login limiter: the 5th failure trips the limit (route returns 429)', () => {
  const ip = 'login-threshold-1';
  for (let i = 0; i < 5; i++) loginLimiter.record(ip);
  assert.strictEqual(loginLimiter.isLimited(ip), true);
});

test('login limiter: a successful login resets the failure counter', () => {
  const ip = 'login-reset-1';
  for (let i = 0; i < 5; i++) loginLimiter.record(ip);
  assert.strictEqual(loginLimiter.isLimited(ip), true);
  loginLimiter.reset(ip); // simulate successful auth
  assert.strictEqual(loginLimiter.isLimited(ip), false);
});

test('login limiter: different IPs are isolated', () => {
  const a = 'login-iso-a';
  const b = 'login-iso-b';
  for (let i = 0; i < 5; i++) loginLimiter.record(a);
  assert.strictEqual(loginLimiter.isLimited(a), true);
  assert.strictEqual(loginLimiter.isLimited(b), false);
});

test('signup limiter: a fresh IP is allowed (normal signup proceeds)', () => {
  assert.strictEqual(signupLimiter.isLimited('signup-fresh-1'), false);
});

test('signup limiter: repeated signup attempts are eventually blocked', () => {
  const ip = 'signup-abuse-1';
  for (let i = 0; i < 10; i++) signupLimiter.record(ip);
  assert.strictEqual(signupLimiter.isLimited(ip), true);
});

test('signup limiter: below its threshold a normal user is not blocked', () => {
  const ip = 'signup-normal-1';
  signupLimiter.record(ip); // a single normal signup
  assert.strictEqual(signupLimiter.isLimited(ip), false);
});
