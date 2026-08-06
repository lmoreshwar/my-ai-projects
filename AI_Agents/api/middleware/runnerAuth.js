const DEFAULT_DEV_TOKEN = 'dev-runner-token';

/**
 * Runner auth — a shared-secret gate for the pull-based worker (B.L.A.S.T. Runner).
 * The worker is NOT a logged-in user, so it authenticates with a single RUNNER_TOKEN
 * (sent as the `x-runner-token` header) instead of a JWT. In DEV_MODE a default token
 * is accepted so the whole loop works locally with zero configuration.
 */
module.exports = function runnerAuth(req, res, next) {
  const isDev = process.env.DEV_MODE === 'true';
  const expected = process.env.RUNNER_TOKEN || (isDev ? DEFAULT_DEV_TOKEN : '');
  if (!expected) {
    return res.status(503).json({ msg: 'Runner is disabled — set RUNNER_TOKEN to enable the worker API.' });
  }
  const token = req.header('x-runner-token') || req.query.runnerToken;
  if (token !== expected) {
    return res.status(401).json({ msg: 'Invalid or missing runner token.' });
  }
  next();
};

module.exports.DEFAULT_DEV_TOKEN = DEFAULT_DEV_TOKEN;
