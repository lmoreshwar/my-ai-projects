// Regression tests for job ownership (P0-2 IDOR fix on /jobs/:jobId/*).
//
// Every authenticated job route funnels through `findJob(jobId, req.user.id)` and returns
// 404 { msg: 'Job not found' } when that lookup yields null. These tests lock in the ownership
// rule those helpers enforce for BOTH stores (Mongo query scoping + dev/in-memory list filtering),
// plus the shared-token runner bypass, and that job routes stay behind the auth middleware.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ownsJob, ownedJobQuery, findOwnedInList } = require('./job_ownership');
const authMiddleware = require('../middleware/auth');

const USER_A = 'user-a-id';
const USER_B = 'user-b-id';

// A dev/in-memory store with jobs owned by two different users (what loadDevJobs() returns).
// AUTO-123 belongs to User A; ids are sequential so User B can trivially guess it.
const devStore = () => ([
  { jobId: 'AUTO-123', userId: USER_A, status: 'WaitingForApproval' },
  { jobId: 'AUTO-124', userId: USER_B, status: 'Passed' },
]);

// ---------- core ownership rule ----------

test('ownsJob: the owner matches, a different user does not', () => {
  assert.equal(ownsJob({ userId: USER_A }, USER_A), true);
  assert.equal(ownsJob({ userId: USER_A }, USER_B), false);
});

test('ownsJob: a missing job never matches', () => {
  assert.equal(ownsJob(null, USER_A), false);
  assert.equal(ownsJob(undefined, USER_A), false);
});

test('ownsJob: undefined/null userId is the runner bypass (no scoping)', () => {
  assert.equal(ownsJob({ userId: USER_A }, undefined), true);
  assert.equal(ownsJob({ userId: USER_A }, null), true);
});

test('ownedJobQuery: a user lookup is scoped by userId (Mongo enforces ownership)', () => {
  assert.deepEqual(ownedJobQuery('AUTO-123', USER_A), { jobId: 'AUTO-123', userId: USER_A });
});

test('ownedJobQuery: a runner lookup (no userId) is NOT scoped', () => {
  assert.deepEqual(ownedJobQuery('AUTO-123', undefined), { jobId: 'AUTO-123' });
  assert.deepEqual(ownedJobQuery('AUTO-123', null), { jobId: 'AUTO-123' });
});

// ---------- 1 & 2: owner can access their own job ----------

test('1-2: User A can look up their own job', () => {
  const job = findOwnedInList(devStore(), 'AUTO-123', USER_A);
  assert.ok(job);
  assert.equal(job.jobId, 'AUTO-123');
});

// ---------- 3-10: User B cannot reach User A's job through any operation ----------
// Every one of these routes does `findJob(jobId, req.user.id)` → this null → 404.

test('3: User B cannot GET User A\'s job → lookup is null (→ 404)', () => {
  assert.equal(findOwnedInList(devStore(), 'AUTO-123', USER_B), null);
});

test('4: User B cannot answer User A\'s job → null (→ 404)', () => {
  assert.equal(findOwnedInList(devStore(), 'AUTO-123', USER_B), null);
});

test('5: User B cannot approve User A\'s job → null (→ 404)', () => {
  assert.equal(findOwnedInList(devStore(), 'AUTO-123', USER_B), null);
});

test('6: User B cannot discard User A\'s job → null (→ 404)', () => {
  assert.equal(findOwnedInList(devStore(), 'AUTO-123', USER_B), null);
});

test('7: User B cannot delete User A\'s job → null (→ 404)', () => {
  // DELETE also scopes the Mongo delete + the dev filter by userId.
  assert.equal(findOwnedInList(devStore(), 'AUTO-123', USER_B), null);
  assert.deepEqual(ownedJobQuery('AUTO-123', USER_B), { jobId: 'AUTO-123', userId: USER_B });
  const remaining = devStore().filter((j) => !(j.jobId === 'AUTO-123' && ownsJob(j, USER_B)));
  assert.equal(remaining.length, 2, 'User B\'s delete removes nothing from User A');
});

test('8: User B cannot trigger execution (run-smoke/run-copilot) on User A\'s job → null (→ 404)', () => {
  assert.equal(findOwnedInList(devStore(), 'AUTO-123', USER_B), null);
});

test('9: User B cannot merge User A\'s PR/job → null (→ 404)', () => {
  assert.equal(findOwnedInList(devStore(), 'AUTO-123', USER_B), null);
});

test('10: User B cannot retrieve User A\'s progress/logs/artifacts → null (→ 404)', () => {
  assert.equal(findOwnedInList(devStore(), 'AUTO-123', USER_B), null);
});

// ---------- jobId exists but userId mismatch → 404 (not 403), no existence leak ----------

test('mismatch: a real jobId owned by someone else resolves to null (→ 404, never 403)', () => {
  const store = devStore();
  assert.ok(store.some((j) => j.jobId === 'AUTO-123'), 'the job really exists');
  assert.equal(findOwnedInList(store, 'AUTO-123', USER_B), null);
});

// ---------- sequential-id enumeration is not a capability ----------

test('sequential ids: guessing AUTO-123 does not let User B read User A\'s job', () => {
  for (const guess of ['AUTO-122', 'AUTO-123', 'AUTO-124', 'AUTO-125']) {
    const job = findOwnedInList(devStore(), guess, USER_B);
    if (job) assert.equal(job.userId, USER_B, `guess ${guess} may only return User B's own job`);
  }
});

test('non-existent jobId resolves to null', () => {
  assert.equal(findOwnedInList(devStore(), 'AUTO-999', USER_A), null);
});

// ---------- 11: owner keeps full access ----------

test('11: User A retains access to their own job across operations', () => {
  const job = findOwnedInList(devStore(), 'AUTO-123', USER_A);
  assert.ok(job);
  assert.equal(job.status, 'WaitingForApproval');
});

// ---------- runner bypass unchanged ----------

test('runner: a lookup with no userId still finds any job (runnerAuth path unchanged)', () => {
  assert.ok(findOwnedInList(devStore(), 'AUTO-123', undefined));
  assert.ok(findOwnedInList(devStore(), 'AUTO-124', undefined));
});

// ---------- 12: unauthenticated request still blocked by the auth middleware ----------

test('12: an unauthenticated request to a job route is denied (existing auth response)', () => {
  const savedDev = process.env.DEV_MODE;
  const savedNodeEnv = process.env.NODE_ENV;
  delete process.env.DEV_MODE; // ensure the dev bypass is off so real auth applies
  process.env.NODE_ENV = 'development';
  try {
    const req = { header: () => undefined, headers: {}, query: {} };
    let statusCode = null;
    const res = { status(c) { statusCode = c; return this; }, json() { return this; } };
    let nexted = false;
    authMiddleware(req, res, () => { nexted = true; });
    assert.equal(nexted, false);
    assert.equal(statusCode, 401);
  } finally {
    if (savedDev === undefined) delete process.env.DEV_MODE; else process.env.DEV_MODE = savedDev;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
  }
});
