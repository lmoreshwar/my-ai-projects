import os
import sys

# Add project root and tools to the path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)
sys.path.insert(0, os.path.join(project_root, "server"))

# Import the FastAPI app from main.py
from server.main import app
