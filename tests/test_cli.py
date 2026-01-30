import subprocess
from pathlib import Path
import sys
import shutil

HERE = Path(__file__).parent

def test_create_lock_from_environment_file():
    lockfile = "lock.json"

    Path(HERE / lockfile).unlink(missing_ok=True)

    subprocess.run(["mambajs", "create-lock", "test-env.yml", lockfile], check=True)

    assert not Path(HERE / lockfile).exists()
