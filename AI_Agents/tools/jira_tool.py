import requests
from typing import Dict, Any

class JiraTool:
    def __init__(self, url: str, email: str, token: str):
        self.url = url.rstrip("/")
        self.auth = (email, token)
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json"
        }

    def test_connection(self) -> Dict[str, Any]:
        """Verify Jira connection and return user data."""
        api_url = f"{self.url}/rest/api/3/myself"
        response = requests.get(api_url, auth=self.auth, headers=self.headers, timeout=10)
        if response.status_code != 200:
            raise Exception(f"Jira Auth failed: {response.status_code}")
        return response.json()

    def search_issues(self, jql: str, max_results: int = 5) -> list:
        """Search for issues using JQL."""
        # Migrate to the latest /search/jql API as per Atlassian CHANGE-2046
        api_url = f"{self.url}/rest/api/3/search/jql"
        params = {
            "jql": jql,
            "maxResults": max_results,
            "fields": "summary,description,status,project"
        }
        response = requests.get(api_url, auth=self.auth, headers=self.headers, params=params, timeout=15)
        
        if response.status_code != 200:
            raise Exception(f"Jira Search error: {response.status_code} - {response.text}")
            
        issues = response.json().get("issues", [])
        results = []
        for issue in issues:
            fields = issue.get("fields", {})
            results.append({
                "id": issue.get("key"),
                "summary": fields.get("summary", ""),
                "description": self._parse_adf(fields.get("description", {})),
                "status": fields.get("status", {}).get("name", ""),
                "project": fields.get("project", {}).get("name", "")
            })
        return results

    def fetch_issue(self, issue_id: str) -> Dict[str, Any]:
        """Fetch issue details from Jira."""
        api_url = f"{self.url}/rest/api/3/issue/{issue_id}"
        response = requests.get(api_url, auth=self.auth, headers=self.headers, timeout=15)
        
        if response.status_code != 200:
            raise Exception(f"Jira API error: {response.status_code} - {response.text}")
            
        data = response.json()
        fields = data.get("fields", {})
        
        return {
            "id": issue_id,
            "summary": fields.get("summary", ""),
            "description": self._parse_adf(fields.get("description", {})),
            "status": fields.get("status", {}).get("name", ""),
            "project": fields.get("project", {}).get("name", ""),
            "raw": data # Keep raw for advanced context
        }

    def _parse_adf(self, adf_content: Dict[str, Any]) -> str:
        """Simple Atlassian Document Format parser to extract text."""
        if not adf_content or "content" not in adf_content:
            return ""
        
        text_parts = []
        for block in adf_content["content"]:
            if block.get("type") == "paragraph":
                for item in block.get("content", []):
                    if item.get("type") == "text":
                        text_parts.append(item.get("text", ""))
        
        return "\n".join(text_parts)
