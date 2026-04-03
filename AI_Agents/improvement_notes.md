# B.L.A.S.T. — Improvement Notes

> These are pending UI/UX improvements to be implemented. When the user says "do the notes", implement all items below.

---

## 1. App Favicon / Tab Logo
- **Component:** `client/index.html`
- **Issue:** No custom logo/favicon appears in the browser tab
- **Action:** Design and add a custom B.L.A.S.T. favicon (16x16, 32x32, 192x192) so all browser tabs show the app logo
- **Priority:** Low

---

## 2. CI/CD Pipeline — "Test Report Generated" Button Timing
- **Component:** `GitHubCICD.jsx`
- **Issue:** The "Test Report Generated" / "View Report" option is shown as enabled even while the pipeline is still running
- **Action:** Disable the "View Report" button until:
  1. The pipeline run has completed successfully
  2. The test report artifact is actually ready to view
- Show it as grayed out / disabled with a tooltip like "Report will be available after pipeline completes"
- **Priority:** High

---

## 3. ZIP Download — Remove Unnecessary Files
- **Component:** `PlaywrightPOM.jsx`, `PlaywrightJS.jsx` (ZIP generation)
- **Issue:** Downloaded ZIP contains unnecessary files (markdown files, extra compressed files). Videos and images are fine (needed for reports).
- **Action:** Review all files included in the ZIP download. Remove:
  - Markdown (.md) files
  - Any other non-essential files that aren't part of the actual test framework
  - Keep: test specs, page objects, config, videos, images/screenshots
- **Priority:** Medium

---

## 4. Real-Time Execution — Status Icon Color
- **Component:** `GitHubCICD.jsx` (Real-Time Execution section)
- **Issue:** The real-time execution icon shows a red X (failure indicator) even when the build is passing
- **Action:** Fix the status icon to correctly reflect the pipeline status:
  - Green checkmark ✅ when build is passing
  - Red X ❌ only when build is actually failing
  - Spinner/loading when still running
- **Priority:** High

---

## 5. Review Page — Multiple UX Improvements
- **Component:** `ReviewTestCases.jsx`

### 5a. Approval & Export Buttons
- **Issue:** "Approval" and "Export Test Cases" buttons are enabled even before review is done
- **Action:** Disable these buttons until the review process is completed. Show tooltip: "Complete the review first"

### 5b. Remove "Save as Draft" Button
- **Issue:** "Save as Draft" button exists but is not functioning
- **Action:** Remove it entirely from the UI

### 5c. Add "Clear" Button
- **Issue:** No way to reset/clear the review form
- **Action:** Add a "Clear" button that resets:
  - JIRA ID field
  - Uploaded file
  - Manual requirement text
  - All review results

### 5d. Mutual Exclusion of Input Methods
- **Issue:** All three input options (JIRA ID, File Upload, Manual Entry) can be used simultaneously
- **Action:** When one input method is selected/filled:
  - Disable the other two input methods
  - Show tooltip on disabled options: "Clear current input to use this method"
  - If user clears the active input, re-enable all three options
- **Priority:** High

---

## 6. AI & Risk Intelligence — Collapsible Cards
- **Component:** `ReviewTestCases.jsx` (AI & Risk Intelligence section)
- **Issue:** Too many items requiring arrow-key scrolling to see everything. Cards are not well-aligned.
- **Action:**
  1. Make it a **collapsible/drill-down** design — show just the section header or a compact card
  2. When user clicks on it, expand to show the full details
  3. Align all cards properly in a consistent grid/layout
  4. "Approval" and "Export" buttons should only be visible AFTER the review is completed
- **Priority:** Medium

---

*Last updated: April 3, 2026*
