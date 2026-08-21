/**
 * codegen-json-repair.test.ts — regression tests for the BLAST codegen JSON-repair robustness fix.
 *
 * ROOT CAUSE this pins: parseArtifacts() isolated the model's JSON with a GREEDY /\{[\s\S]*\}/ match.
 * When a repair reply arrived wrapped in ```json fences or surrounded by explanatory prose (or when the
 * generated code inside a string value contained its own `{`/`}`), the greedy slice captured the wrong
 * span and JSON.parse threw "Expected ',' or '}' after property value…", the two format retries burned,
 * and generation ABORTED — even though the model's actual object was perfectly valid.
 *
 * The fix (extractJsonObject) prefers a fenced block, else scans for the first BRACE-BALANCED object with
 * string/escape awareness, so fences, prose, and braces-inside-code can never abort the run. These tests
 * also PROVE the fix did NOT weaken any gate: the verified-live-evidence locator gate, the module
 * API-preservation gate, duplicate detection, and multi-page evidence propagation all still behave.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  extractJsonObject,
  parseArtifacts,
  assertProvenInteractionLocators,
  assertExistingModuleApiPreserved,
  selectTraceForScenarios,
  coveringTest,
  type Scenario,
} from '../codegen';
import type { AgentStep } from '../agent-loop';

// The loop treats these three messages as FORMAT-class (bounded retry, then a clean, precise failure —
// never a partial write). Keep in sync with isFormatError() in requestValidatedArtifacts().
const isFormatError = (msg: string): boolean =>
  /Codegen: (model did not return JSON|invalid JSON|reply missing page\/module\/spec content)/.test(msg);

/** A valid artifacts object whose module content deliberately contains `{`, `}`, and quotes — the exact
 *  shape that made the old greedy regex miscount braces. */
function validArtifacts(): Record<string, unknown> {
  return {
    domain: 'checkout',
    page: { file: 'src/pages/CheckoutPage.ts', content: 'export class CheckoutPage { readonly x = 1; }' },
    module: {
      file: 'src/modules/CheckoutModule.ts',
      content: 'export class CheckoutModule {\n  async finish(): Promise<void> {\n    if (true) { await this.page.click("#finish"); }\n  }\n}',
    },
    spec: { file: 'src/tests/checkout.spec.ts', content: 'test("finish", async () => { expect(1).toBe(1); });' },
  };
}

// ── PART 1 — robust repair pipeline ──────────────────────────────────────────

test('#1 valid strict JSON repair response parses into artifacts', () => {
  const raw = JSON.stringify(validArtifacts());
  const art = parseArtifacts(raw);
  assert.equal(art.module.file, 'src/modules/CheckoutModule.ts');
  assert.match(art.spec.content, /expect\(1\)\.toBe\(1\)/);
});

test('#2 markdown-fenced JSON repair response parses (```json … ```)', () => {
  const raw = '```json\n' + JSON.stringify(validArtifacts()) + '\n```';
  const art = parseArtifacts(raw);
  assert.equal(art.page.file, 'src/pages/CheckoutPage.ts');
});

test('#3 JSON surrounded by explanatory prose is safely isolated', () => {
  const raw = [
    'Sure — here is the corrected artifact. I kept every locator identical:',
    '',
    '```json',
    JSON.stringify(validArtifacts()),
    '```',
    '',
    'Let me know if you need anything else. { this trailing brace must be ignored }',
  ].join('\n');
  const art = parseArtifacts(raw);
  assert.equal(art.module.file, 'src/modules/CheckoutModule.ts');
});

test('#4 braces INSIDE string values (generated code) never break parsing — the greedy-regex crash', () => {
  // Prose after the object also contains braces; the balanced scan must still pick the FIRST full object.
  const raw = JSON.stringify(validArtifacts()) + '\n\nNote: the finish() body uses an if { } block.';
  const art = parseArtifacts(raw);
  assert.match(art.module.content, /if \(true\) \{ await this\.page\.click/);
});

test('#5 malformed JSON throws a FORMAT-class error (bounded retry, clean failure — no partial write)', () => {
  const broken = '```json\n{ "domain": "checkout", "page": { "file": "a.ts", "content": "x" } ,, }\n```';
  assert.throws(
    () => parseArtifacts(broken),
    (e: Error) => isFormatError(e.message) && /invalid JSON/.test(e.message),
  );
});

test('#5b a reply with NO object throws the retryable "did not return JSON" error', () => {
  assert.throws(
    () => parseArtifacts('I could not complete this request.'),
    (e: Error) => isFormatError(e.message) && /did not return JSON/.test(e.message),
  );
});

test('#5c a reply missing page/module/spec throws the retryable "missing content" error', () => {
  const raw = JSON.stringify({ domain: 'x', page: { file: 'a', content: 'a' } });
  assert.throws(
    () => parseArtifacts(raw),
    (e: Error) => isFormatError(e.message) && /missing page\/module\/spec content/.test(e.message),
  );
});

test('#5d extractJsonObject returns null (not a throw) when there is no object at all', () => {
  assert.equal(extractJsonObject('no json here'), null);
  assert.equal(extractJsonObject(''), null);
});

// ── PART 2 — complete verified evidence propagation (multi-step flow) ─────────

function step(tool: string, extra: Partial<AgentStep> = {}): AgentStep {
  return { tool, args: {}, result: 'ok', ...extra } as AgentStep;
}

test('#6 verified locators from LATER pages of a multi-step flow survive scenario selection', () => {
  // login → product → cart → checkout-one → checkout-two → order-complete.
  const trace: AgentStep[] = [
    step('goto', { url: 'https://x/login' }),
    step('fill', { args: { value: '{{username}}' } as unknown as Record<string, unknown> }),
    step('fill', { args: { value: '{{password}}' } as unknown as Record<string, unknown> }),
    step('click', { locator: "getByRole('button', { name: 'Login' })", url: 'https://x/inventory' }),
    step('click', { locator: "getByRole('button', { name: 'Add to cart' })", url: 'https://x/inventory' }),
    step('click', { locator: "getByRole('link', { name: 'Checkout' })", url: 'https://x/cart' }),
    // LATER-PAGE controls — must NOT be filtered out by scenario selection.
    step('click', { locator: "getByRole('button', { name: 'Finish' })", url: 'https://x/checkout-step-two' }),
    step('snapshot', { url: 'https://x/checkout-complete' }),
  ];
  const scenarios: Scenario[] = [{
    id: 'TC_001', title: 'Finish checkout and verify order confirmation', type: 'positive',
    ready: true, blocked: false, steps: [], expectedResults: 'Order placed',
    coverage: { fieldIds: [], fieldLabels: [] },
  }];
  const { trace: kept } = selectTraceForScenarios(trace, scenarios, ['TC_001']);
  const finish = kept.find((s) => (s.locator || '').includes('Finish'));
  assert.ok(finish, 'the Finish button click on checkout-step-two must remain available to codegen');
  assert.ok(kept.some((s) => s.url === 'https://x/checkout-complete'), 'order-completion evidence must survive');
  assert.ok(kept.some((s) => s.url === 'https://x/cart'), 'cart-page evidence must survive');
});

// ── PART 3 — existing protections remain ENABLED (unchanged) ─────────────────

test('#7 verified-live-evidence locator gate STILL rejects a bare getByRole for a custom control', () => {
  const trace: AgentStep[] = [step('click', {
    interaction: {
      controlId: 'Remember me', action: 'check', semanticRole: 'checkbox', accessibleName: '',
      locatorEvidence: "getByText('Remember me').locator('..').getByRole('checkbox')",
      interactionTarget: 'checkbox ref=e1', uniqueness: 1, custom: true,
      actionability: 'verified-live', provenByLiveTrace: true,
    },
  })];
  assert.throws(
    () => assertProvenInteractionLocators([{ file: 'src/pages/LoginPage.ts', content: "this.box = page.getByRole('checkbox');" }], trace),
    /bare getByRole\('checkbox'\)/,
  );
});

test('#8 module API-preservation gate STILL rejects a regen that drops an existing public method', () => {
  const fw = mkdtempSync(join(tmpdir(), 'blast-json-repair-'));
  try {
    const rel = 'src/modules/CartModule.ts';
    write(fw, rel, 'export class CartModule {\n  async establishCart(): Promise<void> {}\n  async goto(): Promise<void> {}\n}');
    const candidate = {
      domain: 'cart',
      page: { file: 'src/pages/CartPage.ts', content: 'export class CartPage {}' },
      module: { file: rel, content: 'export class CartModule {\n  async goto(): Promise<void> {}\n}' }, // dropped establishCart
      spec: { file: 'src/tests/cart.spec.ts', content: 'test("t", () => {});' },
    };
    assert.throws(() => assertExistingModuleApiPreserved(fw, candidate), /removes existing public method\(s\) \[establishCart\]/);
  } finally {
    rmSync(fw, { recursive: true, force: true });
  }
});

test('#9 module API-preservation gate ALLOWS an additive regen (existing method kept + new one added)', () => {
  const fw = mkdtempSync(join(tmpdir(), 'blast-json-repair-'));
  try {
    const rel = 'src/modules/CartModule.ts';
    write(fw, rel, 'export class CartModule {\n  async establishCart(): Promise<void> {}\n}');
    const candidate = {
      domain: 'cart',
      page: { file: 'src/pages/CartPage.ts', content: 'export class CartPage {}' },
      module: { file: rel, content: 'export class CartModule {\n  async establishCart(): Promise<void> {}\n  async checkout(): Promise<void> {}\n}' },
      spec: { file: 'src/tests/cart.spec.ts', content: 'test("t", () => {});' },
    };
    assert.doesNotThrow(() => assertExistingModuleApiPreserved(fw, candidate));
  } finally {
    rmSync(fw, { recursive: true, force: true });
  }
});

test('#10 duplicate/semantic reuse detection is unchanged (a matching title is still detected)', () => {
  const existing = [{ spec: 'src/tests/checkout.spec.ts', testId: 'TC_001', title: 'Finish checkout and verify order confirmation' }];
  assert.ok(coveringTest('Finish checkout and verify order confirmation', existing), 'an identical title must be detected as covered');
  assert.equal(coveringTest('Change account profile avatar image', existing), null, 'an unrelated title must NOT be flagged as covered');
});

function write(fw: string, rel: string, content: string): void {
  const abs = join(fw, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
