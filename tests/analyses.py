"""tests/analyses.py - checks that each analysis ran the way it was asked to.

A script that finishes without an error has not necessarily done what it was
asked, and two defects hid exactly there. They were found by setting runs
against each other, not by looking for a failure:

  * the time history was set up over the static analysis gravity had left
    behind, so OpenSees refused the chosen integrator and put Newmark 0.5/0.25
    in its place. HHT, generalized alpha and TRBDF2 all gave the same numbers
    as the default, to the last digit. Each is now held to finishing every
    step, to differing from Newmark, and to leaving no sign of the swap;
  * under rigid diaphragms the pushover and the cyclic run controlled a joint
    tied to the floor master, which the Transformation handler takes out of
    the equations. The pushover stopped at its first step, the cyclic run at
    its first drift, and from the corner joint the pushover ran on to a roof
    displacement of sixteen metres. Each is now held to reaching its target.

    node tests/generate.mjs
    python tests/analyses.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
sys.path.insert(0, str(HERE))
from run_variants import RECORD  # noqa: E402  the same synthetic ground motion

# What OpenSees prints when it throws the chosen transient integrator away.
SWAPPED = ("can't set transient integrator", "no Integrator specified")


def gravity_load(stem: str) -> float:
    """The total gravity load the builder worked out, from the generator's manifest."""
    entries = json.loads((OUT / "manifest.json").read_text(encoding="utf8"))
    return next(e["gravityLoad"] for e in entries if e["name"] == stem)


def no_gravity_applied(report: Report, label: str, stem: str, r: dict) -> None:
    """With the gravity analysis off, no vertical load may reach the supports.

    The pattern used to stay in the domain on a Linear series nothing held
    constant: the time history carried ten times the building's weight at ten
    seconds, and a pushover the weight times its load factor.
    """
    rows = r.get("reactions.out", [])
    worst = max((abs(sum(row[1:][2::3])) for row in rows), default=float("nan"))
    weight = gravity_load(stem)
    report.check(f"{label}: no gravity is applied", worst <= 1e-4 * weight,
                 f"largest vertical reaction {worst:.4g} against a weight of {weight:.6g}")


def table(path: Path) -> list[list[float]]:
    rows = []
    for line in path.read_text().splitlines():
        try:
            rows.append([float(v) for v in line.split()])
        except ValueError:
            continue                  # the header
    return [r for r in rows if r]


def run(stem: str) -> dict | None:
    """Runs one variant and keeps what it said and what it wrote."""
    script = OUT / f"{stem}.py"
    if not script.exists():
        return None
    with tempfile.TemporaryDirectory(prefix="osms-an-") as work:
        work = Path(work)
        (work / "ground_motion.txt").write_text(RECORD)
        proc = subprocess.run([sys.executable, str(script)], cwd=work,
                              capture_output=True, text=True, timeout=900)
        found = {p.name: p for p in work.rglob("*") if p.is_file()}
        return {
            "code": proc.returncode,
            "said": (proc.stdout or "") + (proc.stderr or ""),
            "manifest": json.loads(found["manifest.json"].read_text(encoding="utf8"))
                        if "manifest.json" in found else {},
            **{name: table(found[name])
               for name in ("convergence.out", "pushover.out", "cyclic.out", "reactions.out")
               if name in found},
        }


class Report:
    def __init__(self) -> None:
        self.failed = 0

    def check(self, label: str, ok: bool, detail: str = "") -> None:
        self.failed += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {label}" + (f"  - {detail}" if detail else ""))


def time_history(report: Report) -> None:
    print("Time history - the integrator asked for is the one that runs\n")

    def finished(label: str, r: dict | None) -> bool:
        if r is None:
            report.check(label, False, "the variant was not generated")
            return False
        th = r["manifest"].get("cases", {}).get("timeHistory", {})
        done = r["code"] == 0 and th and th.get("steps") == th.get("requestedSteps")
        report.check(f"{label}: every step", bool(done),
                     f"{th.get('steps')} of {th.get('requestedSteps')}" if th else f"exit {r['code']}")
        swapped = [m for m in SWAPPED if m in r["said"]]
        report.check(f"{label}: set as asked", not swapped, "; ".join(swapped))
        return bool(done)

    newmark = run("time-history-Newmark")
    if not finished("Newmark", newmark):
        return
    reference = [row[3] for row in newmark["convergence.out"]]
    peak = max(abs(v) for v in reference)

    for name in ("HHT", "GeneralizedAlpha", "TRBDF2"):
        r = run(f"time-history-{name}")
        if not finished(name, r):
            continue
        shear = [row[3] for row in r["convergence.out"]]
        apart = max(abs(a - b) for a, b in zip(shear, reference))
        report.check(f"{name}: differs from Newmark", apart > 1e-9 * peak,
                     f"largest difference in base shear {apart:.3e} of a peak {peak:.4g}")

    finished("after a pushover", run("time-history-after-pushover"))
    r = run("time-history-no-gravity")
    if finished("without gravity", r):
        no_gravity_applied(report, "without gravity", "time-history-no-gravity", r)


def diaphragm(report: Report) -> None:
    print("\nRigid diaphragms - the lateral analyses reach their targets\n")
    for stem, label in (("diaphragm-pushover-cyclic", "centre"), ("diaphragm-pushover-corner", "corner")):
        r = run(stem)
        if r is None:
            report.check(label, False, "the variant was not generated")
            continue
        cases = r["manifest"].get("cases", {})

        push = cases.get("pushover")
        if push and r.get("pushover.out"):
            target = push["targetDrift"] * push["height"]
            reached = r["pushover.out"][-1][0]
            report.check(f"{label}: pushover reaches its target",
                         abs(reached - target) <= 1e-6 * abs(target),
                         f"{reached:.6g} of {target:.6g}")
        else:
            report.check(f"{label}: pushover reaches its target", False, "no pushover was recorded")

        cyc = cases.get("cyclic")
        if cyc is not None:
            target = max(cyc["amplitudes"]) * cyc["height"]
            reached = max((abs(row[0]) for row in r.get("cyclic.out", [])), default=0.0)
            report.check(f"{label}: cyclic reaches its largest drift",
                         reached >= (1 - 1e-6) * target, f"{reached:.6g} of {target:.6g}")


def modal_pattern(report: Report) -> None:
    print("\nModal load pattern - the mode that moves along the push\n")
    r = run("pushover-dominant-mode")
    push = (r or {}).get("manifest", {}).get("cases", {}).get("pushover")
    if push and r.get("pushover.out"):
        target = push["targetDrift"] * push["height"]
        reached = r["pushover.out"][-1][0]
        report.check("pushover reaches its target", abs(reached - target) <= 1e-6 * abs(target),
                     f"{reached:.6g} of {target:.6g}, following mode {push.get('patternMode')}")
    else:
        report.check("pushover reaches its target", False, "no pushover was recorded")

    r = run("cyclic-dominant-mode-no-gravity")
    cyc = (r or {}).get("manifest", {}).get("cases", {}).get("cyclic")
    if cyc is not None and r["code"] == 0:
        target = max(cyc["amplitudes"]) * cyc["height"]
        reached = max((abs(row[0]) for row in r.get("cyclic.out", [])), default=0.0)
        report.check("cyclic without gravity reaches its largest drift", reached >= (1 - 1e-6) * target,
                     f"{reached:.6g} of {target:.6g}, following mode {cyc.get('patternMode')}")
        no_gravity_applied(report, "cyclic without gravity", "cyclic-dominant-mode-no-gravity", r)
    else:
        report.check("cyclic without gravity reaches its largest drift", False,
                     f"exit {r['code']}" if r else "the variant was not generated")


def main() -> int:
    report = Report()
    time_history(report)
    diaphragm(report)
    modal_pattern(report)
    print("\nEvery analysis ran as asked." if not report.failed
          else f"\n{report.failed} check{'s' if report.failed > 1 else ''} failed.")
    return 1 if report.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
