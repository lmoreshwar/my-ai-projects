const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const JiraTool = require('./tools/jira_tool');
const LLMConnector = require('./tools/llm_connector');
const DocxGenerator = require('./tools/docx_generator');
const ConfluenceTool = require('./tools/confluence_tool');

const app = express();

app.use(cors());
app.use(express.json());

// Main status route
app.get('/', (req, res) => {
    res.json({ message: "Test Planner Node API is running seamlessly!" });
});

// Connection Tester
app.post('/test-connection', async (req, res) => {
    try {
        const conn = req.body;
        
        if (conn.type === 'jira' || conn.type === 'ado') {
            const tool = new JiraTool(conn.config.url, conn.config.email, conn.config.token);
            const userData = await tool.testConnection();
            return res.json({ status: 'success', message: `Connected as ${userData.displayName || 'User'}` });
        } else if (conn.type === 'llm') {
            const connector = new LLMConnector(conn.config.platform, conn.config.apiKey, conn.config.endpoint);
            const response = await connector.generateContent("Say only the word 'Connected' and nothing else.");
            console.log(`LLM Connection Test Response: ${response}`);
            if (response && response.toLowerCase().includes('connected')) {
                return res.json({ status: 'success', message: 'LLM Connection Verified' });
            } else {
                return res.json({ status: 'error', message: `Invalid response: ${response && response.substring(0, 50)}...` });
            }
        }
        
        return res.status(400).json({ status: 'error', message: 'Unsupported connection type' });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/test-jira', async (req, res) => {
    try {
        const { url, email, token } = req.body;
        const tool = new JiraTool(url, email, token);
        const userData = await tool.testConnection();
        return res.json({ status: 'success', message: `Connected as ${userData.displayName}` });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
});

// Fetch Issue logic mapping
app.post('/fetch-issue', async (req, res) => {
    try {
        const reqData = req.body;
        const tool = new JiraTool(reqData.jira.url, reqData.jira.email, reqData.jira.token);

        const productName = (reqData.productName || '').trim();
        const sprint = (reqData.sprint || '').trim();
        const projectKey = (reqData.projectKey || '').trim();
        
        let directId = null;
        const idPattern = `${projectKey}-`;

        if (productName && productName.toUpperCase().includes(idPattern.toUpperCase())) {
            directId = productName;
        } else if (sprint) {
            if (sprint.toUpperCase().includes(idPattern.toUpperCase())) {
                directId = sprint;
            } else if (!isNaN(sprint)) {
                directId = `${projectKey}-${sprint}`;
            }
        }

        let issueData;
        if (directId) {
            console.log(`Fetching direct issue ID: ${directId}`);
            issueData = await tool.fetchIssue(directId);
        } else {
            let jql = `project = '${projectKey}'`;
            if (sprint) {
                jql += ` AND (sprint = '${sprint}' OR fixVersion = '${sprint}' OR summary ~ '${sprint}')`;
            }
            console.log(`Searching Jira with JQL: ${jql}`);
            const issues = await tool.searchIssues(jql);
            if (!issues || issues.length === 0) {
                throw new Error(`No issues found for JQL: ${jql}`);
            }
            issueData = issues[0];
        }

        if (reqData.context) issueData.additional_context = reqData.context;
        issueData.product = reqData.productName;

        return res.json(issueData);
    } catch (error) {
        console.error(`Final Jira Error: ${error.message}`);
        return res.status(400).json({ detail: error.message });
    }
});

// Generate Test Plan Output
app.post('/generate-plan', async (req, res) => {
    try {
        const reqData = req.body;
        const connector = new LLMConnector(reqData.llm.platform, reqData.llm.apiKey, reqData.llm.endpoint);

        const systemPrompt = "You are an expert QA Strategic Lead. Generate a professional and comprehensive Test Plan.";
        const userPrompt = `Generate a detailed Test Plan based on the following Jira requirement:

PRODUCT: ${reqData.issueData.product || 'Unknown Product'}
JIRA ID: ${reqData.issueData.id || 'N/A'}
SUMMARY: ${reqData.issueData.summary || 'N/A'}
DESCRIPTION: ${reqData.issueData.description || 'N/A'}
ADDITIONAL CONTEXT: ${reqData.issueData.additional_context || 'None'}

Please structure the output as follows:
1. INTRODUCTION & OBJECTIVES
2. SCOPE (In-scope and Out-of-scope)
3. TEST STRATEGY (Types of testing, Environment, Tools)
4. TEST SCENARIOS (High-level scenarios mapping to requirements)
5. RISKS & ASSUMPTIONS

Use professional tone. Do not use markdown formatting in the final text (just plain text or bullet points) as it will be inserted into a Word document.`;

        const planContent = await connector.generateContent(userPrompt, systemPrompt, reqData.model);

        // Calculate template path based on deployed location (project root logic)
        // Check if we are in API dir directly or root
        let rootPath = path.dirname(__dirname); // if this is running in /api
        let templatePath = path.join(rootPath, "test_plan_document", "Test Plan - Template.docx");
        
        // If not found in root, assume we are running from project root
        if (!fs.existsSync(templatePath)) {
             templatePath = path.join(process.cwd(), "test_plan_document", "Test Plan - Template.docx");
        }

        const runId = uuidv4();
        // Use a proper tmp directory for serverless (typically /tmp in Vercel)
        const tmpDir = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), '.tmp');
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        const docxOutputName = `Test_Plan_${runId}.docx`;
        const docxOutputPath = path.join(tmpDir, docxOutputName);

        const mdOutputName = `Test_Plan_${runId}.md`;
        const mdOutputPath = path.join(tmpDir, mdOutputName);

        const gen = new DocxGenerator(templatePath);
        gen.generate({
            project_name: reqData.issueData.project || 'N/A',
            summary: reqData.issueData.summary || 'N/A',
            description: reqData.issueData.description || 'N/A',
            test_plan_content: planContent
        }, docxOutputPath);

        fs.writeFileSync(mdOutputPath, planContent, 'utf8');

        return res.json({
            plan: planContent,
            download_url: `/download/${docxOutputName}`,
            md_download_url: `/download/${mdOutputName}`
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ detail: error.message });
    }
});

// File Downloads
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    // ensure no arbitrary folder access
    if (filename.includes('/') || filename.includes('..')) {
        return res.status(403).json({ detail: "Invalid filename" });
    }
    
    // Check both local .tmp and vercel /tmp
    const localTmp = path.join(process.cwd(), '.tmp', filename);
    const apiTmp = process.env.VERCEL ? path.join('/tmp', filename) : localTmp;
    
    if (fs.existsSync(apiTmp)) {
        return res.download(apiTmp, filename);
    } else if (fs.existsSync(localTmp)) {
        return res.download(localTmp, filename);
    }
    
    return res.status(404).json({ detail: "File not found." });
});

// Confluence Publisher
app.post('/publish-confluence', async (req, res) => {
    try {
        const reqData = req.body;
        const tool = new ConfluenceTool(reqData.jira.url, reqData.jira.email, reqData.jira.token);
        const result = await tool.createPage(reqData.spaceKey, reqData.title, reqData.content, reqData.parentId);
        
        let webUiPath = '';
        if (result && result._links && result._links.webui) {
            webUiPath = result._links.webui;
        }

        return res.json({ status: 'success', url: `${reqData.jira.url}/wiki${webUiPath}` });
    } catch (error) {
        console.error(`Confluence error: ${error.message}`);
        return res.status(400).json({ detail: error.message });
    }
});

// Export the app for Vercel Serverless Function
module.exports = app;

// Listen if running locally directly via 'node index.js'
if (require.main === module) {
    const port = process.env.PORT || 8000;
    app.listen(port, () => {
        console.log(`Test Planner API running on port ${port}`);
    });
}
