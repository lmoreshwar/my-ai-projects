/**
 * git_connection.js — resolve the caller's GitHub connection into the repo target the
 * cloud runner dispatches to. Multi-tenant: each user connects their OWN token + repo
 * (their copy of the framework, holding blast-runner.yml + their Actions secrets), so
 * their generated tests + PR land in THEIR repo — not the server owner's.
 *
 * Returns { token, owner, repo, branch }. Any field the user hasn't set falls back to the
 * server env (GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO/GITHUB_DEFAULT_BRANCH), so a request
 * with no GitHub connection behaves exactly as the single-tenant default did before.
 *
 * SECURITY: the token is returned for per-call use only. Callers MUST NOT persist it on the
 * job document or log it — store only { owner, repo, branch } on job.git for URLs/dispatch.
 */
const fs = require('fs');
const path = require('path');
const User = require('../models/User');

const DEV_CONNECTIONS_FILE = path.join(__dirname, '..', '..', 'dev-connections.json');

function loadDevGithub() {
  try {
    if (fs.existsSync(DEV_CONNECTIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEV_CONNECTIONS_FILE, 'utf8'));
      return (data && data.github) || {};
    }
  } catch (err) {
    console.error('Error loading dev github connection:', err.message);
  }
  return {};
}

async function resolveGitConnection(userId) {
  let conn = {};
  try {
    if (process.env.DEV_MODE === 'true') {
      conn = loadDevGithub();
    } else if (userId) {
      const user = await User.findById(userId).select('connections');
      conn = (user && user.connections && user.connections.github) || {};
    }
  } catch (err) {
    console.error('Error resolving github connection:', err.message);
  }
  // The UI stores the target as "owner/repo" (selectedRepo) + selectedBranch. Split it into
  // owner/repo for the API; fall back to the server env for any field the user hasn't set.
  const [selOwner, selRepo] = String(conn.selectedRepo || '').split('/');
  return {
    token: conn.token || process.env.GITHUB_TOKEN || '',
    owner: selOwner || process.env.GITHUB_OWNER || '',
    repo: selRepo || process.env.GITHUB_REPO || '',
    branch: conn.selectedBranch || process.env.GITHUB_DEFAULT_BRANCH || 'main',
  };
}

module.exports = { resolveGitConnection };
