'use strict';

// Ownership helpers for automation jobs (IDOR guard for /jobs/:jobId/*).
//
// A jobId alone is NOT a capability: job ids are sequential (AUTO-<n>) and therefore
// guessable, so every user-facing lookup must also match the owner's userId. These helpers
// centralise that rule so it is applied identically across every handler and both stores
// (MongoDB and the dev/in-memory JSON store).
//
// A userId of undefined/null means "no ownership filter" — used ONLY by the shared-token
// runner routes (runnerAuth), which are not tied to a logged-in user. User routes must always
// pass req.user.id.

function ownsJob(job, userId) {
  if (!job) return false;
  if (userId === undefined || userId === null) return true; // runner path: no user scoping
  return job.userId === userId;
}

// Mongo query for a jobId, scoped to the owner when a userId is supplied.
function ownedJobQuery(jobId, userId) {
  const query = { jobId };
  if (userId !== undefined && userId !== null) query.userId = userId;
  return query;
}

// Pick a job from a dev-store list, enforcing ownership when a userId is supplied.
// Returns null when the job does not exist OR belongs to another user (so callers return the
// same 404 either way and never reveal that another user's job exists).
function findOwnedInList(jobs, jobId, userId) {
  const list = Array.isArray(jobs) ? jobs : [];
  return list.find((j) => j.jobId === jobId && ownsJob(j, userId)) || null;
}

module.exports = { ownsJob, ownedJobQuery, findOwnedInList };
