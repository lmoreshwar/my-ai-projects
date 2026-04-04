# B.L.A.S.T. — Demo Video Script

> **Recording Setup:** Clipchamp → Screen and camera | Clean background | Edge full screen (F11) | Hide favorites bar (Ctrl+Shift+B) | Dark mode ON
>
> **URL:** `blast-test-agent.onrender.com`
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

### [0:00–0:15] HOOK — App Landing Page

> *"AI won't take your job — but someone using AI will. The question is: are you using it, or watching others use it? I chose to build with it. This is B.L.A.S.T. — an AI-powered test automation agent that I built from scratch. Let me show you what it can do."*

**Action:** Show the app landing page, slowly scroll the sidebar to show all menu items.

---

### [0:10–0:25] SETTINGS — Connect LLM

> *"First, connect an LLM. I'm using Google Gemini 2.5 Flash. Enter the API key, select the model, click Test Connection — and we're connected."*

**Action:** Go to Settings → Select Gemini → Paste API key → Select model → Click Test Connection → Show green success.

---

### [0:25–0:55] TEST PLAN — Generate

> *"Now go to Create Test Plan. I'll paste an e-commerce checkout requirement. Click Generate — and within seconds, B.L.A.S.T. creates a complete test plan with objectives, scope, risk assessment, and entry-exit criteria."*

**Action:** Click "Create Test Plan" → Paste the requirement → Click Generate → Slowly scroll through the output.

---

### [0:55–1:25] TEST CASES — Generate

> *"Next, Create Test Cases. I'll type: generate 10 test cases for e-commerce checkout. Watch — it gives exactly 10. Each with ID, title, steps, expected results, priority, and type."*

**Action:** Click "Create Test Cases" → Type the prompt → Click Generate → Show the table → Scroll to show all 10 rows.

---

### [1:25–1:55] REVIEW — Coverage Analysis

> *"The Review page is where it gets intelligent. I enter the requirement, click Analyze — and B.L.A.S.T. runs AI-powered coverage analysis. It shows gap detection, risk intelligence, and a full requirement traceability matrix."*

**Action:** Click "Review Test Cases" → Paste requirement in Manual Input → Click "Analyze & Compare Coverage" → Show Coverage Status cards → Expand AI Risk Intelligence → Expand RTM.

---

### [1:55–2:20] AUTOMATION — Quick Flash

> *"It also generates production-ready automation code. Playwright with Page Object Model — complete with config, page objects, and spec files. Or Selenium BDD with Cucumber. Download as a clean ZIP."*

**Action:** Click "Playwright POM" → Show generated files briefly → Click Download ZIP. Then flash "Selenium BDD" tab briefly.

---

### [2:20–2:40] CI/CD — Quick Flash

> *"Push code to GitHub, trigger CI/CD, and monitor execution in real-time. Green check — tests passed."*

**Action:** Flash GitHub CI/CD tab → Show a completed pipeline with green check → Click View Report briefly.

---

### [2:40–3:00] CLOSING

> *"This is B.L.A.S.T. — an AI test automation command center. Built by me from scratch. Deep dive coming in Part 2. Link in the description."*

**Action:** Show sidebar with all tabs → Smile at camera.

---
---

# VIDEO 2 — Test Generation & Review Deep Dive (Target: 6-8 minutes)

**Title:** "AI Test Coverage Analysis & Risk Detection — B.L.A.S.T. Deep Dive (Part 2)"
**Post on:** YouTube first, then LinkedIn

---

### [0:00–0:20] INTRO

> *"In Part 1, I showed B.L.A.S.T. in 3 minutes. Now let's go deep into every feature — how it generates test plans, test cases, and runs intelligent coverage analysis."*

**Action:** App open on landing page.

---

### [0:20–1:00] SETTINGS — Detailed

> *"B.L.A.S.T. supports three LLM providers — Google Gemini, Groq, and Grok. Each has different strengths. Today I'm using Gemini 2.5 Flash.
> Enter your API key, select the model from the dropdown, and click Test Connection. Green means we're good."*

**Action:** Show platform dropdown (all 3 options) → Select Gemini → Enter key → Select model → Test → Green success.

> *"If you switch to a different LLM later, it automatically resets your previous data so there's no confusion."*

---

### [1:00–2:00] CREATE TEST PLAN — Detailed

> *"Now Create Test Plan. I'll paste a real e-commerce checkout requirement."*

**Action:** Paste the requirement.

> *"Click Generate. The AI analyzes the requirement and creates a structured test plan."*

**Action:** Click Generate → Wait for output.

> *"Look at what it generated — Test Objectives, Scope, Test Strategy, Risk Assessment. Notice the risk section — it identified payment gateway timeout as a high risk. That's not template filling — that's intelligent analysis specific to my requirement."*

**Action:** Scroll slowly through each section. Pause on Risk Assessment and point it out.

---

### [2:00–3:20] CREATE TEST CASES — Detailed

> *"Now the core feature — Create Test Cases. I'll type: generate 10 test cases for e-commerce checkout with payment and coupon validation."*

**Action:** Type the prompt.

> *"Click Generate. Watch the count — I asked for 10, and it generates exactly 10. B.L.A.S.T. has smart count detection — whether you say 'give me 5' or 'only three' or 'generate 15', it respects the number."*

**Action:** Show the table with all 10 rows.

> *"Each test case has an ID, title, description, preconditions, test steps, expected results, priority, and type. Look — it automatically classifies them as Functional, Negative, or Edge Case."*

**Action:** Point to different columns.

> *"You can paginate, filter by keyword, and delete individual cases."*

**Action:** Show pagination. Type something in filter. Delete one case.

---

### [3:20–3:50] CREATE TEST SCENARIOS

> *"Test Scenarios work similarly. Paste a requirement, and it generates BDD-style Given-When-Then scenarios. Useful if your team follows Behavior Driven Development."*

**Action:** Quick demo — paste requirement → generate → show output.

---

### [3:50–4:20] REVIEW — Connect the Dots

> *"Now the most powerful feature — Review Test Cases. This is where B.L.A.S.T. becomes truly intelligent."*

> *"Notice it automatically loaded the 10 test cases we just generated. No copy-paste needed."*

**Action:** Click "Review Test Cases" → Show the green banner saying "10 test cases loaded".

> *"Now I need to provide the original requirement for comparison. Three options — JIRA ticket lookup, file upload, or manual paste. I'll paste manually."*

**Action:** Open Manual Input → Paste the requirement.

---

### [4:20–4:50] REVIEW — Run Analysis

> *"Click Analyze & Compare Coverage. The AI compares every test case against every requirement."*

**Action:** Click the button → Show loading spinner.

> *"And here are the results."*

---

### [4:50–5:20] REVIEW — Coverage Status

> *"Three coverage dimensions. Functional Pathways — are all business flows tested? Negative Scenarios — are failure cases covered? Edge Case Matrix — are boundary conditions handled?"*

> *"Each shows Optimized, Partially Covered, or Gaps. In our case, functional is optimized but edge cases are partially covered."*

**Action:** Point to each of the 3 cards.

---

### [5:20–6:00] REVIEW — AI Risk Intelligence

> *"Now expand AI & Risk Intelligence. This section shows: AI Strategic Insights — a summary of overall test quality. Gap Analysis — specific missing scenarios with severity. Quality Issues — problems in existing test cases. And Duplicates if any."*

> *"Look at Gap G1 — it says we're missing inventory check failure scenario. That's a real gap the AI found."*

**Action:** Expand the section → Point to each card → Highlight a specific gap.

---

### [6:00–6:40] REVIEW — RTM

> *"The Requirement Traceability Matrix maps every requirement to its test cases. Coverage percentage, full or partial status, and comments."*

> *"8 requirements — 6 fully covered, 1 partial, 1 uncovered. The formula is shown here."*

**Action:** Expand RTM → Scroll through the table → Point to the summary stats.

---

### [6:40–7:00] REVIEW — Requirement Status

> *"At the bottom — Requirement Status bars. 29 of 33 functional requirements mapped. Visual progress."*

**Action:** Scroll to bottom → Show progress bars.

---

### [7:00–7:20] REVIEW — Export & Clear

> *"When satisfied, click Approve & Export to save everything. Or Clear All to start fresh."*

**Action:** Show both buttons.

---

### [7:20–7:40] CLOSING

> *"That's the complete test generation and review workflow. In Part 3, I'll show how B.L.A.S.T. generates Playwright and Selenium automation code and runs CI/CD pipelines. Subscribe so you don't miss it."*

**Action:** Smile at camera.

---
---

# VIDEO 3 — Automation Code & CI/CD (Target: 6-8 minutes)

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
- [ ] Only one tab open: blast-test-agent.onrender.com
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

Live Demo: https://blast-test-agent.onrender.com

Part 1: Overview (this video)
Part 2: Test Generation & AI Coverage Review
Part 3: Automation Code & CI/CD Pipeline

Tech Stack: React, Tailwind CSS, Node.js, Express, GitHub Actions
LLMs: Google Gemini, Groq, Grok

#AITesting #TestAutomation #Playwright #Selenium #QA #SDET
```
