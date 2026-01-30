import os
import subprocess
import pathlib
import sys
import shutil
from setuptools.dist import Distribution
from setuptools.command.bdist_wheel import bdist_wheel

old_cwd = os.getcwd()

# Map sys.platform to Bun cross-compile target + wheel plat-name
PLATFORMS = {
    "linux":   ("bun-linux-x64-baseline", "manylinux2014_x86_64"),
    "darwin":  ("bun-darwin-x64", "macosx_10_9_x86_64"),
    "win32":   ("bun-windows-x64-baseline", "win_amd64"),
}

ROOT = pathlib.Path(__file__).parent.parent
PYTHON_DIR = ROOT / "python"
BIN_DIR = PYTHON_DIR / "mambajs" / "bin"
BIN_DIR.mkdir(exist_ok=True)

JS_INPUT = ROOT / "packages/mambajs-cli/dist/index.js"

try:
    for plat, (bun_target, wheel_plat) in PLATFORMS.items():
        print(f"Building Bun binary for {plat}...")
        outfile = BIN_DIR / ("mambajs.exe" if plat == "win32" else "mambajs")
        subprocess.run([
            "bun", "build", "--compile", "--minify",
            "--target", bun_target,
            str(JS_INPUT),
            "--outfile", str(outfile)
        ], check=True)

        os.chdir(PYTHON_DIR)

        print(f"Building wheel for {plat}...")
        # setuptools build for the specific platform
        subprocess.run([
            sys.executable,
            "setup.py", "bdist_wheel",
            "--plat-name", wheel_plat
        ], check=True)

        # Cleanup
        shutil.rmtree(BIN_DIR, ignore_errors=True)

    print("All wheels built!")
finally:
    os.chdir(old_cwd)
