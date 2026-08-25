"""tests/results.py - end-to-end check of the result pipeline.

Generates one model, runs it against real openseespy, then reads the output
directory back through the same modules the browser uses and asserts the
numbers. Three steps, one command, because a result reader that is never run
against a real analysis is not a reader, it is a hope.

    python tests/results.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SAMPLE = HERE / "sample"


def run(label: str, command: list[str], cwd: Path) -> bool:
    # Flushed before handing the console to the child, or the headings arrive
    # after the output they are meant to introduce.
    print(f"\n-- {label} " + "-" * max(0, 60 - len(label)), flush=True)
    proc = subprocess.run(command, cwd=cwd, text=True)
    return proc.returncode == 0


def main() -> int:
    node = shutil.which("node")
    if not node:
        print("node is required to generate the sample script.", file=sys.stderr)
        return 2

    if not run("generating the sample model", [node, str(HERE / "sample.mjs")], HERE):
        return 1

    if not run("running it against openseespy", [sys.executable, "sample.py"], SAMPLE):
        return 1

    if not run("reading the results back", [node, str(HERE / "results_check.mjs")], HERE):
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
