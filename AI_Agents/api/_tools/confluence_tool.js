const axios = require('axios');

/**
 * Confluence Cloud Tool — uses same Atlassian credentials as JIRA
 * Base URL: {jira_base_url}/wiki/rest/api
 * Auth: Basic (email:api_token)
 */
class ConfluenceTool {
    constructor(jiraUrl, email, token) {
        // Derive Confluence wiki base from JIRA URL
        // e.g. https://myteam.atlassian.net → https://myteam.atlassian.net/wiki/rest/api
        this.baseUrl = (jiraUrl || '').replace(/\/$/, '');
        this.wikiApi = `${this.baseUrl}/wiki/rest/api`;
        this.email = email;
        this.token = token;

        const authString = Buffer.from(`${this.email}:${this.token}`).toString('base64');
        this.headers = {
            'Authorization': `Basic ${authString}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
    }

    /**
     * Test Confluence connectivity by fetching current user via wiki API
     */
    async testConnection() {
        try {
            const response = await axios.get(`${this.baseUrl}/wiki/rest/api/user/current`, {
                headers: this.headers,
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            const errStr = error.response
                ? `${error.response.status} - ${JSON.stringify(error.response.data)}`
                : error.message;
            throw new Error(`Confluence connection failed: ${errStr}`);
        }
    }

    /**
     * List available Confluence spaces (for space picker)
     */
    async listSpaces(limit = 100) {
        try {
            // Remove 'type: global' to fetch all types of spaces including personal
            const response = await axios.get(`${this.wikiApi}/space`, {
                headers: this.headers,
                params: { limit, status: 'current' },
                timeout: 15000
            });
            const spaces = (response.data.results || []).map(s => ({
                key: s.key,
                name: s.name,
                type: s.type,
                id: s.id
            }));
            return spaces;
        } catch (error) {
            const errStr = error.response
                ? `${error.response.status} - ${JSON.stringify(error.response.data)}`
                : error.message;
            throw new Error(`Failed to fetch Confluence spaces: ${errStr}`);
        }
    }

    /**
     * Search pages in a space (for parent page selection)
     */
    async searchPages(spaceKey, query = '', limit = 25) {
        try {
            let cql = `space = "${spaceKey}" AND type = "page"`;
            if (query.trim()) {
                cql += ` AND title ~ "${query.trim()}"`;
            }
            const response = await axios.get(`${this.wikiApi}/content/search`, {
                headers: this.headers,
                params: { cql, limit },
                timeout: 15000
            });
            return (response.data.results || []).map(p => ({
                id: p.id,
                title: p.title,
                type: p.type
            }));
        } catch (error) {
            const errStr = error.response
                ? `${error.response.status} - ${JSON.stringify(error.response.data)}`
                : error.message;
            throw new Error(`Failed to search Confluence pages: ${errStr}`);
        }
    }

    /**
     * Convert markdown content to Confluence Storage Format (XHTML)
     * Basic conversion covering common markdown patterns used in test plans
     */
    markdownToStorageFormat(markdown) {
        let html = markdown;

        // Escape XML special characters in text (not in tags we create)
        // We'll build the HTML step by step

        // Split into lines for block-level processing
        const lines = html.split('\n');
        const result = [];
        let inCodeBlock = false;
        let codeBlockLang = '';
        let codeBlockLines = [];
        let inTable = false;
        let tableRows = [];
        let isFirstTableRow = true;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Code block toggle
            if (line.trim().startsWith('```')) {
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    codeBlockLang = line.trim().replace('```', '').trim();
                    codeBlockLines = [];
                    continue;
                } else {
                    inCodeBlock = false;
                    const code = this._escapeXml(codeBlockLines.join('\n'));
                    result.push(`<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${codeBlockLang || 'text'}</ac:parameter><ac:plain-text-body><![CDATA[${codeBlockLines.join('\n')}]]></ac:plain-text-body></ac:structured-macro>`);
                    codeBlockLines = [];
                    continue;
                }
            }
            if (inCodeBlock) {
                codeBlockLines.push(line);
                continue;
            }

            // Table rows
            if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
                // Check if separator row (|---|---|)
                if (/^\|[\s\-:|]+\|$/.test(line.trim())) {
                    continue; // skip separator
                }
                if (!inTable) {
                    inTable = true;
                    tableRows = [];
                    isFirstTableRow = true;
                }
                const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
                tableRows.push({ cells, isHeader: isFirstTableRow });
                isFirstTableRow = false;
                continue;
            } else if (inTable) {
                // End of table
                result.push(this._buildTable(tableRows));
                inTable = false;
                tableRows = [];
            }

            // Headings
            if (line.startsWith('######')) {
                result.push(`<h6>${this._inlineFormat(line.slice(6).trim())}</h6>`);
                continue;
            }
            if (line.startsWith('#####')) {
                result.push(`<h5>${this._inlineFormat(line.slice(5).trim())}</h5>`);
                continue;
            }
            if (line.startsWith('####')) {
                result.push(`<h4>${this._inlineFormat(line.slice(4).trim())}</h4>`);
                continue;
            }
            if (line.startsWith('###')) {
                result.push(`<h3>${this._inlineFormat(line.slice(3).trim())}</h3>`);
                continue;
            }
            if (line.startsWith('##')) {
                result.push(`<h2>${this._inlineFormat(line.slice(2).trim())}</h2>`);
                continue;
            }
            if (line.startsWith('#')) {
                result.push(`<h1>${this._inlineFormat(line.slice(1).trim())}</h1>`);
                continue;
            }

            // Horizontal rule
            if (/^---+$/.test(line.trim())) {
                result.push('<hr/>');
                continue;
            }

            // Bullet list items
            if (/^[\s]*[-*]\s/.test(line)) {
                const text = line.replace(/^[\s]*[-*]\s/, '');
                result.push(`<ul><li>${this._inlineFormat(text)}</li></ul>`);
                continue;
            }

            // Numbered list items
            if (/^[\s]*\d+\.\s/.test(line)) {
                const text = line.replace(/^[\s]*\d+\.\s/, '');
                result.push(`<ol><li>${this._inlineFormat(text)}</li></ol>`);
                continue;
            }

            // Blockquote
            if (line.startsWith('>')) {
                const text = line.slice(1).trim();
                result.push(`<blockquote><p>${this._inlineFormat(text)}</p></blockquote>`);
                continue;
            }

            // Empty line
            if (!line.trim()) {
                result.push('');
                continue;
            }

            // Regular paragraph
            result.push(`<p>${this._inlineFormat(line)}</p>`);
        }

        // Close any open table
        if (inTable) {
            result.push(this._buildTable(tableRows));
        }

        // Merge consecutive <ul> or <ol> elements
        let merged = result.join('\n');
        merged = merged.replace(/<\/ul>\n<ul>/g, '');
        merged = merged.replace(/<\/ol>\n<ol>/g, '');

        return merged;
    }

    _buildTable(rows) {
        let html = '<table><colgroup>';
        if (rows.length > 0) {
            rows[0].cells.forEach(() => { html += '<col/>'; });
        }
        html += '</colgroup><tbody>';
        for (const row of rows) {
            html += '<tr>';
            const tag = row.isHeader ? 'th' : 'td';
            for (const cell of row.cells) {
                html += `<${tag}>${this._inlineFormat(cell)}</${tag}>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        return html;
    }

    _inlineFormat(text) {
        let s = this._escapeXml(text);
        // Bold: **text** or __text__
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
        // Italic: *text* or _text_
        s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
        s = s.replace(/_(.+?)_/g, '<em>$1</em>');
        // Inline code: `code`
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Links: [text](url)
        s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        // Strikethrough: ~~text~~
        s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
        return s;
    }

    _escapeXml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Create or update a page in Confluence
     * @param {string} spaceKey - Space key (e.g. 'QA', 'TEST')
     * @param {string} title - Page title
     * @param {string} markdownContent - Markdown content to convert and publish
     * @param {string|null} parentPageId - Optional parent page ID for nesting
     * @returns {object} - Created/updated page info { id, title, url }
     */
    async publishPage(spaceKey, title, markdownContent, parentPageId = null) {
        try {
            // Convert markdown to Confluence storage format
            const storageBody = this.markdownToStorageFormat(markdownContent);

            // Check if page with this title already exists in the space
            const existingPage = await this._findPageByTitle(spaceKey, title);

            if (existingPage) {
                // Update existing page
                console.log(`[Confluence] Updating existing page: ${existingPage.id} - "${title}"`);
                const updateBody = {
                    version: { number: existingPage.version.number + 1 },
                    title,
                    type: 'page',
                    body: {
                        storage: {
                            value: storageBody,
                            representation: 'storage'
                        }
                    }
                };
                const response = await axios.put(
                    `${this.wikiApi}/content/${existingPage.id}`,
                    updateBody,
                    { headers: this.headers, timeout: 30000 }
                );
                const pageUrl = `${this.baseUrl}/wiki${response.data._links?.webui || `/spaces/${spaceKey}/pages/${response.data.id}`}`;
                return {
                    id: response.data.id,
                    title: response.data.title,
                    url: pageUrl,
                    action: 'updated',
                    version: response.data.version.number
                };
            } else {
                // Create new page
                console.log(`[Confluence] Creating new page: "${title}" in space ${spaceKey}`);
                const createBody = {
                    type: 'page',
                    title,
                    space: { key: spaceKey },
                    body: {
                        storage: {
                            value: storageBody,
                            representation: 'storage'
                        }
                    }
                };
                if (parentPageId) {
                    createBody.ancestors = [{ id: parentPageId }];
                }
                const response = await axios.post(
                    `${this.wikiApi}/content`,
                    createBody,
                    { headers: this.headers, timeout: 30000 }
                );
                const pageUrl = `${this.baseUrl}/wiki${response.data._links?.webui || `/spaces/${spaceKey}/pages/${response.data.id}`}`;
                return {
                    id: response.data.id,
                    title: response.data.title,
                    url: pageUrl,
                    action: 'created',
                    version: 1
                };
            }
        } catch (error) {
            const errStr = error.response
                ? `${error.response.status} - ${JSON.stringify(error.response.data)}`
                : error.message;
            throw new Error(`Confluence publish failed: ${errStr}`);
        }
    }

    /**
     * Fetch the content of a specific Confluence page and return as plain text
     * @param {string} pageId - The Confluence page ID
     * @returns {object} - { id, title, content (plain text), version }
     */
    async fetchPageContent(pageId) {
        try {
            const response = await axios.get(`${this.wikiApi}/content/${pageId}`, {
                headers: this.headers,
                params: { expand: 'body.storage,version' },
                timeout: 15000
            });
            const page = response.data;
            const storageHtml = page.body?.storage?.value || '';
            const plainText = this._storageToPlainText(storageHtml);
            return {
                id: page.id,
                title: page.title,
                content: plainText,
                version: page.version?.number
            };
        } catch (error) {
            const errStr = error.response
                ? `${error.response.status} - ${JSON.stringify(error.response.data)}`
                : error.message;
            throw new Error(`Failed to fetch Confluence page content: ${errStr}`);
        }
    }

    /**
     * Convert Confluence storage format (XHTML) to readable plain text / markdown
     */
    _storageToPlainText(html) {
        if (!html) return '';
        let text = html;
        // Headings → markdown
        text = text.replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (_, level, content) => {
            return '\n' + '#'.repeat(parseInt(level)) + ' ' + content.replace(/<[^>]+>/g, '').trim() + '\n';
        });
        // Table rows
        text = text.replace(/<tr[^>]*>/gi, '\n| ');
        text = text.replace(/<\/tr>/gi, '');
        text = text.replace(/<t[hd][^>]*>(.*?)<\/t[hd]>/gi, (_, content) => {
            return content.replace(/<[^>]+>/g, '').trim() + ' | ';
        });
        // List items
        text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, content) => {
            return '\n- ' + content.replace(/<[^>]+>/g, '').trim();
        });
        // Line breaks and paragraphs
        text = text.replace(/<br\s*\/?>/gi, '\n');
        text = text.replace(/<\/p>/gi, '\n');
        text = text.replace(/<p[^>]*>/gi, '');
        // Horizontal rules
        text = text.replace(/<hr\s*\/?>/gi, '\n---\n');
        // Bold/italic
        text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
        text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
        // Code blocks
        text = text.replace(/<ac:structured-macro ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi, '\n```\n$1\n```\n');
        // Inline code
        text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
        // Links
        text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
        // Strip remaining HTML tags
        text = text.replace(/<[^>]+>/g, '');
        // Decode XML entities
        text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        // Clean up extra whitespace
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        return text;
    }

    /**
     * Find page by title in a space
     */
    async _findPageByTitle(spaceKey, title) {
        try {
            const response = await axios.get(`${this.wikiApi}/content`, {
                headers: this.headers,
                params: {
                    spaceKey,
                    title,
                    expand: 'version',
                    limit: 1
                },
                timeout: 10000
            });
            const results = response.data.results || [];
            return results.length > 0 ? results[0] : null;
        } catch {
            return null;
        }
    }
}

module.exports = ConfluenceTool;
