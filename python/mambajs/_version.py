import json
import subprocess
from pathlib import Path

__version__ = "0.0.0+unknown"

try:
    # Dev mode: read from monorepo package.json
    ROOT = Path(__file__).resolve().parents[2]
    PACKAGE_JSON = ROOT / "packages" / "mambajs-cli" / "package.json"

    if PACKAGE_JSON.exists():
        with open(PACKAGE_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        __version__ = data["version"]

    else:
        raise FileNotFoundError

except FileNotFoundError:
    # Prod mode: call installed mambajs binary
    try:
        BIN_DIR = Path(__file__).parent / "bin"
        BIN = BIN_DIR / "mambajs.exe" if (BIN_DIR / "mambajs.exe").exists() else BIN_DIR / "mambajs"

        result = subprocess.run(
            [str(BIN), "--version"],
            capture_output=True,
            text=True,
            timeout=3,
        )

        if result.returncode == 0:
            __version__ = result.stdout.strip()

    except Exception:
        # Final fallback: keep default
        pass
