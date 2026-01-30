import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE_JSON = ROOT / "packages" / "mambajs-cli" / "package.json"

with open(PACKAGE_JSON, "r", encoding="utf-8") as f:
    data = json.load(f)

__version__ = data["version"]
