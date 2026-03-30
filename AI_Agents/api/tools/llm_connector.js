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

    async generateContent(prompt, systemPrompt = "You are an expert QA Engineer.", model = null) {
        if (!model) {
            if (this.platform === 'groq') model = 'llama-3.3-70b-versatile';
            else if (this.platform === 'ollama') model = 'llama3';
            else if (this.platform === 'gemini') model = 'gemini-1.5-flash';
            else if (this.platform === 'grok') model = 'grok-beta';
        }

        try {
            const response = await this.client.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                model: model,
                temperature: 0.1
            });
            
            return response.choices[0].message.content;
        } catch (error) {
            console.error("LLM Error:", error);
            return `LLM Error: ${error.message}`;
        }
    }
}

module.exports = LLMConnector;
