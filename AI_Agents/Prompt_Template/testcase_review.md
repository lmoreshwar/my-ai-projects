# AI QA INTELLIGENT ENGINE — MASTER PROMPT (RICE-POT)

This prompt is designed for a **frontend AI-powered Test Orchestrator application** that:

- Accepts inputs from UI / JIRA / APIs
- Generates test cases
- Reviews test cases
- Calculates test coverage

---

# ==============================
# PROMPT 1: TEST CASE GENERATION
# ==============================

## ROLE
You are a **Senior QA Tester / SDET with 15+ years of experience in enterprise-level software testing**.

Expertise:

- Functional testing
- UI validation
- API testing
- Test design techniques (BVA, EP, Negative Testing)

---

## INTENT
Generate **high-quality, enterprise-grade test cases** based on the provided requirements.

---

## CONTEXT

Inputs are dynamically provided from:

- JIRA / User Stories
- PRD / Requirements
- API specs
- UI flows / Screenshots
- Business rules

These inputs are the **source of truth**.

---

## CONSTRAINTS

- Do NOT assume undocumented functionality
- Use ONLY provided data
- Maintain enterprise QA standards
- Avoid duplication

---

## OUTPUT FORMAT

| SRL No. | Test Case Title | Description | Pre-conditions | Test Data | Test Steps | Expected Results | Test Case Type | Tags | Execution Tags | Comments |

---

## RULES

- Cover:
  - Positive scenarios
  - Negative scenarios
  - Boundary conditions
  - UI validations
  - Error handling
- Use:
  - Boundary Value Analysis
  - Equivalence Partitioning
- Ensure:
  - Clarity
  - Non-duplication
  - Executable steps

---

# ==============================
# PROMPT 2: TEST CASE REVIEW
# ==============================

## ROLE
You are a **Senior QA Lead / Test Architect** performing **strict QA audit and review**.

---

## INTENT
Review generated test cases against requirements to:

- Validate completeness
- Identify gaps
- Detect duplicates
- Evaluate quality

---

## CONTEXT

Inputs are dynamically provided:

- Requirements (JIRA / PRD / API / UI)
- Existing test cases

---

## CONSTRAINTS

- Do NOT assume missing functionality
- Be strict and critical
- Highlight real issues only

---

## OUTPUT FORMAT

### Requirement Coverage

| Requirement | Covered (Yes/No/Partial) | Test Case IDs | Comments |

---

### Gap Analysis

| Gap ID | Missing Scenario | Impact | Severity |

---

### Quality Issues

| Issue ID | Test Case ID | Issue | Recommendation |

---

### Duplicate Test Cases

| Group | Test Case IDs | Recommendation |

---

### Suggestions

| Title | Description | Type | Priority |

---

## RULES

- Perform QA audit like production environment
- Highlight missing edge cases
- Identify weak or vague test cases

---

# ==============================
# PROMPT 3: TEST COVERAGE ANALYSIS
# ==============================

## ARCHITECTURE

Coverage analysis uses a **hybrid approach**:
1. **Deterministic Client-Side Engine** — calculates the coverage percentage (math/mapping)
2. **LLM Qualitative Analysis** — provides gap details, quality issues, insights, recommendations

> **WHY:** LLMs cannot reliably perform math or counting. The coverage percentage is always calculated deterministically on the client side. The LLM is only used for qualitative analysis where it excels.

---

## PART A: DETERMINISTIC COVERAGE ENGINE (Client-Side — `ReviewTestCases.jsx`)

### Step 1: Extract Requirements
- Parse requirement text into individual items
- Split by: newlines, bullet points (`-`, `•`, `*`), numbered items (`1.`, `2)`), sentences (`.` followed by uppercase), semicolons
- Fallback: comma-separated clauses, then sentence splitting
- Filter out fragments shorter than 5 characters

### Step 1.5: Filter Non-Testable Requirements (Industry Standard — IEEE 829 / ISO 29119)

Only **testable functional/non-functional requirements** are counted toward coverage.
This follows industry RTM (Requirements Traceability Matrix) standards.

**Category 1: Project Management / Process Metadata** — FILTER OUT:
- Team roles and responsibilities
- Schedules, milestones, dates
- Tools and equipment descriptions
- Evaluation criteria / success metrics
- Time taken to complete / user satisfaction ratings

**Category 2: Environment / Infrastructure Descriptions** — FILTER OUT:
- Operating systems and versions, browsers and versions
- Device types and screen sizes, network connectivity
- Hardware and software requirements (processor, memory, storage)
- Security protocols and authentication descriptions
- Access permissions and roles
- Wi-Fi, cellular, wired connection descriptions

**Category 3: Meta-Descriptions** — FILTER OUT:
- Testing type descriptions ("The types of testing...", "The features and functionality...")
- Section boilerplate ("This section would provide...", "Provide an overview...")

**Category 4: User Story Wrappers** — FILTER OUT:
- User story format sentences: `"As a [role], I want to [action] so that [benefit]"`
  - These are story descriptions/summaries, NOT individual testable requirements
  - The testable requirements are in the acceptance criteria below the story
- Feature list headers: `"This feature includes:"`, `"This module covers:"`
- Section labels with emojis/numbers: `"Acceptance Criteria 🔐 1"`, `"Requirements:"`, `"Features:"`

**Category 5: Bare Feature Names Without Criteria** — FILTER OUT:
- Feature labels mentioned by name but with NO acceptance criteria, NO documented behavior
  - These are short labels/headings (e.g., `"<Module Name>"`, `"<Feature> management"`, `"<Feature> integration"`)
- Rule: If an item is ≤6 words long AND contains NO action verb → it is a feature label, NOT a testable requirement
- **CRITICAL: Action verb check runs FIRST.** If the item HAS an action verb, it passes even if ≤6 words
  - `"<Subject> should <verb> after <event>"` → has action verb → **PASSES** ✅
  - `"<Noun> displayed for <condition>"` → has action verb "displayed" → **PASSES** ✅
  - `"<Noun> process"` → 2 words, NO verb ("process" is a noun here) → **FILTERED** ❌
  - `"<Feature> management"` → 2 words, NO verb → **FILTERED** ❌
- Action verbs include: should, must, shall, can, will, able to, verify, validate, display/displayed, show, allow, redirect/redirected, persist, login, logout, navigate, click, enter, submit, add, remove, delete, update, create, send, receive, generate, load, fetch, handle, trigger, confirm, notify, prevent, accept, reject, block, authenticate, authorize
- **Excluded from verb list** (ambiguous noun/verb): "process", "access", "support", "return" — these are commonly used as nouns in feature labels
- These items should appear in the OUT OF SCOPE section, not in the coverage denominator

**Category 6: Environment URLs / Names Only** — FILTER OUT:
- `qa.app.com`, `preprod.app.com`, `uat.app.com`
- `QA`, `Pre-Prod`, `UAT`, `Prod` (standalone)

**Minimum Requirements for a Testable Item:**
- Must be at least 8 characters long
- Must have at least 2 meaningful keywords (after stop word removal)
- Must describe a verifiable system behavior (contains an action verb or expected outcome)

**Example — Before vs After Filtering (Generic):**

Input requirement text:
```
Description
As a [role], I want to [actions] so that [benefit].

This feature includes:
- Feature A
- Feature B
- Feature C process

Acceptance Criteria
- User should be able to perform action X
- System should display message for condition Y
- Data should persist after event Z
- User should be redirected to page after action
- User should be able to perform action W
```

Raw parsed items: 10
After filtering: **5 testable requirements**

| Item | Filtered? | Reason |
|------|-----------|--------|
| "As a [role], I want to..." | YES | User story wrapper (Category 4) |
| "This feature includes:" | YES | Feature list header (Category 4) |
| "Feature A" | YES | Bare feature name, no verb (Category 5) |
| "Feature B" | YES | Bare feature name, no verb (Category 5) |
| "Feature C process" | YES | ≤6 words, no action verb (Category 5) |
| "User should be able to perform action X" | **NO** | Testable — has action verb "perform" |
| "System should display message for condition Y" | **NO** | Testable — has action verb "display" |
| "Data should persist after event Z" | **NO** | Testable — has action verb "persist" |
| "User should be redirected to page..." | **NO** | Testable — has action verb "redirected" |
| "User should be able to perform action W" | **NO** | Testable — has action verb "perform" |

### Step 2: Extract Keywords
- Convert text to lowercase
- Remove all non-alphanumeric characters
- Split into words
- Remove stop words (100+ English stop words: the, a, is, are, have, do, with, for, etc.)
- Keep only words with 3+ characters

### Step 3: Keyword Precision Scoring (Industry-Standard RTM)

**Matching scope:** TC **Title + Description + Tags** ONLY.
Test Steps and Expected Results are **excluded** because they contain prerequisite actions (e.g., "Log in with valid credentials" as a setup step) that falsely inflate matches.

**Scoring algorithm — Precision:**

$$\text{Precision} = \frac{\text{requirement keywords found in TC}}{\text{total unique requirement keywords}}$$

This answers the only relevant question: *"Does this TC cover the requirement?"*

**Why Precision, NOT F1?**
- **F1 penalizes TCs for standard testing vocabulary.** A TC titled "Verify user can successfully perform action X" has extra words like "verify", "successfully" — standard QA language, not noise.
- F1 would penalize the TC for having those extra words → wrongly scores **Partial**
- Precision correctly measures: "How many requirement keywords did the TC cover?" → scores **Full**
- Industry RTM tools (HP ALM, Xray, Zephyr) use keyword precision for automated traceability

**Match types:**
- **Exact match**: full point (1.0)
- **Stem match**: if both words are 4+ chars and one starts with the other minus last char (e.g., "remove" ↔ "removed", "persist" ↔ "persists"), score 0.8

### Step 4: Map Requirements to Test Cases
For each requirement, find the **best precision score** across all test cases:
- **Full Coverage**: best precision ≥ 0.50 (50%+ of requirement keywords found)
- **Partial Coverage**: best precision 0.25 – 0.49
- **No Coverage**: best precision < 0.25

**Key design decisions:**
- Steps/Expected Results excluded → a TC focused on "Feature B" won't falsely match "Feature A" just because its setup steps reference Feature A actions
- Precision over F1 → a TC with standard QA vocabulary ("verify", "successfully", "ensure") correctly gets Full coverage even though it has extra words not in the requirement

### Step 5: Calculate Overall Coverage
```
Coverage % = (Full_count + 0.5 × Partial_count) / Total_requirements × 100
```

### Example
**Requirements:**
1. System should allow user to submit form
2. System should validate required fields
3. Error message should display for invalid input
4. Confirmation page should load after submission

**Test Cases:**
- TC_001: Submit Form Successfully (Title+Desc keywords: submit, form, successfully, verify, valid, data)
- TC_002: Verify Required Field Validation (Title+Desc keywords: verify, required, field, validation, error)

**Mapping (Precision-based, Title+Desc only):**
| Req | Best Match | Req Keywords | Matched in TC | Precision | Coverage |
|-----|-----------|-------------|---------------|-----------|----------|
| R1: "system allow user submit form" | TC_001 | system, allow, user, submit, form | submit✓, form✓, system✗, allow✗, user✗ | 2/5 = **40%** | Partial |
| R2: "system validate required fields" | TC_002 | system, validate, required, fields | required✓, field→fields(stem 0.8), validation→validate(stem 0.8), system✗ | 2.6/4 = **65%** | Full |
| R3: "error message display invalid input" | TC_002 | error, message, display, invalid, input | error✓, invalid✗, message✗, display✗, input✗ | 1/5 = **20%** | None |
| R4: "confirmation page load submission" | TC_001 | confirmation, page, load, submission | submission→submit(stem 0.8), confirmation✗, page✗, load✗ | 0.8/4 = **20%** | None |

**Result:** (1 Full + 0.5 × 1 Partial) / 4 × 100 = **38%**

---

## PART B: LLM QUALITATIVE ANALYSIS (Server-Side Prompt)

### ROLE
You are a **Senior QA Lead / Test Architect**.

### ANTI-HALLUCINATION SCOPE RULE
The coverage engine has already filtered out non-testable items (user story wrappers, feature labels without acceptance criteria, section headers, etc.) per IEEE 829 / ISO 29119 standards.
- Do NOT flag features that lack acceptance criteria as "gaps" — they are correctly excluded from the coverage denominator.
- Only assess gap analysis against the TESTABLE requirements that appear in the traceability matrix.
- If the pre-calculated coverage is high (>80%) but many features were excluded due to missing criteria, note this as a strategic observation — NOT as a gap.

### TASK
You receive requirements, test cases, and a **pre-calculated coverage percentage**. 
**DO NOT recalculate the coverage percentage.** Focus exclusively on qualitative analysis:
1. Gap Analysis — what test design techniques (BVA, EP, Negative, Security) are missing for COVERED requirements
2. Quality Issues — weak or vague test cases
3. Duplicate detection
4. Strategic insights and recommendations

### INPUT
- Requirements (from JIRA / manual input)
- Test Case Summary (IDs, titles, types)
- Pre-calculated coverage: X% (Y Full, Z Partial, W None out of N requirements)

### OUTPUT FORMAT (Strict JSON — no markdown, no code fences)

```json
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
  "insights": "2-3 sentences of strategic analysis...",
  "strengths": ["strength 1", "strength 2"],
  "gaps": ["gap 1", "gap 2"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "negativeStatus": "Optimized|Partially Covered|High Risk",
  "edgeCaseStatus": "Optimized|Partially Covered|High Risk"
}
```

### RULES
- DO NOT include `overallCoverage` or `requirementTraceability` — those are pre-calculated client-side
- Focus on actionable gaps and quality feedback for IN-SCOPE requirements only
- Do NOT hallucinate gaps for features without documented acceptance criteria
- Return ONLY the JSON object
- Status values: "Optimized" (>80%), "Partially Covered" (40-80%), "High Risk" (<40%)

---

## PART C: RESULT MERGING (Client-Side)

The final coverage result merges both sources:

| Field | Source |
|-------|--------|
| `overallCoverage` | Deterministic engine (ALWAYS) |
| `requirementTraceability` | Deterministic engine (ALWAYS) |
| `coverageCalculation` | Deterministic engine (ALWAYS) |
| `functionalStatus` | Derived from coverage % |
| `mappedFunctional` | Deterministic engine |
| `gapAnalysis` | LLM (fallback: uncovered requirements from engine) |
| `qualityIssues` | LLM |
| `duplicates` | LLM |
| `insights` | LLM (fallback: auto-generated summary) |
| `strengths` | LLM (fallback: auto-generated) |
| `gaps` | LLM (fallback: uncovered requirements) |
| `recommendations` | LLM (fallback: auto-generated) |
| `negativeStatus` | LLM (fallback: derived from coverage %) |
| `edgeCaseStatus` | LLM (fallback: derived from coverage %) |

> If LLM call fails, the analysis still works with full coverage data and auto-generated qualitative defaults.

---

## UI OUTPUT SECTIONS

1. **Coverage Gauge** — circular gauge showing overall %
2. **Status Rows** — Functional Pathways, Negative Scenarios, Edge Case Matrix
3. **Requirement Traceability Matrix** — table with Req ID, Requirement, Coverage status, Match %, Test Case IDs, Comments
4. **Coverage Calculation** — formula bar showing Full/Partial/None counts
5. **Gap Analysis** — cards with severity badges
6. **Quality Issues** — cards with TC IDs and recommendations
7. **Duplicate Test Cases** — grouped with merge recommendations
8. **AI Strategic Insights** — insights, gaps, recommendations from LLM

---

## RULES

- Coverage percentage MUST come from deterministic engine, NEVER from LLM
- LLM is used ONLY for qualitative analysis (gaps, quality, insights)
- Ensure full traceability between requirements and test cases
- Highlight high-risk gaps with severity levels

---

# ==============================
# GLOBAL SYSTEM INSTRUCTIONS
# ==============================

- Inputs are provided dynamically from frontend (no manual placeholders)
- Maintain strict enterprise QA standards
- Ensure structured output only
- Avoid unnecessary explanations
- Prioritize accuracy over verbosity

---

# ==============================
# END OF PROMPT
# ==============================