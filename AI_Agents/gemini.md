# Project Constitution: Test Planner Agent

## Data Schemas

### Jira/ADO Feature Input
```json
{
  "id": "string",
  "platform": "jira|ado|xray",
  "summary": "string",
  "description": "string",
  "acceptance_criteria": "string[]",
  "attachments": "string[]"
}
```

### Connection Schema
```json
{
  "type": "jira|ado|xray|llm",
  "name": "string",
  "config": {
    "url": "string",
    "email": "string",
    "token": "string",
    "platform": "groq|ollama|grok|openai",
    "apiKey": "string",
    "endpoint": "string"
  },
  "status": "connected|disconnected|testing"
}
```

### UI State Schema
```json
{
  "step": 1|2|3|4,
  "theme": "light|dark",
  "sidebarOpen": "boolean",
  "activeTab": "dashboard|curriculum|settings|intelligent_test_planner",
  "loading": "boolean",
  "connections": "Connection[]",
  "currentIssue": "IssueData|null",
  "generatedPlan": "string|null",
  "downloadUrl": "string|null"
}
```

### Test Plan Output
```json
{
  "project_name": "string",
  "test_objectives": "string",
  "scope": "string",
  "test_strategy": "string",
  "test_plan_content": "string"
}
```

## Behavioral Rules
- **Integrity**: Never hallucinate test cases. Use context from the feature description.
- **Protocol**: Follow B.L.A.S.T. for all automation.
- **Security**: Never store plain-text credentials. Use `.env`.

## Architectural Invariants
- Layer 1: Architecture (SOPs in `architecture/`)
- Layer 2: Navigation (Logic in `src/`)
- Layer 3: Tools (Execution scripts in `tools/`)

## Maintenance Log
- 2026-03-30: Project initialized by Antigravity.
