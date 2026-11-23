"""Pack the Python package and the built UI into one zipapp."""

from __future__ import annotations

import hashlib
import shutil
import sys
import tempfile
import zipapp
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = '''from homelab_panel.server import main

if __name__ == "__main__":
    main()
'''


def main():
    destination = Path(sys.argv[1] if len(sys.argv) > 1 else "dist/homelab-panel.pyz")
    dist = ROOT / "ui" / "dist"
    index = dist / "index.html"
    if not index.is_file():
        raise SystemExit("ui/dist is missing. Build the UI first.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        stage = Path(temp)
        shutil.copytree(ROOT / "homelab_panel", stage / "homelab_panel", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        shutil.copytree(dist, stage / "ui" / "dist")
        (stage / "__main__.py").write_text(MAIN)
        zipapp.create_archive(stage, destination, interpreter="/usr/bin/python3", compressed=True)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    checksum = destination.with_suffix(destination.suffix + ".sha256")
    checksum.write_text(f"{digest}  {destination.name}\n")
    print(destination)
    print(f"{digest}  {destination.name}")


if __name__ == "__main__":
    main()
