#!/usr/bin/env node
/**
 * B.L.A.S.T. remote worker.
 *
 * A tiny HTTP service that runs the SAME local_agent engine your laptop uses,
 * but on a persistent cloud host (e.g. an Oracle Always-Free VM) that has
 * Chromium + the framework + the global `@playwright/cli` bin installed once.
 *
 * Your B.L.A.S.T. API (on Render) calls this worker to run the crawler +
 * @playwright/cli evidence + LLM authoring remotely — no laptop required.
 *
 * Contract:
 *   Auth:  every request must send  Authorization: Bearer <WORKER_TOKEN>
 *   Env:   WORKER_TOKEN     shared secret (required) — reject all requests if unset
 *          WORKER_PORT      listen port (default 8090)
 *          FRAMEWORK_PATH   checkout of the framework repo (where src/ lives)
 *          LLM_PLATFORM + matching API key (GROQ_API_KEY / GEMINI_API_KEY / ...)
 *   Routes:
 *          GET  /health              -> readiness (no auth) : { ok, configured, cli, framework }
 *          POST /explore  {job,creds}-> { testCases, featureModel, logs }
 *          POST /generate {job}      -> { result, logs }
 *
 * SECURITY: credentials arrive only in the POST body for the transient explore
 * session, are passed straight to the engine, and are NEVER logged or persisted.
 * Always run this worker behind HTTPS (a reverse proxy or tunnel) in production.
 */
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');
const localAgent = require('../api/_tools/local_agent');

const PORT = Number(process.env.WORKER_PORT) || 8090;
const TOKEN = process.env.WORKER_TOKEN || '';

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function authorized(req) {
  if (!TOKEN) return false; // fail closed when no token is configured
  const header = req.headers['authorization'] || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return timingSafeEqual(m[1].trim(), TOKEN);
}

function hasPlaywrightCli() {
  try {
    execSync('playwright-cli --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readJsonBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0];

  // Health is unauthenticated so uptime checks can probe it.
  if (req.method === 'GET' && url === '/health') {
    const cfg = localAgent.config();
    return send(res, 200, {
      ok: true,
      configured: localAgent.isConfigured(),
      cli: hasPlaywrightCli(),
      framework: !!(cfg && cfg.frameworkPath),
      tokenSet: !!TOKEN,
    });
  }

  if (!authorized(req)) {
    return send(res, 401, { error: 'unauthorized' });
  }

  if (req.method === 'POST' && url === '/explore') {
    try {
      const payload = await readJsonBody(req);
      const job = payload.job || payload;
      const creds = payload.creds || {
        username: payload.username || '',
        password: payload.password || '',
      };
      if (!job || !job.url || !job.feature) {
        return send(res, 400, { error: 'job.url and job.feature are required' });
      }
      const logs = [];
      const { testCases, featureModel } = await localAgent.exploreAndAuthor(
        job,
        (line) => logs.push(line),
        creds,
      );
      return send(res, 200, { testCases, featureModel, logs });
    } catch (e) {
      return send(res, 500, { error: e && e.message ? e.message : String(e) });
    }
  }

  if (req.method === 'POST' && url === '/generate') {
    try {
      const payload = await readJsonBody(req);
      const job = payload.job || payload;
      if (!job || !job.jobId) {
        return send(res, 400, { error: 'job.jobId is required' });
      }
      const logs = [];
      const result = await localAgent.generateAndRun(job, (line) => logs.push(line));
      return send(res, 200, { result, logs });
    } catch (e) {
      return send(res, 500, { error: e && e.message ? e.message : String(e) });
    }
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  const cfg = localAgent.config();
  // Intentionally never print the token or any secret.
  console.log(`[worker] B.L.A.S.T. remote worker listening on :${PORT}`);
  console.log(`[worker] framework=${cfg && cfg.frameworkPath ? 'set' : 'MISSING'} llm=${localAgent.isConfigured() ? 'configured' : 'NOT configured'} cli=${hasPlaywrightCli() ? 'present' : 'MISSING'} token=${TOKEN ? 'set' : 'MISSING (all requests rejected)'}`);
});
