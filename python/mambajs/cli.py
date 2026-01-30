import subprocess
import pathlib
import sys
import platform

BIN_DIR = pathlib.Path(__file__).parent / "bin"

if platform.system() == "Windows":
    BIN = BIN_DIR / "mambajs.exe"
else:
    BIN = BIN_DIR / "mambajs"

def main():
    subprocess.run([str(BIN), *sys.argv[1:]], check=True)
