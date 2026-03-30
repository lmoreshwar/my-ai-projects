import requests
import sys

def list_spaces(url, email, token):
    api_url = f"{url.rstrip('/')}/wiki/rest/api/space"
    auth = (email, token)
    params = {"limit": 10}
    
    try:
        response = requests.get(api_url, auth=auth, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            spaces = [f"{s['key']} ({s['name']})" for s in data.get('results', [])]
            print("Available Confluence Spaces:")
            for s in spaces:
                print(f" - {s}")
        else:
            print(f"Error: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"Failed to fetch spaces: {str(e)}")

if __name__ == "__main__":
    # We'll use the credentials usually provided in the env or the ones we've seen
    # For now, let's just make the script and let the model run it with args or read from App.jsx
    pass
