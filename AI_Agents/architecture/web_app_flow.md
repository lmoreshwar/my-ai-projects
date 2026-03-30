# SOP: Web App Workflow

## Application Overview
The Intelligent Test Planning Agent is a 4-step wizard-style application:

### Step 1: Setup (JIRA & LLM Connections)
- **UI Elements**: Forms for Connection Name, JIRA URL, Email, API Token.
- **LLM Settings**: Platform selection (Groq, Ollama, Gemini), API Key, Endpoint (for Ollama).
- **Functionality**: "Test Connection" button for both JIRA and LLM.
- **Persistence**: Store settings in LocalStorage (for UI) and pass to Backend headers/body during work.

### Step 2: Fetch Issues
- **UI Elements**: Input for JIRA ID (e.g., TEST-123) and an optional "Context" text area.
- **Functionality**: Button to fetch issue details (Summary, Description, Acceptance Criteria).
- **Backend**: Calls `jira_tool.py` to get raw data.

### Step 3: Review
- **UI Elements**: Editable form showing fetched details.
- **Functionality**: Allow user to refine or add more details before AI processing.
- **Output**: JSON payload ready for the planner tool.

### Step 4: Test Plan
- **UI Elements**: "Generate Test Plan" button and Model selection dropdown.
- **Functionality**: LLM processes the data and returns a structured Test Plan.
- **Final Action**: Download as `.docx` using `docx_generator.py`.
