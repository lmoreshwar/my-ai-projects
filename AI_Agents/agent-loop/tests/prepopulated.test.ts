/**
 * prepopulated.test.ts — regression tests for the GENERIC control-classification pipeline.
 *
 * The bug this pins down: a page/section title (e.g. Sauce Demo's "Products") or any other piece of
 * page chrome (heading / nav link / static text / table header) was being adopted as the LABEL of a
 * nearby unnamed prepopulated control, then enforced by codegen as an untouchable "field" — which
 * wrongly rejected a scenario that merely used "Products" as a read-only readiness/heading
 * assertion. The fix is at the classifier source (never borrow a label from a non-field node) plus a
 * precise codegen guard (a prepopulated dropdown/radio is protected by its selected VALUE, never by
 * its label). Genuine prepopulated INPUT fields must stay fully protected.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepopulatedFields } from '../agent-loop';
import type { AgentStep } from '../agent-loop';
import { parseInventory, isInputCapableRole } from '../discovery';
import { assertPrepopulatedFieldsUntouched, prepopulatedFieldEntries } from '../codegen';

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

/** Wrap the classifier output as a one-step trace, exactly as the agent loop records it. */
function traceFrom(snapshot: string): AgentStep[] {
  return [{
    tool: 'snapshot',
    args: {},
    result: 'ok',
    prepopulatedFields: prepopulatedFields(snapshot, new Set<string>()),
  }];
}

/** A minimal generated-artifact bundle whose page/module/spec are the given strings. */
function artWith(parts: { page?: string; module?: string; spec?: string; testData?: Record<string, unknown> }) {
  return {
    domain: 'demo',
    page: { file: 'src/pages/DemoPage.ts', content: parts.page || '' },
    module: { file: 'src/modules/DemoModule.ts', content: parts.module || '' },
    spec: { file: 'src/tests/demo.spec.ts', content: parts.spec || '' },
    testData: parts.testData || {},
    uniqueFields: [] as unknown[],
  };
}

/* ── Fixtures ────────────────────────────────────────────────────────────────── */

// The exact failing screen: a page TITLE rendered as static text, a genuinely-prepopulated sort
// <select> with NO accessible name, a product link, and the Add-to-cart action.
const SAUCE_INVENTORY = `
- text: Products
- combobox [ref=e10]:
  - option "Name (A to Z)" [selected] [ref=e11]
  - option "Name (Z to A)" [ref=e12]
  - option "Price (low to high)" [ref=e13]
- link "Sauce Labs Backpack" [ref=e20]
- text: carry.allTheThings() with the sleek, streamlined Sly Pack $29.99
- button "Add to cart" [ref=e25]
`.trim();

// Same screen but the title is a real heading node (the requirement's stated framing).
const SAUCE_HEADING_TITLE = `
- heading "Products" [level=1]
- combobox [ref=e10]:
  - option "Name (A to Z)" [selected] [ref=e11]
  - option "Name (Z to A)" [ref=e12]
- button "Add to cart" [ref=e25]
`.trim();

/* ── 1. Page heading "Products" is NEVER a prepopulated field ─────────────────── */

test('page heading "Products" is never adopted as a prepopulated field label', () => {
  const fields = prepopulatedFields(SAUCE_HEADING_TITLE, new Set());
  assert.ok(!fields.some((f) => /products/i.test(f.label)), 'the "Products" heading must not become a field label');
  const combo = fields.find((f) => f.kind === 'dropdown');
  assert.ok(combo, 'the real prepopulated sort dropdown is still captured');
  assert.match(combo!.label, /^Field\s/, 'a name-less dropdown under a heading falls back to a Field <ref> label');
  assert.equal(combo!.value, 'Name (A to Z)', 'its real prepopulated value is still captured for value-based protection');
});

/* ── 2. Static text is NEVER a prepopulated field ─────────────────────────────── */

test('static text nodes never produce a prepopulated field', () => {
  const snapshot = `
- text: Products
- text: Swag Labs — the best swag in town
- button "Add to cart" [ref=e25]
`.trim();
  assert.deepEqual(prepopulatedFields(snapshot, new Set()), [], 'no input controls ⇒ no prepopulated fields');
});

/* ── 3. Navigation links are NEVER prepopulated (even with an inline value) ────── */

test('navigation links are never classified as prepopulated fields', () => {
  const snapshot = `
- navigation:
  - link "Dashboard" [ref=e1]
  - link "Admin" [ref=e2]
- button "Save" [ref=e10]
`.trim();
  assert.deepEqual(prepopulatedFields(snapshot, new Set()), [], 'links/buttons are not input-capable');
});

test('discovery never marks a non-input control (link with an inline value) prepopulated', () => {
  // A contrived link that carries an inline value must still be gated out by isInputCapableRole.
  const snapshot = `
- link "Home" [ref=e1]: "somevalue"
- text: Employee Id
- textbox "Employee Id" [ref=e12]: "0021"
`.trim();
  const inv = parseInventory(snapshot);
  const link = inv.find((i) => i.role === 'link');
  assert.ok(link, 'the link is inventoried');
  assert.equal(link!.prepopulated, false, 'a link is never prepopulated regardless of an inline value');
  const employeeId = inv.find((i) => /employee id/i.test(i.label));
  assert.equal(employeeId!.prepopulated, true, 'a real prepopulated textbox is still flagged');
});

/* ── 4. A REAL prepopulated textbox stays protected by its label ───────────────── */

test('a real prepopulated textbox is captured and protected by its label', () => {
  const snapshot = `
- text: Employee Id
- textbox "Employee Id" [ref=e12]: "0021"
- text: Nickname
- textbox [ref=e30]
`.trim();
  const fields = prepopulatedFields(snapshot, new Set());
  const empId = fields.find((f) => f.kind === 'text');
  assert.ok(empId, 'the prepopulated Employee Id text field is captured');
  assert.equal(empId!.label, 'Employee Id');
  assert.equal(empId!.value, '0021');
  assert.ok(!fields.some((f) => /nickname/i.test(f.label)), 'the empty Nickname field is not prepopulated');

  // Codegen must reject any generated artifact that touches the Employee Id field by name.
  const trace = traceFrom(snapshot);
  assert.throws(
    () => assertPrepopulatedFieldsUntouched(artWith({ spec: `await page.getByLabel('Employee Id').fill('999');` }), trace),
    /app-prepopulated field 'Employee Id' must be left untouched/,
  );
});

/* ── 5. A REAL prepopulated combobox is protected by VALUE, not by label ───────── */

test('a real prepopulated combobox is protected by its selected value, and its label stays usable', () => {
  const snapshot = `
- text: Nationality
- combobox [ref=e20]:
  - option "Indian" [selected] [ref=e21]
  - option "American" [ref=e22]
`.trim();
  const fields = prepopulatedFields(snapshot, new Set());
  const combo = fields.find((f) => f.kind === 'dropdown');
  assert.ok(combo, 'the prepopulated Nationality dropdown is captured');
  assert.equal(combo!.value, 'Indian');

  const trace = traceFrom(snapshot);
  // Re-selecting the already-chosen value is rejected (value-based protection preserved).
  assert.throws(
    () => assertPrepopulatedFieldsUntouched(artWith({ module: `await this.actions.selectOption(this.page.nationality, 'Indian');` }), trace),
    /already set to 'Indian'/,
  );
  // Merely referencing the label word as a read-only heading assertion is allowed.
  assert.doesNotThrow(
    () => assertPrepopulatedFieldsUntouched(artWith({ spec: `await expect(page.getByText('Nationality')).toBeVisible();` }), trace),
    'a dropdown label must never gate codegen the way a text-field label does',
  );
});

/* ── 6. isInputCapableRole is the single source of truth for the input gate ────── */

test('isInputCapableRole recognises only genuine input controls', () => {
  for (const role of ['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'textarea']) {
    assert.equal(isInputCapableRole(role), true, `${role} is input-capable`);
  }
  for (const role of ['heading', 'text', 'paragraph', 'link', 'button', 'img', 'tab', 'option', 'columnheader', 'navigation', 'generic']) {
    assert.equal(isInputCapableRole(role), false, `${role} is not input-capable`);
  }
});

test('a checkbox is classified as a checkbox (input-capable), an empty one is not prepopulated', () => {
  const snapshot = `
- text: Remember me
- checkbox [ref=e10]
- heading "Sign in" [level=6]
`.trim();
  const inv = parseInventory(snapshot);
  const cb = inv.find((i) => i.role === 'checkbox');
  assert.ok(cb, 'the checkbox is inventoried');
  assert.equal(cb!.type, 'checkbox');
  assert.equal(cb!.prepopulated, false, 'an unchecked checkbox is not prepopulated');
  assert.deepEqual(prepopulatedFields(snapshot, new Set()), [], 'no prepopulated values on this screen');
});

/* ── 7. A heading whose text looks like a field name is not adopted as a label ─── */

test('a heading that looks like a field name is not adopted as a control label', () => {
  const snapshot = `
- heading "Login Name" [level=6]
- combobox [ref=e20]:
  - option "Active" [selected] [ref=e21]
  - option "Inactive" [ref=e22]
`.trim();
  const fields = prepopulatedFields(snapshot, new Set());
  const combo = fields.find((f) => f.kind === 'dropdown');
  assert.ok(combo, 'the prepopulated dropdown is captured');
  assert.ok(!/login name/i.test(combo!.label), 'the "Login Name" heading must not be borrowed as the label');
  assert.match(combo!.label, /^Field\s/, 'with no genuine field label, it falls back to Field <ref>');
});

/* ── 8. Genuine label→input association still works; a heading in between does not ─ */

test('an unnamed input borrows its genuine adjacent text label, never a heading', () => {
  const snapshot = `
- text: Email
- textbox [ref=e12]: "user@example.com"
- separator
- separator
- heading "Contact" [level=6]
- textbox [ref=e30]: "555-1234"
`.trim();
  const fields = prepopulatedFields(snapshot, new Set());
  const email = fields.find((f) => f.value === 'user@example.com');
  const phone = fields.find((f) => f.value === '555-1234');
  assert.equal(email!.label, 'Email', 'a genuine adjacent text label IS associated with the input');
  assert.match(phone!.label, /^Field\s/, 'a heading is NOT adopted as the input label — falls back to Field <ref>');
});

/* ── THE regression: Sauce "Products → Add Product to Cart" must generate cleanly ─ */

test('Sauce Products → Add to Cart: the "Products" title never blocks a read-only heading assertion', () => {
  const trace = traceFrom(SAUCE_INVENTORY);

  // The sort dropdown is genuinely prepopulated and captured for value-based protection...
  const entries = prepopulatedFieldEntries(trace);
  const sort = entries.find((e) => e.kind === 'dropdown');
  assert.ok(sort, 'the prepopulated sort dropdown is captured');
  assert.equal(sort!.value, 'Name (A to Z)');

  // ...but a correct Add-to-Cart spec that uses "Products" ONLY as a read-only readiness assertion
  // and clicks "Add to cart" must NOT be rejected (this is the exact bug being fixed).
  const goodSpec = `
    await expect(page.getByText('Products')).toBeVisible();
    await productsModule.addProductToCart('Sauce Labs Backpack');
  `;
  assert.doesNotThrow(
    () => assertPrepopulatedFieldsUntouched(artWith({ spec: goodSpec }), trace),
    'using the page title "Products" as a readiness assertion must be allowed',
  );

  // A spec that re-selects the already-chosen sort value IS still rejected (protection preserved).
  const badSpec = `await this.actions.selectOption(this.page.sort, 'Name (A to Z)');`;
  assert.throws(
    () => assertPrepopulatedFieldsUntouched(artWith({ module: badSpec }), trace),
    /already set to 'Name \(A to Z\)'/,
  );
});
