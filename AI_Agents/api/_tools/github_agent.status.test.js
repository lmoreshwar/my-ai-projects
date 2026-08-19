/**
 * github_agent.status.test.js — regression tests for the generic job-status synchronization layer.
 *
 * These lock in the fix for the bug where a GitHub Explore run that finished GREEN (success) with a
 * valid, automatable plan was still shown as BLOCKED in the BLAST UI. They exercise the two pure,
 * side-effect-free cores of the sync layer:
 *   • mapGithubRunState(status, conclusion)  — GitHub run  → generic lifecycle state
 *   • deriveExploreStatus(runState, plan)     — lifecycle state + plan → BLAST explore-phase status
 *
 * Run: node --test api/_tools/github_agent.status.test.js   (from the AI_Agents package root)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mapGithubRunState, deriveExploreStatus } = require('./github_agent');

const planWithCases = { status: 'passed', cases: [{ id: 'TC_001', title: 'Add to cart' }], scenarios: [] };
const planReadyScenariosOnly = {
  status: 'passed',
  cases: [],
  scenarios: [{ id: 'S1', title: 'Add to cart', ready: true, blocked: false }],
};
const planNothingAutomatable = {
  status: 'passed',
  cases: [],
  scenarios: [{ id: 'S1', title: 'Locked', ready: false, blocked: true, blockedReason: 'no data-test' }],
};
const planExplorationFailed = { status: 'failed', cases: [], scenarios: [], summary: 'Login blocked exploration.' };

/* ── mapGithubRunState: generic GitHub Actions state mapping ── */

test('mapGithubRunState — queued and in_progress map to running', () => {
  assert.equal(mapGithubRunState('queued', null), 'running');
  assert.equal(mapGithubRunState('in_progress', null), 'running');
  assert.equal(mapGithubRunState('waiting', null), 'running');
});

test('mapGithubRunState — completed + conclusion maps generically', () => {
  assert.equal(mapGithubRunState('completed', 'success'), 'success');
  assert.equal(mapGithubRunState('completed', 'failure'), 'failed');
  assert.equal(mapGithubRunState('completed', 'timed_out'), 'failed');
  assert.equal(mapGithubRunState('completed', 'startup_failure'), 'failed');
  assert.equal(mapGithubRunState('completed', 'cancelled'), 'cancelled');
  assert.equal(mapGithubRunState('completed', 'skipped'), 'skipped');
});

/* ── deriveExploreStatus: the A–F regression matrix ── */

// A. GitHub success (with an automatable plan) → BLAST WaitingForApproval (never Blocked), plan exposed.
test('A. GitHub success → BLAST ready to approve (not Blocked)', () => {
  const d = deriveExploreStatus('success', planWithCases);
  assert.equal(d.status, 'WaitingForApproval');
  assert.equal(d.ready, true);
});

// B. GitHub failure → BLAST Failed, no success shown.
test('B. GitHub failure → BLAST Failed', () => {
  const d = deriveExploreStatus('failed', null);
  assert.equal(d.status, 'Failed');
  assert.equal(d.ready, false);
});

// C. GitHub cancelled → BLAST Cancelled.
test('C. GitHub cancelled → BLAST Cancelled', () => {
  const d = deriveExploreStatus('cancelled', null);
  assert.equal(d.status, 'Cancelled');
  assert.equal(d.ready, false);
});

// D. GitHub in_progress (running) → BLAST Exploring (keep polling).
test('D. in_progress → BLAST Exploring', () => {
  const d = deriveExploreStatus('running', null);
  assert.equal(d.status, 'Exploring');
  assert.equal(d.ready, false);
});

// E. Stale blocked corrected after success: a green run with a valid plan is WaitingForApproval,
//    even when only ready SCENARIOS exist and the legacy cases[] array is empty (the exact bug).
test('E. stale blocked corrected — success + ready scenarios only → WaitingForApproval', () => {
  const d = deriveExploreStatus('success', planReadyScenariosOnly);
  assert.equal(d.status, 'WaitingForApproval');
  assert.equal(d.ready, true);
});

// F. Plan artifact exists after a successful Explore → the plan is exposed & ready to approve.
test('F. success + plan present → ready to approve (plan exposed)', () => {
  const d = deriveExploreStatus('success', planWithCases);
  assert.equal(d.status, 'WaitingForApproval');
  assert.equal(d.ready, true);
});

/* ── Guardrails: 'Blocked' stays reserved for REAL BLAST states, never a stale workflow status ── */

test('success + genuinely nothing automatable → Blocked (real BLAST state)', () => {
  const d = deriveExploreStatus('success', planNothingAutomatable);
  assert.equal(d.status, 'Blocked');
  assert.equal(d.ready, false);
  assert.match(d.reason, /automation-ready/i);
});

test('success + exploration could not verify a flow → Blocked with the plan reason', () => {
  const d = deriveExploreStatus('success', planExplorationFailed);
  assert.equal(d.status, 'Blocked');
  assert.equal(d.reason, 'Login blocked exploration.');
});

test('success but plan artifact not indexed yet → keep Exploring (never a premature Blocked)', () => {
  const d = deriveExploreStatus('success', null);
  assert.equal(d.status, 'Exploring');
  assert.equal(d.ready, false);
});

test('skipped run → BLAST Skipped', () => {
  const d = deriveExploreStatus('skipped', null);
  assert.equal(d.status, 'Skipped');
  assert.equal(d.ready, false);
});
