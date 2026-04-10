const express = require('express');

console.log('Backend server starting...');

const connectDB = require('./db');
// Connect to MongoDB
console.log('Attempting MongoDB connection...');
connectDB();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const JiraTool = require('./_tools/jira_tool');
const LLMConnector = require('./_tools/llm_connector');
const DocxGenerator = require('./_tools/docx_generator');
const ConfluenceTool = require('./_tools/confluence_tool');

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));

// Strip /api prefix if present (for Vercel deployment compatibility)
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        req.url = req.url.replace('/api', '');
    }
    next();
});

// Serve React static files (Render / standalone — not Vercel)
// Must be BEFORE API routes so static assets (JS, CSS, images) are served directly
const _clientDist = path.join(__dirname, '..', 'client', 'dist');
if (!process.env.VERCEL && fs.existsSync(_clientDist)) {
    app.use(express.static(_clientDist));
    console.log(`[Server] Serving React frontend from ${_clientDist}`);
}

// Main status route (API health check)
app.get('/health', (req, res) => {
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
            // Use user's model if provided, otherwise let connector use its default
            let userModel = conn.config.model && conn.config.model.trim() ? conn.config.model.trim() : null;
            console.log(`[Connection Test] Platform: ${conn.config.platform}, Model: ${userModel || 'default'}, Endpoint: ${conn.config.endpoint || 'default'}`);
            const result = await connector.generateContent("Say only the word 'Connected' and nothing else.", undefined, userModel);
            const response = typeof result === 'object' ? result.content : result;
            console.log(`LLM Connection Test Response (model: ${userModel || 'default'}): ${response}`);
            if (response && response.toLowerCase().includes('connected')) {
                return res.json({ status: 'success', message: `LLM Connected (model: ${userModel || 'default'})` });
            } else {
                return res.json({ status: 'error', message: `Unexpected LLM response: ${response && response.substring(0, 80)}` });
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

// Zephyr Scale Connection Test
app.post('/test-zephyr', async (req, res) => {
    try {
        const { url, apiKey } = req.body;
        const axios = require('axios');
        const baseUrl = (url || 'https://api.zephyrscale.smartbear.com/v2').replace(/\/$/, '');
        const response = await axios.get(`${baseUrl}/healthcheck`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            },
            timeout: 10000
        });
        return res.json({ status: 'success', message: 'Zephyr Scale Connected' });
    } catch (error) {
        // Even if healthcheck fails, try /testcases endpoint as fallback
        try {
            const axios = require('axios');
            const baseUrl = (req.body.url || 'https://api.zephyrscale.smartbear.com/v2').replace(/\/$/, '');
            const response = await axios.get(`${baseUrl}/testcases?maxResults=1`, {
                headers: {
                    'Authorization': `Bearer ${req.body.apiKey}`,
                    'Accept': 'application/json'
                },
                timeout: 10000
            });
            return res.json({ status: 'success', message: 'Zephyr Scale Connected' });
        } catch (e2) {
            const errStr = e2.response ? `${e2.response.status} - ${JSON.stringify(e2.response.data)}` : e2.message;
            return res.status(400).json({ status: 'error', message: `Zephyr Connection failed: ${errStr}` });
        }
    }
});

// GitHub Connection Test – validates PAT and returns user info + repos
app.post('/test-github', async (req, res) => {
    try {
        const { token, apiUrl } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');

        // Use Bearer for fine-grained tokens (github_pat_), also works for classic (ghp_)
        const authHeader = `Bearer ${token}`;
        console.log(`GitHub: Testing connection to ${baseUrl} (token prefix: ${token.substring(0, 10)}...)`);

        // Validate token by fetching authenticated user
        const userRes = await axios.get(`${baseUrl}/user`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 10000,
        });
        const username = userRes.data.login;
        console.log(`GitHub: Authenticated as ${username}`);

        // Fetch repos (up to 100) – affiliation covers owned, collaborator & org repos
        const reposRes = await axios.get(`${baseUrl}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&visibility=all`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 15000,
        });
        const repos = reposRes.data.map(r => ({ name: r.full_name, visibility: r.private ? 'Private' : 'Public', default_branch: r.default_branch }));
        console.log(`GitHub: Found ${repos.length} repos:`, repos.map(r => `${r.name} (${r.visibility})`).join(', '));

        return res.json({ status: 'success', message: `Connected as ${username}`, username, repos });
    } catch (error) {
        console.error('GitHub connection error:', error.response?.status, error.response?.data || error.message);
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Unauthorized'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// GitHub – fetch branches for a specific repo
app.post('/github-branches', async (req, res) => {
    try {
        const { token, apiUrl, repo } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');

        const authHeader = `Bearer ${token}`;
        const branchRes = await axios.get(`${baseUrl}/repos/${repo}/branches?per_page=100`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 10000,
        });
        const branches = branchRes.data.map(b => b.name);

        return res.json({ status: 'success', branches });
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// GitHub – Create a new branch from an existing one
app.post('/github-create-branch', async (req, res) => {
    try {
        const { token, apiUrl, repo, baseBranch, newBranch } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        // 1. Get the SHA of the base branch
        const refRes = await axios.get(`${baseUrl}/repos/${repo}/git/ref/heads/${baseBranch}`, {
            headers: { Authorization: authHeader, Accept: 'application/vnd.github+json' },
            timeout: 10000,
        });
        const sha = refRes.data.object.sha;

        // 2. Create new branch ref
        await axios.post(`${baseUrl}/repos/${repo}/git/refs`, {
            ref: `refs/heads/${newBranch}`,
            sha,
        }, {
            headers: { Authorization: authHeader, Accept: 'application/vnd.github+json' },
            timeout: 10000,
        });

        return res.json({ status: 'success', message: `Branch "${newBranch}" created from "${baseBranch}"` });
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// GitHub – Get file content from repo (for conflict comparison)
app.post('/github-file-content', async (req, res) => {
    try {
        const { token, apiUrl, repo, branch, filePath } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        const fileRes = await axios.get(`${baseUrl}/repos/${repo}/contents/${filePath}?ref=${branch}`, {
            headers: { Authorization: authHeader, Accept: 'application/vnd.github+json' },
            timeout: 10000,
        });
        const content = Buffer.from(fileRes.data.content, 'base64').toString('utf-8');
        return res.json({ status: 'success', content, sha: fileRes.data.sha, size: fileRes.data.size });
    } catch (error) {
        if (error.response?.status === 404) {
            return res.json({ status: 'not_found' });
        }
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// GitHub – Atomic push via Git Tree API (create blobs → tree → commit → update ref)
app.post('/github-push-tree', async (req, res) => {
    try {
        const { token, apiUrl, repo, branch, commitMessage, files } = req.body;
        // files: [{ path, content }]
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;
        const headers = { Authorization: authHeader, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };

        console.log(`[GitHub Push Tree] ${files.length} files → ${repo}@${branch}`);

        // 1. Get latest commit SHA on the branch
        const refRes = await axios.get(`${baseUrl}/repos/${repo}/git/ref/heads/${branch}`, { headers, timeout: 10000 });
        const latestCommitSha = refRes.data.object.sha;

        // 2. Get the tree SHA from the latest commit
        const commitRes = await axios.get(`${baseUrl}/repos/${repo}/git/commits/${latestCommitSha}`, { headers, timeout: 10000 });
        const baseTreeSha = commitRes.data.tree.sha;

        // 3. Create blobs for all files
        const treeItems = [];
        for (const file of files) {
            const blobRes = await axios.post(`${baseUrl}/repos/${repo}/git/blobs`, {
                content: file.content,
                encoding: 'utf-8',
            }, { headers, timeout: 15000 });
            treeItems.push({
                path: file.path,
                mode: '100644',
                type: 'blob',
                sha: blobRes.data.sha,
            });
        }

        // 4. Create new tree
        const treeRes = await axios.post(`${baseUrl}/repos/${repo}/git/trees`, {
            base_tree: baseTreeSha,
            tree: treeItems,
        }, { headers, timeout: 15000 });
        const newTreeSha = treeRes.data.sha;

        // 5. Create new commit
        const newCommitRes = await axios.post(`${baseUrl}/repos/${repo}/git/commits`, {
            message: commitMessage,
            tree: newTreeSha,
            parents: [latestCommitSha],
        }, { headers, timeout: 15000 });
        const newCommitSha = newCommitRes.data.sha;

        // 6. Update branch ref
        await axios.patch(`${baseUrl}/repos/${repo}/git/refs/heads/${branch}`, {
            sha: newCommitSha,
        }, { headers, timeout: 10000 });

        console.log(`[GitHub Push Tree] Success → commit ${newCommitSha.substring(0, 7)}`);
        return res.json({ status: 'success', commitSha: newCommitSha, message: `Pushed ${files.length} files in 1 atomic commit` });
    } catch (error) {
        console.error('[GitHub Push Tree] Error:', error.response?.status, error.response?.data || error.message);
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// GitHub – Compare: check if branch has diverged (detect conflicts)
app.post('/github-compare', async (req, res) => {
    try {
        const { token, apiUrl, repo, branch, filePaths } = req.body;
        // filePaths: [{ remotePath, localContent }]
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;
        const headers = { Authorization: authHeader, Accept: 'application/vnd.github+json' };

        const results = [];
        for (const fp of filePaths) {
            try {
                const fileRes = await axios.get(`${baseUrl}/repos/${repo}/contents/${fp.remotePath}?ref=${branch}`, { headers, timeout: 10000 });
                const remoteContent = Buffer.from(fileRes.data.content, 'base64').toString('utf-8');
                const remoteSha = fileRes.data.sha;

                if (remoteContent.trim() === fp.localContent.trim()) {
                    results.push({ path: fp.remotePath, status: 'unchanged', remoteSha });
                } else {
                    results.push({ path: fp.remotePath, status: 'modified', remoteSha, remoteContent });
                }
            } catch (err) {
                if (err.response?.status === 404) {
                    results.push({ path: fp.remotePath, status: 'new', remoteSha: null, remoteContent: null });
                } else {
                    results.push({ path: fp.remotePath, status: 'error', error: err.message });
                }
            }
        }
        return res.json({ status: 'success', results });
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// ── Confluence Integration (uses same JIRA/Atlassian credentials) ──

// Test Confluence connectivity
app.post('/test-confluence', async (req, res) => {
    try {
        const { url, email, token } = req.body;
        const tool = new ConfluenceTool(url, email, token);
        const user = await tool.testConnection();
        return res.json({ status: 'success', message: `Confluence connected as ${user.displayName || user.username || 'User'}` });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
});

// List Confluence spaces
app.post('/confluence-spaces', async (req, res) => {
    try {
        const { url, email, token } = req.body;
        const tool = new ConfluenceTool(url, email, token);
        const spaces = await tool.listSpaces();
        return res.json({ status: 'success', spaces });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
});

// Search pages in a Confluence space (for parent page picker)
app.post('/confluence-pages', async (req, res) => {
    try {
        const { url, email, token, spaceKey, query } = req.body;
        const tool = new ConfluenceTool(url, email, token);
        const pages = await tool.searchPages(spaceKey, query || '');
        return res.json({ status: 'success', pages });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
});

// Push content to Confluence (create or update page)
app.post('/push-confluence', async (req, res) => {
    try {
        const { url, email, token, spaceKey, title, content, parentPageId } = req.body;
        if (!spaceKey || !title || !content) {
            return res.status(400).json({ status: 'error', message: 'spaceKey, title, and content are required' });
        }
        const tool = new ConfluenceTool(url, email, token);
        const result = await tool.publishPage(spaceKey, title, content, parentPageId || null);
        console.log(`[Confluence] Page ${result.action}: ${result.title} (ID: ${result.id})`);
        return res.json({ status: 'success', ...result });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
});

// Fetch Confluence page content (for importing requirements)
app.post('/confluence-page-content', async (req, res) => {
    try {
        const { url, email, token, pageId } = req.body;
        if (!pageId) {
            return res.status(400).json({ status: 'error', message: 'pageId is required' });
        }
        const tool = new ConfluenceTool(url, email, token);
        const page = await tool.fetchPageContent(pageId);
        return res.json({ status: 'success', ...page });
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

        const product = (reqData.issueData.product || '').toLowerCase();
        const isAutomation = product.includes('selenium') || product.includes('playwright');

        let systemPrompt, userPrompt;

        if (isAutomation && reqData.issueData.additional_context) {
            // Automation pages (Selenium BDD, Playwright JS) send a specialized system prompt
            // in additional_context — use it directly instead of the generic Test Plan template
            systemPrompt = reqData.issueData.additional_context;
            userPrompt = `Generate automation code for the following requirement:

PRODUCT: ${reqData.issueData.product || 'Unknown Product'}
ID: ${reqData.issueData.id || 'N/A'}
SUMMARY: ${reqData.issueData.summary || 'N/A'}

REQUIREMENT:
${reqData.issueData.description || 'N/A'}`;
        } else if (reqData.issueData.additional_context && reqData.issueData.additional_context.length > 100) {
            // Pages that send a substantial additional_context (Test Cases, Scenarios, Coverage Review)
            // use their own system prompt — pass it directly instead of the generic Test Plan template
            systemPrompt = reqData.issueData.additional_context;
            userPrompt = `Analyze the following requirement and generate output strictly according to your instructions:

PRODUCT: ${reqData.issueData.product || 'Unknown Product'}
ID: ${reqData.issueData.id || 'N/A'}
SUMMARY: ${reqData.issueData.summary || 'N/A'}

REQUIREMENT / INPUT:
${reqData.issueData.description || 'N/A'}`;
        } else {
            // Default: Test Plan generation with STRICT anti-hallucination rules
            systemPrompt = `You are an expert QA Strategic Lead operating under STRICT anti-hallucination rules.

ANTI-HALLUCINATION RULES (MANDATORY):
1. You may ONLY use information explicitly provided in the JIRA ticket data or user input below.
2. DO NOT invent features, APIs, error codes, UI elements, system behavior, or test data.
3. DO NOT assume default or "typical" system behavior that is not described in the input.
4. If a field is missing, empty, or marked "N/A", you MUST acknowledge it as "Insufficient information" — do NOT fabricate content for it.
5. Every test scenario, step, and expected result MUST be directly traceable to the provided input.
6. If information is insufficient to create a section, write: "⚠ Insufficient information — this section cannot be completed without additional details."
7. Output must be deterministic and repeatable.

PROCESS:
Step 1: Extract verifiable facts from the input.
Step 2: Identify and list missing or unknown information.
Step 3: Generate the test plan ONLY from Step 1 facts.
Step 4: Perform a self-check — remove any hallucinated or assumed content.

Generate a professional and comprehensive Test Plan.`;

            // Build fact inventory for the prompt
            const descriptionText = reqData.issueData.description && reqData.issueData.description.trim().length > 5
                ? reqData.issueData.description
                : '⚠ NOT PROVIDED';
            const summaryText = reqData.issueData.summary && reqData.issueData.summary.trim().length > 3
                ? reqData.issueData.summary
                : '⚠ NOT PROVIDED';
            const additionalCtx = reqData.issueData.additional_context && reqData.issueData.additional_context.trim().length > 0
                ? reqData.issueData.additional_context
                : 'None';
            const isManual = reqData.issueData.inputMode === 'manual';

            userPrompt = `Generate a detailed Test Plan based on the following ${isManual ? 'manually provided requirement' : 'Jira requirement'}:

${isManual ? 'SOURCE: Manual User Input' : `JIRA ID: ${reqData.issueData.id || 'N/A'}`}
PRODUCT: ${reqData.issueData.product || 'Unknown Product'}
SUMMARY: ${summaryText}
DESCRIPTION: ${descriptionText}
ADDITIONAL CONTEXT: ${additionalCtx}

IMPORTANT: Before generating, list the "Verified Facts" and "Missing Information" at the top.

Please structure the output as follows:
## VERIFIED FACTS (from input)
## MISSING INFORMATION (fields not provided)
## 1. INTRODUCTION & OBJECTIVES
## 2. SCOPE (In-scope and Out-of-scope)
## 3. TEST STRATEGY (Types of testing, Environment, Tools)
## 4. TEST SCENARIOS (High-level scenarios mapping ONLY to provided requirements)
## 5. RISKS & ASSUMPTIONS

For any section where input data is insufficient, explicitly state: "⚠ Insufficient information to determine."
Do NOT fabricate test scenarios for features not mentioned in the input.`;
        }

        console.log(`[generate-plan] Product: "${reqData.issueData.product}", Using ${isAutomation ? 'automation' : 'default'} prompt`);

        // Use user-specified model or let connector pick default
        const userModel = reqData.llm.model && reqData.llm.model.trim() ? reqData.llm.model.trim() : null;
        
        // Pass continuation options if provided by frontend
        // On Vercel Free tier (10s limit), force single-round to avoid timeout
        const isVercelFree = !!process.env.VERCEL && !process.env.VERCEL_PRO;
        let continuation = reqData.continuation || null;
        if (isVercelFree && continuation && continuation.type !== 'none') {
            console.log('[generate-plan] Vercel Free tier detected — disabling continuation to fit 10s limit');
            continuation = { type: 'none' };
        }
        const result = await connector.generateContent(userPrompt, systemPrompt, userModel, continuation);
        
        // result is now { content, meta } from the updated LLM connector
        const planContent = typeof result === 'object' ? result.content : result;
        const llmMeta = typeof result === 'object' ? result.meta : {};

        // Temp directory for output files
        const runId = uuidv4();
        const tmpDir = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), '.tmp');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        // Save Markdown
        const mdOutputName = `Test_Plan_${runId}.md`;
        const mdOutputPath = path.join(tmpDir, mdOutputName);
        fs.writeFileSync(mdOutputPath, planContent, 'utf8');

        // Try DOCX generation (non-fatal if template missing)
        let docxDownloadUrl = null;
        try {
            let rootPath = path.dirname(__dirname);
            let templatePath = path.join(rootPath, "test_plan_document", "Test Plan - Template.docx");
            if (!fs.existsSync(templatePath)) {
                templatePath = path.join(process.cwd(), "test_plan_document", "Test Plan - Template.docx");
            }
            if (fs.existsSync(templatePath)) {
                const docxOutputName = `Test_Plan_${runId}.docx`;
                const docxOutputPath = path.join(tmpDir, docxOutputName);
                const gen = new DocxGenerator(templatePath);
                gen.generate({
                    project_name: reqData.issueData.project || 'N/A',
                    summary: reqData.issueData.summary || 'N/A',
                    description: reqData.issueData.description || 'N/A',
                    test_plan_content: planContent
                }, docxOutputPath);
                docxDownloadUrl = `/download/${docxOutputName}`;
            } else {
                console.warn('DOCX template not found, skipping Word generation');
            }
        } catch (docxErr) {
            console.error('DOCX generation error (non-fatal):', docxErr.message);
        }

        return res.json({
            plan: planContent,
            download_url: docxDownloadUrl,
            md_download_url: `/download/${mdOutputName}`,
            llm_meta: llmMeta
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ detail: error.message });
    }
});

/* ═══════════════════════════════════════════════════════════════════════
   GITHUB CICD — Workflow Management Endpoints
   ═══════════════════════════════════════════════════════════════════════ */

// List workflows for a repo
app.post('/github-workflows', async (req, res) => {
    try {
        const { token, apiUrl, repo } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        const wfRes = await axios.get(`${baseUrl}/repos/${repo}/actions/workflows`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 10000,
        });
        const workflows = wfRes.data.workflows.map(w => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
        return res.json({ status: 'success', workflows });
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// Trigger a workflow_dispatch
app.post('/github-trigger-workflow', async (req, res) => {
    try {
        const { token, apiUrl, repo, workflowId, branch } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;
        const runsUrl = `${baseUrl}/repos/${repo}/actions/workflows/${workflowId}/runs?per_page=1&branch=${branch || 'main'}`;
        const ghHeaders = { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' };

        // Capture the latest run ID BEFORE dispatch so we can detect the new run
        let previousRunId = null;
        try {
            const preRes = await axios.get(runsUrl, { headers: ghHeaders, timeout: 10000 });
            previousRunId = preRes.data.workflow_runs?.[0]?.id || null;
        } catch { /* ignore */ }

        // Dispatch the workflow
        await axios.post(`${baseUrl}/repos/${repo}/actions/workflows/${workflowId}/dispatches`, {
            ref: branch || 'main',
        }, {
            headers: ghHeaders,
            timeout: 15000,
        });

        // Wait briefly then fetch the latest run for this workflow
        await new Promise(r => setTimeout(r, 2000));
        const runsRes = await axios.get(runsUrl, { headers: ghHeaders, timeout: 10000 });
        const latestRun = runsRes.data.workflow_runs?.[0];

        // Only return the run if it's genuinely new (different from the pre-dispatch run)
        const isNewRun = latestRun && latestRun.id !== previousRunId;

        return res.json({
            status: 'success',
            message: 'Workflow triggered successfully',
            run: isNewRun ? { id: latestRun.id, run_number: latestRun.run_number, status: latestRun.status, html_url: latestRun.html_url } : null,
            previousRunId,
        });
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// Find the latest run for a specific workflow (used when trigger doesn't return a run immediately)
app.post('/github-workflows-runs', async (req, res) => {
    try {
        const { token, apiUrl, repo, workflowId, branch } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        const runsRes = await axios.get(`${baseUrl}/repos/${repo}/actions/workflows/${workflowId}/runs?per_page=1&branch=${branch || 'main'}`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 10000,
        });
        const latestRun = runsRes.data.workflow_runs?.[0];
        if (latestRun) {
            return res.json({
                status: 'success',
                run: { id: latestRun.id, run_number: latestRun.run_number, status: latestRun.status, conclusion: latestRun.conclusion, html_url: latestRun.html_url },
            });
        }
        return res.json({ status: 'success', run: null });
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// Get workflow run status + jobs
app.post('/github-run-status', async (req, res) => {
    try {
        const { token, apiUrl, repo, runId } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        const [runRes, jobsRes] = await Promise.all([
            axios.get(`${baseUrl}/repos/${repo}/actions/runs/${runId}`, {
                headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
                timeout: 10000,
            }),
            axios.get(`${baseUrl}/repos/${repo}/actions/runs/${runId}/jobs`, {
                headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
                timeout: 10000,
            }),
        ]);

        const run = runRes.data;
        const jobs = jobsRes.data.jobs.map(j => ({
            id: j.id, name: j.name, status: j.status, conclusion: j.conclusion,
            started_at: j.started_at, completed_at: j.completed_at,
            steps: (j.steps || []).map(s => ({
                name: s.name, status: s.status, conclusion: s.conclusion,
                started_at: s.started_at, completed_at: s.completed_at, number: s.number,
            })),
        }));

        return res.json({
            status: 'success',
            run: {
                id: run.id, run_number: run.run_number, status: run.status,
                conclusion: run.conclusion, html_url: run.html_url,
                created_at: run.created_at, updated_at: run.updated_at,
            },
            jobs,
        });
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// Get run logs (text stream)
app.post('/github-run-logs', async (req, res) => {
    try {
        const { token, apiUrl, repo, runId } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        const logRes = await axios.get(`${baseUrl}/repos/${repo}/actions/runs/${runId}/logs`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 30000,
            responseType: 'arraybuffer',
            maxRedirects: 5,
        });

        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename=logs-${runId}.zip`);
        return res.send(logRes.data);
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// Parse test results from run logs (extracts Playwright/test summary counts)
app.post('/github-parse-test-results', async (req, res) => {
    try {
        const { token, apiUrl, repo, runId } = req.body;
        const axios = require('axios');
        const PizZip = require('pizzip');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        console.log(`Parsing test results from run ${runId} logs...`);
        const logRes = await axios.get(`${baseUrl}/repos/${repo}/actions/runs/${runId}/logs`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 60000,
            responseType: 'arraybuffer',
            maxRedirects: 5,
        });

        const zip = new PizZip(logRes.data);
        const files = Object.keys(zip.files);
        let allText = '';
        for (const fname of files) {
            if (!zip.files[fname].dir) {
                try { allText += zip.file(fname).asText() + '\n'; } catch { }
            }
        }

        // Strip ANSI escape codes (GitHub Actions logs include colored output)
        allText = allText.replace(/\x1b\[[0-9;]*m/g, '').replace(/\u001b\[[0-9;]*m/g, '');

        // Parse Playwright-style output independently for each count
        // Playwright outputs like: "8 passed (52.5s)" or "8 passed, 2 failed (1.2m)"
        let passed = 0, failed = 0, skipped = 0;

        // Find ALL "N passed/failed/skipped" occurrences, take the largest (final summary)
        const passedMatches = [...allText.matchAll(/(\d+)\s+passed/gi)];
        const failedMatches = [...allText.matchAll(/(\d+)\s+failed/gi)];
        const skippedMatches = [...allText.matchAll(/(\d+)\s+skipped/gi)];

        if (passedMatches.length) passed = Math.max(...passedMatches.map(m => parseInt(m[1])));
        if (failedMatches.length) failed = Math.max(...failedMatches.map(m => parseInt(m[1])));
        if (skippedMatches.length) skipped = Math.max(...skippedMatches.map(m => parseInt(m[1])));

        // Try to find individual test lines: lines containing "✓" or "✗" or "ok" / "not ok" (TAP)
        // Also count lines like "[1/10]" patterns
        const testLinesPassed = (allText.match(/\[[\d]+\/[\d]+\].*(?:PASSED|passed|✓|ok\b)/g) || []).length;
        const testLinesFailed = (allText.match(/\[[\d]+\/[\d]+\].*(?:FAILED|failed|✗|not ok)/g) || []).length;
        
        // Use individual line counts if summary was 0
        if (passed === 0 && testLinesPassed > 0) passed = testLinesPassed;
        if (failed === 0 && testLinesFailed > 0) failed = testLinesFailed;

        console.log(`Test results parsed — Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);
        return res.json({ status: 'success', passed, failed, skipped, total: passed + failed + skipped });
    } catch (error) {
        console.error('Log parse error:', error.response?.status, error.message);
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg, passed: 0, failed: 0, skipped: 0 });
    }
});

// List artifacts for a run
app.post('/github-run-artifacts', async (req, res) => {
    try {
        const { token, apiUrl, repo, runId } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        const artRes = await axios.get(`${baseUrl}/repos/${repo}/actions/runs/${runId}/artifacts`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 10000,
        });

        const artifacts = artRes.data.artifacts.map(a => ({
            id: a.id, name: a.name, size_in_bytes: a.size_in_bytes,
            archive_download_url: a.archive_download_url, expired: a.expired,
            created_at: a.created_at,
        }));

        return res.json({ status: 'success', artifacts });
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// Download a specific artifact (proxy to avoid CORS)
app.post('/github-download-artifact', async (req, res) => {
    try {
        const { token, apiUrl, repo, artifactId } = req.body;
        const axios = require('axios');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        const dlRes = await axios.get(`${baseUrl}/repos/${repo}/actions/artifacts/${artifactId}/zip`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 60000,
            responseType: 'arraybuffer',
            maxRedirects: 5,
        });

        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename=artifact-${artifactId}.zip`);
        return res.send(dlRes.data);
    } catch (error) {
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
    }
});

// Extract report from artifact zip — prioritizes report.json, falls back to HTML
app.post('/github-extract-html-report', async (req, res) => {
    try {
        const { token, apiUrl, repo, artifactId } = req.body;
        const axios = require('axios');
        const PizZip = require('pizzip');
        const baseUrl = (apiUrl || 'https://api.github.com').replace(/\/$/, '');
        const authHeader = `Bearer ${token}`;

        console.log(`Extracting report from artifact ${artifactId}...`);
        const dlRes = await axios.get(`${baseUrl}/repos/${repo}/actions/artifacts/${artifactId}/zip`, {
            headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github+json' },
            timeout: 120000,
            responseType: 'arraybuffer',
            maxRedirects: 5,
        });

        const zip = new PizZip(dlRes.data);
        const files = Object.keys(zip.files).filter(f => !zip.files[f].dir);


        // ── 1. Find HTML file ──
        let htmlFile = files.find(f => f.toLowerCase().endsWith('index.html'));
        if (!htmlFile) htmlFile = files.find(f => f.toLowerCase().endsWith('.html'));
        const htmlContent = htmlFile ? zip.file(htmlFile).asText() : null;

        // ── 2. Find and parse report.json (Playwright JSON reporter output) ──
        let testData = null;
        const jsonFile = files.find(f => f.toLowerCase().endsWith('report.json'))
            || files.find(f => f.toLowerCase().endsWith('.json') && !f.includes('package.json'));

        // Build map of attachments in the artifact (screenshots, videos, traces)
        const attachmentFiles = {};
        files.forEach(f => {
            const lower = f.toLowerCase();
            if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
                attachmentFiles[f] = { type: 'screenshot', path: f };
            } else if (lower.endsWith('.webm') || lower.endsWith('.mp4')) {
                attachmentFiles[f] = { type: 'video', path: f };
            } else if (lower.includes('trace') && lower.endsWith('.zip')) {
                attachmentFiles[f] = { type: 'trace', path: f };
            }
        });


        if (jsonFile) {
            try {
                const jsonContent = zip.file(jsonFile).asText();
                const report = JSON.parse(jsonContent);

                // Recursively extract specs from Playwright suite hierarchy
                const tests = [];
                const extractFromSuites = (suites, parentTitle = '', parentFile = '') => {
                    for (const suite of (suites || [])) {
                        const suiteTitle = parentTitle ? `${parentTitle} › ${suite.title}` : suite.title;
                        const suiteFile = suite.file || parentFile;
                        
                        // Extract from specs (Playwright JSON reporter)
                        for (const spec of (suite.specs || [])) {
                            const testEntry = spec.tests?.[0];
                            const allResults = testEntry?.results || [];
                            const lastResult = allResults[allResults.length - 1] || {};
                            
                            // Status determination priority:
                            // 1. spec.ok === false means test failed
                            // 2. testEntry.status ('expected', 'unexpected', 'flaky', 'skipped')
                            // 3. lastResult.status ('passed', 'failed', 'timedOut', 'skipped')
                            let status = 'passed';
                            if (spec.ok === false) {
                                status = 'failed';
                            } else if (testEntry?.status) {
                                const ts = testEntry.status.toLowerCase();
                                if (ts === 'unexpected' || ts === 'timedout') status = 'failed';
                                else if (ts === 'expected') status = 'passed';
                                else if (ts === 'flaky') status = 'flaky';
                                else if (ts === 'skipped') status = 'skipped';
                                else status = ts;
                            } else if (lastResult.status) {
                                const rs = lastResult.status.toLowerCase();
                                if (rs === 'failed' || rs === 'timedout') status = 'failed';
                                else if (rs === 'passed') status = 'passed';
                                else if (rs === 'skipped') status = 'skipped';
                                else status = rs;
                            }
                            
                            const duration = lastResult.duration || 0;
                            
                            // Extract error info from various locations
                            let errorMsg = '';
                            let errorStack = '';
                            let errorSnippet = '';
                            
                            // Check errors array first (more detailed)
                            if (lastResult.errors?.length) {
                                const err = lastResult.errors[0];
                                errorMsg = err.message || '';
                                errorStack = err.stack || '';
                                errorSnippet = err.snippet || '';
                            }
                            // Fallback to error object
                            if (!errorMsg && lastResult.error) {
                                errorMsg = lastResult.error.message || lastResult.error.snippet || '';
                                errorStack = lastResult.error.stack || '';
                                errorSnippet = lastResult.error.snippet || '';
                            }
                            // Check for error in spec itself
                            if (!errorMsg && spec.error) {
                                errorMsg = spec.error.message || spec.error;
                                errorStack = spec.error.stack || '';
                            }
                            
                            // Extract attachments (screenshots, videos, traces)
                            const attachments = [];
                            for (const att of (lastResult.attachments || [])) {
                                const attInfo = {
                                    name: att.name || 'attachment',
                                    contentType: att.contentType || 'application/octet-stream',
                                    path: att.path || null,
                                    body: att.body || null, // may already be base64 encoded
                                };
                                
                                // Determine type
                                if (att.contentType?.includes('image')) {
                                    attInfo.type = 'screenshot';
                                } else if (att.contentType?.includes('video')) {
                                    attInfo.type = 'video';
                                } else if (att.name?.includes('trace')) {
                                    attInfo.type = 'trace';
                                } else {
                                    attInfo.type = 'other';
                                }
                                
                                // If attachment has a path, try to extract file from zip and base64 encode
                                if (att.path && !attInfo.body) {
                                    // Playwright stores attachments relative to report, try common paths
                                    const possiblePaths = [
                                        att.path,
                                        att.path.replace(/^.*[\\\/]/, ''), // just filename
                                        `data/${att.path.replace(/^.*[\\\/]/, '')}`, // data/filename
                                        att.path.replace(/\\/g, '/'), // normalize slashes
                                    ];
                                    
                                    for (const tryPath of possiblePaths) {
                                        const matchingFile = files.find(f => 
                                            f === tryPath || 
                                            f.endsWith(tryPath) || 
                                            f.toLowerCase().endsWith(tryPath.toLowerCase())
                                        );
                                        if (matchingFile && zip.files[matchingFile]) {
                                            try {
                                                const fileData = zip.file(matchingFile).asUint8Array();
                                                attInfo.body = Buffer.from(fileData).toString('base64');
                                                break;
                                            } catch (e) {
                                                // Silent fail - attachment not critical
                                            }
                                        }
                                    }
                                }
                                
                                attachments.push(attInfo);
                            }
                            
                            const testFile = spec.file || suiteFile || '';
                            
                            tests.push({
                                name: spec.title,
                                fullTitle: suiteTitle ? `${suiteTitle} › ${spec.title}` : spec.title,
                                file: testFile,
                                status,
                                duration: duration > 1000 ? `${(duration / 1000).toFixed(1)}s` : `${Math.round(duration)}ms`,
                                durationMs: duration,
                                error: errorMsg,
                                errorStack,
                                errorSnippet,
                                line: spec.line || 0,
                                column: spec.column || 0,
                                retries: allResults.length > 1 ? allResults.length - 1 : 0,
                                attachments,
                                annotations: spec.annotations || [],
                            });
                            

                        }
                        // Recurse into nested suites (describe blocks)
                        if (suite.suites?.length) extractFromSuites(suite.suites, suiteTitle, suiteFile);
                    }
                };
                extractFromSuites(report.suites);

                const passed = tests.filter(t => t.status === 'passed').length;
                const failed = tests.filter(t => t.status === 'failed').length;
                const skipped = tests.filter(t => t.status === 'skipped').length;
                const flaky = tests.filter(t => t.status === 'flaky').length;
                const totalDuration = tests.reduce((sum, t) => sum + (t.durationMs || 0), 0);

                // Group by file for the UI
                const byFile = {};
                tests.forEach(t => {
                    const file = t.file || 'Unknown';
                    if (!byFile[file]) byFile[file] = [];
                    byFile[file].push(t);
                });

                testData = {
                    tests,
                    byFile,
                    summary: {
                        passed, failed, skipped, flaky,
                        total: tests.length,
                        totalDuration: totalDuration > 60000 ? `${(totalDuration / 60000).toFixed(1)}m` : `${(totalDuration / 1000).toFixed(1)}s`,
                        totalDurationMs: totalDuration,
                    },
                    config: {
                        projects: report.config?.projects?.map(p => p.name) || [],
                        workers: report.config?.workers || 1,
                    },
                    attachmentFiles: Object.keys(attachmentFiles),
                };
                console.log(`Parsed ${tests.length} tests from JSON — ${passed}P/${failed}F/${skipped}S/${flaky}Flaky — ${testData.summary.totalDuration}`);
            } catch (e) {
                console.error(`JSON parse error for ${jsonFile}:`, e.message);
            }
        }

        // ── 3. Fallback: try to extract from HTML if JSON parsing failed or had no tests ──
        if ((!testData || testData.tests.length === 0) && htmlContent) {
            console.log('Attempting HTML-embedded data extraction...');
            
            // Try to extract embedded JSON data from HTML (Playwright embeds it in script tags)
            const embedMatch = htmlContent.match(/window\.playwrightReportBase64\s*=\s*"([^"]+)"/);
            if (embedMatch) {
                try {
                    const decoded = Buffer.from(embedMatch[1], 'base64').toString('utf-8');
                    const embedData = JSON.parse(decoded);
                    console.log('Found embedded Playwright report data');
                    // Process similarly to JSON report...
                    // (embedded data has same structure)
                } catch (e) {
                    console.log('Could not parse embedded data:', e.message);
                }
            }
            
            // Extract from summary text as last resort
            const summaryPassMatch = htmlContent.match(/(\d+)\s*passed/i);
            const summaryFailMatch = htmlContent.match(/(\d+)\s*failed/i);
            const summarySkipMatch = htmlContent.match(/(\d+)\s*(?:skipped|did not run)/i);
            const p = summaryPassMatch ? parseInt(summaryPassMatch[1]) : 0;
            const f = summaryFailMatch ? parseInt(summaryFailMatch[1]) : 0;
            const s = summarySkipMatch ? parseInt(summarySkipMatch[1]) : 0;
            if (p + f + s > 0 && (!testData || testData.tests.length === 0)) {
                console.log(`Extracted summary from HTML: ${p}P/${f}F/${s}S`);
                testData = { tests: [], byFile: {}, summary: { passed: p, failed: f, skipped: s, flaky: 0, total: p + f + s, totalDuration: '', totalDurationMs: 0 }, config: {} };
            }
        }

        if (!htmlContent && !testData) {
            return res.json({ status: 'success', html: null, testData: null, message: 'No report files found in artifact', fileList: files });
        }

        return res.json({ status: 'success', html: htmlContent, testData, fileList: files });
    } catch (error) {
        console.error('Report extraction error:', error.response?.status, error.message);
        const msg = error.response ? `GitHub API ${error.response.status}: ${error.response.data?.message || 'Error'}` : error.message;
        return res.status(400).json({ status: 'error', message: msg });
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

// Export the app for Vercel Serverless Function
module.exports = app;

// SPA fallback: serve index.html for all non-API routes (Render / standalone)
if (!process.env.VERCEL && fs.existsSync(_clientDist)) {
    app.get('*', (req, res) => {
        res.sendFile(path.join(_clientDist, 'index.html'));
    });
}

// Listen if running locally or on Render (Render sets PORT env var)
if (require.main === module) {
    const port = process.env.PORT || 8000;
    app.listen(port, () => {
        console.log(`Test Planner API running on port ${port}`);
    });
}
