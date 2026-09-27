"""tests/fuzz.py - runs what tests/fuzz.mjs generated, and holds it to account.

Every script is run against real openseespy with the synthetic ground motion
beside it. Not every random combination has to complete - some are numerically
hard, and some combine solver options OpenSees does not support together - so
failing to finish is reported, not failed. What is failed is the three things
that must never happen:

  * a run that completes and does not balance: the vertical base reaction
    recorded after gravity must equal the gravity load the builder applied.
    This is how the chevron that unloaded half its beam and the gravity
    integrator that stopped at ten times the load were found;
  * a mode reported with a period of zero, which reads as infinitely stiff
    when the truth is a non-positive eigenvalue - an unstable model;
  * any message from a defect that has been fixed. Each is listed below with
    what caused it, so a regression names itself.

    node tests/fuzz.mjs [count] [seed]
    python tests/fuzz.py [jobs]
"""

from __future__ import annotations

import concurrent.futures as cf
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out-fuzz"
sys.path.insert(0, str(HERE))
from run_variants import RECORD  # noqa: E402  the same synthetic ground motion

JOBS = int(sys.argv[1]) if len(sys.argv) > 1 else 8
TIMEOUT = 300
STATICS = 1e-3            # relative; the recorder's own rounding sits near 1e-5

# OpenSees messages of defects that have been fixed, and what caused each.
FIXED = {
    "torsion not specified": "a fiber section written without -GJ",
    "section 21not found": "members pointing at an aggregated section that was never built",
    "section 22not found": "members pointing at an aggregated section that was never built",
    "section 23not found": "members pointing at an aggregated section that was never built",
    "uniaxial material does not exist": "RCCircularSection in a steel frame",
    "PlainHandler": "the Plain handler under a rigid diaphragm",
    "no Numberer specified": "a parallel-only numberer",
    "incorrect # args": "'-doRayleigh' on a bearing that does not take it",
    "math domain error": "Rayleigh damping anchored on a non-positive eigenvalue",
}
CONVERGENCE = ("failed to converge", "did not converge", "could not be restored",
               "non-positive eigenvalue")


def run_one(entry: dict) -> dict:
    name = entry["name"]
    result = {"name": name}
    with tempfile.TemporaryDirectory(prefix="osms-fz-") as work:
        work = Path(work)
        (work / "ground_motion.txt").write_text(RECORD)
        try:
            proc = subprocess.run([sys.executable, str(OUT / f"{name}.py")], cwd=work,
                                  capture_output=True, text=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            result["status"] = "timeout"
            return result

        said = (proc.stdout or "") + (proc.stderr or "")
        result["regressions"] = [f"{msg!r} ({why})" for msg, why in FIXED.items() if msg in said]

        if proc.returncode != 0:
            low = said.lower()
            result["status"] = "no-convergence" if any(k in low for k in CONVERGENCE) else "error"
            tail = [line for line in (proc.stderr or "").strip().splitlines() if line.strip()]
            result["detail"] = tail[-1][:200] if tail else ""
            return result

        result["status"] = "ok"
        manifests = list(work.rglob("manifest.json"))
        if not manifests:
            return result
        man = json.loads(manifests[0].read_text(encoding="utf8"))
        gravity = (man.get("cases") or {}).get("gravity")
        if gravity and entry.get("gravityLoad"):
            got, want = gravity["baseReaction"][2], entry["gravityLoad"]
            result["statics"] = abs(got - want) / max(abs(want), 1e-12)
        modal = (man.get("cases") or {}).get("modal")
        if modal:
            result["zeroPeriod"] = any(p == 0.0 for p in modal.get("periods", []))
    return result


def main() -> int:
    entries = json.loads((OUT / "fuzz.json").read_text(encoding="utf8"))
    runnable = [e for e in entries if e["outcome"] == "generated"]
    print(f"Fuzz - {len(runnable)} scripts of {len(entries)} combinations, {JOBS} at a time\n", flush=True)
    with cf.ThreadPoolExecutor(max_workers=JOBS) as pool:
        results = list(pool.map(run_one, runnable))
    (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf8")

    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print("  " + " | ".join(f"{v} {k}" for k, v in sorted(counts.items())))

    failures = 0
    for r in results:
        problems = list(r.get("regressions", []))
        if r.get("statics", 0.0) > STATICS:
            problems.append(f"does not balance: {r['statics']:.3%} off the applied gravity")
        if r.get("zeroPeriod"):
            problems.append("a mode is reported with a period of zero")
        if problems:
            failures += 1
            print(f"  FAIL {r['name']}: " + "; ".join(problems))

    balanced = [r for r in results if "statics" in r]
    print(f"\n  {len(balanced)} completed runs checked for statics, "
          f"worst {max((r['statics'] for r in balanced), default=0.0):.2e}")
    print("\nNo regressions, every completed run balances." if not failures
          else f"\n{failures} run{'s' if failures > 1 else ''} failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
