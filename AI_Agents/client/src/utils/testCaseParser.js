/**
 * testCaseParser.js — shared helpers to turn the generated test-case markdown
 * table into structured rows, and to identify automation-feasible cases.
 *
 * Automation-feasible = the "Execution Tags" column contains "automation".
 */

export function parseTestCasesFromMarkdown(raw) {
  if (!raw) return [];
  const lines = raw.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const headerCols = lines[0].split('|').map((c) => c.trim()).filter(Boolean);
  const dataLines = lines.slice(2);
  return dataLines
    .map((line) => {
      const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
      const obj = {};
      headerCols.forEach((h, i) => { obj[h] = cols[i] || ''; });
      return obj;
    })
    .filter((r) => r['SRL No.'] && /^TC[_-]/i.test(r['SRL No.']));
}

export function isAutomationFeasible(tc) {
  return (tc['Execution Tags'] || '').toLowerCase().includes('automation');
}

export function automationFeasibleCases(raw) {
  return parseTestCasesFromMarkdown(raw).filter(isAutomationFeasible);
}

// Rough complexity estimate based on number of test steps.
export function estimateComplexity(tc) {
  const steps = (tc['Test Steps'] || '').split(/\n|;|→|\d+\./).filter((s) => s.trim().length > 3);
  const n = steps.length;
  if (n <= 3) return 'Low';
  if (n <= 7) return 'Medium';
  return 'High';
}

export function primaryTag(tc) {
  return (tc['Tags'] || 'General').split(',')[0].trim() || 'General';
}
