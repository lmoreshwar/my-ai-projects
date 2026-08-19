/**
 * crawl-planner.ts
 *
 * Converts the verified live-browser trace produced by the Playwright CLI agent
 * into a durable, human-readable and codegen-friendly crawl plan.
 *
 * The browser is the source of truth: every actionable step and locator comes
 * from the live AgentStep/InteractionEvidence captured during the crawl.
 * This module is deterministic; it does not call an LLM.
 */

import { writeFileSync } from 'node:fs';
import { AgentStep, type AgentLoopResult } from './agent-loop';

export interface CrawlPlanStep {
  order: number;
  action: string;
  description: string;
  url?: string;
  args: Record<string, unknown>;
  locator?: string;
  interaction?: AgentStep['interaction'];
  observedResult: string;
  source: 'live-browser-trace';
}

export interface CrawlPlan {
  version: 1;
  feature: string;
  startUrl: string;
  flowUrls: string[];
  status: AgentLoopResult['status'];
  summary: string;
  featureBoundary?: AgentLoopResult['featureBoundary'];
  prerequisites: Array<{ url: string; reason: string }>;
  steps: CrawlPlanStep[];
  locatorEvidence: Array<{
    order: number;
    action: string;
    locator: string;
    controlId?: string;
    semanticRole?: string;
    accessibleName?: string;
    provenByLiveTrace: boolean;
  }>;
  discovery: AgentLoopResult['discovery'];
}

export function buildCrawlPlan(
  feature: string,
  startUrl: string,
  flowUrls: string[],
  walk: AgentLoopResult,
): CrawlPlan {
  const steps: CrawlPlanStep[] = walk.steps.map((step, index) => ({
    order: index + 1,
    action: step.tool,
    description: describeStep(step),
    url: step.url,
    args: step.args,
    locator: step.locator,
    interaction: step.interaction,
    observedResult: step.result,
    source: 'live-browser-trace',
  }));

  const locatorEvidence = steps
    .filter((step) => step.locator || step.interaction?.locatorEvidence)
    .map((step) => ({
      order: step.order,
      action: step.action,
      locator: step.interaction?.locatorEvidence || step.locator || '',
      controlId: step.interaction?.controlId,
      semanticRole: step.interaction?.semanticRole,
      accessibleName: step.interaction?.accessibleName,
      provenByLiveTrace: step.interaction?.provenByLiveTrace === true,
    }));

  const prerequisites = flowUrls.length > 1
    ? flowUrls.slice(0, -1).map((url) => ({ url, reason: 'User-supplied prerequisite/flow URL' }))
    : [];

  return {
    version: 1,
    feature,
    startUrl,
    flowUrls,
    status: walk.status,
    summary: walk.summary,
    featureBoundary: walk.featureBoundary,
    prerequisites,
    steps,
    locatorEvidence,
    discovery: walk.discovery,
  };
}

export function renderCrawlPlanMarkdown(plan: CrawlPlan): string {
  const lines: string[] = [
    `# ${plan.feature} — Live Crawl Test Plan`,
    '',
    '## Crawl Contract',
    `- Start URL: ${plan.startUrl}`,
    `- Status: ${plan.status}`,
    `- Summary: ${plan.summary}`,
    `- Evidence source: live browser trace`,
    '',
  ];

  if (plan.flowUrls.length) {
    lines.push('## Requested Flow URLs', '');
    for (const url of plan.flowUrls) lines.push(`- ${url}`);
    lines.push('');
  }

  lines.push('## Verified Steps', '');
  for (const step of plan.steps) {
    lines.push(`${step.order}. **${step.action}** — ${step.description}`);
    if (step.url) lines.push(`   - URL: ${step.url}`);
    if (step.locator || step.interaction?.locatorEvidence) {
      lines.push(`   - Locator: \`${step.interaction?.locatorEvidence || step.locator}\``);
    }
    if (step.interaction) {
      lines.push(`   - Control: ${step.interaction.controlId} (${step.interaction.semanticRole}${step.interaction.accessibleName ? `, "${step.interaction.accessibleName}"` : ''})`);
      lines.push('   - Locator status: verified-live');
    }
    if (step.observedResult) lines.push(`   - Observed result: ${compact(step.observedResult)}`);
  }

  lines.push('', '## Locator Evidence', '');
  for (const evidence of plan.locatorEvidence) {
    lines.push(`- Step ${evidence.order}: ${evidence.action} → \`${evidence.locator}\` (verified-live=${evidence.provenByLiveTrace})`);
  }

  if (plan.featureBoundary) {
    lines.push('', '## Feature Boundary', '', `- Acceptance verified: ${plan.featureBoundary.acceptanceVerified}`, `- Reason: ${plan.featureBoundary.reason}`);
  }

  return `${lines.join('\n')}\n`;
}

export function writeCrawlPlan(outputDir: string, plan: CrawlPlan): { jsonFile: string; markdownFile: string } {
  const { join } = require('node:path') as typeof import('node:path');
  const jsonFile = join(outputDir, 'blast-crawl-plan.json');
  const markdownFile = join(outputDir, 'blast-crawl-plan.md');
  writeFileSync(jsonFile, JSON.stringify(plan, null, 2));
  writeFileSync(markdownFile, renderCrawlPlanMarkdown(plan));
  return { jsonFile, markdownFile };
}

function describeStep(step: AgentStep): string {
  const value = step.args?.value ?? step.args?.text ?? step.args?.url ?? '';
  if (value) return `${step.tool} ${String(value)}`;
  return step.tool;
}

function compact(text: string): string {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
}
