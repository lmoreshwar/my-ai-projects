const axios = require('axios');

class JiraTool {
    constructor(url, email, token) {
        this.url = (url || '').replace(/\/$/, '');
        this.email = email;
        this.token = token;

        const authString = Buffer.from(`${this.email}:${this.token}`).toString('base64');
        this.headers = {
            'Authorization': `Basic ${authString}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
    }

    async testConnection() {
        try {
            const response = await axios.get(`${this.url}/rest/api/3/myself`, {
                headers: this.headers,
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            const errStr = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
            throw new Error(`Jira Connection Test failed: ${errStr}`);
        }
    }

    async fetchIssue(issueId) {
        try {
            const response = await axios.get(`${this.url}/rest/api/3/issue/${issueId}`, {
                headers: this.headers,
                timeout: 15000
            });
            const data = response.data;
            const fields = data.fields || {};
            
            return {
                id: data.key,
                summary: fields.summary || 'No Summary',
                description: this.extractTextFromAdf(fields.description) || 'No Description provided.',
                status: fields.status?.name || 'Unknown',
                project: fields.project?.name || 'Unknown Project'
            };
        } catch (error) {
            const errStr = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
            throw new Error(`Jira Fetch error: ${errStr}`);
        }
    }

    async searchIssues(jql, maxResults = 5) {
        try {
            const response = await axios.get(`${this.url}/rest/api/3/search/jql`, {
                headers: this.headers,
                params: {
                    jql: jql,
                    maxResults: maxResults,
                    fields: 'summary,description,status,project'
                },
                timeout: 15000
            });
            
            const issues = response.data.issues || [];
            return issues.map(data => ({
                id: data.key,
                summary: data.fields?.summary || 'No Summary',
                description: this.extractTextFromAdf(data.fields?.description) || 'No Description provided.',
                status: data.fields?.status?.name || 'Unknown',
                project: data.fields?.project?.name || 'Unknown Project'
            }));
        } catch (error) {
            const errStr = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
            throw new Error(`Jira Search error: ${errStr}`);
        }
    }

    // Helper to extract plain text from Jira's Atlassian Document Format (ADF)
    extractTextFromAdf(description) {
        if (!description) return "";
        if (typeof description === 'string') return description;
        
        try {
            if (description.content && Array.isArray(description.content)) {
                let text = "";
                for (const block of description.content) {
                    if (block.content && Array.isArray(block.content)) {
                        for (const inline of block.content) {
                            if (inline.text) text += inline.text;
                        }
                    }
                    text += "\n";
                }
                return text.trim();
            }
        } catch (e) {
            console.error("ADF Extraction Error:", e);
        }
        return JSON.stringify(description);
    }
}

module.exports = JiraTool;
