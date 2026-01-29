import subprocess
import pathlib
import sys

BIN = pathlib.Path(__file__).parent / "bin" / "mambajs"

def main():
    subprocess.run([str(BIN), *sys.argv[1:]], check=True)
