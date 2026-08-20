'use strict';

// Single source of truth for the JWT secret + DEV_MODE bypass policy.
// Production is signalled by NODE_ENV === 'production'. In every other
// environment (including unset) the historical local-dev behaviour is preserved.

// Local-development-only fallback. NEVER used when NODE_ENV === 'production'.
const DEV_FALLBACK_SECRET = 'super_secret_blast_key_2026';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Resolve the secret used to sign and verify JWTs.
 * - Production: JWT_SECRET must be set explicitly; otherwise throw (fail fast,
 *   never fall back to the insecure hardcoded value).
 * - Development: use JWT_SECRET when present, otherwise the local fallback.
 */
function getJwtSecret() {
  const configured = process.env.JWT_SECRET;
  if (configured) return configured;
  if (isProduction()) {
    throw new Error('JWT_SECRET must be set in production; refusing to use the insecure development fallback.');
  }
  return DEV_FALLBACK_SECRET;
}

/**
 * Whether the DEV_MODE authentication bypass (fake dev user) is allowed.
 * Only in local development — never when NODE_ENV === 'production'.
 */
function isDevBypassAllowed() {
  return process.env.DEV_MODE === 'true' && !isProduction();
}

module.exports = { getJwtSecret, isDevBypassAllowed, isProduction, DEV_FALLBACK_SECRET };
