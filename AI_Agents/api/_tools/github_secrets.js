/**
 * github_secrets.js — set per-repo GitHub Actions secrets securely, per run.
 *
 * WHY THIS EXISTS (the security gap it closes):
 *   workflow_dispatch INPUTS are NOT secret — they render in plain text in the Actions
 *   run UI and logs. So the app login username/password (which arrive fresh from each
 *   Autopilot form submission, for a DIFFERENT user's repo each time) must NEVER travel
 *   as dispatch inputs. Instead we push them as encrypted REPOSITORY SECRETS just before
 *   triggering the run; the workflow job then reads secrets.AGENT_USERNAME /
 *   secrets.AGENT_PASSWORD. GitHub stores secrets encrypted at rest and masks them in logs.
 *
 * FLOW (per GitHub's official docs):
 *   1. GET  /repos/{owner}/{repo}/actions/secrets/public-key   → { key_id, key }
 *   2. Encrypt the value with libsodium sealed box using that public key.
 *   3. PUT  /repos/{owner}/{repo}/actions/secrets/{name}       → { encrypted_value, key_id }
 *
 * MULTI-TENANT: the caller passes the connected user's OWN git connection
 *   ({ token, owner, repo }) — the same token used to dispatch the workflow and open the
 *   PR — so the secret is set on THEIR repo with THEIR permissions. The token and the raw
 *   credential values are used per-call only and are NEVER persisted or logged here.
 */
const axios = require('axios');
const sodium = require('libsodium-wrappers');

const API = 'https://api.github.com';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'blast-automation-orchestrator',
  };
}

/** Encrypt a plaintext value for a repo using its Actions public key (libsodium sealed box). */
async function encryptForRepo(publicKeyBase64, value) {
  await sodium.ready;
  const binKey = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const binValue = sodium.from_string(value);
  const sealed = sodium.crypto_box_seal(binValue, binKey);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

/**
 * Create or update a single repository Actions secret.
 * @param {{ token: string, owner: string, repo: string }} git  connected user's git connection
 * @param {string} name   secret name (e.g. 'AGENT_USERNAME')
 * @param {string} value  raw secret value (encrypted before it leaves this process)
 * @returns {Promise<{ name: string, status: number }>}  201 = created, 204 = updated
 */
async function setRepoSecret(git, name, value) {
  const token = git && git.token;
  const owner = git && git.owner;
  const repo = git && git.repo;
  if (!token || !owner || !repo) throw new Error('setRepoSecret: git connection must include token, owner and repo.');
  if (!name) throw new Error('setRepoSecret: a secret name is required.');
  if (value === undefined || value === null || value === '') throw new Error(`setRepoSecret: a non-empty value is required for ${name}.`);

  // 1) Fetch the repo's public key.
  let keyId;
  let publicKey;
  try {
    const { data } = await axios.get(`${API}/repos/${owner}/${repo}/actions/secrets/public-key`, { headers: headers(token) });
    keyId = data.key_id;
    publicKey = data.key;
  } catch (err) {
    const status = err.response && err.response.status;
    const msg = (err.response && err.response.data && err.response.data.message) || err.message;
    throw new Error(`Could not read the repo public key${status ? ` (${status})` : ''}: ${msg}`);
  }

  // 2) Encrypt locally. 3) PUT the encrypted value — the raw value never leaves this process.
  const encryptedValue = await encryptForRepo(publicKey, value);
  try {
    const res = await axios.put(
      `${API}/repos/${owner}/${repo}/actions/secrets/${encodeURIComponent(name)}`,
      { encrypted_value: encryptedValue, key_id: keyId },
      { headers: headers(token) },
    );
    return { name, status: res.status };
  } catch (err) {
    const status = err.response && err.response.status;
    const msg = (err.response && err.response.data && err.response.data.message) || err.message;
    throw new Error(`Could not set secret ${name}${status ? ` (${status})` : ''}: ${msg}`);
  }
}

/**
 * Convenience: push the fresh app login credentials as the two secrets the runner job reads.
 * Uses APP_USERNAME/APP_PASSWORD — the exact names the engine (local_agent.js) and blast-runner.yml
 * already read. Overwrites any previous run's values (one feature run at a time per repo is fine).
 * @param {{ token, owner, repo }} git
 * @param {{ username: string, password: string }} creds
 */
async function setAppCredentialSecrets(git, creds) {
  const username = creds && creds.username;
  const password = creds && creds.password;
  if (!username || !password) throw new Error('setAppCredentialSecrets: both username and password are required.');
  await setRepoSecret(git, 'APP_USERNAME', String(username));
  await setRepoSecret(git, 'APP_PASSWORD', String(password));
  return { set: ['APP_USERNAME', 'APP_PASSWORD'] };
}

module.exports = { setRepoSecret, setAppCredentialSecrets };
