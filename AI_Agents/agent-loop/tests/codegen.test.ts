/**
 * codegen.test.ts — unit tests for scenario authoring, the legacy projection, and trace filtering.
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInventory } from '../discovery';
import type { DiscoveryResult } from '../discovery';
import { authorScenariosFromDiscovery, scenariosToCases, selectTraceForScenarios } from '../codegen';
import type { AgentStep } from '../agent-loop';

const SNAPSHOT = `
- heading "Add Candidate" [level=6]
- text: First Name*
- textbox "First Name" [ref=e12]
- text: Middle Name
- textbox "Middle Name" [ref=e13]
- text: Last Name*
- textbox "Last Name" [ref=e14]
- text: Email*
- textbox [ref=e25]
- text: Resume
- button "Browse" [ref=e30]
- button "Save" [ref=e48]
`.trim();

function discoveryFixture(): DiscoveryResult {
  const inventory = parseInventory(SNAPSHOT);
  return {
    applicationSummary: { application: 'OrangeHRM', feature: 'Add Candidate', entryUrl: '', finalUrl: '', pageTitle: '', headings: [], authenticated: true },
    inventory, states: [], scrolls: 1, snapshots: 1,
    stoppedReason: 'stable',
    completeness: { passed: true, checks: [], missing: [] },
  };
}

test('exhaustive positive scenario fills every executable field but excludes the blocked upload', () => {
  const disc = discoveryFixture();
  const scenarios = authorScenariosFromDiscovery({ feature: 'Add Candidate', url: 'x', maxCases: 6 }, disc, []);
  const positive = scenarios.find((s) => s.type === 'positive' && /all fields/i.test(s.title));
  assert.ok(positive, 'an all-fields positive scenario must exist');
  assert.equal(positive!.ready, true);
  // First/Middle/Last/Email = 4 executable fields; Resume (file) and Save (action) excluded.
  assert.equal(positive!.coverage.fieldLabels.length, 4);
  assert.ok(!positive!.coverage.fieldLabels.some((l) => /resume/i.test(l)), 'the blocked upload is never a scenario field');
  // The Save action should still appear as the final step.
  assert.ok(positive!.steps.some((st) => /save/i.test(st.action)));
});

test('a required-only positive scenario is offered when required is a strict subset', () => {
  const disc = discoveryFixture();
  const scenarios = authorScenariosFromDiscovery({ feature: 'Add Candidate', url: 'x', maxCases: 6 }, disc, []);
  const reqOnly = scenarios.find((s) => s.type === 'positive' && /required/i.test(s.title));
  assert.ok(reqOnly, 'a required-only scenario must be offered');
  assert.equal(reqOnly!.coverage.fieldLabels.length, 3); // First, Last, Email
});

test('negative scenarios are surfaced but marked blocked (no live validation evidence)', () => {
  const disc = discoveryFixture();
  const scenarios = authorScenariosFromDiscovery({ feature: 'Add Candidate', url: 'x', maxCases: 6 }, disc, []);
  const negatives = scenarios.filter((s) => s.type === 'negative');
  assert.ok(negatives.length >= 1);
  for (const n of negatives) {
    assert.equal(n.ready, false);
    assert.equal(n.blocked, true);
    assert.ok(n.blockedReason && n.blockedReason.length > 0);
  }
});

test('scenariosToCases projects a legacy PlanCase list with numbered steps', () => {
  const disc = discoveryFixture();
  const scenarios = authorScenariosFromDiscovery({ feature: 'Add Candidate', url: 'x', maxCases: 6 }, disc, []);
  const cases = scenariosToCases(scenarios);
  assert.equal(cases.length, scenarios.length);
  assert.ok(cases[0].steps.every((s) => /^\d+\./.test(s)), 'steps are numbered');
});

test('selectTraceForScenarios keeps login + selected fields, drops unselected fields', () => {
  const disc = discoveryFixture();
  const scenarios = authorScenariosFromDiscovery({ feature: 'Add Candidate', url: 'x', maxCases: 6 }, disc, []);
  const reqOnly = scenarios.find((s) => /required/i.test(s.title))!;

  const trace: AgentStep[] = [
    { tool: 'fill', args: { ref: 'e1', value: '{{USERNAME}}' }, scopeHint: { label: 'Username' } as any, result: '' },
    { tool: 'fill', args: { ref: 'e2', value: '{{PASSWORD}}' }, scopeHint: { label: 'Password' } as any, result: '' },
    { tool: 'fill', args: { ref: 'e12', value: 'John' }, scopeHint: { label: 'First Name' } as any, result: '' },
    { tool: 'fill', args: { ref: 'e13', value: 'Q' }, scopeHint: { label: 'Middle Name' } as any, result: '' },
    { tool: 'fill', args: { ref: 'e14', value: 'Doe' }, scopeHint: { label: 'Last Name' } as any, result: '' },
    { tool: 'fill', args: { ref: 'e25', value: 'j@x.com' }, scopeHint: { label: 'Email' } as any, result: '' },
    { tool: 'click', args: { ref: 'e48' }, result: '' },
  ];

  const { trace: filtered, coverageLabels } = selectTraceForScenarios(trace, scenarios, [reqOnly.id]);
  const labels = filtered.filter((s) => s.tool === 'fill').map((s) => (s.scopeHint as any)?.label);
  assert.ok(labels.includes('Username') && labels.includes('Password'), 'credential fills are always kept');
  assert.ok(labels.includes('First Name') && labels.includes('Last Name') && labels.includes('Email'), 'selected required fields kept');
  assert.ok(!labels.includes('Middle Name'), 'the unselected optional field is dropped');
  assert.ok(filtered.some((s) => s.tool === 'click'), 'the Save click is kept');
  assert.ok(coverageLabels.length === 3);
});

test('no selection (legacy) returns the full trace unchanged', () => {
  const disc = discoveryFixture();
  const scenarios = authorScenariosFromDiscovery({ feature: 'Add Candidate', url: 'x', maxCases: 6 }, disc, []);
  const trace: AgentStep[] = [{ tool: 'fill', args: { ref: 'e12', value: 'John' }, result: '' }];
  const { trace: out, coverageLabels } = selectTraceForScenarios(trace, scenarios, []);
  assert.equal(out.length, 1);
  assert.equal(coverageLabels.length, 0);
});
