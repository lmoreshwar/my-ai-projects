const OpenAI = require('openai');

class LLMConnector {
    constructor(platform, apiKey = null, endpoint = null) {
        this.platform = (platform || 'ollama').toLowerCase();
        this.apiKey = apiKey;
        this.endpoint = endpoint || 'http://localhost:11434/v1';

        switch (this.platform) {
            case 'groq':
                this.client = new OpenAI({
                    baseURL: 'https://api.groq.com/openai/v1',
                    apiKey: this.apiKey
                });
                break;
            case 'ollama':
                this.client = new OpenAI({
                    baseURL: this.endpoint,
                    apiKey: 'ollama' // Placeholder for Ollama API
                });
                break;
            case 'gemini':
                this.client = new OpenAI({
                    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
                    apiKey: this.apiKey
                });
                break;
            case 'grok':
                this.client = new OpenAI({
                    baseURL: 'https://api.x.ai/v1',
                    apiKey: this.apiKey
                });
                break;
            default:
                throw new Error(`Unsupported LLM platform: ${this.platform}`);
        }
    }

    /* ─────────────────────────────────────────────
       continuation options (passed via 4th arg):
       {
         type: 'table' | 'list' | 'text' | 'code' | 'none',
         minItems: 30,          // table rows or list items threshold
         maxRounds: 4           // max continuation API calls
       }
       
       'none' or omitted → single call, no continuation.
       
       Safe for licensed / unlimited models:
         - If the model produces a full response in one shot,
           finish_reason = 'stop' and item count > minItems,
           the loop never fires.
       ───────────────────────────────────────────── */
    async generateContent(prompt, systemPrompt = "You are an expert QA Engineer.", model = null, continuation = null) {
        if (!model) {
            if (this.platform === 'groq') model = 'llama-3.3-70b-versatile';
            else if (this.platform === 'ollama') model = 'llama3';
            else if (this.platform === 'gemini') model = 'gemini-2.0-flash';
            else if (this.platform === 'grok') model = 'grok-2';
        }

        // Gemini fallback chain — if the primary model is unavailable (503),
        // we'll try alternatives automatically
        const GEMINI_FALLBACK_CHAIN = {
            'gemini-2.5-flash':   ['gemini-2.0-flash', 'gemini-1.5-flash'],
            'gemini-2.5-pro':     ['gemini-2.0-flash', 'gemini-1.5-pro'],
            'gemini-2.0-flash':   ['gemini-2.5-flash', 'gemini-1.5-flash'],
            'gemini-1.5-flash':   ['gemini-2.0-flash', 'gemini-2.5-flash'],
            'gemini-1.5-pro':     ['gemini-2.5-pro', 'gemini-2.0-flash'],
        };

        console.log(`[LLM] Using model: ${model}, Platform: ${this.platform}`);

        // Platform-aware token limits — safe for both free-tier and licensed
        const PLATFORM_LIMITS = {
            groq:   { max_tokens: 4096, tpm: 12000, delay_ms: 2000 },  // Groq free-tier: 12K TPM
            gemini: { max_tokens: 32768, tpm: 1000000, delay_ms: 1000 }, // Gemini 2.5 Flash supports up to 65K output
            grok:   { max_tokens: 16384, tpm: 999999, delay_ms: 500 },
            ollama: { max_tokens: 8192, tpm: 999999, delay_ms: 0 },    // local, no limits
        };
        const platformCfg = PLATFORM_LIMITS[this.platform] || { max_tokens: 8192, tpm: 999999, delay_ms: 500 };
        const MAX_TOKENS = platformCfg.max_tokens;
        const ROUND_DELAY = platformCfg.delay_ms;

        const contType  = continuation?.type || 'none';
        const minItems  = continuation?.minItems || 30;
        const maxRounds = continuation?.maxRounds || 4;
        const TOKEN_HEADROOM = 0.95; // continue if output used < 95% of max_tokens (was 0.40 — too conservative)

        // Estimate rough token count from text (~4 chars per token)
        const estimateTokens = (text) => Math.ceil((text || '').length / 4);

        // Trim assistant history to last N rows/items to stay within TPM
        const trimHistory = (content, maxChars = 2000) => {
            if (content.length <= maxChars) return content;
            // For tables: keep header + last 5 rows
            const lines = content.split('\n');
            const tableLines = lines.filter(l => l.trim().startsWith('|'));
            if (tableLines.length >= 3) {
                const header = tableLines.slice(0, 2); // header + separator
                const lastRows = tableLines.slice(-5);
                return `[...${tableLines.length - 7} earlier rows omitted for brevity...]\n${header.join('\n')}\n${lastRows.join('\n')}`;
            }
            // For other content: keep last portion
            return `[...earlier content omitted...]\n${content.slice(-maxChars)}`;
        };

        /* ── Helpers ── */
        // Strip code fences and thinking blocks that Gemini 2.5 may wrap around tables
        const cleanLLMOutput = (text) => {
            let cleaned = text;
            // Remove <think>...</think> or <reasoning>...</reasoning> blocks
            cleaned = cleaned.replace(/<(?:think|reasoning)>[\s\S]*?<\/(?:think|reasoning)>/gi, '');
            // Remove markdown code fences (```markdown ... ``` or ``` ... ```)
            cleaned = cleaned.replace(/```(?:markdown|md)?\n?/gi, '');
            return cleaned.trim();
        };

        const countTableRows = (text) => {
            const cleaned = cleanLLMOutput(text);
            const lines = cleaned.split('\n').filter(l => l.trim().startsWith('|'));
            if (lines.length < 3) return 0;
            // Subtract header row and separator row
            let dataRows = 0;
            for (let i = 0; i < lines.length; i++) {
                const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
                if (cells.every(c => /^[-:]+$/.test(c) || !c)) continue; // separator
                if (i === 0 && cells[0] && /SRL|No\.|Test Case/i.test(cells[0])) continue; // header
                dataRows++;
            }
            return dataRows;
        };

        const getLastSrl = (text) => {
            const cleaned = cleanLLMOutput(text);
            const lines = cleaned.split('\n').filter(l => l.trim().startsWith('|'));
            if (lines.length < 3) return null;
            const lastLine = lines[lines.length - 1];
            const cells = lastLine.split('|').slice(1, -1).map(c => c.trim());
            return cells[0] || null;
        };

        const countListItems = (text) => {
            const matches = text.match(/^\s*\d+[\.\)]\s/gm);
            return matches ? matches.length : 0;
        };

        const getLastListNumber = (text) => {
            const matches = text.match(/^\s*(\d+)[\.\)]\s/gm);
            if (!matches || matches.length === 0) return 0;
            const last = matches[matches.length - 1].match(/(\d+)/);
            return last ? parseInt(last[1], 10) : 0;
        };

        /* ── Single LLM call with retry + Gemini model fallback ── */
        const callLLMSingle = async (msgs, useModel, retries = 3) => {
            // Gemini's OpenAI-compatible API does not support 'seed' or 'top_p'
            const callParams = {
                messages: msgs,
                model: useModel,
                temperature: 0,
                max_tokens: MAX_TOKENS
            };
            // Only add seed/top_p for platforms that support them
            if (this.platform !== 'gemini') {
                callParams.seed = 42;
                callParams.top_p = 1;
            }

            let lastError;
            for (let attempt = 1; attempt <= retries; attempt++) {
                try {
                    console.log(`[LLM] Calling ${useModel} (attempt ${attempt}/${retries})...`);
                    const resp = await this.client.chat.completions.create(callParams);
                    return (() => { // extract result from resp
                        const c = resp.choices[0];
                        const u = resp.usage || {};
                        return {
                            content: c.message.content,
                            finish_reason: c.finish_reason,
                            prompt_tokens: u.prompt_tokens || 0,
                            completion_tokens: u.completion_tokens || 0,
                            total_tokens: u.total_tokens || 0
                        };
                    })();
                } catch (err) {
                    lastError = err;
                    const status = err.status || err.statusCode || 0;
                    if ((status === 429 || status === 503 || status === 502) && attempt < retries) {
                        const wait = status === 429 ? attempt * 5000 : attempt * 3000;
                        console.warn(`[LLM] ${status === 429 ? 'Rate limited' : 'Service unavailable'} (${status}) for ${useModel}. Retrying in ${wait / 1000}s (attempt ${attempt}/${retries})...`);
                        await new Promise(r => setTimeout(r, wait));
                        continue;
                    }
                    throw err;
                }
            }
            throw lastError;
        };

        /* ── callLLM with Gemini model fallback chain ── */
        const callLLM = async (msgs, retries = 3) => {
            try {
                return await callLLMSingle(msgs, model, retries);
            } catch (primaryErr) {
                const status = primaryErr.status || primaryErr.statusCode || 0;
                // Only fallback on 503/502 (service unavailable), not on auth or other errors
                if (this.platform === 'gemini' && (status === 503 || status === 502)) {
                    const fallbacks = GEMINI_FALLBACK_CHAIN[model] || [];
                    for (const fallbackModel of fallbacks) {
                        console.warn(`[LLM] Model ${model} returned ${status}. Trying fallback: ${fallbackModel}...`);
                        try {
                            const result = await callLLMSingle(msgs, fallbackModel, 2);
                            // Update the model variable so continuation rounds use the working model
                            model = fallbackModel;
                            console.log(`[LLM] Fallback to ${fallbackModel} succeeded!`);
                            return result;
                        } catch (fallbackErr) {
                            const fbStatus = fallbackErr.status || fallbackErr.statusCode || 0;
                            console.warn(`[LLM] Fallback ${fallbackModel} also failed (${fbStatus}). Trying next...`);
                            continue;
                        }
                    }
                    throw new Error(`All Gemini models unavailable (503). Tried: ${model}, ${fallbacks.join(', ')}. Google's API may be temporarily overloaded — please try again in a few minutes.`);
                }
                throw primaryErr;
            }
        };

        /* ── Build continuation prompt per type ── */
        const buildContinuationPrompt = (prevContent, itemCount) => {
            switch (contType) {
                case 'table': {
                    const lastSrl = getLastSrl(prevContent) || `TC_${String(itemCount).padStart(3, '0')}`;
                    const nextSrl = lastSrl.replace(/\d+/, (n) => String(Number(n) + 1).padStart(n.length, '0'));
                    return `You generated ${itemCount} test cases (up to ${lastSrl}).

Check if you have covered ALL of these test design categories for EACH documented acceptance criterion:
1. ✅ Positive / Happy path
2. ❌ Negative / Invalid input
3. 🔲 Boundary Value Analysis (empty, min length, max length, special chars)
4. 🔲 Equivalence Partitioning (valid class, invalid class)
5. 🔲 UI Validation (field presence, masking, error message display/clearing)
6. 🔲 Security (SQL injection, XSS, session hijacking, unauthorized access)
7. 🔲 Error Handling (server error, timeout, edge cases)

If ANY of the above categories are missing for documented criteria — CONTINUE generating starting from ${nextSrl}.
If ALL categories are thoroughly covered for every documented criterion — respond with: "COVERAGE COMPLETE"

REMINDER: Deriving Negative, Boundary, Security, UI tests from documented criteria is NOT hallucination — it is mandatory QA methodology. But do NOT generate tests for features without documented acceptance criteria.

- Do NOT repeat any previously generated test cases
- Continue the same markdown table format (NO header row, just data rows starting with |)
- Continue the SRL numbering sequence from ${lastSrl}

Output ONLY the additional table rows, OR "COVERAGE COMPLETE" if done:`;
                }
                case 'list': {
                    const lastNum = getLastListNumber(prevContent);
                    return `You generated only ${itemCount} scenarios (up to #${lastNum}). This is NOT enough for complete requirement coverage.

CONTINUE generating MORE test scenarios starting from ${lastNum + 1}.

RULES:
- Do NOT repeat any previously generated scenarios
- Continue the same numbered list format
- Cover ALL remaining areas: Negative, Boundary, Error handling, Edge cases
- Generate at LEAST 15 more scenarios
- Continue the numbering sequence from ${lastNum}

Output ONLY the additional numbered scenarios (no header, no title, no explanation):`;
                }
                case 'text':
                    return `Your previous response was cut off. Continue from EXACTLY where you left off. Do NOT repeat any content already generated. Continue the same formatting and structure.`;
                case 'code':
                    return `Your previous code was cut off. Continue from EXACTLY where the code stopped. Do NOT repeat any code already generated. Output ONLY the remaining code.`;
                default:
                    return `Continue from where you left off. Do not repeat any previously generated content.`;
            }
        };

        /* ── Should we continue? ── */
        const shouldContinue = (content, finishReason, completionTokens, currentRound) => {
            if (currentRound >= maxRounds) return false;
            const ratio = completionTokens / MAX_TOKENS;

            switch (contType) {
                case 'table': {
                    const rows = countTableRows(content);
                    console.log(`[LLM] shouldContinue check: rows=${rows}, minItems=${minItems}, ratio=${ratio.toFixed(3)}, headroom=${TOKEN_HEADROOM}, finish=${finishReason}`);
                    // Continue if: model stopped voluntarily AND few rows AND token headroom
                    if (finishReason === 'stop' && rows > 0 && rows <= minItems && ratio < TOKEN_HEADROOM) return true;
                    // Fallback: if table rows=0 but content is substantial (>2000 chars), the format
                    // may not have been detected — still continue if tokens suggest more content is needed
                    if (finishReason === 'stop' && rows === 0 && content.length > 2000 && ratio < TOKEN_HEADROOM && currentRound <= 2) return true;
                    // Also continue if actually truncated
                    if (finishReason === 'length') return true;
                    return false;
                }
                case 'list': {
                    const items = countListItems(content);
                    if (finishReason === 'stop' && items > 0 && items <= minItems && ratio < TOKEN_HEADROOM) return true;
                    if (finishReason === 'length') return true;
                    return false;
                }
                case 'text':
                case 'code':
                    // For prose/code, only continue on actual truncation
                    return finishReason === 'length';
                default:
                    return false;
            }
        };

        /* ── Merge continuation content ── */
        const mergeContent = (existing, newContent) => {
            switch (contType) {
                case 'table': {
                    // Extract only data rows (skip repeated headers/separators)
                    const lines = newContent.split('\n');
                    const dataLines = [];
                    for (const line of lines) {
                        if (!line.trim().startsWith('|')) continue;
                        const cells = line.split('|').slice(1, -1).map(c => c.trim());
                        if (cells.every(c => /^[-:]+$/.test(c) || !c)) continue; // separator
                        if (cells[0] && /SRL|No\.|Test Case Title/i.test(cells[0])) continue; // header
                        dataLines.push(line);
                    }
                    return dataLines.length > 0
                        ? existing.trimEnd() + '\n' + dataLines.join('\n')
                        : existing;
                }
                case 'list': {
                    // Extract only numbered items
                    const lines = newContent.split('\n').filter(l => /^\s*\d+[\.\)]/.test(l) || (l.trim() && !l.startsWith('#')));
                    return lines.length > 0
                        ? existing.trimEnd() + '\n' + lines.join('\n')
                        : existing;
                }
                case 'text':
                case 'code':
                default:
                    return existing.trimEnd() + '\n' + newContent;
            }
        };

        /* ── Count items for metadata ── */
        const countItems = (content) => {
            switch (contType) {
                case 'table': return countTableRows(content);
                case 'list':  return countListItems(content);
                default:      return 0;
            }
        };

        /* ═══════════════════════════════════════════
           MAIN EXECUTION
           ═══════════════════════════════════════════ */
        try {
            let messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ];

            // ── Round 1: Initial generation ──
            const r1 = await callLLM(messages);
            let allContent = r1.content;
            let totalPromptTokens = r1.prompt_tokens;
            let totalCompletionTokens = r1.completion_tokens;
            let totalTokens = r1.total_tokens;
            let lastFinishReason = r1.finish_reason;
            let rounds = 1;

            console.log(`[LLM] Round 1: Model=${model}, Platform=${this.platform}, finish=${lastFinishReason}, tokens=${totalCompletionTokens}, items=${countItems(allContent)}`);

            // ── Continuation loop ──
            // Check if model already signaled coverage complete in Round 1
            if (contType !== 'none' && allContent.toUpperCase().includes('COVERAGE COMPLETE')) {
                console.log(`[LLM] Model signaled COVERAGE COMPLETE in Round 1. Skipping continuation.`);
            } else if (contType !== 'none') {
                while (shouldContinue(allContent, lastFinishReason, totalCompletionTokens, rounds)) {
                    const itemCount = countItems(allContent);
                    console.log(`[LLM] Continuation ${rounds}: ${itemCount} items, ${totalCompletionTokens} tokens (${(totalCompletionTokens / MAX_TOKENS * 100).toFixed(1)}%). Requesting more...`);

                    // Delay between rounds to respect TPM limits
                    if (ROUND_DELAY > 0) {
                        console.log(`[LLM] Waiting ${ROUND_DELAY}ms before next round (TPM cooldown)...`);
                        await new Promise(resolve => setTimeout(resolve, ROUND_DELAY));
                    }

                    const contPrompt = buildContinuationPrompt(allContent, itemCount);
                    // Use trimmed history to keep prompt within TPM limits
                    const trimmedHistory = trimHistory(allContent);
                    const contMessages = [
                        { role: 'system', content: 'Continue generating ONLY for documented/in-scope features. Follow ALL original Anti-Hallucination rules. If all documented requirements are covered, respond with "COVERAGE COMPLETE".' },
                        { role: 'user', content: prompt },
                        { role: 'assistant', content: trimmedHistory },
                        { role: 'user', content: contPrompt }
                    ];

                    // Check estimated prompt size — bail if too large
                    const estPromptTokens = contMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
                    if (estPromptTokens + MAX_TOKENS > platformCfg.tpm * 0.9) {
                        console.warn(`[LLM] Skipping continuation: estimated ${estPromptTokens} prompt + ${MAX_TOKENS} output = ${estPromptTokens + MAX_TOKENS} tokens, would exceed TPM ${platformCfg.tpm}`);
                        break;
                    }

                    try {
                        const rN = await callLLM(contMessages);
                        lastFinishReason = rN.finish_reason;
                        totalPromptTokens += rN.prompt_tokens;
                        totalCompletionTokens += rN.completion_tokens;
                        totalTokens += rN.total_tokens;
                        rounds++;

                        const newItems = countItems(rN.content);
                        console.log(`[LLM] Round ${rounds}: +${newItems} items, tokens=${rN.completion_tokens}, finish=${lastFinishReason}`);

                        // Stop if model signals coverage is complete
                        if (rN.content.toUpperCase().includes('COVERAGE COMPLETE')) {
                            console.log(`[LLM] Model signaled COVERAGE COMPLETE. Stopping continuation.`);
                            break;
                        }

                        if (newItems === 0 && contType !== 'text' && contType !== 'code') break;
                        if (rN.content.trim().length < 20) break; // trivial response

                        allContent = mergeContent(allContent, rN.content);
                    } catch (contError) {
                        // If continuation fails (rate limit, token limit, etc.), return what we have
                        console.warn(`[LLM] Continuation round ${rounds + 1} failed: ${contError.message}. Returning accumulated content.`);
                        break;
                    }
                }
            }

            const finalItems = countItems(allContent);
            console.log(`[LLM] FINAL: ${finalItems > 0 ? finalItems + ' items' : allContent.length + ' chars'} after ${rounds} round(s). Tokens: prompt=${totalPromptTokens}, completion=${totalCompletionTokens}`);

            // ── Build metadata ──
            const meta = {
                model,
                platform: this.platform,
                finish_reason: lastFinishReason,
                prompt_tokens: totalPromptTokens,
                completion_tokens: totalCompletionTokens,
                total_tokens: totalTokens,
                truncated: lastFinishReason === 'length',
                rounds,
                total_items: finalItems
            };

            if (lastFinishReason === 'length') {
                console.warn(`[LLM] Output TRUNCATED after ${rounds} rounds. Model: ${model}, tokens: ${totalCompletionTokens}`);
                meta.warning = `Output was truncated — the model (${model}) reached its maximum output token limit (${totalCompletionTokens} tokens used across ${rounds} round(s)). The generated content may be INCOMPLETE.`;
            }

            return { content: allContent, meta };
        } catch (error) {
            console.error(`LLM Error [${this.platform}/${model}]:`, error.message, error.status || '');
            const msg = error.message || '';
            const status = error.status || error.statusCode || 0;
            if (msg.includes('maximum context length') || msg.includes('max_tokens') || msg.includes('token')) {
                throw new Error(`Token limit exceeded: ${msg}. Try a different model with higher token capacity or reduce the input size.`);
            }
            if (msg.includes('rate_limit') || msg.includes('429') || status === 429) {
                throw new Error(`Rate limit reached: ${msg}. Wait a moment and try again, or switch to a different LLM provider.`);
            }
            if (status === 503 || status === 502) {
                throw new Error(`LLM service unavailable (${status}) for model ${model}. Google's Gemini API may be temporarily overloaded. Try again in a minute or use a different model.`);
            }
            if (status === 400) {
                throw new Error(`LLM Bad Request (400): ${msg}. The model "${model}" may not exist or the request format may be unsupported.`);
            }
            throw new Error(`LLM Error: ${msg}`);
        }
    }
}

module.exports = LLMConnector;
