import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List, Dict
import requests
from dotenv import load_dotenv
import uuid

# Import our custom tools (ensure they are in the PYTHONPATH)
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from tools.jira_tool import JiraTool
from tools.llm_connector import LLMConnector
from tools.docx_generator import DocxGenerator
from tools.confluence_tool import ConfluenceTool

load_dotenv()

app = FastAPI(title="Intelligent Test Planner API")

class ConnectionConfig(BaseModel):
    url: Optional[str] = None
    email: Optional[str] = None
    token: Optional[str] = None
    platform: Optional[str] = None
    apiKey: Optional[str] = None
    endpoint: Optional[str] = None
    status: Optional[str] = None
    message: Optional[str] = None

class ConnectionRequest(BaseModel):
    type: str # jira, ado, llm
    config: ConnectionConfig

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class JiraConnection(BaseModel):
    url: str
    email: str
    token: str

class LLMConnection(BaseModel):
    platform: str
    apiKey: str
    endpoint: Optional[str] = None

class FetchRequest(BaseModel):
    productName: Optional[str] = ""
    projectKey: str
    sprint: Optional[str] = ""
    context: Optional[str] = ""
    jira: JiraConnection

class GenerateRequest(BaseModel):
    issueData: Dict
    llm: LLMConnection
    model: Optional[str] = None

class PublishRequest(BaseModel):
    title: str
    content: str
    spaceKey: str
    parentId: Optional[str] = None
    jira: JiraConnection

@app.get("/")
async def root():
    return {"message": "Test Planner API is running"}

@app.post("/test-connection")
async def test_connection(conn: ConnectionRequest):
    try:
        if conn.type == "jira" or conn.type == "ado":
            tool = JiraTool(conn.config.url, conn.config.email, conn.config.token)
            # Simple test: get current user info
            user_data = tool.test_connection()
            return {"status": "success", "message": f"Connected as {user_data.get('displayName', 'User')}"}
        
        elif conn.type == "llm":
            connector = LLMConnector(conn.config.platform, conn.config.apiKey, conn.config.endpoint)
            # Simple test: generate a tiny word
            response = connector.generate_content("Say only the word 'Connected' and nothing else.")
            print(f"LLM Connection Test Response: {response}")
            if "connected" in response.lower():
                return {"status": "success", "message": "LLM Connection Verified"}
            else:
                return {"status": "error", "message": f"Invalid response: {response[:50]}..."}
                
        return {"status": "error", "message": "Unsupported connection type"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/test-jira")
async def test_jira(conn: JiraConnection):
    # Backward compatibility or separate test
    try:
        tool = JiraTool(conn.url, conn.email, conn.token)
        user_data = tool.test_connection()
        return {"status": "success", "message": f"Connected as {user_data.get('displayName')}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/fetch-issue")
async def fetch_issue(req: FetchRequest):
    try:
        tool = JiraTool(req.jira.url, req.jira.email, req.jira.token)
        
        req.productName = req.productName.strip() if req.productName else ""
        req.sprint = req.sprint.strip() if req.sprint else ""
        req.projectKey = req.projectKey.strip()

        # Determine if we have a direct ID in productName or sprint (ID field)
        direct_id = None
        id_pattern = f"{req.projectKey}-"
        
        if req.productName and id_pattern.upper() in req.productName.upper():
            direct_id = req.productName
        elif req.sprint:
            # If they gave the full ID (SCRUM-6) or just the number (6)
            if id_pattern.upper() in req.sprint.upper():
                direct_id = req.sprint
            elif req.sprint.isdigit():
                direct_id = f"{req.projectKey}-{req.sprint}"
            
        if direct_id:
            # It's a direct ID (e.g. VWOAPP-123)
            print(f"Fetching direct issue ID: {direct_id}")
            issue_data = tool.fetch_issue(direct_id)
        else:
            # Search for issues based on project and sprint
            jql = f"project = '{req.projectKey}'"
            if req.sprint:
                jql += f" AND (sprint = '{req.sprint}' OR fixVersion = '{req.sprint}' OR summary ~ '{req.sprint}')"
            
            print(f"Searching Jira with JQL: {jql}")
            issues = tool.search_issues(jql)
            if not issues:
                raise Exception(f"No issues found for JQL: {jql}")
            issue_data = issues[0]
            
        # Add metadata for UI preview
        if req.context:
            issue_data["additional_context"] = req.context
        issue_data["product"] = req.productName
        
        return issue_data
    except Exception as e:
        print(f"Final Jira Error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/generate-plan")
async def generate_plan(req: GenerateRequest):
    try:
        connector = LLMConnector(req.llm.platform, req.llm.apiKey, req.llm.endpoint)
        
        # Comprehensive System/User Prompt for QA Test Planning
        system_prompt = "You are an expert QA Strategic Lead. Generate a professional and comprehensive Test Plan."
        user_prompt = f"""
Generate a detailed Test Plan based on the following Jira requirement:

PRODUCT: {req.issueData.get('product', 'Unknown Product')}
JIRA ID: {req.issueData.get('id', 'N/A')}
SUMMARY: {req.issueData.get('summary', 'N/A')}
DESCRIPTION: {req.issueData.get('description', 'N/A')}
ADDITIONAL CONTEXT: {req.issueData.get('additional_context', 'None')}

Please structure the output as follows:
1. INTRODUCTION & OBJECTIVES
2. SCOPE (In-scope and Out-of-scope)
3. TEST STRATEGY (Types of testing, Environment, Tools)
4. TEST SCENARIOS (High-level scenarios mapping to requirements)
5. RISKS & ASSUMPTIONS

Use professional tone. Do not use markdown formatting in the final text (just plain text or bullet points) as it will be inserted into a Word document.
"""
        plan_content = connector.generate_content(user_prompt, system_prompt=system_prompt)
        
        template_path = r"c:\Users\DELL\AI Workspace\AI My Projects\MyAIProjects\AI_Agents\test_plan_document\Test Plan - Template.docx"
        output_path = os.path.join(os.getcwd(), ".tmp", f"Test_Plan_{uuid.uuid4()}.docx")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        gen = DocxGenerator(template_path)
        gen.generate({
            "project_name": req.issueData.get('project', 'N/A'),
            "summary": req.issueData.get('summary', 'N/A'),
            "description": req.issueData.get('description', 'N/A'),
            "test_plan_content": plan_content
        }, output_path)
        
        # Also save a .md file
        md_filename = f"Test_Plan_{uuid.uuid4()}.md"
        md_path = os.path.join(os.getcwd(), ".tmp", md_filename)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(plan_content)
        
        return {
            "plan": plan_content, 
            "download_url": f"/download/{os.path.basename(output_path)}",
            "md_download_url": f"/download/{md_filename}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/download/{filename}")
async def download_file(filename: str):
    path = os.path.join(os.getcwd(), ".tmp", filename)
    if os.path.exists(path):
        return FileResponse(path, media_type='application/octet-stream', filename=filename)
    raise HTTPException(status_code=404, detail="File not found")

@app.post("/publish-confluence")
async def publish_confluence(req: PublishRequest):
    try:
        # Use existing Jira credentials if the user didn't provide different ones
        tool = ConfluenceTool(req.jira.url, req.jira.email, req.jira.token)
        result = tool.create_page(req.spaceKey, req.title, req.content, req.parentId)
        return {"status": "success", "url": f"{req.jira.url}/wiki{result.get('_links', {}).get('webui')}"}
    except Exception as e:
        print(f"Confluence error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
