# 🎯 AI Native Playwright Framework + B.L.A.S.T. Integration Plan

## 📋 Executive Summary

**Goal:** Enable B.L.A.S.T. UI to generate production-ready Playwright automation using AI Native Framework's proven patterns, store it in MongoDB, and create a seamless requirement → test cases → automation workflow.

**Key Innovation:** Zero-code automation generation with evidence-based locators, self-healing, and intelligent reuse.

---

## 🔍 Framework Analysis

### AI Native Playwright Framework Strengths
✅ **Agent-Driven:** GitHub Copilot skills auto-generate code  
✅ **Evidence-Based Locators:** `@playwright/cli` captures real DOM elements (no guessing)  
✅ **3-Layer Architecture:** Pages → Modules → Tests (clean separation)  
✅ **Self-Healing:** SmartLocator with fallback chains  
✅ **Reuse Index:** capabilities.json tracks all assets  
✅ **Anti-Hallucination:** Strict rules prevent invented locators/features  
✅ **Wrapper-Driven:** Actions/WaitHelper/WorkflowActions for maintainability  

### B.L.A.S.T. Framework Strengths
✅ **Full-Stack UI:** React + Node + MongoDB  
✅ **LLM Integration:** Multiple providers (Groq, Ollama, Gemini, Grok, OpenAI)  
✅ **JIRA/Confluence/Zephyr:** Enterprise tool integration  
✅ **Test Management:** Generates test cases, plans, scenarios  
✅ **Database Storage:** MongoDB for persistence  
✅ **User-Friendly:** No-code test generation UI  

---

## 🎯 Integration Architecture

### New Workflow: Requirement → Test Cases → Automation

```
┌─────────────────────────────────────────────────────────────────┐
│ B.L.A.S.T. UI (React Frontend)                                  │
├─────────────────────────────────────────────────────────────────┤
│ 1. User Input                                                    │
│    ├─ Requirement/User Story                                    │
│    ├─ Application URL (for @playwright/cli)                     │
│    └─ Screenshots/Snapshots (optional)                          │
│                                                                  │
│ 2. Test Case Generation (EXISTING)                              │
│    ├─ LLM generates test cases via RICE-POT prompt              │
│    ├─ Saves to MongoDB (TestCase model)                         │
│    └─ Shows in UI table                                         │
│                                                                  │
│ 3. Automation Generation (NEW) ⭐                               │
│    ├─ Button: "Generate Playwright Automation"                  │
│    ├─ User selects test cases to automate                       │
│    ├─ Optional: Run @playwright/cli for evidence-based locators │
│    ├─ LLM generates 3-layer Playwright code                     │
│    │   ├─ Page Objects (locators only)                          │
│    │   ├─ Modules (workflows)                                   │
│    │   └─ Tests (assertions)                                    │
│    ├─ Saves to MongoDB:                                         │
│    │   ├─ PageObject collection                                 │
│    │   ├─ Module collection (new)                               │
│    │   ├─ TestSpec collection (new)                             │
│    │   └─ Capabilities collection (replaces capabilities.json)  │
│    └─ Download as ZIP (Playwright project)                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Backend API (Node + Express)                                    │
├─────────────────────────────────────────────────────────────────┤
│ NEW Endpoints:                                                   │
│ • POST /api/automation/generate                                 │
│   ├─ Input: Test cases + app URL + snapshots                   │
│   ├─ Process:                                                   │
│   │   1. Check capabilities for reusable pages/modules          │
│   │   2. Generate locators (evidence-based if snapshot given)   │
│   │   3. Generate Page Objects                                  │
│   │   4. Generate Modules                                       │
│   │   5. Generate Test Specs                                    │
│   │   6. Save to MongoDB                                        │
│   │   7. Update capabilities index                              │
│   └─ Output: { pages, modules, tests, downloadUrl }            │
│                                                                  │
│ • POST /api/automation/playwright-cli                           │
│   ├─ Integrates with @playwright/cli                            │
│   ├─ Captures element snapshots from live app                   │
│   └─ Returns evidence-based locators                            │
│                                                                  │
│ • GET /api/automation/capabilities                              │
│   └─ Returns reusable pages/modules for intelligent reuse       │
│                                                                  │
│ • POST /api/automation/download                                 │
│   └─ Packages automation as ZIP (full Playwright project)       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ MongoDB Collections (New + Updated)                             │
├─────────────────────────────────────────────────────────────────┤
│ EXISTING:                                                        │
│ • TestCase — test cases (already has pageObjects ref)           │
│ • PageObject — page objects (basic structure exists)            │
│ • SavedArtifact — historical artifacts                          │
│ • User — user accounts                                          │
│                                                                  │
│ NEW:                                                             │
│ • Module — workflow modules                                     │
│   ├─ name, description, filePath                                │
│   ├─ methods: [{ name, params, steps, dependencies }]           │
│   └─ imports: [{ type, name, path }]                            │
│                                                                  │
│ • TestSpec — test specifications                                │
│   ├─ name, filePath, feature                                    │
│   ├─ tests: [{ title, tags, steps, assertions }]                │
│   ├─ usedModules: [moduleId]                                    │
│   └─ usedPages: [pageObjectId]                                  │
│                                                                  │
│ • Capability — reuse index (replaces capabilities.json)         │
│   ├─ type: 'page' | 'module' | 'test' | 'fixture' | 'util'     │
│   ├─ name, filePath                                             │
│   ├─ exports: [{ name, type, signature }]                       │
│   └─ lastUpdated                                                │
│                                                                  │
│ ENHANCED:                                                        │
│ • PageObject — add AI Native structure                          │
│   ├─ locators: [{ name, strategy, selector, fallbacks }]        │
│   ├─ evidence: { snapshot, screenshotUrl, timestamp }           │
│   └─ selfHealing: { enabled, fallbackChains }                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Implementation Phases

### **Phase 1: Foundation (Week 1-2)** 

#### 1.1 MongoDB Schema Setup
- [ ] Create `Module.js` model
- [ ] Create `TestSpec.js` model  
- [ ] Create `Capability.js` model
- [ ] Enhance `PageObject.js` with AI Native structure
- [ ] Add indexes for fast lookup

#### 1.2 Backend API - Core Automation Engine
- [ ] Create `api/_tools/playwright_generator.js`
  - Implements AI Native 3-layer generation
  - Evidence-based locator generation
  - SmartLocator fallback chain creation
  - Wrapper-driven code generation
- [ ] Create `api/routes/automation.js`
  - POST `/api/automation/generate` — main generation endpoint
  - GET `/api/automation/capabilities` — reuse index query
  - POST `/api/automation/download` — ZIP packaging
- [ ] Create `api/_tools/capabilities_manager.js`
  - Manages MongoDB Capability collection
  - Reuse discovery logic
  - Dependency tracking

#### 1.3 LLM Prompt Engineering
- [ ] Create `Prompt_Template/playwright_ai_native_generation.md`
  - Uses AI Native AGENT.md rules
  - 3-layer architecture enforcement
  - Evidence-based locator priority
  - SmartLocator generation
  - Wrapper API usage (Actions/WaitHelper/WorkflowActions)
  - Anti-hallucination rules

---

### **Phase 2: UI Integration (Week 3-4)**

#### 2.1 New React Component
- [ ] Create `client/src/components/PlaywrightAINative.jsx`
  - Step 1: Select test cases to automate
  - Step 2: Provide app URL + optional snapshots
  - Step 3: Configure evidence capture (optional @playwright/cli)
  - Step 4: Generate automation (Pages → Modules → Tests)
  - Step 5: Preview generated code (tabbed view)
  - Step 6: Download ZIP or push to GitHub

#### 2.2 Capabilities Browser
- [ ] Create `client/src/components/CapabilitiesBrowser.jsx`
  - Shows all reusable pages/modules
  - Searchable/filterable
  - Click to view code
  - "Use in new test" button

#### 2.3 Evidence Capture Integration
- [ ] Create `client/src/components/PlaywrightCLI.jsx`
  - Simple UI to launch @playwright/cli
  - Capture snapshots from live app
  - Upload snapshots to backend
  - Use snapshots for evidence-based locators

---

### **Phase 3: Advanced Features (Week 5-6)**

#### 3.1 Self-Healing Integration
- [ ] Implement SmartLocator generation in prompts
- [ ] Add fallback chain builder UI
- [ ] Create healing telemetry dashboard
- [ ] Generate `SELF_HEALING_REPORT.md` equivalent

#### 3.2 Intelligent Reuse
- [ ] Implement reuse-first discovery
  - Check capabilities before generating new pages/modules
  - Suggest existing assets
  - Auto-import existing fixtures
- [ ] Create dependency graph visualization
- [ ] Add "similar tests" recommendation

#### 3.3 GitHub Integration Enhancement
- [ ] Push generated automation to GitHub
- [ ] Create PR with automation code
- [ ] Link to JIRA tickets
- [ ] Generate CI/CD workflow file

---

### **Phase 4: Quality & Optimization (Week 7-8)**

#### 4.1 Code Quality
- [ ] Add ESLint/Prettier config to generated code
- [ ] TypeScript validation
- [ ] Import optimization
- [ ] Duplicate detection

#### 4.2 Testing & Validation
- [ ] Validate generated code syntax
- [ ] Dry-run test execution
- [ ] Self-test: Generate automation for B.L.A.S.T. itself

#### 4.3 Documentation
- [ ] User guide: Requirement → Automation workflow
- [ ] Video walkthrough
- [ ] API documentation
- [ ] Migration guide (existing users)

---

## 📦 New File Structure

```
AI_Agents/
├── api/
│   ├── _tools/
│   │   ├── playwright_generator.js      ⭐ NEW — AI Native code generator
│   │   ├── capabilities_manager.js      ⭐ NEW — MongoDB capabilities index
│   │   ├── evidence_capture.js          ⭐ NEW — @playwright/cli integration
│   │   ├── smart_locator_builder.js     ⭐ NEW — SmartLocator fallback chains
│   │   └── zip_packager.js              ⭐ NEW — ZIP download utility
│   ├── models/
│   │   ├── Module.js                    ⭐ NEW — Module schema
│   │   ├── TestSpec.js                  ⭐ NEW — Test spec schema
│   │   ├── Capability.js                ⭐ NEW — Capabilities index
│   │   └── PageObject.js                🔄 ENHANCED — AI Native structure
│   └── routes/
│       └── automation.js                ⭐ NEW — Automation endpoints
│
├── client/src/components/
│   ├── PlaywrightAINative.jsx           ⭐ NEW — Main automation UI
│   ├── CapabilitiesBrowser.jsx          ⭐ NEW — Reuse index browser
│   ├── PlaywrightCLI.jsx                ⭐ NEW — Evidence capture UI
│   └── CodePreview.jsx                  ⭐ NEW — Syntax-highlighted preview
│
├── Prompt_Template/
│   ├── playwright_ai_native_generation.md   ⭐ NEW — AI Native prompt
│   ├── page_object_generation.md            ⭐ NEW — Page-only prompt
│   ├── module_generation.md                 ⭐ NEW — Module-only prompt
│   └── smart_locator_generation.md          ⭐ NEW — Self-healing prompt
│
└── INTEGRATION_PLAN.md                  📄 THIS FILE
```

---

## 🎨 UI/UX Flow

### Automation Generation Wizard (5 Steps)

```
┌────────────────────────────────────────────────────────┐
│ Step 1: Select Test Cases                              │
├────────────────────────────────────────────────────────┤
│ ☑ TC_001: Login with valid credentials                │
│ ☑ TC_002: Login with invalid password                 │
│ ☐ TC_003: Add product to cart                         │
│ ☑ TC_004: Remove product from cart                    │
│                                                         │
│ Selected: 3 test cases                                 │
│ [Next: Provide App Details] →                         │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ Step 2: Application Details                            │
├────────────────────────────────────────────────────────┤
│ App URL: https://www.saucedemo.com                    │
│ Environment: ◉ QA  ○ UAT  ○ Dev                       │
│                                                         │
│ Evidence Capture (Optional):                           │
│ [ Upload Screenshot ] [ Launch @playwright/cli ]      │
│                                                         │
│ [← Back]  [Next: Configure Generation] →              │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ Step 3: Generation Options                             │
├────────────────────────────────────────────────────────┤
│ ☑ Use evidence-based locators (recommended)           │
│ ☑ Enable self-healing (SmartLocator)                  │
│ ☑ Check for reusable pages/modules                    │
│ ☑ Generate wrapper-driven code                        │
│ ☐ Include visual testing setup                        │
│                                                         │
│ LLM Model: [Groq - llama-3.3-70b-versatile ▼]        │
│                                                         │
│ [← Back]  [Generate Automation] 🚀                    │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ Step 4: Generation Progress                            │
├────────────────────────────────────────────────────────┤
│ ✅ Analyzing test cases (3)                           │
│ ✅ Checking capabilities for reuse...                 │
│    Found: LoginPage (reusable), CartPage (new)        │
│ ✅ Generating Page Objects (2)                        │
│    ├─ LoginPage.ts (reused)                           │
│    └─ CartPage.ts (created)                           │
│ ✅ Generating Modules (2)                             │
│    ├─ LoginModule.ts                                   │
│    └─ CartModule.ts                                    │
│ ⏳ Generating Test Specs (1)...                       │
│    └─ cart-management.spec.ts                         │
│                                                         │
│ [View Generated Code] →                                │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ Step 5: Preview & Download                             │
├────────────────────────────────────────────────────────┤
│ Tabs: [Pages] [Modules] [Tests] [Config] [Package]   │
│                                                         │
│ ┌─ CartPage.ts ────────────────────────────────────┐ │
│ │ import { Page } from '@playwright/test';        │ │
│ │                                                   │ │
│ │ export class CartPage {                          │ │
│ │   constructor(private page: Page) {}            │ │
│ │                                                   │ │
│ │   addToCartBtn = () => this.page                 │ │
│ │     .getByRole('button', { name: /add to cart/i})│ │
│ │     .or(this.page.getByTestId('add-to-cart'));  │ │
│ │ }                                                 │ │
│ └───────────────────────────────────────────────────┘ │
│                                                         │
│ [Download ZIP] [Push to GitHub] [Save to Database]    │
└────────────────────────────────────────────────────────┘
```

---

## 🔌 Key API Endpoints

### POST `/api/automation/generate`

**Request:**
```json
{
  "testCaseIds": ["TC_001", "TC_002", "TC_004"],
  "appUrl": "https://www.saucedemo.com",
  "environment": "qa",
  "options": {
    "evidenceBased": true,
    "selfHealing": true,
    "checkReuse": true,
    "wrapperDriven": true,
    "visualTesting": false
  },
  "llmConfig": {
    "platform": "groq",
    "model": "llama-3.3-70b-versatile"
  },
  "snapshots": ["data:image/png;base64,..."]
}
```

**Response:**
```json
{
  "success": true,
  "automation": {
    "pages": [
      {
        "_id": "...",
        "name": "CartPage",
        "filePath": "src/pages/CartPage.ts",
        "locators": [...],
        "code": "import { Page } from '@playwright/test';\n..."
      }
    ],
    "modules": [
      {
        "_id": "...",
        "name": "CartModule",
        "filePath": "src/modules/CartModule.ts",
        "methods": [...],
        "code": "import { CartPage } from '../pages/CartPage';\n..."
      }
    ],
    "tests": [
      {
        "_id": "...",
        "name": "cart-management.spec.ts",
        "filePath": "src/tests/cart-management.spec.ts",
        "tests": [...],
        "code": "import { test, expect } from '../fixtures';\n..."
      }
    ],
    "capabilities": {
      "reused": ["LoginPage", "LoginModule"],
      "created": ["CartPage", "CartModule", "cart-management.spec"]
    },
    "downloadUrl": "/api/automation/download/xyz123",
    "stats": {
      "pages": 2,
      "modules": 2,
      "tests": 3,
      "loc": 247
    }
  }
}
```

---

## 🧠 LLM Prompt Strategy

### Prompt: `playwright_ai_native_generation.md`

```markdown
You are a **Senior QA Automation Architect** specializing in the **AI Native Playwright Framework**.

## CONTEXT
You will receive:
1. Test cases (from B.L.A.S.T.)
2. App URL and environment
3. Optional: Screenshots/DOM snapshots
4. Existing capabilities (reusable pages/modules)

## YOUR TASK
Generate production-ready Playwright TypeScript automation using the **AI Native 3-layer architecture**:

### Layer 1: Page Objects (`src/pages/*Page.ts`)
- **Locators ONLY** — no business logic, no assertions
- Evidence-based: Use provided snapshots/screenshots for accurate selectors
- Locator priority: `getByRole() > getByLabel() > getByPlaceholder() > getByText() > getByTestId() > CSS`
- Format: `elementName = () => this.page.getByRole(...)`
- Self-healing: Add SmartLocator with fallback chains (max 3 strategies)
- Reuse existing pages if capabilities show they exist

### Layer 2: Modules (`src/modules/*Module.ts`)
- **Workflows ONLY** — orchestrate Page actions, no assertions
- Use `Logger.step()` for every step
- Use `Actions` for interactions, `WaitHelper` for waits, `WorkflowActions` for multi-step flows
- No raw `page.locator()` — always use Page Object methods
- Methods: 5-15 lines, single responsibility
- Parameterize variants (Yes/No, Save/Submit) with typed defaults

### Layer 3: Test Specs (`src/tests/*.spec.ts`)
- **Assertions ONLY** — call module methods, add `expect()`
- Use `test.describe()` with feature name
- Add `@Tags` per AI Native standard: `@<Feature> @<TestType> @<Priority> @<Project> @<Browser>`
- Use fixtures from `src/fixtures/index.ts`
- File naming: domain-based (login.spec.ts, cart.spec.ts), NOT single-scenario

## ANTI-HALLUCINATION RULES (MANDATORY)
1. DO NOT invent locators — use evidence from snapshots/screenshots
2. DO NOT assume "typical" UI behavior
3. If evidence is missing, use semantic locators with fallbacks
4. DO NOT hardcode credentials/data — use `credentials()`, `env()`, `testData.json`
5. DO NOT create speculative `.catch()` fallbacks without evidence

## WRAPPER-DRIVEN CODE
- One action = one line
- Promote repeated patterns to wrappers immediately
- File uploads: `Actions.uploadViaFileChooser(browseBtn, attachmentPath('file.pdf'))`
- No force-clicks, no `evaluate()` hacks unless evidence proves them needed

## SELF-HEALING (SmartLocator)
```typescript
addToCartBtn = () => SmartLocator.create(this.page, [
  { strategy: 'role', value: ['button', { name: /add to cart/i }] }, // reason: primary accessible role
  { strategy: 'testId', value: 'add-to-cart' }  // reason: fallback if text changes
]);
```

## OUTPUT FORMAT
Return JSON:
```json
{
  "pages": [
    {
      "name": "CartPage",
      "filePath": "src/pages/CartPage.ts",
      "imports": ["Page"],
      "locators": [
        { "name": "addToCartBtn", "strategy": "role", "selector": "button, { name: /add to cart/i }", "fallbacks": [...] }
      ],
      "code": "full TypeScript code here"
    }
  ],
  "modules": [
    {
      "name": "CartModule",
      "filePath": "src/modules/CartModule.ts",
      "imports": ["CartPage", "Logger", "Actions"],
      "methods": [
        { "name": "addProductToCart", "params": ["productName"], "steps": [...] }
      ],
      "code": "full TypeScript code here"
    }
  ],
  "tests": [
    {
      "name": "cart-management.spec.ts",
      "filePath": "src/tests/cart-management.spec.ts",
      "imports": ["test", "expect", "CartModule"],
      "tests": [
        { "title": "Add to Cart adds product and updates cart badge", "tags": "@Cart @Functional @P0 @Smoke @desktop-chrome", "steps": [...] }
      ],
      "code": "full TypeScript code here"
    }
  ],
  "fixtures": ["CartModule fixture registration code"],
  "config": ["playwright.config.ts updates if needed"],
  "package": ["package.json dependencies to add"]
}
```

## REUSE FIRST
Check provided capabilities. If a page/module exists, IMPORT it — do not recreate.
```

---

## 🎯 Success Metrics

### Technical KPIs
- ✅ 100% test cases automatable (no manual intervention)
- ✅ <5 min generation time for 10 test cases
- ✅ 90%+ locator accuracy (evidence-based)
- ✅ 70%+ code reuse (via capabilities)
- ✅ Zero compilation errors (TypeScript validated)
- ✅ Self-healing enabled by default

### User Experience KPIs
- ✅ 1-click automation generation
- ✅ Download ZIP in <10 seconds
- ✅ GitHub push in <30 seconds
- ✅ Editable code preview
- ✅ Clear progress indicators

### Business KPIs
- ✅ 10x faster test automation (vs manual coding)
- ✅ 80% reduction in maintenance (self-healing)
- ✅ 50% reduction in locator failures (evidence-based)

---

## 🛡️ Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **LLM hallucinates locators** | Evidence-based workflow + strict prompts + validation |
| **Generated code doesn't compile** | TypeScript validation + ESLint + dry-run |
| **Locators break frequently** | SmartLocator + self-healing + fallback chains |
| **Code quality issues** | Wrapper-driven enforcement + linting + review |
| **MongoDB performance** | Indexes on Capability queries + caching |
| **@playwright/cli integration complexity** | Optional feature + fallback to semantic locators |

---

## 📚 Dependencies

### New NPM Packages (Backend)
```json
{
  "archiver": "^7.0.0",         // ZIP creation
  "playwright": "^1.49.0",       // @playwright/cli integration
  "typescript": "^5.7.2",        // TypeScript validation
  "eslint": "^9.18.0"            // Code quality
}
```

### New NPM Packages (Frontend)
```json
{
  "react-syntax-highlighter": "^15.6.1",  // Code preview
  "monaco-editor-react": "^4.6.0"          // Editable code view
}
```

---

## 🚦 Go/No-Go Decision Points

### Phase 1 Gate
- [ ] MongoDB schemas validated
- [ ] Core generation endpoint working (single test case)
- [ ] LLM prompt generates valid TypeScript
- [ ] Evidence-based locator extraction working

### Phase 2 Gate
- [ ] UI wizard functional (all 5 steps)
- [ ] Code preview shows syntax highlighting
- [ ] ZIP download working
- [ ] Capabilities browser shows reusable assets

### Phase 3 Gate
- [ ] Self-healing locators generated correctly
- [ ] Reuse discovery working (50%+ reuse rate)
- [ ] GitHub push integration working

### Launch Gate
- [ ] End-to-end flow: requirement → automation → ZIP (under 5 min)
- [ ] Generated code compiles (TypeScript + ESLint pass)
- [ ] Self-test passed (B.L.A.S.T. automates itself)
- [ ] Documentation complete

---

## 🎓 Training & Adoption

### Developer Training (1 week)
1. AI Native Framework principles
2. 3-layer architecture deep-dive
3. Evidence-based locator workflow
4. Capabilities management

### User Training (2 days)
1. B.L.A.S.T. + AI Native integration overview
2. Automation wizard walkthrough
3. Customization options
4. GitHub integration

---

## 📞 Next Steps

1. **Review this plan** — Approve/adjust
2. **Set up dev environment** — Clone AI Native framework
3. **Phase 1 Sprint Planning** — 2-week sprint
4. **Proof of Concept** — Single test case end-to-end
5. **User feedback** — Iterate on UI/UX

---

## ❓ Open Questions

1. **@playwright/cli Integration:** Should we embed it in the UI or keep it optional?
2. **Capabilities Storage:** MongoDB vs. JSON file vs. hybrid?
3. **Code Editing:** Allow inline editing before download, or download first?
4. **Version Control:** Track automation versions in DB or rely on GitHub?
5. **Execution:** Should B.L.A.S.T. also RUN the generated tests, or just generate?

---

**Status:** 📋 PLAN DRAFT — Awaiting Approval  
**Owner:** Moreshwar Landge  
**Last Updated:** 2026-08-04
