/**
 * import-resolve.test.ts — regression tests for the named-import contract gate (assertImportsResolve).
 *
 * Reproduces the exact CI runtime failure on the Checkout run:
 *   TC_001 "TypeError: Cannot read properties of undefined (reading 'checkout')"
 *
 * Root cause: the generated spec did `import { testData } from '../config'` and then read
 * `testData.checkout.firstName`, but the framework's src/config/index.ts exports NO `testData` — so the
 * binding is `undefined` at runtime and the first property read crashes. This is an IMPORT-contract bug,
 * cheaper and more reliable to catch with a deterministic in-memory gate than with an LLM heal round.
 *
 * These tests lock the gate: it REJECTS a named import the target module does not export, and it never
 * false-positives on (a) valid imports, (b) non-relative node_modules imports, (c) sibling files still
 * being generated (not yet on disk), or (d) wildcard re-export modules whose surface it cannot enumerate.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertImportsResolve } from '../codegen';

/* ── Temp-framework helper: a config that exports routes/credentials/urlFor/urlRegex but NOT testData. */
function makeFramework(): string {
  const dir = mkdtempSync(join(tmpdir(), 'blast-imports-'));
  mkdirSync(join(dir, 'src', 'config'), { recursive: true });
  mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
  mkdirSync(join(dir, 'src', 'fixtures'), { recursive: true });
  writeFileSync(join(dir, 'src', 'config', 'index.ts'), [
    "export const config = { baseUrl: 'https://example.com' } as const;",
    "export const credentials = { username: 'u', password: 'p' } as const;",
    "export const routes = { login: '/' } as const;",
    'export function urlFor(p: string): string { return p; }',
    'export function urlRegex(p: string): RegExp { return new RegExp(p); }',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'pages', 'LoginPage.ts'), 'export class LoginPage {}\n');
  // A wildcard re-export barrel — the gate cannot enumerate its surface, so it must SKIP it.
  writeFileSync(join(dir, 'src', 'fixtures', 'index.ts'), "export * from './base';\n");
  return dir;
}
const cleanup = (fw: string) => rmSync(fw, { recursive: true, force: true });

/* ── #1 — the exact Checkout crash: importing a symbol config does not export must THROW. */
test('#1 rejects `import { testData } from ../config` when config exports no testData', () => {
  const fw = makeFramework();
  try {
    assert.throws(
      () => assertImportsResolve(fw, [
        { dir: 'src/tests', file: 'checkout.spec.ts', content: "import { credentials, routes, urlRegex, testData } from '../config';\n" },
      ]),
      /testData.*does not export it/,
      'the undefined-import that caused the runtime crash is rejected in-memory',
    );
  } finally { cleanup(fw); }
});

/* ── #2 — only-valid imports from an on-disk module must NOT throw. */
test('#2 accepts named imports that the target module actually exports', () => {
  const fw = makeFramework();
  try {
    assert.doesNotThrow(() => assertImportsResolve(fw, [
      { dir: 'src/tests', file: 'login.spec.ts', content: "import { credentials, routes, urlRegex } from '../config';\n" },
      { dir: 'src/modules', file: 'LoginModule.ts', content: "import { LoginPage } from '../pages/LoginPage';\n" },
    ]));
  } finally { cleanup(fw); }
});

/* ── #3 — a mismatched import from an on-disk PAGE is also caught. */
test('#3 rejects a symbol an on-disk page does not export', () => {
  const fw = makeFramework();
  try {
    assert.throws(
      () => assertImportsResolve(fw, [
        { dir: 'src/modules', file: 'LoginModule.ts', content: "import { LoginPage, Nonexistent } from '../pages/LoginPage';\n" },
      ]),
      /Nonexistent.*does not export it/,
    );
  } finally { cleanup(fw); }
});

/* ── #4 — a sibling being generated in the SAME batch is not on disk yet → SKIP (no false positive). */
test('#4 skips imports of sibling files still being generated (not yet on disk)', () => {
  const fw = makeFramework();
  try {
    assert.doesNotThrow(() => assertImportsResolve(fw, [
      { dir: 'src/tests', file: 'checkout.spec.ts', content: "import { CheckoutModule } from '../modules/CheckoutModule';\n" },
    ]));
  } finally { cleanup(fw); }
});

/* ── #5 — non-relative (node_modules) imports are not part of the framework contract → SKIP. */
test('#5 skips non-relative node_modules imports', () => {
  const fw = makeFramework();
  try {
    assert.doesNotThrow(() => assertImportsResolve(fw, [
      { dir: 'src/tests', file: 'login.spec.ts', content: "import { test, expect } from '@playwright/test';\n" },
    ]));
  } finally { cleanup(fw); }
});

/* ── #6 — a wildcard re-export barrel cannot be enumerated → SKIP rather than risk a false rejection. */
test('#6 skips modules that re-export with a wildcard (export * from)', () => {
  const fw = makeFramework();
  try {
    assert.doesNotThrow(() => assertImportsResolve(fw, [
      { dir: 'src/tests', file: 'login.spec.ts', content: "import { anything } from '../fixtures';\n" },
    ]));
  } finally { cleanup(fw); }
});
