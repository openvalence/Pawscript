"""pawtrack: the tracker sidecar (PROTOCOL.md)."""
import os
from pathlib import Path

# paw-cdot: the folder that holds .cache/ and .models/ (the app's Settings > Models folder, passed as PAWTRACK_MODELS);
# without it trackers/, as before
MODELS_DIR = Path(os.environ.get("PAWTRACK_MODELS") or Path(__file__).resolve().parent.parent)