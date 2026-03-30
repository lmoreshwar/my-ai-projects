import os
from openai import OpenAI
from typing import Optional, List, Dict
import requests

class LLMConnector:
    def __init__(self, platform: str, api_key: Optional[str] = None, endpoint: Optional[str] = None):
        self.platform = platform.lower()
        self.api_key = api_key
        self.endpoint = endpoint or "http://localhost:11434/v1"

        if self.platform == "groq":
            self.client = OpenAI(
                base_url="https://api.groq.com/openai/v1",
                api_key=self.api_key
            )
        elif self.platform == "ollama":
            self.client = OpenAI(
                base_url=self.endpoint,
                api_key="ollama" # Placeholder for Ollama
            )
        elif self.platform == "gemini":
            self.client = OpenAI(
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                api_key=self.api_key
            )
        elif self.platform == "grok":
            self.client = OpenAI(
                base_url="https://api.x.ai/v1",
                api_key=self.api_key
            )
        else:
            raise ValueError(f"Unsupported LLM platform: {self.platform}")

    def generate_content(self, prompt: str, system_prompt: str = "You are an expert QA Engineer.", model: Optional[str] = None) -> str:
        """Call the LLM and return the generated text."""
        
        if not model:
            if self.platform == "groq": model = "llama-3.3-70b-versatile"
            elif self.platform == "ollama": model = "llama3"
            elif self.platform == "gemini": model = "gemini-1.5-flash"
            elif self.platform == "grok": model = "grok-beta"

        try:
            response = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                model=model,
                temperature=0.1
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"LLM Error: {str(e)}"
