import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCrawlPlan, renderCrawlPlanMarkdown } from '../crawl-planner';
import type { AgentLoopResult } from '../agent-loop';

const walk: AgentLoopResult = {
  status: 'passed',
  summary: 'Feature completed',
  steps: [
    {
      tool: 'click',
      args: { ref: 'e1' },
      locator: "page.locator('[data-test=add]')",
      interaction: {
        controlId: 'Add item',
        action: 'click',
        semanticRole: 'button',
        accessibleName: 'Add item',
        locatorEvidence: "page.locator('[data-test=add]')",
        interactionTarget: 'button "Add item" [ref=e1]',
        uniqueness: 1,
        custom: false,
        actionability: 'verified-live',
        provenByLiveTrace: true,
      },
      result: 'Page URL: https://example.test/cart',
      url: 'https://example.test/cart',
    },
    {
      tool: 'fill',
      args: { ref: 'e2', value: 'Alex' },
      locator: "page.getByRole('textbox', { name: 'First Name' })",
      result: 'filled successfully',
      url: 'https://example.test/form',
    },
  ],
  discovery: undefined,
};

test('buildCrawlPlan preserves every live step and locator evidence', () => {
  const plan = buildCrawlPlan('Example feature', 'https://example.test', [
    'https://example.test/start',
    'https://example.test/form',
  ], walk);

  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].source, 'live-browser-trace');
  assert.equal(plan.locatorEvidence.length, 2);
  assert.equal(plan.locatorEvidence[0].provenByLiveTrace, true);
  assert.deepEqual(plan.flowUrls, [
    'https://example.test/start',
    'https://example.test/form',
  ]);
});

test('renderCrawlPlanMarkdown exposes steps, locators and live evidence', () => {
  const plan = buildCrawlPlan('Example feature', 'https://example.test', [], walk);
  const md = renderCrawlPlanMarkdown(plan);
  assert.match(md, /Verified Steps/);
  assert.match(md, /Locator:/);
  assert.match(md, /verified-live/);
  assert.match(md, /Add item/);
});
