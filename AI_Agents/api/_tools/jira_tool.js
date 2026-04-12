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
            // Request expanded renderedFields + all fields to ensure full description
            const response = await axios.get(`${this.url}/rest/api/3/issue/${issueId}`, {
                headers: this.headers,
                params: { expand: 'renderedFields' },
                timeout: 15000
            });
            const data = response.data;
            const fields = data.fields || {};

            // Primary description from ADF
            let description = this.extractTextFromAdf(fields.description) || '';

            // Append Acceptance Criteria if stored in a custom field (common patterns)
            // Check all custom fields that might be rich-text ADF
            for (const [key, value] of Object.entries(fields)) {
                if (key.startsWith('customfield_') && value && typeof value === 'object' && value.type === 'doc') {
                    // This is an ADF custom field — extract and append
                    const customText = this.extractTextFromAdf(value);
                    if (customText && customText.trim() && !description.includes(customText.trim())) {
                        description += '\n\n' + customText.trim();
                    }
                }
            }

            // Also check renderedFields for HTML description as fallback
            const rendered = data.renderedFields || {};
            if (!description.trim() && rendered.description) {
                // Strip HTML tags as a basic fallback
                description = rendered.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            }

            // Detect issue type for hierarchy traversal
            const issueType = (fields.issuetype?.name || '').toLowerCase();
            const parentKey = fields.parent?.key || null;
            const parentSummary = fields.parent?.fields?.summary || null;

            console.log(`JIRA Fetch [${issueId}]: Type=${issueType}, Description=${description.length} chars, Parent=${parentKey || 'none'}`);
            
            return {
                id: data.key,
                summary: fields.summary || 'No Summary',
                description: description || 'No Description provided.',
                status: fields.status?.name || 'Unknown',
                project: fields.project?.name || 'Unknown Project',
                issueType: fields.issuetype?.name || 'Unknown',
                parentKey,
                parentSummary
            };
        } catch (error) {
            const errStr = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
            throw new Error(`Jira Fetch error: ${errStr}`);
        }
    }

    /**
     * Fetch a ticket AND its full hierarchy context:
     * - If Epic/Initiative → fetch all child stories & sub-tasks
     * - If Story → fetch parent Epic context + child sub-tasks
     * - If Sub-task → fetch parent Story + grandparent Epic context
     * Returns a single combined issueData with aggregated description.
     */
    async fetchIssueWithHierarchy(issueId) {
        const mainIssue = await this.fetchIssue(issueId);
        const issueType = (mainIssue.issueType || '').toLowerCase();
        
        let hierarchyContext = '';
        let childIssues = [];

        // ── CASE 1: Epic or Initiative → Fetch all children ──
        if (issueType === 'epic' || issueType === 'initiative') {
            try {
                const children = await this.searchIssues(`parent = "${issueId}" ORDER BY rank ASC`, 50);
                if (children.length > 0) {
                    hierarchyContext += `\n\n---\n## Child Stories/Tasks (${children.length})\n`;
                    for (const child of children) {
                        hierarchyContext += `\n### ${child.id}: ${child.summary}\n${child.description}\n`;
                        childIssues.push({ id: child.id, summary: child.summary, type: 'Story' });

                        // Also fetch sub-tasks of each child story
                        try {
                            const subtasks = await this.searchIssues(`parent = "${child.id}" ORDER BY rank ASC`, 20);
                            for (const st of subtasks) {
                                hierarchyContext += `\n#### ${st.id}: ${st.summary}\n${st.description}\n`;
                                childIssues.push({ id: st.id, summary: st.summary, type: 'Sub-task' });
                            }
                        } catch (e) {
                            // Sub-task fetch failed — continue without them
                            console.warn(`Could not fetch sub-tasks for ${child.id}: ${e.message}`);
                        }
                    }
                }
            } catch (e) {
                console.warn(`Could not fetch children for ${issueId}: ${e.message}`);
            }
        }

        // ── CASE 2: Story/Task → Fetch parent context + child sub-tasks ──
        else if (issueType === 'story' || issueType === 'task') {
            // Fetch parent Epic context
            if (mainIssue.parentKey) {
                try {
                    const parent = await this.fetchIssue(mainIssue.parentKey);
                    hierarchyContext += `\n\n---\n## Parent Epic: ${parent.id} — ${parent.summary}\n${parent.description}\n`;
                } catch (e) {
                    console.warn(`Could not fetch parent ${mainIssue.parentKey}: ${e.message}`);
                }
            }

            // Fetch child sub-tasks
            try {
                const subtasks = await this.searchIssues(`parent = "${issueId}" ORDER BY rank ASC`, 20);
                if (subtasks.length > 0) {
                    hierarchyContext += `\n\n---\n## Sub-tasks (${subtasks.length})\n`;
                    for (const st of subtasks) {
                        hierarchyContext += `\n### ${st.id}: ${st.summary}\n${st.description}\n`;
                        childIssues.push({ id: st.id, summary: st.summary, type: 'Sub-task' });
                    }
                }
            } catch (e) {
                console.warn(`Could not fetch sub-tasks for ${issueId}: ${e.message}`);
            }
        }

        // ── CASE 3: Sub-task/Bug → Fetch parent Story + grandparent Epic ──
        else if (issueType === 'sub-task' || issueType === 'subtask' || issueType === 'bug') {
            if (mainIssue.parentKey) {
                try {
                    const parent = await this.fetchIssue(mainIssue.parentKey);
                    hierarchyContext += `\n\n---\n## Parent Story: ${parent.id} — ${parent.summary}\n${parent.description}\n`;

                    // Fetch grandparent Epic
                    if (parent.parentKey) {
                        try {
                            const grandparent = await this.fetchIssue(parent.parentKey);
                            hierarchyContext += `\n## Parent Epic: ${grandparent.id} — ${grandparent.summary}\n${grandparent.description}\n`;
                        } catch (e) {
                            console.warn(`Could not fetch grandparent ${parent.parentKey}: ${e.message}`);
                        }
                    }
                } catch (e) {
                    console.warn(`Could not fetch parent ${mainIssue.parentKey}: ${e.message}`);
                }
            }
        }

        // Combine everything
        const combinedDescription = mainIssue.description + hierarchyContext;
        const ticketCount = 1 + childIssues.length;
        console.log(`JIRA Hierarchy [${issueId}]: ${ticketCount} tickets aggregated, ${combinedDescription.length} chars total`);

        return {
            ...mainIssue,
            description: combinedDescription,
            hierarchy: {
                type: mainIssue.issueType,
                childIssues,
                totalTickets: ticketCount
            }
        };
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
    // Recursively walks the entire ADF tree so no content is lost
    extractTextFromAdf(node) {
        if (!node) return "";
        if (typeof node === 'string') return node;

        try {
            // If the node itself is a text leaf, return its text
            if (node.type === 'text') {
                return node.text || '';
            }

            // Hard break → newline
            if (node.type === 'hardBreak') return '\n';

            // Emoji
            if (node.type === 'emoji') return node.attrs?.shortName || '';

            // Mention
            if (node.type === 'mention') return `@${node.attrs?.text || 'user'}`;

            // InlineCard / link
            if (node.type === 'inlineCard') return node.attrs?.url || '';

            // If there's no content array, nothing more to extract
            if (!node.content || !Array.isArray(node.content)) {
                // For mediaGroup / mediaSingle, note the attachment
                if (node.type === 'mediaGroup' || node.type === 'mediaSingle') return '[attachment]\n';
                return '';
            }

            let result = '';
            const type = node.type;

            // --- Block-level nodes ---

            if (type === 'bulletList' || type === 'orderedList') {
                node.content.forEach((child, idx) => {
                    const prefix = type === 'orderedList' ? `${idx + 1}. ` : '• ';
                    const itemText = this.extractTextFromAdf(child).replace(/^\n+/, '');
                    result += prefix + itemText + '\n';
                });
                return result;
            }

            if (type === 'listItem') {
                return node.content.map(c => this.extractTextFromAdf(c)).join('\n');
            }

            if (type === 'table') {
                for (const row of node.content) {
                    if (row.type === 'tableRow') {
                        const cells = (row.content || []).map(cell => {
                            return this.extractTextFromAdf(cell).replace(/\n+$/, '').trim();
                        });
                        result += '| ' + cells.join(' | ') + ' |\n';
                    }
                }
                return result + '\n';
            }

            if (type === 'tableHeader' || type === 'tableCell') {
                return node.content.map(c => this.extractTextFromAdf(c)).join(' ').trim();
            }

            if (type === 'codeBlock') {
                const lang = node.attrs?.language || '';
                const code = node.content ? node.content.map(c => this.extractTextFromAdf(c)).join('') : '';
                return '```' + lang + '\n' + code + '\n```\n';
            }

            if (type === 'blockquote') {
                const inner = node.content.map(c => this.extractTextFromAdf(c)).join('');
                return inner.split('\n').map(line => '> ' + line).join('\n') + '\n';
            }

            if (type === 'panel') {
                const panelType = node.attrs?.panelType ? `[${node.attrs.panelType.toUpperCase()}] ` : '';
                return panelType + node.content.map(c => this.extractTextFromAdf(c)).join('') + '\n';
            }

            if (type === 'heading') {
                const level = node.attrs?.level || 1;
                const headingText = node.content ? node.content.map(c => this.extractTextFromAdf(c)).join('') : '';
                return '#'.repeat(level) + ' ' + headingText + '\n';
            }

            if (type === 'rule') {
                return '---\n';
            }

            // For expand / nestedExpand (collapsible sections)
            if (type === 'expand' || type === 'nestedExpand') {
                const title = node.attrs?.title ? `[${node.attrs.title}]\n` : '';
                return title + node.content.map(c => this.extractTextFromAdf(c)).join('');
            }

            // Default: recursively extract children, add newline for block-level nodes
            const childText = node.content.map(c => this.extractTextFromAdf(c)).join('');

            // Block-level types that should end with a newline
            const blockTypes = ['paragraph', 'doc', 'taskList', 'taskItem', 'decisionList', 'decisionItem', 'layoutSection', 'layoutColumn'];
            if (blockTypes.includes(type)) {
                return childText + '\n';
            }

            return childText;
        } catch (e) {
            console.error("ADF Extraction Error:", e);
            // Fallback: stringify the whole node so nothing is lost
            return JSON.stringify(node);
        }
    }
}

module.exports = JiraTool;
