# B.L.A.S.T. — Demo Video Script

> **Recording Setup:** Clipchamp → Screen and camera | Clean background | Edge full screen (F11) | Hide favorites bar (Ctrl+Shift+B) | Dark mode ON
>
> **URL:** `blastaiqa.com`
>
> **Keep ready:** Gemini API key, GitHub PAT, sample requirement text (below)

---

## Sample Requirement (Copy-paste this during demo)

```
E-Commerce Checkout Flow:
- User can add items to cart and view cart summary
- User can apply valid coupon codes for discounts
- User can select shipping address from saved addresses or add new
- Payment via Credit Card, Debit Card, UPI, or Net Banking
- Order confirmation with email notification
- User can cancel order within 30 minutes of placement
- Guest checkout allowed without registration
- Real-time inventory check before order placement
```

---

# VIDEO 1 — Overview (Target: 2-3 minutes)

**Title:** "I Built an AI Agent That Writes Test Cases — B.L.A.S.T."
**Post on:** LinkedIn + YouTube

---

### [0:00–0:30] PROBLEM STATEMENT — Why B.L.A.S.T. Exists

> *"Let me ask you something. How long does it take your team to go from a JIRA ticket to a fully reviewed test plan? A day? Two days? Now add writing test cases, reviewing coverage gaps, generating automation scripts, pushing to GitHub, and running CI/CD. That's a full sprint just for test planning."*

> *"The problem is clear — manual test planning is slow, error-prone, and disconnected. You write a test plan in Word, test cases in Excel, automation code in your IDE, push via terminal, and monitor pipelines on GitHub. Five tools, five context switches, five chances to miss something."*

> *"I built B.L.A.S.T. to solve this. One platform — from requirement to running tests. AI-powered, anti-hallucination enforced, and fully integrated. Let me show you what it can do."*

**Action:** Start with a split-screen or text overlay showing the pain points:
- "JIRA → Word → Excel → IDE → Terminal → GitHub" (crossed out)  
- Then show B.L.A.S.T. landing page appearing as the solution.

---

### [0:30–0:45] SETTINGS — Connect LLM

> *"First, connect an LLM. I'm using Google Gemini 2.5 Flash. Enter the API key, select the model, click Test Connection — and we're connected."*

**Action:** Go to Settings → Select Gemini → Paste API key → Select model → Click Test Connection → Show green success.

---

### [0:45–1:15] TEST PLAN — Generate & Push to Confluence

> *"Now go to Create Test Plan. I'll paste an e-commerce checkout requirement. Click Generate — and within seconds, B.L.A.S.T. creates a complete test plan with objectives, scope, risk assessment, and entry-exit criteria. And with one click — Push to Confluence — it's published directly to your team's wiki."*

**Action:** Click "Create Test Plan" → Paste the requirement → Click Generate → Scroll through output → Click "Push to Confluence" → Show modal → Publish → Show success link.

---

### [1:15–1:45] TEST CASES — Generate

> *"Next, Create Test Cases. I'll type: generate 10 test cases for e-commerce checkout. Watch — it gives exactly 10. Each with ID, title, steps, expected results, priority, and type."*

**Action:** Click "Create Test Cases" → Type the prompt → Click Generate → Show the table → Scroll to show all 10 rows.

---

### [1:45–2:15] REVIEW — Coverage Analysis

> *"The Review page is where it gets intelligent. I enter the requirement, click Analyze — and B.L.A.S.T. runs AI-powered coverage analysis. It shows gap detection, risk intelligence, and a full requirement traceability matrix."*

**Action:** Click "Review Test Cases" → Paste requirement in Manual Input → Click "Analyze & Compare Coverage" → Show Coverage Status cards → Expand AI Risk Intelligence → Expand RTM.

---

### [2:15–2:40] AUTOMATION — Quick Flash

> *"It also generates production-ready automation code. Playwright with Page Object Model — complete with config, page objects, and spec files. Or Selenium BDD with Cucumber. Download as a clean ZIP."*

**Action:** Click "Playwright POM" → Show generated files briefly → Click Download ZIP. Then flash "Selenium BDD" tab briefly.

---

### [2:40–3:00] CI/CD — Quick Flash

> *"Push code to GitHub, trigger CI/CD, and monitor execution in real-time. Green check — tests passed."*

**Action:** Flash GitHub CI/CD tab → Show a completed pipeline with green check → Click View Report briefly.

---

### [3:00–3:20] CLOSING

> *"This is B.L.A.S.T. — from problem to solution. One platform that replaces five tools. Built by me from scratch. Deep dive coming in Part 2. Link in the description."*

**Action:** Show sidebar with all tabs → Smile at camera.

---
---

# VIDEO 2 — Test Plan, Test Cases & Review Deep Dive (Target: 6-8 minutes)

**Title:** "AI Generates Test Plans, Pushes to Confluence & Runs Coverage Analysis — B.L.A.S.T. Deep Dive (Part 2)"
**Post on:** YouTube first, then LinkedIn

---

### [0:00–0:20] INTRO

> *"In Part 1, I showed B.L.A.S.T. in 3 minutes. Now let's go deep — how it creates test plans, pushes them directly to Confluence, generates structured test cases, and runs intelligent coverage analysis. This is the complete test planning workflow."*

**Action:** App open on landing page. Dark mode ON.

---

### [0:20–1:00] SETTINGS — Connect LLM + JIRA

> *"First, let's set up our connections. Under Settings, I'll connect two things — an LLM provider and JIRA."*

> *"For the LLM, I'm using Google Gemini 2.5 Flash. Enter your API key, select the model, click Test Connection. Green — connected."*

**Action:** Show platform dropdown → Select Gemini → Enter key → Test → Green success.

> *"Now JIRA. Enter your Atlassian URL, email, and API token. Same token works for both JIRA and Confluence — they share the same Atlassian credentials. Test Connection — connected."*

**Action:** Enter JIRA URL → Email → Token → Test → Green success.

> *"These two connections unlock the entire test planning pipeline."*

---

### [1:00–2:30] CREATE TEST PLAN — Two Input Modes

> *"Now Create Test Plan. B.L.A.S.T. gives you two input modes."*

> *"Mode 1 — JIRA Ticket. Enter a ticket ID like QA-101, click Search. It pulls the summary, description, acceptance criteria — everything from your JIRA ticket. The anti-hallucination system checks data completeness and warns you if fields are missing."*

**Action:** Select JIRA Ticket mode → Type `QA-101` → Click Search → Show the preview with ticket details → Point to completeness warning if any.

> *"Mode 2 — Manual Input. If you don't have a JIRA ticket, paste your requirement directly. I'll paste an e-commerce checkout flow."*

**Action:** Switch to Manual Input → Paste the sample requirement.

> *"Optionally, add context — like 'focus on payment edge cases' or 'include mobile scenarios'."*

**Action:** Type something in Additional Context.

> *"Click Generate Test Plan. The AI analyzes the requirement and creates a structured, professional-grade test plan."*

**Action:** Click Generate → Wait → Show output rendering.

> *"Look at what it produced — Test Objectives, Scope definition, Test Strategy with entry-exit criteria, Risk Assessment. Notice the risk section — it identified payment gateway timeout as a high-priority risk. That's not template filling — that's intelligent analysis specific to my requirement."*

**Action:** Scroll slowly through each section. Pause on Risk Assessment.

---

### [2:30–3:30] PUSH TO CONFLUENCE — Live Demo

> *"Now here's a powerful feature — Push to Confluence. Since we already connected JIRA, Confluence is ready. Same Atlassian credentials, no extra setup."*

> *"Click Push to Confluence. It fetches your Confluence spaces. Select the space — I'll pick QA Test Plans. The title is auto-generated from the ticket ID and summary."*

**Action:** Click Push to Confluence → Show modal → Show spaces dropdown populating → Select a space.

> *"Optionally, search for a parent page to nest it under. I'll search for 'Sprint 24' and select it."*

**Action:** Type in parent page search → Select a page from dropdown.

> *"Click Publish."*

**Action:** Click Publish → Show loading spinner → Show success message.

> *"Done — page created. Click this link to open it directly in Confluence."*

**Action:** Click the "Open in Confluence" link → Show the page rendered in Confluence in the browser.

> *"From requirement to published test plan in under a minute. If I push again with the same title, it updates the existing page — no duplicates."*

---

### [3:30–4:30] CREATE TEST CASES — Detailed

> *"Now the core feature — Create Test Cases."*

> *"I can type a natural language prompt: 'generate 10 test cases for e-commerce checkout with payment and coupon validation'."*

**Action:** Type the prompt.

> *"Click Generate. Watch the count — I asked for 10, and it generates exactly 10. B.L.A.S.T. has smart count detection — whether you say 'give me 5' or 'only three' or 'generate 15', it respects the number."*

**Action:** Show the table with all 10 rows.

> *"Each test case has an ID, title, description, preconditions, test steps, expected results, priority, and type. Look — it automatically classifies them as Functional, Negative, or Edge Case."*

**Action:** Point to different columns. Click on a row to expand details.

> *"You can paginate through them, filter by keyword, and delete individual cases. These test cases also automatically flow into the Review page."*

**Action:** Show pagination → Type in filter → Delete one case.

---

### [4:30–5:00] CREATE TEST SCENARIOS — Quick

> *"Test Scenarios work similarly. Paste a requirement, and it generates BDD-style Given-When-Then scenarios. Useful if your team follows Behavior Driven Development."*

**Action:** Quick demo — paste requirement → generate → show output briefly.

---

### [5:00–5:30] REVIEW — Introduction

> *"Now the most powerful feature — Review Test Cases. This is where B.L.A.S.T. becomes truly intelligent."*

> *"Notice — it automatically loaded the 10 test cases we just generated. No copy-paste needed."*

**Action:** Click "Review Test Cases" → Show the green banner saying "10 test cases loaded".

> *"Now I provide the original requirement for comparison. Three options — JIRA ticket, or manual paste. I'll paste manually."*

**Action:** Open Manual Input → Paste the requirement.

---

### [5:30–6:00] REVIEW — Run Analysis

> *"Click Analyze & Compare Coverage. The AI compares every test case against every line of the requirement."*

**Action:** Click the button → Show loading spinner → Results appear.

---

### [6:00–6:30] REVIEW — Coverage Status Cards

> *"Three coverage dimensions. Functional Pathways — are all business flows tested? Negative Scenarios — are failure cases covered? Edge Case Matrix — are boundary conditions handled?"*

> *"Each shows Optimized, Partially Covered, or Gaps. In our case, functional is optimized at 92%, but edge cases show gaps."*

**Action:** Point to each of the 3 cards slowly.

---

### [6:30–7:10] REVIEW — AI Risk Intelligence

> *"Expand AI & Risk Intelligence. This is the brain of the review engine."*

> *"AI Strategic Insights — overall quality summary. Gap Analysis — specific missing scenarios with severity ratings. Quality Issues — problems in existing test cases. Duplicates — if any test cases overlap."*

> *"Look at Gap G1 — 'Missing inventory check failure scenario' with HIGH severity. That's a real gap the AI found that our test cases missed."*

**Action:** Expand the section → Point to each panel → Highlight a specific gap.

---

### [7:10–7:40] REVIEW — RTM (Requirement Traceability Matrix)

> *"The Requirement Traceability Matrix maps every requirement to its test cases. Coverage percentage, full or partial status, and comments."*

> *"8 requirements — 6 fully covered, 1 partial, 1 uncovered. The coverage formula is calculated automatically."*

**Action:** Expand RTM → Scroll through table → Point to summary stats.

---

### [7:40–8:00] CLOSING

> *"That's the complete test planning and review workflow in B.L.A.S.T. From a JIRA ticket or a raw requirement — to a professional test plan published on Confluence — to structured test cases — to AI-powered coverage analysis. All in one tool."*

> *"In Part 3, I'll show how B.L.A.S.T. generates Playwright and Selenium automation code, pushes to GitHub, and runs CI/CD pipelines. Subscribe so you don't miss it."*

**Action:** Show sidebar → Smile → End.

---
---

# VIDEO 3 — Automation Code, GitHub & CI/CD (Target: 6-8 minutes)

**Title:** "AI Generates Playwright & Selenium Code + Runs CI/CD — B.L.A.S.T. (Part 3)"
**Post on:** YouTube first, then LinkedIn

---

### [0:00–0:20] INTRO

> *"B.L.A.S.T. doesn't just generate test cases — it writes production-ready automation code and runs CI/CD pipelines. Let me show you the complete flow."*

---

### [0:20–1:30] PLAYWRIGHT POM — Generate

> *"Playwright POM — Page Object Model. I enter the application URL and the requirement."*

**Action:** Enter URL + Paste requirement.

> *"Click Generate. B.L.A.S.T. creates a complete Playwright project — page object files, spec files, utility helpers, and a full configuration."*

**Action:** Click Generate → Show the file tree on the left.

> *"Let me open a page file. Clean selectors, reusable methods, async-await pattern. This is production-quality code, not pseudocode."*

**Action:** Click on a page file → Scroll through the code.

> *"Now the spec file — proper test structure, imports from page objects, assertions, and hooks."*

**Action:** Click on a spec file → Show the code.

---

### [1:30–2:10] PLAYWRIGHT CONFIG

> *"The playwright.config.ts is fully configured — screenshots on failure, video recording, trace viewer, and HTML reporter. All ready to use."*

**Action:** Click on playwright.config.ts → Point to each setting.

---

### [2:10–2:40] DOWNLOAD ZIP

> *"Click Download ZIP. It packages only the source code — no markdown files, no logs, no clutter. Unzip, run npm install, then npx playwright test."*

**Action:** Click Download ZIP → Show it downloading.

---

### [2:40–3:30] SELENIUM BDD — Generate

> *"Now Selenium BDD. Same requirement, but this time it generates Cucumber-style tests."*

**Action:** Switch to Selenium BDD tab → Enter requirement → Generate.

> *"Feature files with Given-When-Then syntax. Step definitions that map to page class methods. And page objects for Selenium."*

**Action:** Show feature file → Show step definitions → Show page object.

> *"Two frameworks, same requirement. Your team picks what they use — Playwright or Selenium. B.L.A.S.T. handles both."*

---

### [3:30–4:20] GITHUB INTEGRATION — Push Code

> *"Now let's push this to GitHub. Go to GitHub Integration."*

**Action:** Click GitHub tab.

> *"Enter your GitHub Personal Access Token. Select the repository. Choose the branch. Click Push."*

**Action:** Enter PAT → Select repo → Push.

> *"Code is pushed. You can verify on GitHub — all the files are there."*

**Action:** Show success message.

---

### [4:20–5:30] GITHUB CI/CD — Trigger Pipeline

> *"Now the final piece — CI/CD. Go to GitHub CI/CD."*

**Action:** Click GitHub CI/CD tab.

> *"Select the workflow file — this is the GitHub Actions workflow that B.L.A.S.T. generated. Click Trigger Pipeline."*

**Action:** Select workflow → Click Trigger.

> *"Watch the real-time status icon — it's spinning while the pipeline runs. B.L.A.S.T. polls GitHub every few seconds for updates."*

**Action:** Point to the spinning icon. Wait.

> *"Green check — pipeline completed successfully. All tests passed."*

**Action:** Show the green check icon.

---

### [5:30–6:10] VIEW REPORT

> *"Now click View Report. This shows the full CI/CD execution report — test results, pass/fail count, execution time, and any screenshots."*

**Action:** Click View Report → Show the report.

> *"From requirement to running tests — without writing a single line of code manually."*

---

### [6:10–7:00] CLOSING — Tech Stack & Credits

> *"Let me quickly share the tech stack. Frontend — React with Tailwind CSS. Backend — Node.js with Express. LLM Integration — Google Gemini, Groq, and Grok. Deployment — Render.com. CI/CD — GitHub Actions."*

> *"I built this entirely from concept to deployment. Every prompt, every component, every API integration."*

> *"If you're in QA, test automation, or software engineering — I'd love to hear your thoughts. Drop a comment. If you found this useful, like and subscribe."*

> *"This is B.L.A.S.T. — Built by Moreshwar Landge. Thank you for watching."*

**Action:** Show the app one last time → Smile → End.

---
---

# POSTING SCHEDULE

| Day | What | Platform | Time (IST) |
|-----|------|----------|------------|
| **Day 1** (Tue/Wed) | Video 1 — Overview (2-3 min) | LinkedIn + YouTube | 8:30 AM |
| **Day 4** | 30-sec teaser clip from Video 2 | LinkedIn | 9:00 AM |
| **Day 7** | Video 2 — Deep Dive (6-8 min) | YouTube + LinkedIn | 10:00 AM (Sat/Sun) |
| **Day 10** | 30-sec teaser clip from Video 3 | LinkedIn | 9:00 AM |
| **Day 14** | Video 3 — Automation & CI/CD (6-8 min) | YouTube + LinkedIn | 10:00 AM (Sat/Sun) |

---

# PRE-RECORDING CHECKLIST

- [ ] Edge browser: Hide favorites bar (Ctrl+Shift+B)
- [ ] Edge browser: Full screen (F11)
- [ ] Only one tab open: blastaiqa.com
- [ ] Dark mode ON in the app
- [ ] LLM pre-connected (so demo doesn't fail on camera)
- [ ] Sample requirement copied and ready to paste
- [ ] Clipchamp: Screen and camera selected
- [ ] Microphone tested (speak and check audio level)
- [ ] Clean background behind you
- [ ] Phone on silent / notifications off on laptop
- [ ] Close all unnecessary apps (Slack, Teams, email)
- [ ] Do a 15-second test recording first

---

# LINKEDIN POST (for Video 1)

```
I built an AI Test Agent. Here's what it does in under 3 minutes.

After weeks of building, I'm sharing B.L.A.S.T. —
an AI-powered testing command center that:

- Generates test plans from requirements
- Creates test cases with exact count control
- Runs AI coverage analysis with gap detection
- Builds Playwright POM & Selenium BDD code
- Pushes to GitHub & triggers CI/CD pipelines
- Monitors execution in real-time

Tech: React + Tailwind + Node.js + Gemini/Groq/Grok

This isn't a prototype — it's deployed and working.

Full deep-dive on YouTube (link in comments)

#Testing #AI #TestAutomation #QA #Playwright #Selenium
#React #NodeJS #LLM #Gemini #BuildInPublic #SDET
```

---

# YOUTUBE DESCRIPTION (for all videos)

```
B.L.A.S.T. — AI Test Automation Command Center
Built by Moreshwar Landge

An intelligent test agent that generates test plans, test cases,
automation code (Playwright POM / Selenium BDD), and runs CI/CD
pipelines — all powered by LLMs (Gemini, Groq, Grok).

Live Demo: https://blastaiqa.com

Part 1: Overview (this video)
Part 2: Test Generation & AI Coverage Review
Part 3: Automation Code & CI/CD Pipeline

Tech Stack: React, Tailwind CSS, Node.js, Express, GitHub Actions
LLMs: Google Gemini, Groq, Grok

#AITesting #TestAutomation #Playwright #Selenium #QA #SDET
```
