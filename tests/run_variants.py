"""tests/run_variants.py - runs every generated script against real openseespy.

Each script is executed in its own interpreter, so a solver that aborts the
process cannot take the rest of the run with it. A script that raises is a
failure; a model that runs but does not converge is reported separately,
because non-convergence is a property of the model, not a bug in the generator.

    python tests/generate.mjs        # writes tests/out
    python tests/run_variants.py     # runs them

Options:
    --dir DIR       where the scripts are         (default: tests/out)
    --jobs N        parallel interpreters         (default: CPU count, max 8)
    --timeout SEC   per-script limit              (default: 300)
    --filter TEXT   only run scripts whose name contains TEXT
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Phrases OpenSees prints when the model is fine but the solution did not
# converge. These are reported, not counted as failures.
NON_CONVERGENCE = (
    "failed to converge",
    "did not converge",
    "analyze failed",
    "the Algorithm failed",
)


def run_one(script: Path, timeout: int) -> dict:
    started = time.perf_counter()
    # Recorders write relative to the script's OUT_DIR, so each run gets its own
    # scratch directory and nothing is left behind in the repository.
    with tempfile.TemporaryDirectory(prefix="osms-") as work:
        try:
            proc = subprocess.run(
                [sys.executable, str(script)],
                cwd=work,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            code, out, err = proc.returncode, proc.stdout, proc.stderr
        except subprocess.TimeoutExpired:
            return {
                "name": script.stem, "status": "timeout",
                "seconds": timeout, "detail": f"exceeded {timeout} s",
            }

    seconds = time.perf_counter() - started
    blob = f"{out}\n{err}"

    if code == 0:
        return {"name": script.stem, "status": "ok", "seconds": seconds, "detail": ""}

    if any(phrase.lower() in blob.lower() for phrase in NON_CONVERGENCE):
        return {
            "name": script.stem, "status": "no-convergence", "seconds": seconds,
            "detail": last_meaningful_line(blob),
        }

    return {
        "name": script.stem, "status": "error", "seconds": seconds,
        "detail": last_meaningful_line(blob),
    }


def last_meaningful_line(blob: str) -> str:
    lines = [line.strip() for line in blob.splitlines() if line.strip()]
    return lines[-1][:200] if lines else "no output"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", default=str(HERE / "out"))
    parser.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 1))
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--filter", default="")
    args = parser.parse_args()

    out_dir = Path(args.dir)
    scripts = sorted(p for p in out_dir.glob("*.py") if args.filter in p.name)
    if not scripts:
        print(f"No scripts in {out_dir}. Run:  node tests/generate.mjs", file=sys.stderr)
        return 2

    try:
        import openseespy.opensees  # noqa: F401
    except Exception as exc:                                  # pragma: no cover
        print(f"openseespy is not importable in {sys.executable}: {exc}", file=sys.stderr)
        return 2

    print(f"Running {len(scripts)} scripts on {sys.version.split()[0]} "
          f"with {args.jobs} workers\n")

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(run_one, s, args.timeout): s for s in scripts}
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            mark = {"ok": "  ok", "no-convergence": "  --",
                    "error": "FAIL", "timeout": "TIME"}[result["status"]]
            print(f"{mark}  {result['name']:<38} {result['seconds']:6.1f}s "
                  f"{result['detail']}")

    results.sort(key=lambda r: r["name"])
    counts = {status: sum(1 for r in results if r["status"] == status)
              for status in ("ok", "no-convergence", "error", "timeout")}

    report = out_dir / "results.json"
    report.write_text(json.dumps(
        {"python": sys.version.split()[0], "counts": counts, "results": results},
        indent=2) + "\n", encoding="utf8")

    print(f"\n{counts['ok']} completed | {counts['no-convergence']} did not converge | "
          f"{counts['error']} script errors | {counts['timeout']} timed out")
    print(f"Report: {report}")

    # Only a script error or a timeout is a failure of the generator.
    return 1 if counts["error"] or counts["timeout"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
