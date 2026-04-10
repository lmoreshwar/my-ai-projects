# B.L.A.S.T. AGENT: STLC & Jira Hierarchy Architecture

This document defines the Software Testing Life Cycle (STLC) and Jira hierarchy standards for the B.L.A.S.T. AGENT testing framework. It strictly adheres to ISTQB standards and modern Agile/Scrum practices. This structure will serve as the blueprint for the frontend UI components handling Test Planning and Requirements Traceability.

---

## 1. Jira Issue Hierarchy Structure

To ensure full traceability from high-level business goals down to individual test executions, B.L.A.S.T. AGENT enforces a strict 4-tier Jira issue hierarchy.

### 🔺 Level 1: Initiative / Parent (Strategic Level)
*   **Description:** High-level strategic goals or large-scale product features that span multiple quarters.
*   **Example:** *Revamp User Authentication System.*
*   **ISTQB Mapping:** Business Requirements / High-Level System Requirements.

### 🔼 Level 2: Epic (Feature Level)
*   **Description:** A large body of work that can be broken down into specific tasks (User Stories). Epics represent a major feature delivered within a release or program increment.
*   **Example:** *Implement SSO (Single Sign-On) via Google and Microsoft.*
*   **ISTQB Mapping:** Feature Requirements / Functional Requirements.

### ⏺ Level 3: User Story / Task (Development Level)
*   **Description:** The smallest unit of work that delivers value to the end-user. Must follow the standard format: *"As a [persona], I want to [action] so that [benefit]."*
*   **Example:** *As a user, I want to click 'Sign in with Google' so that I can log in without remembering a new password.*
*   **ISTQB Mapping:** Test Basis / Acceptance Criteria. This is the primary level where **Test Cases** are linked.

### 🔽 Level 4: Sub-task / Bug (Execution Level)
*   **Description:** Technical steps required to complete a User Story, or defects found during testing.
*   **Example:** *Sub-task: Create OAuth2 API endpoint.* | *Bug: Google login button is unresponsive on Safari.*
*   **ISTQB Mapping:** Defect Reports / Test Execution Artifacts.

---

## 2. Testing STLC Phase Mapping

The B.L.A.S.T. AGENT framework maps ISTQB Fundamental Test Process (STLC) phases directly into the frontend workflow.

### Phase 1: Requirements Analysis (The "Why")
*   **Action:** QA analyzes the Epic and User Story (Level 2 & 3).
*   **B.L.A.S.T. UI Component:** Requirements Importer / Jira Integration sync.
*   **Output:** Verified Test Basis, identified ambiguities, and established Acceptance Criteria.

### Phase 2: Test Planning & Strategy (The "How")
*   **Action:** Defining the testing approach, scope, risks, and resources.
*   **ISTQB Standard:** Master Test Plan (MTP) or Level Test Plan (LTP).
*   **B.L.A.S.T. UI Component:** `TestPlanGenerator.jsx`
*   **Key Sections to Capture:**
    *   Scope (In/Out)
    *   Testing Types (Functional, Non-Functional, Regression, Automation)
    *   Environment & Data Requirements
    *   Entry/Exit Criteria

### Phase 3: Test Design & Development (The "What")
*   **Action:** Translating requirements into Test Scenarios and Test Cases.
*   **B.L.A.S.T. UI Component:** `TestScenarioGenerator.jsx` & `TestCaseGenerator.jsx`
*   **Traceability:** Every generated Test Case MUST be linked back to a Level 3 User Story ID.
*   **Format:**
    *   Pre-conditions
    *   Test Steps (Action -> Expected Result)
    *   Post-conditions

### Phase 4: Test Implementation (The "Code")
*   **Action:** Converting manual test cases into automated scripts (Playwright, Selenium) and defining Page Objects.
*   **B.L.A.S.T. UI Component:** `PlaywrightPOM.jsx`, `SeleniumBDD.jsx`
*   **Concept:** Page Object Model (POM) generation, BDD Step Definitions.

### Phase 5: Test Execution & Reporting (The "Result")
*   **Action:** Running the tests via CI/CD and logging results.
*   **B.L.A.S.T. UI Component:** `GitHubCICD.jsx`, `ZephyrDashboard.jsx`
*   **Output:** Pass/Fail metrics, Coverage Reports, Defect logging (creating Level 4 Bugs in Jira).

### Phase 6: Test Closure
*   **Action:** Finalizing the test cycle, collecting metrics, and evaluating exit criteria.
*   **B.L.A.S.T. UI Component:** Coverage/Metrics Dashboard.
*   **Output:** Test Summary Report.

---

## 3. Data Schema for Frontend Implementation

When building the UI to represent this hierarchy, the state management (or MongoDB Schema) should reflect this nested structure:

```json
{
  "jiraHierarchy": {
    "initiative": {
      "id": "INIT-101",
      "summary": "Revamp User Authentication",
      "epics": [
        {
          "id": "EPIC-202",
          "summary": "Implement SSO",
          "userStories": [
            {
              "id": "STORY-303",
              "summary": "As a user, I want to login with Google...",
              "acceptanceCriteria": ["Must redirect to Google OAuth", "Must handle rejected permissions"],
              "linkedTestCases": ["TC-001", "TC-002"],
              "subTasks": ["TASK-401", "BUG-402"]
            }
          ]
        }
      ]
    }
  }
}
```

## 4. UI Implementation Plan

Based on this architecture, the future updates to the B.L.A.S.T. frontend should include:
1.  **Jira Tree View:** A UI component that visually nests the Jira issues (Initiative -> Epic -> Story -> Sub-task).
2.  **Traceability Matrix:** A dashboard view showing which User Stories have Test Cases written, automated, and executed.
3.  **Context-Aware Test Generation:** When a user selects a User Story, the LLM should automatically pull the Epic context to generate better Test Cases.