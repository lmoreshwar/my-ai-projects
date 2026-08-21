/**
 * locator-contract.test.ts — the VERIFIED-LIVE interaction contract, end to end.
 *
 * Proves the generic layer that turns live evidence into generated locators can never emit a
 * semantically-weak / ambiguous locator (e.g. a bare `page.getByRole('checkbox')`) for a custom or
 * ambiguous checkable/select control. Two layers are exercised:
 *
 *   1. CAPTURE  — `interactionEvidenceForRef` + `deriveLocatorScopeHint` build a LocatorContract from the
 *                 live a11y snapshot, flagging unnamed checkables and ambiguous roles as `custom`.
 *   2. GATE     — `assertProvenInteractionLocators` rejects a bare role locator BEFORE execution and hands
 *                 the repair loop the proven, label-scoped target to reuse.
 *
 * Everything here is application-agnostic: fixtures are generic a11y trees, never OrangeHRM selectors.
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProvenInteractionLocators,
  assertUniqueNamedRoleLocators,
  ambiguousSnapshotRoleNames,
  assertCollectionReadsUseCollectionLocators,
  assertNoSelfReferentialSortAssertion,
  singleTargetNamedPageMembers,
} from '../codegen';
import { deriveLocatorScopeHint, interactionEvidenceForRef } from '../agent-loop';
import type { AgentStep, InteractionEvidence } from '../agent-loop';

/* ── Fixtures ─────────────────────────────────────────────────────────────────── */

// A custom switch: an UNNAMED checkbox whose visible label is a sibling text node (the OXD-switch shape,
// but expressed generically). Its native <input> is what a11y exposes; a wrapper span intercepts clicks.
const CUSTOM_SWITCH_SNAPSHOT = `
- group "Filters":
  - text: Include Past Employees
  - checkbox [ref=e5]
`.trim();

// A conventional, accessible checkbox: it carries its own accessible name, so a named getByRole is safe.
const NATIVE_CHECKBOX_SNAPSHOT = `
- group "Consent":
  - text: Consent
  - checkbox "Consent" [ref=e5]
`.trim();

/** Build an interactive trace step carrying a LocatorContract (defaults model the custom-switch case). */
function evStep(action: string, ev: Partial<InteractionEvidence> = {}): AgentStep {
  const interaction: InteractionEvidence = {
    controlId: 'Include Past Employees',
    action,
    semanticRole: 'checkbox',
    accessibleName: '',
    locatorEvidence: "page.getByText('Include Past Employees', { exact: true }).locator('xpath=ancestor::*[descendant::input][1]').getByRole('checkbox')",
    interactionTarget: 'checkbox (unnamed) [ref=e5]',
    uniqueness: 1,
    custom: true,
    actionability: 'verified-live',
    provenByLiveTrace: true,
    ...ev,
  };
  return { tool: action, args: {}, result: '', interaction };
}

const files = (content: string, file = 'GeneratedPage.ts'): Array<{ file: string; content: string }> => [{ file, content }];

/* ── 1. CAPTURE: unnamed checkable earns a label-scoped hint even when it is unique ─────────────── */

test('deriveLocatorScopeHint scopes an UNNAMED checkable to its label even when it is the only one (matches===1)', () => {
  const hint = deriveLocatorScopeHint(CUSTOM_SWITCH_SNAPSHOT, 'e5');
  assert.ok(hint, 'an unnamed checkbox/switch must get a label-scoped hint — a bare role locator is unsafe');
  assert.equal(hint!.role, 'checkbox');
  assert.equal(hint!.name, '');
  assert.match(hint!.locator, /getByText\('Include Past Employees', \{ exact: true \}\)/);
  assert.match(hint!.locator, /getByRole\('checkbox'\)$/);
});

test('deriveLocatorScopeHint leaves a NAMED, unique checkbox alone (no hint needed)', () => {
  // A properly-labelled checkbox is safe via getByRole('checkbox', { name }); no scoping required.
  assert.equal(deriveLocatorScopeHint(NATIVE_CHECKBOX_SNAPSHOT, 'e5'), undefined);
});

/* ── 2. CAPTURE: the LocatorContract flags custom vs. safe controls ─────────────────────────────── */

test('interactionEvidenceForRef marks an unnamed checkable as custom and prefers the proven scoped target', () => {
  const scope = deriveLocatorScopeHint(CUSTOM_SWITCH_SNAPSHOT, 'e5');
  const ev = interactionEvidenceForRef(CUSTOM_SWITCH_SNAPSHOT, 'e5', 'check', "page.getByRole('checkbox')", scope);
  assert.ok(ev, 'evidence must be produced for a resolved ref');
  assert.equal(ev!.custom, true, 'an unnamed checkbox is a custom widget');
  assert.equal(ev!.semanticRole, 'checkbox');
  assert.equal(ev!.accessibleName, '');
  assert.equal(ev!.uniqueness, 1);
  assert.equal(ev!.actionability, 'verified-live');
  assert.equal(ev!.provenByLiveTrace, true);
  // The contract carries the label-scoped locator, NOT the weak bare one that was echoed by the CLI.
  assert.match(ev!.locatorEvidence, /getByText\('Include Past Employees'/);
});

test('interactionEvidenceForRef marks a NAMED, unique checkbox as NOT custom and keeps the proven locator', () => {
  const proven = "page.getByRole('checkbox', { name: 'Consent' })";
  const ev = interactionEvidenceForRef(NATIVE_CHECKBOX_SNAPSHOT, 'e5', 'check', proven, deriveLocatorScopeHint(NATIVE_CHECKBOX_SNAPSHOT, 'e5'));
  assert.ok(ev);
  assert.equal(ev!.custom, false);
  assert.equal(ev!.uniqueness, 1);
  assert.equal(ev!.accessibleName, 'Consent');
  assert.equal(ev!.locatorEvidence, proven, 'with no scope hint the proven CLI locator is preserved');
});

/* ── 3. GATE: the exact regression — a custom switch must never become getByRole('checkbox') ─────── */

test('assertProvenInteractionLocators REJECTS a bare getByRole(checkbox) for a custom (unnamed) switch [req #13]', () => {
  const trace = [evStep('check')];
  assert.throws(
    () => assertProvenInteractionLocators(files("await this.page.getByRole('checkbox').check();"), trace),
    /Include Past Employees[\s\S]*Do NOT use generic getByRole\('checkbox'\)[\s\S]*Reuse the EXACT live interaction target/,
    'the bare, click-intercepted locator must be rejected with the reuse-the-proven-target diagnostic',
  );
});

test('assertProvenInteractionLocators ACCEPTS the proven label-scoped locator (no false positive on the fix)', () => {
  const trace = [evStep('check')];
  const good = `await this.${trace[0].interaction!.locatorEvidence}.check();`;
  assert.doesNotThrow(() => assertProvenInteractionLocators(files(good), trace));
});

/* ── 4. GATE: native checkbox stays allowed ─────────────────────────────────────────────────────── */

test('assertProvenInteractionLocators ALLOWS a named getByRole(checkbox, {name}) — safe & unambiguous', () => {
  const trace = [evStep('check', { controlId: 'Consent', accessibleName: 'Consent', custom: false })];
  assert.doesNotThrow(() => assertProvenInteractionLocators(files("await this.page.getByRole('checkbox', { name: 'Consent' }).check();"), trace));
});

test('assertProvenInteractionLocators ignores a named getByRole even when a DIFFERENT control is custom', () => {
  // Code targets the safe named checkbox; there is no bare role locator, so the gate stays silent.
  const trace = [evStep('check')];
  assert.doesNotThrow(() => assertProvenInteractionLocators(files("await this.page.getByRole('checkbox', { name: 'Consent' }).check();"), trace));
});

/* ── 5. GATE: ambiguous same-role controls (radio group, custom dropdown) ───────────────────────── */

test('assertProvenInteractionLocators REJECTS a bare getByRole(radio) for an ambiguous radio group', () => {
  const trace = [evStep('check', { controlId: 'Gender', semanticRole: 'radio', accessibleName: 'Male', uniqueness: 2, locatorEvidence: "page.getByRole('group', { name: 'Gender' }).getByRole('radio', { name: 'Male' })" })];
  assert.throws(
    () => assertProvenInteractionLocators(files("await this.page.getByRole('radio').check();"), trace),
    /2 same-role radio controls \(ambiguous\)/,
  );
});

test('assertProvenInteractionLocators REJECTS a bare getByRole(combobox) for an ambiguous custom dropdown', () => {
  const trace = [evStep('click', { controlId: 'Status', semanticRole: 'combobox', accessibleName: '', uniqueness: 3, locatorEvidence: "page.getByText('Status', { exact: true }).locator('xpath=ancestor::*[descendant::input][1]').getByRole('combobox')" })];
  assert.throws(
    () => assertProvenInteractionLocators(files("await this.page.getByRole('combobox').click();"), trace),
    /3 same-role combobox controls \(ambiguous\)/,
  );
});

/* ── 6. GATE: scope & safety boundaries ─────────────────────────────────────────────────────────── */

test('assertProvenInteractionLocators never fires on non-checkable/select evidence (a textbox)', () => {
  // Even if generated code contains a bare getByRole('checkbox') for some unrelated reason, a textbox
  // interaction is not risky evidence, so the gate does not police it. It reacts ONLY to proven evidence.
  const trace = [evStep('fill', { controlId: 'Email', semanticRole: 'textbox', custom: false })];
  assert.doesNotThrow(() => assertProvenInteractionLocators(files("await this.page.getByRole('checkbox').check();"), trace));
});

test('assertProvenInteractionLocators is a no-op when the trace has no interaction evidence', () => {
  const trace: AgentStep[] = [{ tool: 'check', args: {}, result: '' }];
  assert.doesNotThrow(() => assertProvenInteractionLocators(files("await this.page.getByRole('checkbox').check();"), trace));
});

/* ── 7. END TO END: capture ➜ gate (the full generic layer, driven only by a live snapshot) ──────── */

test('capture ➜ gate: an unnamed switch snapshot rejects the bare locator and accepts the scoped one', () => {
  // 1. CAPTURE the contract straight from a live a11y snapshot (as the agent loop does at run time).
  const scope = deriveLocatorScopeHint(CUSTOM_SWITCH_SNAPSHOT, 'e5');
  const ev = interactionEvidenceForRef(CUSTOM_SWITCH_SNAPSHOT, 'e5', 'check', "page.getByRole('checkbox')", scope)!;
  const trace: AgentStep[] = [{ tool: 'check', args: {}, result: '', interaction: ev }];

  // 2. GATE rejects the weak inferred locator …
  assert.throws(
    () => assertProvenInteractionLocators(files("await this.page.getByRole('checkbox').check();"), trace),
    /Do NOT use generic getByRole\('checkbox'\)/,
  );
  // … and accepts the proven, label-scoped target the contract captured.
  assert.doesNotThrow(() => assertProvenInteractionLocators(files(`await this.${ev.locatorEvidence}.check();`), trace));
});

/* ── 8. GATE: named-role AMBIGUITY (image link + title link share one accessible name) ─────────── */

// A SauceDemo-style inventory snapshot: each item exposes its name on BOTH an image link (name from its
// alt text) and a text/title link, so getByRole('link', { name }) resolves to 2 elements. Generic a11y tree.
const INVENTORY_SNAPSHOT = `
- main:
  - list:
    - listitem:
      - link "Sauce Labs Backpack":
        - img "Sauce Labs Backpack"
      - link "Sauce Labs Backpack"
      - text: "$29.99"
    - listitem:
      - link "Sauce Labs Bike Light":
        - img "Sauce Labs Bike Light"
      - link "Sauce Labs Bike Light"
      - text: "$9.99"
- link "Open Menu"
`.trim();

const snap = (result: string): AgentStep => ({ tool: 'snapshot', args: {}, result });

test('ambiguousSnapshotRoleNames flags a (role,name) that appears twice in ONE snapshot', () => {
  const amb = ambiguousSnapshotRoleNames([snap(INVENTORY_SNAPSHOT)]);
  assert.ok(amb.has('link\u0000Sauce Labs Backpack'), 'the dual image+title link must be flagged');
  assert.ok(amb.has('link\u0000Sauce Labs Bike Light'));
  assert.ok(!amb.has('link\u0000Open Menu'), 'a unique link must NOT be flagged');
});

test('ambiguousSnapshotRoleNames counts PER snapshot — a unique name seen in two snapshots is not flagged', () => {
  const one = snap('- link "Sauce Labs Backpack"\n- text: "$29.99"');
  const two = snap('- link "Sauce Labs Backpack"\n- text: "$29.99"');
  const amb = ambiguousSnapshotRoleNames([one, two]);
  assert.equal(amb.size, 0, 'the same UNIQUE element captured across snapshots must not look like a duplicate');
});

test('assertUniqueNamedRoleLocators REJECTS a bare named getByRole(link) that matches image + title link', () => {
  const trace = [snap(INVENTORY_SNAPSHOT)];
  assert.throws(
    () => assertUniqueNamedRoleLocators(files("backpackLink = (): Locator => this.page.getByRole('link', { name: 'Sauce Labs Backpack' });"), trace),
    /getByRole\('link', \{ name: 'Sauce Labs Backpack' \}\)[\s\S]*resolved to N elements[\s\S]*getByText/,
    'the ambiguous product-title role locator must be rejected with the data-test / getByText remedy',
  );
});

test('assertUniqueNamedRoleLocators ACCEPTS the getByText title target (only the title, not the alt-named image)', () => {
  const trace = [snap(INVENTORY_SNAPSHOT)];
  assert.doesNotThrow(
    () => assertUniqueNamedRoleLocators(files("backpackTitle = (): Locator => this.page.getByText('Sauce Labs Backpack', { exact: true });"), trace),
  );
});

test('assertUniqueNamedRoleLocators ACCEPTS a stable data-test locator', () => {
  const trace = [snap(INVENTORY_SNAPSHOT)];
  assert.doesNotThrow(
    () => assertUniqueNamedRoleLocators(files(`backpackTitle = (): Locator => this.page.locator('[data-test="item-4-title-link"]');`), trace),
  );
});

test('assertUniqueNamedRoleLocators ACCEPTS a SCOPED named role locator (a call sits between page. and getByRole)', () => {
  const trace = [snap(INVENTORY_SNAPSHOT)];
  const scoped = "row = (): Locator => this.page.locator('.inventory_item', { hasText: 'Sauce Labs Backpack' }).getByRole('link', { name: 'Sauce Labs Backpack' });";
  assert.doesNotThrow(() => assertUniqueNamedRoleLocators(files(scoped), trace));
});

test('assertUniqueNamedRoleLocators stays silent when the named role is UNIQUE in the snapshot', () => {
  const trace = [snap(INVENTORY_SNAPSHOT)];
  assert.doesNotThrow(
    () => assertUniqueNamedRoleLocators(files("menu = (): Locator => this.page.getByRole('link', { name: 'Open Menu' });"), trace),
  );
});

test('assertUniqueNamedRoleLocators is a no-op when there is no snapshot evidence', () => {
  assert.doesNotThrow(
    () => assertUniqueNamedRoleLocators(files("backpackLink = (): Locator => this.page.getByRole('link', { name: 'Sauce Labs Backpack' });"), []),
  );
});

/* ── 9. GATE: collection-read hygiene (a collection read backed by a single named/text locator) ──── */

// The EXACT live SauceDemo Name-sort defect: productNames() is a single named LINK, so .allTextContents()
// matches the item image link (empty text) + title link → ["", "Sauce Labs Backpack"]. Generic fixtures.
const BUGGY_PAGE = "export class SauceDemoPage {\n  productNames = (): Locator => this.page.getByRole('link', { name: 'Sauce Labs Backpack' });\n}";
const GOOD_TESTID_PAGE = "export class SauceDemoPage {\n  productNames = (): Locator => this.page.getByTestId('inventory-item-name');\n}";
const GOOD_CSS_PAGE = 'export class SauceDemoPage {\n  productNames = (): Locator => this.page.locator(\'[data-test="inventory-item-name"]\');\n}';
const BARE_ROLE_PAGE = "export class SauceDemoPage {\n  productNames = (): Locator => this.page.getByRole('link');\n}";
const BUGGY_TEXT_PAGE = "export class SauceDemoPage {\n  productNames = (): Locator => this.page.getByText('Sauce Labs Backpack', { exact: true });\n}";
const METHOD_STYLE_PAGE = "export class SauceDemoPage {\n  productNames(): Locator {\n    return this.page.getByRole('link', { name: 'Sauce Labs Backpack' });\n  }\n}";
const READ_MODULE = 'export class SauceDemoModule {\n  async productNames(): Promise<string[]> {\n    return this.sauceDemoPage.productNames().allTextContents();\n  }\n}';
const COUNT_MODULE = 'export class SauceDemoModule {\n  async productCount(): Promise<number> {\n    return this.sauceDemoPage.productNames().count();\n  }\n}';
const CLICK_MODULE = 'export class SauceDemoModule {\n  async openBackpack(): Promise<void> {\n    await this.actions.click(this.sauceDemoPage.productNames());\n  }\n}';

const pf = (content: string, file = 'SauceDemoPage.ts'): { file: string; content: string } => ({ file, content });
const mf = (content: string, file = 'SauceDemoModule.ts'): { file: string; content: string } => ({ file, content });

test('assertCollectionReadsUseCollectionLocators REJECTS .allTextContents() on a single named LINK getter', () => {
  assert.throws(
    () => assertCollectionReadsUseCollectionLocators(pf(BUGGY_PAGE), [mf(READ_MODULE)]),
    /collection read[\s\S]*backed by a SINGLE-element locator[\s\S]*getByTestId/,
    'the live productNames() named-link bug must be rejected with the collection-locator remedy',
  );
});

test('assertCollectionReadsUseCollectionLocators REJECTS .count() on a getByText literal getter', () => {
  assert.throws(
    () => assertCollectionReadsUseCollectionLocators(pf(BUGGY_TEXT_PAGE), [mf(COUNT_MODULE)]),
    /backed by a SINGLE-element locator \(getByText/,
  );
});

test('assertCollectionReadsUseCollectionLocators REJECTS a method-style single named getter', () => {
  assert.throws(
    () => assertCollectionReadsUseCollectionLocators(pf(METHOD_STYLE_PAGE), [mf(READ_MODULE)]),
    /backed by a SINGLE-element locator/,
  );
});

test('assertCollectionReadsUseCollectionLocators ACCEPTS a getByTestId collection getter', () => {
  assert.doesNotThrow(() => assertCollectionReadsUseCollectionLocators(pf(GOOD_TESTID_PAGE), [mf(READ_MODULE)]));
});

test('assertCollectionReadsUseCollectionLocators ACCEPTS a data-test CSS collection getter', () => {
  assert.doesNotThrow(() => assertCollectionReadsUseCollectionLocators(pf(GOOD_CSS_PAGE), [mf(READ_MODULE)]));
});

test('assertCollectionReadsUseCollectionLocators ACCEPTS a bare getByRole(link) with no name', () => {
  assert.doesNotThrow(() => assertCollectionReadsUseCollectionLocators(pf(BARE_ROLE_PAGE), [mf(READ_MODULE)]));
});

test('assertCollectionReadsUseCollectionLocators is a NO-OP when the single named getter is only CLICKED', () => {
  // A single named locator is CORRECT for a click — the gate fires ONLY on a collection read of it.
  assert.doesNotThrow(() => assertCollectionReadsUseCollectionLocators(pf(BUGGY_PAGE), [mf(CLICK_MODULE)]));
});

test('singleTargetNamedPageMembers detects named-role and text getters, not collections', () => {
  assert.ok(singleTargetNamedPageMembers(BUGGY_PAGE).has('productNames'), 'named-role getter is single-target');
  assert.ok(singleTargetNamedPageMembers(BUGGY_TEXT_PAGE).has('productNames'), 'getByText literal getter is single-target');
  assert.ok(!singleTargetNamedPageMembers(GOOD_TESTID_PAGE).has('productNames'), 'getByTestId is a collection strategy');
  assert.ok(!singleTargetNamedPageMembers(BARE_ROLE_PAGE).has('productNames'), 'a bare role (no name) is a collection strategy');
});

/* ── 10. GATE: tautological ordering assertion (compare a value to its OWN sorted copy) ──────────── */

const specWith = (assertion: string, file = 'sauceDemo.spec.ts'): { file: string; content: string } => ({
  file,
  content: `test('sort', async ({ page }) => {\n  const productNames = await m.productNames();\n  ${assertion}\n});`,
});

test('assertNoSelfReferentialSortAssertion REJECTS expect(x).toEqual([...x].sort(desc)) — the live Z-A bug', () => {
  assert.throws(
    () => assertNoSelfReferentialSortAssertion(specWith('expect(productNames).toEqual([...productNames].sort((a, b) => b.localeCompare(a)));')),
    /tautological ordering assertion[\s\S]*INDEPENDENT expected order/,
  );
});

test('assertNoSelfReferentialSortAssertion REJECTS the .slice().sort(), Array.from().sort() and .reverse() forms', () => {
  assert.throws(() => assertNoSelfReferentialSortAssertion(specWith('expect(names).toEqual(names.slice().sort());')), /tautological/);
  assert.throws(() => assertNoSelfReferentialSortAssertion(specWith('expect(names).toEqual(Array.from(names).sort());')), /tautological/);
  assert.throws(() => assertNoSelfReferentialSortAssertion(specWith('expect(names).toEqual([...names].reverse());')), /tautological/);
});

test('assertNoSelfReferentialSortAssertion ACCEPTS a comparison to an INDEPENDENT expected array', () => {
  assert.doesNotThrow(() => assertNoSelfReferentialSortAssertion(specWith('expect(productNames).toEqual(expectedSortedNames);')));
});

test('assertNoSelfReferentialSortAssertion ACCEPTS a sort of a DIFFERENT array (not the asserted value)', () => {
  // Comparing the observed list to a sorted copy of a SEPARATELY-captured baseline is legitimate.
  assert.doesNotThrow(() => assertNoSelfReferentialSortAssertion(specWith('expect(sortedNames).toEqual([...originalNames].sort());')));
});
