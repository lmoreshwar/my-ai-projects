# SOP: LLM Integration (Groq & Ollama)

## Groq Connection
- **API URL**: `https://api.groq.com/openai/v1` (OpenAI compatible).
- **Model Recommendation**: `llama3-70b-8192` or `mixtral-8x7b-32768`.
- **Logic**: Use the `groq` Python library or standard `openai` library with a custom `base_url`.

## Ollama Connection (Local)
- **API URL**: User provided (default `http://localhost:11434/v1`).
- **Logic**: Use the `openai` library with `base_url` set to the Ollama endpoint.
- **Model**: Expect user to provide model name (e.g., `llama3`).

## Gemini Connection
- **API**: Google Generative AI (Google-provided).
- **Model**: `gemini-1.5-flash` or `gemini-1.5-pro`.

## Prompting Strategy
- Input: JSON payload from the Review step + Template context.
- Output: Structured Markdown text clearly mapped to the `.docx` sections.
