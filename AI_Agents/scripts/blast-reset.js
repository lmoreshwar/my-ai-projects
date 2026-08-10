#!/usr/bin/env node
/**
 * B.L.A.S.T. doctor — force the AI Native Playwright framework repo back to a pristine baseline
 * and remove orphan blast/* branches left behind by interrupted generation runs.
 *
 * Only ever touches the generation-owned paths (src, .ai-memory, .blast-backups) and blast/*
 * branches — never the user's other files or branches.
 *
 *   npm run blast:reset
 */
const localAgent = require('../api/_tools/local_agent');

(async () => {
  try {
    if (!localAgent.isConfigured()) {
      console.error('[reset] Local provider is not configured (framework path missing). Aborting.');
      process.exit(1);
    }
    const { base, deletedBranches } = await localAgent.resetFramework((line) => console.log(line));
    console.log(`[reset] Done — baseline ${base}, deleted ${deletedBranches.length} orphan branch(es).`);
    process.exit(0);
  } catch (err) {
    console.error(`[reset] Failed: ${err.message}`);
    process.exit(1);
  }
})();
