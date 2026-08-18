/**
 * discovery.test.ts — unit tests for the exhaustive-discovery parser + completeness gate.
 * Runs with the Node built-in test runner via tsx: `npm test`.
 *
 * The fixture is a realistic OrangeHRM "Add Candidate" accessibility snapshot with all 12 controls,
 * including the tricky ones: a custom Vacancy combobox, an unnamed Email/Contact/Keywords/Date/Notes
 * input anchored to its label, a Resume file upload (Browse button → BLOCKED), a Notes textarea, a
 * Consent checkbox, and the Save action.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInventory, evaluateCompleteness } from '../discovery';

const ADD_CANDIDATE_SNAPSHOT = `
- heading "Add Candidate" [level=6]
- text: First Name*
- textbox "First Name" [ref=e12]
- text: Middle Name
- textbox "Middle Name" [ref=e13]
- text: Last Name*
- textbox "Last Name" [ref=e14]
- text: Vacancy
- combobox [ref=e20]: "-- Select --"
- text: Email*
- textbox [ref=e25]
- text: Contact Number
- textbox [ref=e28]
- text: Resume
- button "Browse" [ref=e30]
- text: Keywords
- textbox [ref=e33]
- text: Date of Application
- textbox [ref=e36]
- text: Notes
- textbox [ref=e40]
- text: Consent to keep data
- checkbox [ref=e44]
- button "Save" [ref=e48]
`.trim();

test('parseInventory captures every one of the 12 controls', () => {
  const inv = parseInventory(ADD_CANDIDATE_SNAPSHOT);
  assert.equal(inv.length, 12, `expected 12 controls, got ${inv.length}: ${inv.map((i) => i.label).join(', ')}`);
});

test('Resume upload is inventoried, blocked, non-executable — never silently omitted', () => {
  const inv = parseInventory(ADD_CANDIDATE_SNAPSHOT);
  const resume = inv.find((i) => /resume/i.test(i.label) || i.type === 'file');
  assert.ok(resume, 'Resume upload must be present in the inventory');
  assert.equal(resume!.type, 'file');
  assert.equal(resume!.executable, false);
  assert.equal(resume!.blocked, true);
  assert.equal(resume!.blockedReason, 'No approved test fixture available');
  assert.ok(resume!.locatorEvidence, 'blocked upload must still carry live locator evidence');
});

test('control types are classified correctly (combobox / textarea / checkbox / date)', () => {
  const inv = parseInventory(ADD_CANDIDATE_SNAPSHOT);
  const byLabel = (re: RegExp) => inv.find((i) => re.test(i.label));
  assert.equal(byLabel(/vacancy/i)!.type, 'combobox');
  assert.equal(byLabel(/notes/i)!.type, 'textarea');
  assert.equal(byLabel(/consent/i)!.type, 'checkbox');
  assert.equal(byLabel(/date of application/i)!.type, 'date');
  assert.equal(byLabel(/^email/i)!.type, 'textbox');
});

test('unnamed inputs are anchored to their nearest label with live evidence', () => {
  const inv = parseInventory(ADD_CANDIDATE_SNAPSHOT);
  const email = inv.find((i) => /^email/i.test(i.label));
  assert.ok(email, 'Email field resolved from its preceding label');
  assert.equal(email!.accessibleName, '', 'Email textbox has no accessible name in the snapshot');
  assert.ok(email!.locatorEvidence, 'unnamed input must carry label-anchored evidence');
});

test('required flags come from the asterisked labels', () => {
  const inv = parseInventory(ADD_CANDIDATE_SNAPSHOT);
  assert.equal(inv.find((i) => /first name/i.test(i.label))!.required, true);
  assert.equal(inv.find((i) => /last name/i.test(i.label))!.required, true);
  assert.equal(inv.find((i) => /^email/i.test(i.label))!.required, true);
  // No asterisk and no aria-required ⇒ requiredness is UNKNOWN (null), never assumed false.
  assert.equal(inv.find((i) => /middle name/i.test(i.label))!.required, null);
});

test('Save is an action, not a fillable field', () => {
  const inv = parseInventory(ADD_CANDIDATE_SNAPSHOT);
  const save = inv.find((i) => /save/i.test(i.label));
  assert.ok(save);
  assert.equal(save!.isAction, true);
});

test('evaluateCompleteness passes when the page is fully inventoried', () => {
  const inv = parseInventory(ADD_CANDIDATE_SNAPSHOT);
  const gate = evaluateCompleteness({ inventory: inv, states: [], scrolls: 2, snapshots: 3, stoppedReason: 'stable' });
  assert.equal(gate.passed, true, `unexpected gaps: ${gate.missing.join('; ')}`);
});

test('evaluateCompleteness reports a gap when scrolling never stabilised', () => {
  const inv = parseInventory(ADD_CANDIDATE_SNAPSHOT);
  const gate = evaluateCompleteness({ inventory: inv, states: [], scrolls: 12, snapshots: 30, stoppedReason: 'max-snapshots' });
  assert.equal(gate.passed, false);
  assert.ok(gate.missing.length >= 1);
});
