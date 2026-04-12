# B.L.A.S.T. Agent — Project History & Context

> **READ THIS FIRST.** This document is the single source of truth for all decisions, architecture,
> audit results, and lessons learned in this project. Before making any changes, read this file.

---

## 1. Project Identity

- **Name:** B.L.A.S.T. Agent (Blueprint, Link, Architect, Stylize, Trigger)
- **Owner:** Moreshwar Landge (lmoreshwar / l.moreshwar@gmail.com)
- **Repo:** https://github.com/lmoreshwar/my-ai-projects.git
- **Workspace:** `c:\Users\MoreshwarLandge\Autoamtion Workspace\my-ai-projects\AI_Agents`

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js / Express on port 8000 |
| Frontend | React 19 + Vite 4.5.3 + Tailwind CSS 3.4.19 on port 5173 |
| Database | MongoDB via Mongoose |
| Auth | JWT (5h expiry, secret: `super_secret_blast_key_2026`) |
| LLM | Multi-provider via LLMConnector (Gemini, Groq, OpenAI, Grok, Ollama) |
| JIRA | Atlassian REST API v3 — project ATP (ID: 10034) |

---

## 3. Key Files & Their Purposes

| File | Purpose |
|---|---|
| `api/index.js` (~1195 lines) | Express server, all API routes including `/generate-plan` |
| `api/_tools/llm_connector.js` (~501 lines) | LLM integration with auto-continuation, retry, Gemini fallback |
| `api/_tools/jira_tool.js` (~351 lines) | JIRA fetch with hierarchy — returns `description`, `testableDescription`, `parentContext` |
| `client/src/components/TestCaseGenerator.jsx` (~1629 lines) | 3-step TC generation: Input → Gap Analysis → Generate/Preview |
| `client/src/components/ReviewTestCases.jsx` (~1197 lines) | Coverage review engine + RTM UI (ISTQB collective scoring) |
| `Prompt_Template/testcases_ricepot.md` (426 lines) | The RICE-POT master prompt for test case generation |
| `improvement_notes.md` | Pending UI/UX improvements (favicon, CI/CD, ZIP cleanup, review page) |

---

## 4. RICE-POT Prompt — Design Decisions & Audit Results

### 4a. Test Case Types (6 types — FINAL, CORRECT)

The prompt defines exactly **6 Test Case Types**:

| Type | What It Covers |
|---|---|
| **Functional** | Core behavior validation (click, navigate, verify state) |
| **UI** | Visual element presence, layout, styling, UI behavior |
| **Validation** | Data correctness (values, formats, calculations shown correctly) |
| **Negative** | Invalid inputs, error scenarios, unauthorized actions |
| **Security** | Injection, XSS, CSRF, session manipulation, unauthorized access |
| **Boundary** | Edge values — empty, min, max, just-above, just-below limits |

### 4b. CRITICAL DECISION — Types Are Requirement-Driven

**The prompt is CORRECT.** Test case types generated depend on the **REQUIREMENT CONTENT**, not on forcing all 6 types:

- ATP-10 (SauceDemo Cart) has **no input fields, no auth criteria, no security criteria**
- Therefore: 0 Negative, 0 Security, 0 UI-typed TCs is **CORRECT behavior**
- Generating Security TCs for a simple add-to-cart button would be **HALLUCINATION**
- The Anti-Hallucination + Scope Boundary rules correctly prevent this

**DO NOT add forced minimums per type.** That would cause hallucination for simple features.

### 4c. Test Design Techniques (3 in prompt)

| Technique | Status |
|---|---|
| Boundary Value Analysis | In prompt ✅ |
| Equivalence Partitioning | In prompt ✅ |
| Negative Testing | In prompt ✅ |
| Decision Table Testing | Not in prompt (optional add — only useful for multi-condition requirements) |
| State Transition Testing | Not in prompt (optional add — useful for workflow features) |
| Error Guessing | Not in prompt (optional add — experience-based) |

### 4d. Execution Tags (3 tags — CORRECT)

| Tag | Assignment Rule |
|---|---|
| **Regression** | ALL test cases get this by default |
| **Sanity** | Core happy-path only. If Sanity → Regression must also be present |
| **Automation** | Stable, repeatable, programmatically verifiable. Min 70% of TCs |

### 4e. Frontend CASE_TYPES Dropdown (in TestCaseGenerator.jsx line 699)

Current: `['Functional', 'API', 'UI', 'Integration', 'Negative', 'Security', 'Boundary', 'Validation', 'Performance', 'Regression', 'Smoke', 'End-to-End', 'Automation']`

**Known mismatch:** The dropdown has 13 types but the prompt only instructs 6. The extras (API, Integration, Performance, End-to-End) are for manual editing flexibility. `Regression`, `Smoke`, `Automation` in the dropdown are technically Execution Tags not Types — but kept for user convenience during manual edits.

---

## 5. Completed Work (Chronological)

### Session: April 12, 2026

| # | Task | Commit / Status |
|---|---|---|
| 1 | Created 12 JIRA tickets (ATP-7 to ATP-18) for SauceDemo test hierarchy | Done via REST API |
| 2 | Created JIRA Release 1.0.0 (SauceDemo Core Shopping Flow) | Done, tagged all tickets |
| 3 | Fixed connection settings not retaining values after login | Pushed (607612a) |
| 4 | Fixed CRITICAL security bug: new users seeing previous users' data | Pushed (607612a) |
| 5 | Fixed signup auto-redirect (added explicit "Go to Sign In" button) | Pushed (607612a) |
| 6 | Made TopBar dynamic (firstName/lastName from JWT) | Pushed (607612a) |
| 7 | Updated auth.js to include firstName/lastName in JWT responses | Pushed (607612a) |
| 8 | Excluded parent epic from coverage engine (testableDescription) | Pushed (607612a) |
| 9 | ISTQB coverage engine overhaul (collective scoring, keyword tracking, actionable messages) | Pushed (607612a) |
| 10 | Investigated TC count drop 19→11 — confirmed LLM non-determinism, NOT a code bug | No code change needed |
| 11 | Backend: continuationFailed/continuationError metadata tracking | Committed (1ba3ba9) |
| 12 | Frontend: partial generation detection warning | Committed (1ba3ba9) |
| 13 | Full hybrid auto-retry countdown UI (continueGenerating, 60s timer, Retry Now/Cancel) | Pushed (c2a69c4) |
| 14 | RICE-POT prompt audit against ISTQB | **Result: Prompt is CORRECT as-is** |

---

## 6. Architecture Decisions Log

### Decision 1: Anti-Hallucination > Coverage Completeness
- **Context:** The prompt has Scope Boundary Rule as HIGHEST PRIORITY
- **Decision:** If a requirement doesn't have criteria for a certain test type, DO NOT generate that type
- **Reasoning:** Hallucinating test cases for undocumented features is worse than missing a type
- **Date:** April 12, 2026

### Decision 2: Coverage Engine Uses Dual Scoring
- **Context:** Single-TC scoring missed compound requirements
- **Decision:** `computeCoverage()` uses both bestSingle + collective union scoring
- **How:** `analyseKeywordMatches()` returns matched/unmatched keywords per requirement
- **Date:** April 12, 2026

### Decision 3: Parent Epic Excluded from Coverage
- **Context:** Parent epic description was diluting coverage scores
- **Decision:** `jira_tool.js` returns `testableDescription` (main+children only) separate from `description` (full)
- **How:** Coverage engine uses `testableDescription`, TC generator uses `description`
- **Date:** April 12, 2026

### Decision 4: Rate Limit → Hybrid Auto-Retry
- **Context:** LLM rate limits cause incomplete TC generation
- **Decision:** 60s countdown timer → auto-retry → max 2 attempts → then manual button
- **How:** `continueGenerating()` appends new TCs, `handleRateLimitRetry()` manages countdown
- **Date:** April 12, 2026

### Decision 5: TC Count Variation is LLM Non-Determinism
- **Context:** Same requirement generated 19 TCs once, 11 TCs another time
- **Decision:** This is NOT a bug. The `description` field (TC generator input) is unchanged
- **Reasoning:** Different LLM runs produce different counts due to temperature, context window, model state
- **Date:** April 12, 2026

---

## 7. JIRA Configuration

| Setting | Value |
|---|---|
| URL | https://moreaitesting.atlassian.net |
| Email | soma.moreshwar@gmail.com |
| Project | ATP (ID: 10034) |
| Issue Types | Epic(10044), Story(10078), Task(10043), Subtask(10045), Bug(10079) |
| Release | Release 1.0.0 — SauceDemo Core Shopping Flow (2026-04-12 to 2026-05-30) |
| Tickets | ATP-7 (Epic) → ATP-8,9,10 (Stories) → ATP-11 to ATP-18 (Subtasks) |

---

## 8. LLM Configuration

| Platform | Token Limits |
|---|---|
| Groq | max_tokens: 4096, TPM: 12K |
| Gemini | max_tokens: 32768, TPM: 1M |
| Grok | max_tokens: 16384 |
| OpenAI | max_tokens: 16384 |
| Ollama | max_tokens: 8192 |

**Continuation system:** `type: 'table'`, `minItems: 15`, `maxRounds: 3`
- `shouldContinue()` checks: row count vs minItems, token ratio vs 0.95 headroom, finish_reason
- `mergeContent()` appends continuation rows (strips repeated headers/separators)
- Gemini fallback chain: tries multiple models on failure

---

## 9. Pending Work (from improvement_notes.md)

1. App favicon / tab logo
2. CI/CD "View Report" button timing
3. ZIP download — remove unnecessary files
4. Real-time execution status icon color
5. Review page — multiple UX improvements (approval buttons, save draft, clear, mutual exclusion)
6. AI & Risk Intelligence — collapsible cards

---

## 10. Rules for AI Assistant

1. **READ THIS FILE FIRST** before making any changes
2. **DO NOT hallucinate** — if the requirement doesn't have criteria for a TC type, don't generate it
3. **DO NOT add forced minimum counts per TC type** — types are requirement-driven
4. **ASK before implementing changes** when user says so
5. **The RICE-POT prompt is CORRECT as-is** for the 6 types and 3 techniques
6. **TC count variation between runs is normal** — it's LLM non-determinism, not a bug
7. **Always check the requirement content** before judging whether generated TCs are correct
8. **Update this file** after every significant decision or completed task

---

*Last updated: April 12, 2026*
