// One-off diagnostic: verify the saved Gemini key against the Generative Language
// API. Reads the key from dev-connections.json and prints ONLY status/message —
// never the key itself. Safe to delete after use.
const fs = require('fs');
const path = require('path');

const conn = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dev-connections.json'), 'utf8'));
const key = (conn.llm && conn.llm.apiKey) || '';
const prefix = key.slice(0, 3);
const looksLikeAiStudio = /^AIza/.test(key);
console.log(`Key prefix: "${prefix}…"  length=${key.length}  looksLikeAiStudioKey=${looksLikeAiStudio}`);

(async () => {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const ids = (body.models || []).map((m) => m.name.replace('models/', ''));
      console.log(`NATIVE OK ${res.status} — accessible flash models:`, ids.filter((n) => n.includes('flash')).slice(0, 6));
    } else {
      console.log(`NATIVE ERROR ${res.status} — ${body.error ? body.error.status + ': ' + body.error.message : 'no body'}`);
    }
  } catch (e) {
    console.log('NATIVE request failed:', e.message);
  }

  // Reproduce the app's exact call: OpenAI-compatible chat endpoint, Bearer auth.
  const candidates = [
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-flash-lite-latest',
  ];
  for (const model of candidates) {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: "Say 'Connected'." }] }),
      });
      const text = await res.text();
      const ok = res.ok ? 'OK  ' : 'FAIL';
      console.log(`  [${ok}] ${res.status} ${model}${res.ok ? '' : ' — ' + text.slice(0, 90).replace(/\s+/g, ' ')}`);
    } catch (e) {
      console.log(`  [ERR ] ${model} — ${e.message}`);
    }
  }
})();
