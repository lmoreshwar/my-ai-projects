import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import * as XLSX from 'xlsx';

/* ── Parse markdown table → array of row-objects ── */
function parseMarkdownTable(md) {
  if (!md) return [];
  const lines = md.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 3) return [];
  const split = (line) =>
    line.split('|').slice(1, -1).map((c) => c.trim());
  const headers = split(lines[0]);
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = split(lines[i]);
    if (!cells.length || cells.every((c) => !c || /^-+$/.test(c))) continue;
    const row = {};
    headers.forEach((h, idx) => (row[h] = cells[idx] || ''));
    rows.push(row);
  }
  return rows;
}

/* ── Deterministic Coverage Engine (client-side, no LLM dependency) ── */
const STOP_WORDS = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','must','need','of','in','to','for','with','on','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','each','every','all','both','few','more','most','other','some','such','no','not','only','own','same','so','than','too','very','just','that','this','these','those','which','what','when','where','who','whom','whose','why','how','and','but','or','nor','if','then','else','because','since','while','although','though']);

/* ── Industry-Standard Non-Testable Patterns (IEEE 829 / ISO 29119) ──
   These patterns identify meta/process items that are NOT testable requirements.
   IMPORTANT: The bare-feature-name check is in isTestableRequirement() AFTER
   the action verb check, so legitimate requirements with verbs are never filtered.
*/
const NON_TESTABLE_PATTERNS = [
  // Project management / process
  /\b(roles?\s+and\s+responsibilities|team\s+members?|test\s+lead|stakeholders?)\b/i,
  /\b(schedule|milestones?|start\s+and\s+end\s+dates?|planned\s+activities)\b/i,
  /\b(tools?\s+and\s+equipment|documentation\s+templates?|testing\s+software)\b/i,
  /\b(criteria\s+.*used\s+to\s+evaluate|success\s+.*criteria|number\s+of\s+defects\s+found)\b/i,
  /\b(time\s+taken\s+to\s+complete|user\s+satisfaction\s+ratings?)\b/i,
  // Environment / infrastructure descriptions
  /\b(operating\s+systems?\s+and\s+versions?|browsers?\s+and\s+versions?)\b/i,
  /\b(device\s+types?\s+and\s+screen\s+sizes?|network\s+connectivity\s+and\s+bandwidth)\b/i,
  /\b(hardware\s+and\s+software\s+requirements|processor|memory|storage\s+capacity)\b/i,
  /\b(security\s+protocols?\s+and\s+authentication|passwords?,?\s*tokens?,?\s*or\s+certificates)\b/i,
  /\b(access\s+permissions?\s+and\s+roles?)\b/i,
  /\b(wi-?fi|cellular|wired\s+connections?)\b/i,
  // Meta-descriptions of testing types
  /^the\s+(types?\s+of\s+testing|features?\s+and\s+functionality|environments?)\b/i,
  /^the\s+(criteria|roles?|schedule|tools?)\b/i,
  // Section headers / boilerplate
  /\bthis\s+section\s+would\b/i,
  /\bprovide\s+an?\s+overview\b/i,
  /\bincluding\s+its\s+purpose,?\s*scope/i,
  // Environment URLs
  /^(name\s+env\s+url|qa\s|pre\s?prod|uat\s|prod\s)/i,
  /^(qa\..*\.com|preprod\..*\.com|uat\..*\.com|app\..*\.com)/i,
  // User story wrappers
  /^(as\s+a[n]?\s+.{3,}?,\s*i\s+want\s+to)\b/i,
  /^description\s+(as\s+a)/i,
  // Feature list headers / section labels
  /^this\s+(feature|module|section|system)\s+(includes?|contains?|covers?)\s*:?\s*$/i,
  /^(acceptance\s+criteria|test\s+criteria|requirements?)\s*[\p{Emoji}\p{Emoji_Presentation}🔐🔒🔑📝📋✅❌⚠️💡]*\s*\d*\s*$/iu,
  /^(features?|modules?|components?|sections?)\s*:?\s*$/i,
  // NOTE: Bare feature name check moved to isTestableRequirement() — runs AFTER action verb check
];

/* Verbs that indicate a testable behavioral requirement.
   IMPORTANT: Only include words that are UNAMBIGUOUSLY verbs in testing context.
   Excluded: "process" (noun in "Checkout process"), "access" (noun in "User access"),
   "support" (noun in "Payment support"), "return" ("Return policy" vs "return value")
*/
const ACTION_VERB_RE = /\b(should|must|shall|can|will|able\s+to|verify|validate|ensure|check|display(ed|s)?|show[ns]?|allow(ed|s)?|enable[ds]?|disable[ds]?|redirect(ed|s)?|persist[s]?|login|logout|log\s*in|log\s*out|navigate[ds]?|click(ed|s)?|enter(ed|s)?|submit(ted|s)?|select(ed|s)?|upload(ed|s)?|download(ed|s)?|delete[ds]?|remov(e[ds]?|ing)|add(ed|s)?|updat(e[ds]?|ing)|creat(e[ds]?|ing)|send[s]?|receiv(e[ds]?|ing)|generat(e[ds]?|ing)|load[s]?|fetch(ed|es)?|handl(e[ds]?|ing)|trigger[s]?|confirm(ed|s)?|notif(y|ies|ied)|prevent[s]?|accept[s]?|reject[s]?|block[s]?|authenticat(e[ds]?|ing)|authoriz(e[ds]?|ing))\b/i;

/* ── Is this line a testable requirement? ── */
function isTestableRequirement(text) {
  if (!text || text.trim().length < 8) return false;
  const trimmed = text.trim();
  // 1. Check against NON_TESTABLE_PATTERNS (project mgmt, env, headers, etc.)
  for (const pattern of NON_TESTABLE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }
  // 2. Filter environment URLs
  if (/^[a-z]+\.[a-z]+\.[a-z]+$/i.test(trimmed)) return false;
  // 3. Check for action verbs FIRST — if it has a verb, it's likely testable
  const hasActionVerb = ACTION_VERB_RE.test(trimmed);
  // 4. Bare feature labels (≤6 words, NO action verb) → not testable
  //    "Cart management", "Payment integration" → filtered
  //    "Error message displayed for invalid credentials" → has verb "displayed" → KEPT
  const words = trimmed.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 6 && !hasActionVerb) return false;
  // 5. Minimum keyword depth (avoid single-word or too vague items)
  const keywords = extractKeywords(text);
  if (keywords.length < 2) return false;
  return true;
}

/* ── Extract testable requirements from user input ──
   IEEE 29119 approach: Split input into individual lines/items, then filter.
   Handles: bullet points, numbered items, parent-child colon patterns, etc.

   Parent-child pattern detection:
   "User should be able to:"    ← parent prefix (ends with colon)
   "  Increase quantity"        ← child item
   "  Decrease quantity"        ← child item
   Result: "User should be able to Increase quantity", "User should be able to Decrease quantity"
*/
function extractRequirements(reqText) {
  if (!reqText || !reqText.trim()) return [];
  // Split into individual lines
  const rawLines = reqText.replace(/\r\n/g, '\n')
    .split('\n')
    .map(s => s
      .replace(/^[\s\u200B\u00A0]*[\p{Emoji}\p{Emoji_Presentation}🔐🔒🔑📝📋✅❌⚠️💡⭐🎯📌]+[\s.]*/gu, '')  // strip emoji prefixes
      .replace(/^[-•*]+\s*/, '')       // strip bullet markers
      .replace(/^\d+[.)]\s*/, '')      // strip numbering (1. 2) etc.)
      .replace(/^[A-Z]\.\s+/, '')      // strip letter numbering (A. B. etc.)
      .trim()
    )
    .filter(s => s.length > 0);

  // ── Phase 1: Resolve parent-child colon patterns ──
  // If a line ends with ":" and is followed by short items (≤5 words), combine them.
  // "User should be able to:" + "Increase quantity" → "User should be able to Increase quantity"
  const resolved = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    const endsWithColon = /:\s*$/.test(line);

    if (endsWithColon && line.length > 5) {
      const prefix = line.replace(/:\s*$/, '').trim();
      // Collect following short lines as children (until we hit a long line or another colon line)
      const children = [];
      let j = i + 1;
      while (j < rawLines.length) {
        const child = rawLines[j];
        const childWords = child.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(w => w.length > 0);
        // Stop collecting children if: line is long (>6 words), ends with colon, or is clearly a new section
        if (childWords.length > 6 || /:\s*$/.test(child)) break;
        if (child.length > 5) children.push(child);
        j++;
      }
      if (children.length > 0) {
        // Combine parent prefix with each child
        children.forEach(child => {
          resolved.push(`${prefix} ${child}`);
        });
        i = j; // skip past all children
      } else {
        // No children found — include the colon line as-is (will be filtered later)
        resolved.push(line);
        i++;
      }
    } else {
      resolved.push(line);
      i++;
    }
  }

  // ── Phase 2: Filter to testable requirements ──
  const testable = resolved.filter(s => s.length > 5).filter(isTestableRequirement);

  // Fallback: if nothing passes, try comma-separated or sentence splitting
  if (testable.length === 0 && reqText.includes(',')) {
    const commaSplit = reqText.split(/,\s*/).map(s => s.trim()).filter(s => s.length > 5);
    const commaTestable = commaSplit.filter(isTestableRequirement);
    if (commaTestable.length > 0) return commaTestable;
  }
  if (testable.length === 0) {
    const sentences = reqText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5);
    const sentTestable = sentences.filter(isTestableRequirement);
    if (sentTestable.length > 0) return sentTestable;
  }
  return testable.length > 0 ? testable : [reqText.trim()];
}

function extractKeywords(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/* ── Keyword Precision Scoring (Industry-Standard for RTM) ──
   Measures: what fraction of the REQUIREMENT's keywords appear in the TC?
   This is the standard metric used in automated RTM tools (HP ALM, Xray, etc.)

   Why PRECISION, not F1?
   - F1 penalizes TCs for having extra vocabulary (e.g., "verify", "registered",
     "authentication") which are standard testing terms — not irrelevant noise.
   - TC_001 "Successful Login with Valid Credentials" scores F1=0.47 (WRONG: Partial)
     but Precision=0.80 (CORRECT: Full) against "login with valid credentials".
   - Precision answers the right question: "Does this TC cover the requirement?"
*/
function calcSimilarity(reqKeywords, tcKeywords) {
  if (reqKeywords.length === 0 || tcKeywords.length === 0) return 0;
  const tcSet = new Set(tcKeywords);
  const reqUnique = [...new Set(reqKeywords)];
  let matches = 0;
  for (const kw of reqUnique) {
    if (tcSet.has(kw)) { matches++; continue; }
    // Stem matching: "remove" ↔ "removed", "persist" ↔ "persists"
    for (const tkw of tcSet) {
      if (kw.length >= 4 && tkw.length >= 4 && (tkw.startsWith(kw.slice(0, -1)) || kw.startsWith(tkw.slice(0, -1)))) {
        matches += 0.8;
        break;
      }
    }
  }
  return matches / reqUnique.length; // Precision: 0.0 to 1.0
}

/* ── Coverage Calculation (IEEE 29119 / ISTQB Standard RTM) ──
   Industry approach: Match requirements against TC Title + Description + Tags ONLY.
   Steps/Expected Results are excluded because they contain prerequisite actions
   (e.g., "Log in with valid credentials" as a setup step) that falsely inflate matches.

   Thresholds (aligned with industry automated traceability tools):
   - Full Coverage:    precision ≥ 0.50 (50%+ of requirement keywords found in TC)
   - Partial Coverage: precision 0.25–0.49
   - No Coverage:      precision < 0.25
*/
function computeCoverage(requirements, testCases) {
  const tcData = testCases.map((tc, i) => {
    const id = tc['SRL No.'] || `TC_${String(i + 1).padStart(3, '0')}`;
    const title = tc['Test Case Title'] || tc['Description'] || '';
    const desc = tc['Description'] || '';
    const tags = tc['Tags'] || '';
    // ONLY Title + Description + Tags — the semantic identity of what the TC tests
    const keywords = extractKeywords(`${title} ${desc} ${tags}`);
    return { id, title, keywords };
  });

  const traceability = requirements.map((req, i) => {
    const reqKw = extractKeywords(req);
    let bestScore = 0;
    let bestTcIds = [];

    for (const tc of tcData) {
      const score = calcSimilarity(reqKw, tc.keywords);
      if (score >= 0.25) bestTcIds.push(tc.id);  // List TCs at Partial threshold or above
      if (score > bestScore) bestScore = score;
    }

    let coverage;
    if (bestScore >= 0.50) coverage = 'Full';
    else if (bestScore >= 0.25) coverage = 'Partial';
    else coverage = 'None';

    return {
      id: `R${i + 1}`,
      requirement: req,
      coverage,
      score: Math.round(bestScore * 100),
      testCaseIds: bestTcIds,
      comments: coverage === 'Full' ? 'Well covered' : coverage === 'Partial' ? 'Partially addressed' : 'No matching test case found'
    };
  });

  const total = traceability.length;
  const full = traceability.filter(r => r.coverage === 'Full').length;
  const partial = traceability.filter(r => r.coverage === 'Partial').length;
  const none = traceability.filter(r => r.coverage === 'None').length;
  const pct = total > 0 ? Math.round((full + 0.5 * partial) / total * 100) : 0;

  return { traceability, total, full, partial, none, pct };
}

/* ── Coverage Analysis System Prompt (qualitative analysis only) ── */
const COVERAGE_PROMPT = `You are a **Senior QA Lead / Test Architect**. You will receive requirements and test cases along with a pre-calculated coverage percentage.

## ANTI-HALLUCINATION SCOPE RULE
The coverage engine has already filtered out non-testable items (user story wrappers, feature labels without acceptance criteria, section headers, etc.) per IEEE 829 / ISO 29119 standards. 
- Do NOT flag features that lack acceptance criteria as "gaps" — they are correctly excluded from the coverage denominator.
- Only assess gap analysis against the TESTABLE requirements that appear in the traceability matrix.
- If the pre-calculated coverage is high (>80%) but many features were excluded due to missing criteria, note this as a strategic observation — NOT as a gap.

## TASK
Provide QUALITATIVE analysis only. The coverage percentage is already calculated — DO NOT recalculate it. Focus on:
1. Gap Analysis — what test design techniques (BVA, EP, Negative, Security) are missing for COVERED requirements
2. Quality Issues — weak or vague test cases
3. Duplicate detection
4. Strategic insights and recommendations

## OUTPUT FORMAT (STRICT JSON — no markdown, no code fences)
Return ONLY valid JSON:
{
  "gapAnalysis": [
    {"gapId": "G1", "missingScenario": "...", "impact": "...", "severity": "High|Medium|Low"}
  ],
  "qualityIssues": [
    {"issueId": "Q1", "testCaseId": "TC_001", "issue": "...", "recommendation": "..."}
  ],
  "duplicates": [
    {"group": 1, "testCaseIds": ["TC_001", "TC_002"], "recommendation": "merge into one"}
  ],
  "insights": "2-3 sentences of strategic analysis about what the test suite covers well and where it falls short...",
  "strengths": ["strength 1", "strength 2"],
  "gaps": ["gap 1", "gap 2"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "negativeStatus": "Optimized|Partially Covered|High Risk",
  "edgeCaseStatus": "Optimized|Partially Covered|High Risk"
}

## RULES
- DO NOT include overallCoverage or requirementTraceability — those are pre-calculated
- Focus on actionable gaps and quality feedback for IN-SCOPE requirements only
- Do NOT hallucinate gaps for features without documented acceptance criteria
- Return ONLY the JSON object`;

export default function ReviewTestCases({ connections, apiBase, generatedTestCases, onNavigate, reviewCoverage, setReviewCoverage }) {
  /* ── State ── */
  const [testCases, setTestCases] = useState('');
  const [parsedCases, setParsedCases] = useState([]);
  const [ticketId, setTicketId] = useState('');
  const [manualReq, setManualReq] = useState('');
  const [issueData, setIssueData] = useState(null);
  const [fetchingJira, setFetchingJira] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const coverage = reviewCoverage;
  const setCoverage = setReviewCoverage;
  const [manualExpanded, setManualExpanded] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [riskExpanded, setRiskExpanded] = useState(false);
  const itemsPerPage = 10;
  const carouselRef = useRef(null);

  // Determine which input method is active (for mutual exclusion)
  const activeInputMethod = ticketId.trim() || issueData ? 'jira' : manualReq.trim() ? 'upload' : null;

  /* Auto-load test cases */
  useEffect(() => {
    if (generatedTestCases && generatedTestCases.trim()) {
      setTestCases(generatedTestCases);
      setParsedCases(parseMarkdownTable(generatedTestCases));
    }
  }, [generatedTestCases]);

  /* ── Fetch JIRA ── */
  const fetchJira = async () => {
    if (!ticketId.trim()) return;
    if (connections.jira.status !== 'connected') return alert('Connect to JIRA first in Settings');
    setFetchingJira(true);
    try {
      const r = await fetch(`${apiBase}/fetch-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jira: connections.jira, productName: '', projectKey: ticketId.split('-')[0], sprint: ticketId, context: '' }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || 'Fetch failed');
      setIssueData(await r.json());
    } catch (e) {
      alert(e.message);
    }
    setFetchingJira(false);
  };

  /* ── Build requirement context ── */
  const buildReqContext = useCallback(() => {
    let ctx = '';
    if (issueData) ctx += `## JIRA REQUIREMENT\n- ID: ${issueData.id}\n- Summary: ${issueData.summary}\n- Description:\n${issueData.description}\n\n`;
    if (manualReq.trim()) ctx += `## MANUAL REQUIREMENT\n${manualReq}\n\n`;
    return ctx;
  }, [issueData, manualReq]);

  const hasReq = !!issueData || manualReq.trim().length > 0;
  const hasTests = parsedCases.length > 0 || testCases.trim().length > 0;

  /* ── Run Coverage Analysis ── */
  const runAnalysis = async () => {
    if (!hasReq) return alert('Provide requirements (JIRA or manual) to compare against');
    if (!hasTests) return alert('No test cases found. Generate test cases first.');
    if (connections.llm.status !== 'connected') return alert('Connect LLM first in Settings');
    setAnalyzing(true);
    setCoverage(null);
    try {
      const reqCtx = buildReqContext();

      // ── STEP 1: Deterministic client-side coverage calculation ──
      const reqText = issueData
        ? `${issueData.summary || ''}\n${issueData.description || ''}`
        : manualReq;
      
      // Extract all lines (for logging), then filter to testable only
      const allLines = reqText.replace(/\r\n/g, '\n').split('\n')
        .map(s => s.trim()).filter(s => s.length > 5);
      const requirements = extractRequirements(reqText);
      
      const cvg = computeCoverage(requirements, parsedCases);

      // Build structured test case summary for LLM qualitative analysis
      let tcSummary = '';
      if (parsedCases.length > 0) {
        tcSummary = '## TEST CASE SUMMARY\n';
        parsedCases.forEach((tc, i) => {
          const id = tc['SRL No.'] || `TC_${String(i + 1).padStart(3, '0')}`;
          const title = tc['Test Case Title'] || tc['Description'] || 'Untitled';
          const type = tc['Test Case Type'] || 'Functional';
          tcSummary += `- **${id}**: ${title} [${type}]\n`;
        });
        tcSummary += '\n';
      }

      // ── STEP 2: Call LLM for qualitative analysis only ──
      let llmData = {};
      try {
        const res = await fetch(`${apiBase}/generate-plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            issueData: {
              product: 'Coverage Analysis',
              id: 'COVERAGE',
              summary: 'Test Case Coverage Analysis',
              description: `## REQUIREMENTS\n${reqCtx}\n\n${tcSummary}\n## PRE-CALCULATED COVERAGE: ${cvg.pct}% (${cvg.full} Full, ${cvg.partial} Partial, ${cvg.none} None out of ${cvg.total} requirements)\n\nProvide qualitative analysis only.`,
              additional_context: COVERAGE_PROMPT,
            },
            llm: connections.llm,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const jsonMatch = data.plan.match(/\{[\s\S]*\}/);
          if (jsonMatch) llmData = JSON.parse(jsonMatch[0]);
        }
      } catch (llmErr) {
        console.warn('[Coverage] LLM qualitative analysis failed, using client-side only:', llmErr.message);
      }

      // ── STEP 3: Merge deterministic coverage + LLM qualitative analysis ──
      const statusFromPct = (pct) => pct > 80 ? 'Optimized' : pct > 40 ? 'Partially Covered' : 'High Risk';
      const mappedCount = cvg.full + cvg.partial;

      const result = {
        // Deterministic values (ALWAYS from client-side engine)
        overallCoverage: cvg.pct,
        requirementTraceability: cvg.traceability,
        coverageCalculation: {
          totalRequirements: cvg.total,
          fullyCovered: cvg.full,
          partiallyCovered: cvg.partial,
          notCovered: cvg.none,
          testCasesAnalyzed: parsedCases.length,
          formula: `(${cvg.full} + 0.5×${cvg.partial}) / ${cvg.total} × 100 = ${cvg.pct}%`
        },
        functionalStatus: statusFromPct(cvg.pct),
        mappedFunctional: [mappedCount, cvg.total],
        mappedNonFunctional: [0, 0],
        // Qualitative values (from LLM, with defaults)
        negativeStatus: llmData.negativeStatus || statusFromPct(cvg.pct),
        edgeCaseStatus: llmData.edgeCaseStatus || statusFromPct(cvg.pct),
        gapAnalysis: llmData.gapAnalysis || cvg.traceability
          .filter(r => r.coverage === 'None')
          .map((r, i) => ({ gapId: `G${i + 1}`, missingScenario: r.requirement, impact: 'Untested requirement', severity: 'High' })),
        qualityIssues: llmData.qualityIssues || [],
        duplicates: llmData.duplicates || [],
        insights: llmData.insights || `Coverage analysis: ${cvg.full} requirements fully covered, ${cvg.partial} partially covered, ${cvg.none} not covered out of ${cvg.total} total requirements.`,
        strengths: llmData.strengths || (cvg.full > 0 ? [`${cvg.full} requirement(s) fully covered by test cases`] : []),
        gaps: llmData.gaps || cvg.traceability.filter(r => r.coverage === 'None').map(r => r.requirement),
        recommendations: llmData.recommendations || (cvg.none > 0 ? [`Add test cases for ${cvg.none} uncovered requirement(s)`] : ['Test coverage is adequate']),
      };

      setCoverage(result);
    } catch (e) {
      alert(e.message);
    }
    setAnalyzing(false);
  };

  /* ── Export Review .md ── */
  const exportReviewMd = () => {
    if (!coverage) return alert('Run analysis first');
    let content = `# Test Case Review & Coverage Report\n\n## Overall Coverage: ${coverage.overallCoverage}%\n\n`;
    if (coverage.coverageCalculation) {
      content += `## Coverage Calculation\n- Total Requirements: ${coverage.coverageCalculation.totalRequirements}\n- Fully Covered: ${coverage.coverageCalculation.fullyCovered}\n- Partially Covered: ${coverage.coverageCalculation.partiallyCovered}\n- Not Covered: ${coverage.coverageCalculation.notCovered}\n- Formula: ${coverage.coverageCalculation.formula}\n\n`;
    }
    content += `## Functional Status: ${coverage.functionalStatus}\n## Negative Scenarios: ${coverage.negativeStatus}\n## Edge Cases: ${coverage.edgeCaseStatus}\n\n`;
    content += `## Mapped Requirements\n- Functional: ${coverage.mappedFunctional?.[0]}/${coverage.mappedFunctional?.[1]}\n- Non-Functional: ${coverage.mappedNonFunctional?.[0]}/${coverage.mappedNonFunctional?.[1]}\n\n`;
    if (coverage.requirementTraceability && coverage.requirementTraceability.length > 0) {
      content += `## Requirement Traceability Matrix\n\n| Req ID | Requirement | Coverage | Test Cases | Comments |\n|--------|-------------|----------|------------|----------|\n`;
      coverage.requirementTraceability.forEach(r => {
        content += `| ${r.id} | ${r.requirement} | ${r.coverage} | ${(r.testCaseIds || []).join(', ')} | ${r.comments || ''} |\n`;
      });
      content += '\n';
    }
    if (coverage.gapAnalysis && coverage.gapAnalysis.length > 0) {
      content += `## Gap Analysis\n\n| Gap ID | Missing Scenario | Impact | Severity |\n|--------|------------------|--------|----------|\n`;
      coverage.gapAnalysis.forEach(g => {
        content += `| ${g.gapId} | ${g.missingScenario} | ${g.impact} | ${g.severity} |\n`;
      });
      content += '\n';
    }
    if (coverage.qualityIssues && coverage.qualityIssues.length > 0) {
      content += `## Quality Issues\n\n| Issue ID | Test Case | Issue | Recommendation |\n|----------|-----------|-------|----------------|\n`;
      coverage.qualityIssues.forEach(q => {
        content += `| ${q.issueId} | ${q.testCaseId} | ${q.issue} | ${q.recommendation} |\n`;
      });
      content += '\n';
    }
    content += `## AI Insights\n${coverage.insights}\n\n## Strengths\n${(coverage.strengths || []).map(s => '- ' + s).join('\n')}\n\n## Gaps\n${(coverage.gaps || []).map(g => '- ' + g).join('\n')}\n\n## Recommendations\n${(coverage.recommendations || []).map(r => '- ' + r).join('\n')}\n\n---\n\n`;

    // Rebuild Test Cases section from parsedCases (reflects removals)
    // Preserve non-table content (OUT OF SCOPE, SELF-VALIDATION, etc.) from original
    const tableLineIdx = testCases.split('\n').findIndex(l => l.trim().startsWith('| SRL') || l.trim().startsWith('| TC'));
    const nonTablePart = tableLineIdx > 0 ? testCases.split('\n').slice(0, tableLineIdx).join('\n').trim() : '';
    content += `## Test Cases\n`;
    if (nonTablePart) content += nonTablePart + '\n\n';
    if (parsedCases.length > 0) {
      const headers = Object.keys(parsedCases[0]);
      content += '| ' + headers.join(' | ') + ' |\n';
      content += '|' + headers.map(() => '---').join('|') + '|\n';
      parsedCases.forEach(tc => {
        content += '| ' + headers.map(h => (tc[h] || '').replace(/\|/g, '\\|')).join(' | ') + ' |\n';
      });
    }
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Coverage_Review_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── Export Trace Matrix Excel ── */
  const exportTraceMatrix = () => {
    if (!parsedCases.length) return alert('No test case table data found');
    const rows = parsedCases.map((tc, i) => ({
      'TC ID': tc['SRL No.'] || `TC_${String(i + 1).padStart(3, '0')}`,
      'Test Case Title': tc['Test Case Title'] || '',
      'Type': tc['Test Case Type'] || '',
      'Tags': tc['Tags'] || '',
      'Execution Tags': tc['Execution Tags'] || '',
      'Requirement Source': issueData?.id || 'Manual',
      'Coverage Status': coverage ? 'Analyzed' : 'Pending',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0]).map((k) => ({ wch: Math.min(Math.max(k.length + 2, 14), 45) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Trace Matrix');
    XLSX.writeFile(wb, `TraceMatrix_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  /* ── SVG Gauge ── */
  const CoverageGauge = ({ pct }) => {
    const r = 88;
    const circ = 2 * Math.PI * r;
    const offset = circ - (pct / 100) * circ;
    return (
      <div className="relative w-48 h-48 flex items-center justify-center mx-auto">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 192 192">
          <circle cx="96" cy="96" r={r} fill="transparent" stroke="#e7e0eb" strokeWidth="12" />
          <circle cx="96" cy="96" r={r} fill="transparent" stroke="#e60012" strokeWidth="12"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" className="transition-all duration-1000 ease-out" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-black text-on-surface dark:text-white">{pct}%</span>
          <span className="text-xs font-bold text-secondary uppercase tracking-tighter">Overall Coverage</span>
        </div>
      </div>
    );
  };

  const ic = 'w-full bg-white dark:bg-slate-800 border border-outline-variant/40 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-app-red/40 focus:border-app-red transition-all dark:text-white placeholder:text-secondary/60';

  /* ── Computed: Filter & Pagination ── */
  const filteredCases = filterText.trim()
    ? parsedCases.filter(tc => {
        const s = filterText.toLowerCase();
        return (tc['SRL No.'] || '').toLowerCase().includes(s) ||
               (tc['Test Case Title'] || '').toLowerCase().includes(s) ||
               (tc['Description'] || '').toLowerCase().includes(s) ||
               (tc['Test Case Type'] || '').toLowerCase().includes(s) ||
               (tc['Tags'] || '').toLowerCase().includes(s);
      })
    : parsedCases;
  const totalPages = Math.max(1, Math.ceil(filteredCases.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedCases = filteredCases.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);

  const scrollCarousel = (dir) => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: dir * 400, behavior: 'smooth' });
    }
  };

  const getPriorityStyle = (type) => {
    const t = (type || '').toLowerCase();
    if (t.includes('critical') || t.includes('security')) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    if (t.includes('negative') || t.includes('error')) return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
    if (t.includes('boundary') || t.includes('edge')) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    if (t.includes('performance') || t.includes('non-functional')) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
  };

  /* ═══════ RENDER ═══════ */
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-32 space-y-8">

      {/* ── Page Header & Coverage Status Circle ── */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold text-app-red tracking-tighter">Review Test Cases</h1>
          <p className="text-on-surface-variant dark:text-slate-400 text-sm">Validate and refine AI-generated test scenarios for production deployment.</p>
        </div>
        <div className="flex items-center gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-outline-variant/10">
          <div className="relative w-16 h-16">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="transparent" stroke="#e7e0eb" strokeWidth="6" />
              {coverage && (
                <circle cx="32" cy="32" r="28" fill="transparent" stroke="#e60012" strokeWidth="6"
                  strokeDasharray={2 * Math.PI * 28}
                  strokeDashoffset={2 * Math.PI * 28 - (coverage.overallCoverage / 100) * 2 * Math.PI * 28}
                  strokeLinecap="round" className="transition-all duration-1000 ease-out" />
              )}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold text-on-surface dark:text-white">{coverage ? `${coverage.overallCoverage}%` : '—'}</span>
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-secondary">Coverage Status</p>
            <p className="text-lg font-bold text-on-surface dark:text-white">{coverage ? coverage.functionalStatus : 'Awaiting'}</p>
          </div>
        </div>
      </div>

      {/* Auto-loaded banner */}
      {testCases && parsedCases.length > 0 && (
        <div className="flex items-center gap-3 px-5 py-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
          <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400">check_circle</span>
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            {parsedCases.length} test cases loaded from the Test Case Generator. Provide requirements and click &ldquo;Analyze &amp; Compare Coverage&rdquo;.
          </p>
        </div>
      )}

      {/* ── Requirement Intake (Compact 3-Column) ── */}
      <section className="bg-slate-50 dark:bg-slate-900 p-5 rounded-xl border-l-4 border-app-red">
        <h2 className="text-sm font-bold uppercase tracking-widest text-app-red mb-4">Requirement Intake</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* JIRA ID */}
          <div className={`bg-white dark:bg-slate-800 p-3 rounded-lg flex items-center gap-3 transition-all ${activeInputMethod && activeInputMethod !== 'jira' ? 'opacity-40 pointer-events-none' : ''}`}
            title={activeInputMethod && activeInputMethod !== 'jira' ? 'Clear current input to use JIRA lookup' : ''}>
            <span className="material-symbols-outlined text-secondary">link</span>
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] text-on-surface-variant dark:text-slate-400 font-medium">JIRA ID</label>
              <div className="flex items-center gap-1">
                <input
                  className="w-full bg-transparent border-none p-0 text-sm font-bold focus:ring-0 focus:outline-none dark:text-white placeholder:text-secondary/60"
                  type="text"
                  placeholder="e.g. HD-4092"
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchJira()}
                  disabled={activeInputMethod && activeInputMethod !== 'jira'}
                />
                <button
                  onClick={fetchJira}
                  disabled={fetchingJira || !ticketId.trim() || (activeInputMethod && activeInputMethod !== 'jira')}
                  className="text-app-red hover:text-red-700 disabled:opacity-40 transition shrink-0"
                >
                  <span className="material-symbols-outlined text-sm">{fetchingJira ? 'progress_activity' : 'send'}</span>
                </button>
                {(ticketId || issueData) && (
                  <button onClick={() => { setTicketId(''); setIssueData(null); setCoverage(null); }} className="text-slate-400 hover:text-red-500 transition shrink-0">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Document Upload */}
          <div
            className={`bg-white dark:bg-slate-800 p-3 rounded-lg flex items-center gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-all ${activeInputMethod && activeInputMethod !== 'upload' ? 'opacity-40 pointer-events-none' : ''}`}
            title={activeInputMethod && activeInputMethod !== 'upload' ? 'Clear current input to use file upload' : ''}
            onClick={() => !activeInputMethod || activeInputMethod === 'upload' ? document.getElementById('req-upload')?.click() : null}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => { setManualReq(ev.target?.result || ''); setCoverage(null); };
              reader.readAsText(file);
            }}
          >
            <input
              type="file"
              accept=".md,.txt,.markdown"
              id="req-upload"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => { setManualReq(ev.target?.result || ''); setCoverage(null); };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
            <span className="material-symbols-outlined text-secondary">upload_file</span>
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] text-on-surface-variant dark:text-slate-400 font-medium">Document Upload</label>
              <p className="text-sm font-bold text-on-surface dark:text-white truncate">
                {manualReq.trim() ? manualReq.trim().substring(0, 30) + '...' : 'Click or drop .md / .txt'}
              </p>
            </div>
            {manualReq.trim() && (
              <button onClick={(e) => { e.stopPropagation(); setManualReq(''); setCoverage(null); }} className="text-slate-400 hover:text-red-500 transition shrink-0">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>

          {/* Manual Input (click to expand textarea) */}
          <div
            className={`bg-white dark:bg-slate-800 p-3 rounded-lg flex items-center gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-all ${activeInputMethod && activeInputMethod !== 'upload' ? 'opacity-40 pointer-events-none' : ''}`}
            title={activeInputMethod && activeInputMethod !== 'upload' ? 'Clear current input to use manual entry' : ''}
            onClick={() => !activeInputMethod || activeInputMethod === 'upload' ? setManualExpanded(!manualExpanded) : null}
          >
            <span className="material-symbols-outlined text-secondary">edit_note</span>
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] text-on-surface-variant dark:text-slate-400 font-medium">Manual Input</label>
              <p className="text-sm font-bold text-on-surface-variant dark:text-slate-400 truncate italic">
                {manualReq.trim() ? `${manualReq.trim().split('\n').length} lines entered` : 'Click to expand'}
              </p>
            </div>
            <span className="material-symbols-outlined text-sm text-secondary transition-transform" style={{ transform: manualExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>expand_more</span>
          </div>
        </div>

        {/* JIRA data indicator */}
        {issueData && (
          <div className="mt-3 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-600 text-sm">check_circle</span>
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex-1 truncate">{issueData.id}: {issueData.summary}</span>
            <button onClick={() => { setIssueData(null); setCoverage(null); }} className="text-emerald-400 hover:text-red-500 transition shrink-0">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

        {/* Expanded manual textarea */}
        {manualExpanded && (
          <div className="mt-3">
            <textarea
              className={`${ic} resize-none`}
              rows={5}
              placeholder="Paste complex business logic or architectural requirements here..."
              value={manualReq}
              onChange={(e) => setManualReq(e.target.value)}
              autoFocus
            />
            {manualReq.trim() && (
              <div className="flex justify-end mt-1">
                <button onClick={() => { setManualReq(''); setCoverage(null); }} className="text-[10px] font-bold text-slate-400 hover:text-red-500 flex items-center gap-0.5 transition">
                  <span className="material-symbols-outlined text-xs">close</span> Clear
                </button>
              </div>
            )}
          </div>
        )}

        {/* Analyze Button */}
        <button
          onClick={runAnalysis}
          disabled={analyzing || !hasReq || !hasTests}
          className="mt-4 w-full bg-gradient-to-br from-app-red to-red-600 text-white font-bold py-3.5 rounded-lg shadow-lg shadow-app-red/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
        >
          {analyzing ? (
            <>
              <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
              Analyzing...
            </>
          ) : (
            <>
              Analyze &amp; Compare Coverage
              <span className="material-symbols-outlined">analytics</span>
            </>
          )}
        </button>
      </section>

      {/* ── Coverage Status Rows (horizontal cards) ── */}
      {coverage && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Functional Pathways', status: coverage.functionalStatus },
            { label: 'Negative Scenarios', status: coverage.negativeStatus },
            { label: 'Edge Case Matrix', status: coverage.edgeCaseStatus },
          ].map((item, idx) => {
            const isOpt = item.status === 'Optimized';
            const isPart = item.status === 'Partially Covered';
            return (
              <div key={idx} className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 rounded-xl shadow-sm">
                <div className="flex items-center gap-3">
                  <span className={`material-symbols-outlined ${isOpt ? 'text-green-600' : isPart ? 'text-amber-500' : 'text-app-red'}`} style={{ fontVariationSettings: "'FILL' 1" }}>
                    {isOpt ? 'check_circle' : isPart ? 'warning' : 'error'}
                  </span>
                  <span className="font-bold text-on-surface dark:text-white text-sm">{item.label}</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${isOpt ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : isPart ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-app-red'}`}>
                  {item.status}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── AI & Risk Intelligence (Collapsible) ── */}
      {coverage && (
        <section className="space-y-0">
          <button
            onClick={() => setRiskExpanded(!riskExpanded)}
            className="w-full flex items-center justify-between p-5 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 rounded-xl border border-outline-variant/20 shadow-sm hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-app-red text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>psychology</span>
              <div className="text-left">
                <h2 className="text-lg font-bold text-on-surface dark:text-white tracking-tight">AI &amp; Risk Intelligence</h2>
                <p className="text-[10px] text-secondary font-medium">
                  {coverage.gapAnalysis?.length || 0} gaps · {coverage.qualityIssues?.length || 0} issues · {coverage.duplicates?.length || 0} duplicates
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-secondary transition-transform duration-300" style={{ transform: riskExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              expand_more
            </span>
          </button>

          {riskExpanded && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-5 animate-in">

            {/* Card 1: AI Strategic Insights */}
            <div className="bg-gradient-to-br from-app-red to-red-700 p-6 rounded-2xl text-white flex flex-col shadow-lg">
              <div className="flex justify-between items-start mb-4">
                <span className="material-symbols-outlined bg-white/20 p-2 rounded-lg">psychology</span>
                <span className="text-[10px] bg-white/30 px-2 py-1 rounded-full font-bold uppercase">Insights</span>
              </div>
              <h3 className="text-xl font-bold mb-2">AI Strategic Insights</h3>
              <div className="max-h-[180px] overflow-y-auto pr-1 flex-1">
                <p className="text-sm text-white/80 leading-relaxed">&ldquo;{coverage.insights}&rdquo;</p>
                {coverage.recommendations && coverage.recommendations.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/20">
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-2 text-white/60">Recommendations</p>
                    <ul className="space-y-1">
                      {coverage.recommendations.map((r, i) => (
                        <li key={i} className="text-xs text-white/80 flex items-start gap-2">
                          <span className="material-symbols-outlined text-white/50 text-sm mt-0.5">lightbulb</span>{r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Card 2: Gap Analysis */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl flex flex-col border-l-8 border-blue-600 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <span className="material-symbols-outlined text-blue-600 bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg">analytics</span>
                <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full font-bold uppercase">{coverage.gapAnalysis?.length || 0} Gaps</span>
              </div>
              <h3 className="text-xl font-bold text-on-surface dark:text-white mb-2">Gap Analysis</h3>
              <div className="max-h-[180px] overflow-y-auto pr-1 flex-1">
                {coverage.gapAnalysis && coverage.gapAnalysis.length > 0 ? (
                  <div className="space-y-2">
                    {coverage.gapAnalysis.map((g, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <span className="font-mono text-[10px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded shrink-0">{g.gapId}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-on-surface dark:text-white">{g.missingScenario}</p>
                          <p className="text-[10px] text-secondary mt-0.5">{g.impact}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${g.severity === 'High' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : g.severity === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{g.severity}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-on-surface-variant italic">No gaps detected.</p>
                )}
              </div>
            </div>

            {/* Card 3: Quality Issues */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl flex flex-col shadow-sm border border-outline-variant/15">
              <div className="flex justify-between items-start mb-4">
                <span className="material-symbols-outlined text-orange-500 bg-orange-100 dark:bg-orange-900/30 p-2 rounded-lg">report_problem</span>
                <span className="text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-2 py-1 rounded-full font-bold uppercase">{coverage.qualityIssues?.length || 0} Issues</span>
              </div>
              <h3 className="text-xl font-bold text-on-surface dark:text-white mb-2">Quality Issues</h3>
              <div className="max-h-[180px] overflow-y-auto pr-1 flex-1">
                {coverage.qualityIssues && coverage.qualityIssues.length > 0 ? (
                  <div className="space-y-2">
                    {coverage.qualityIssues.map((q, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-orange-50/50 dark:bg-orange-900/10 rounded-lg">
                        <span className="font-mono text-[10px] font-bold text-orange-600 bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 rounded shrink-0">{q.issueId}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs"><span className="font-mono text-blue-600">{q.testCaseId}</span>: {q.issue}</p>
                          <p className="text-[10px] text-secondary mt-0.5">Fix: {q.recommendation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-on-surface-variant italic">No quality issues found.</p>
                )}
              </div>
            </div>

            {/* Card 4: Duplicates (if any) */}
            {coverage.duplicates && coverage.duplicates.length > 0 && (
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl flex flex-col shadow-sm border border-outline-variant/15">
                <div className="flex justify-between items-start mb-4">
                  <span className="material-symbols-outlined text-gray-500 bg-gray-100 dark:bg-gray-800 p-2 rounded-lg">content_copy</span>
                  <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-1 rounded-full font-bold uppercase">{coverage.duplicates.length} Dupes</span>
                </div>
                <h3 className="text-xl font-bold text-on-surface dark:text-white mb-2">Duplicates</h3>
                <div className="max-h-[180px] overflow-y-auto pr-1 flex-1">
                  <div className="space-y-2">
                    {coverage.duplicates.map((d, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <span className="text-[10px] font-bold text-secondary">Group {d.group}</span>
                        <span className="font-mono text-xs text-blue-600">{(d.testCaseIds || []).join(', ')}</span>
                        <span className="text-[10px] text-secondary ml-auto">{d.recommendation}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div>
          )}
        </section>
      )}

      {/* ── Requirement Traceability Matrix ── */}
      {coverage?.requirementTraceability && coverage.requirementTraceability.length > 0 && (
        <section className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border-l-4 border-purple-600">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-purple-600">account_tree</span>
            <h4 className="font-bold text-on-surface dark:text-white">Requirement Traceability Matrix</h4>
            {coverage.coverageCalculation && (
              <span className="ml-auto text-[10px] font-mono text-secondary bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                {coverage.coverageCalculation.formula}
              </span>
            )}
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <th className="text-left px-3 py-2 font-bold text-secondary border-b border-slate-200 dark:border-slate-700">Req</th>
                  <th className="text-left px-3 py-2 font-bold text-secondary border-b border-slate-200 dark:border-slate-700 min-w-[200px]">Requirement</th>
                  <th className="text-center px-3 py-2 font-bold text-secondary border-b border-slate-200 dark:border-slate-700">Coverage</th>
                  <th className="text-center px-3 py-2 font-bold text-secondary border-b border-slate-200 dark:border-slate-700">Match %</th>
                  <th className="text-left px-3 py-2 font-bold text-secondary border-b border-slate-200 dark:border-slate-700">Test Cases</th>
                  <th className="text-left px-3 py-2 font-bold text-secondary border-b border-slate-200 dark:border-slate-700">Comments</th>
                </tr>
              </thead>
              <tbody>
                {coverage.requirementTraceability.map((r, i) => {
                  const covColor = r.coverage === 'Full' ? 'text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400' : r.coverage === 'Partial' ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400' : 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400';
                  return (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2 font-mono font-bold text-purple-600">{r.id}</td>
                      <td className="px-3 py-2 text-on-surface dark:text-slate-300">{r.requirement}</td>
                      <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${covColor}`}>{r.coverage}</span></td>
                      <td className="px-3 py-2 text-center font-mono text-xs">{r.score != null ? `${r.score}%` : '—'}</td>
                      <td className="px-3 py-2 font-mono text-blue-600">{(r.testCaseIds || []).join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-secondary">{r.comments || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {coverage.coverageCalculation && (
            <div className="mt-3 flex gap-4 text-[10px] font-bold flex-wrap">
              <span className="text-blue-600">Test Cases: {coverage.coverageCalculation.testCasesAnalyzed}</span>
              <span className="text-green-600">Full: {coverage.coverageCalculation.fullyCovered}</span>
              <span className="text-amber-600">Partial: {coverage.coverageCalculation.partiallyCovered}</span>
              <span className="text-red-600">None: {coverage.coverageCalculation.notCovered}</span>
              <span className="text-secondary">Requirements: {coverage.coverageCalculation.totalRequirements}</span>
            </div>
          )}
        </section>
      )}

      {/* ── Generated Test Cases Table ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-xl font-extrabold text-on-surface dark:text-white tracking-tight">Generated Test Cases</h2>
          <div className="flex gap-3 items-center">
            {parsedCases.length > 0 && (
              <button onClick={() => { if (confirm('Clear all test cases?')) { setTestCases(''); setParsedCases([]); setCoverage(null); } }}
                className="text-[10px] font-bold text-slate-400 hover:text-red-500 flex items-center gap-0.5 transition" title="Clear all">
                <span className="material-symbols-outlined text-xs">delete_sweep</span> Clear
              </button>
            )}
            <span className="text-xs font-bold text-secondary">{parsedCases.length} Total</span>
            <button onClick={() => setFilterOpen(!filterOpen)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-on-surface dark:text-white text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              <span className="material-symbols-outlined text-sm">filter_list</span> Filter
            </button>
          </div>
        </div>

        {/* Filter Input */}
        {filterOpen && (
          <div className="px-2">
            <input
              className={ic}
              placeholder="Search by ID, title, type, or tags..."
              value={filterText}
              onChange={(e) => { setFilterText(e.target.value); setCurrentPage(1); }}
              autoFocus
            />
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
          {paginatedCases.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800 border-b border-outline-variant/15">
                      <th className="px-6 py-4 text-[11px] font-extrabold uppercase tracking-widest text-secondary w-24">ID</th>
                      <th className="px-6 py-4 text-[11px] font-extrabold uppercase tracking-widest text-secondary">Summary</th>
                      <th className="px-6 py-4 text-[11px] font-extrabold uppercase tracking-widest text-secondary w-32 text-center">Type</th>
                      <th className="px-6 py-4 text-[11px] font-extrabold uppercase tracking-widest text-secondary w-24 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {paginatedCases.map((tc, idx) => {
                      const globalIdx = filteredCases.indexOf(tc);
                      const origIdx = parsedCases.indexOf(tc);
                      const tcId = tc['SRL No.'] || `TC_${String(origIdx + 1).padStart(3, '0')}`;
                      const title = tc['Test Case Title'] || tc['Description'] || 'Untitled';
                      const desc = tc['Description'] || '';
                      const type = tc['Test Case Type'] || 'Functional';
                      return (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-6 py-4 font-mono text-sm text-app-red font-bold">{tcId}</td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-semibold text-on-surface dark:text-white">{title}</div>
                            {desc && desc !== title && (
                              <div className="text-xs text-on-surface-variant dark:text-slate-400 truncate max-w-md">{desc}</div>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className={`mx-auto w-fit px-2 py-1 rounded text-[10px] font-bold uppercase ${getPriorityStyle(type)}`}>{type}</div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button onClick={() => { setParsedCases(prev => prev.filter((_, i) => i !== origIdx)); setCoverage(null); setCurrentPage(1); }}
                              className="text-on-surface-variant dark:text-slate-400 hover:text-red-500 transition-colors">
                              <span className="material-symbols-outlined text-lg">delete</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800 flex justify-between items-center border-t border-outline-variant/15">
                <span className="text-xs text-on-surface-variant dark:text-slate-400">
                  Showing {(safePage - 1) * itemsPerPage + 1}&ndash;{Math.min(safePage * itemsPerPage, filteredCases.length)} of {filteredCases.length} cases
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                    className="px-3 py-1 bg-white dark:bg-slate-900 border border-outline-variant/20 rounded text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40">
                    Prev
                  </button>
                  <span className="px-3 py-1 text-xs font-bold text-secondary">{safePage}/{totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                    className="px-3 py-1 bg-app-red text-white rounded text-xs font-bold hover:bg-red-700 transition-colors shadow-sm disabled:opacity-40">
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 opacity-30 text-center">
              <span className="material-symbols-outlined text-4xl mb-2">description</span>
              <p className="text-xs font-semibold">No test cases {filterText ? 'match your filter' : 'loaded'}</p>
              <p className="text-[10px] mt-1">{filterText ? 'Try a different search term' : 'Generate test cases first from the "Create Test Cases" page'}</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Requirement Status ── */}
      {coverage && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm">
          <h3 className="font-bold text-on-surface dark:text-white mb-4">Requirement Status</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex justify-between text-xs font-medium mb-1">
                <span className="text-on-surface-variant dark:text-slate-400">Mapped Functional Requirements</span>
                <span className="text-app-red font-bold">{coverage.mappedFunctional?.[0]}/{coverage.mappedFunctional?.[1]}</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div className="bg-app-red h-full rounded-full transition-all duration-700" style={{ width: `${coverage.mappedFunctional?.[1] ? (coverage.mappedFunctional[0] / coverage.mappedFunctional[1]) * 100 : 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs font-medium mb-1">
                <span className="text-on-surface-variant dark:text-slate-400">Non-Functional Mapping</span>
                <span className="text-blue-600 font-bold">{coverage.mappedNonFunctional?.[0]}/{coverage.mappedNonFunctional?.[1]}</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div className="bg-blue-600 h-full rounded-full transition-all duration-700" style={{ width: `${coverage.mappedNonFunctional?.[1] ? (coverage.mappedNonFunctional[0] / coverage.mappedNonFunctional[1]) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Final Actions ── */}
      <div className="flex flex-col md:flex-row gap-4 pt-4">
        <button
          onClick={() => {
            if (confirm('Clear all data? This will reset JIRA ID, uploaded files, manual input, and all review results.')) {
              setTicketId(''); setIssueData(null); setManualReq(''); setManualExpanded(false);
              setTestCases(''); setParsedCases([]); setCoverage(null); setFilterText(''); setCurrentPage(1); setRiskExpanded(false);
            }
          }}
          className="flex-1 bg-slate-100 dark:bg-slate-800 text-on-surface dark:text-white py-4 rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          <span className="material-symbols-outlined">restart_alt</span> Clear All
        </button>
        <button onClick={exportTraceMatrix}
          disabled={!coverage}
          title={!coverage ? 'Complete the review analysis first' : ''}
          className="flex-1 bg-app-red text-white py-4 rounded-xl font-bold flex items-center justify-center gap-3 shadow-lg shadow-app-red/20 hover:bg-red-700 active:scale-95 transition-all disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined">check_circle</span> Approve &amp; Export Scenarios
        </button>
      </div>
    </div>
  );
}
