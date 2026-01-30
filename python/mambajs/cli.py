import subprocess
import pathlib
import sys
import platform

BIN_DIR = pathlib.Path(__file__).parent / "bin"
BIN = BIN_DIR / "mambajs.exe" if (BIN_DIR / "mambajs.exe").exists() else BIN_DIR / "mambajs"

def main():
    if not BIN.exists():
        print(f"Error: mambajs binary not found at {BIN}", file=sys.stderr)
        return 127

    result = subprocess.run([str(BIN), *sys.argv[1:]])

    # Propagate the exit code exactly
    return result.returncode
