#!/usr/bin/env python3
"""Spike reset and verdict scaffolding for the DSH device quality runs (G43).

Uses only the Python 3.12+ standard library. Every reset goes through the UI
or platform commands that were verified live; the `settings put ui_night_mode`
path is deliberately absent (it does not take effect on the MuMu ROM, and
`settings get` still reads 2 while dark). Achievement is judged from
screenshots by a human or the model -- this script never judges pixels, it
only produces deterministically reset states plus a review checklist.

Live runs need an emulator (absent on machines without adb); `--dry-run`
prints every adb invocation without touching a device, so CI stays green.
"""

import argparse
import subprocess
import sys
from pathlib import Path

# Verbatim goal texts from the D9 ruling table (one new DSH session per task).
TASKS = {
    "T1": "Open Settings, go to Display",
    "T2": "Open Settings, turn on the dark theme",
}


def run_adb(serial: str, *args: str, dry_run: bool = False) -> str:
    cmd = ["adb", "-s", serial, *args]
    if dry_run:
        print("$ " + " ".join(cmd))
        return "<dry-run>"
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"adb failed: {' '.join(cmd)}\n{proc.stderr.strip()}")
    return proc.stdout.strip()


def reset_home(serial: str, dry_run: bool = False) -> None:
    """Back to the launcher and prove it via the focused window."""
    run_adb(
        serial,
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.HOME",
        dry_run=dry_run,
    )
    focus = run_adb(serial, "shell", "dumpsys", "window", dry_run=dry_run)
    if not dry_run and "LawnchairLauncher" not in focus:
        raise RuntimeError("home reset failed: mCurrentFocus is not LawnchairLauncher")
    print("home: launcher focused")


def reset_light(serial: str, dry_run: bool = False) -> None:
    """Light theme through the platform command (settings put does not work)."""
    run_adb(serial, "shell", "cmd", "uimode", "night", "no", dry_run=dry_run)
    print("theme: reset to light (verify against the next screenshot)")


def shot(serial: str, dest: str, dry_run: bool = False) -> None:
    """Pull one screenshot; the verdict is always made from the image."""
    cmd = ["adb", "-s", serial, "exec-out", "screencap", "-p"]
    if dry_run:
        print("$ " + " ".join(cmd) + f" > {dest}")
        return
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"screencap failed: {proc.stderr.decode('utf-8', 'replace')}")
    Path(dest).write_bytes(proc.stdout)
    print(f"shot: {dest}")


def oracle(task: str, serial: str, dry_run: bool = False) -> None:
    """Print the旁证 (never the verdict): settings value + review checklist."""
    setting = run_adb(
        serial, "shell", "settings", "get", "secure", "ui_night_mode", dry_run=dry_run
    )
    print(f"oracle[{task}]: settings ui_night_mode = {setting} (旁证 only, not the verdict)")
    if task == "T1":
        print("checklist[T1]: screenshot shows the Display page, light theme")
    elif task == "T2":
        print("checklist[T2]: screenshot shows the display switch ON and a dark device")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default=None, help="ADB serial (default: $ADB_DEVICE_SERIAL)")
    parser.add_argument(
        "--task",
        choices=sorted(TASKS),
        default="T1",
        help="spike task; goal texts: "
        + "; ".join(f"{name}: {goal}" for name, goal in TASKS.items()),
    )
    parser.add_argument("--out-dir", default="spike", help="where to drop screenshots")
    parser.add_argument(
        "--dry-run", action="store_true", help="print adb invocations without running them"
    )
    args = parser.parse_args(argv)

    serial = args.serial
    if not serial:
        import os

        serial = os.environ.get("ADB_DEVICE_SERIAL", "")
    if not serial and not args.dry_run:
        print("no device serial: pass --serial or set ADB_DEVICE_SERIAL", file=sys.stderr)
        return 2

    try:
        reset_home(serial or "<serial>", dry_run=args.dry_run)
        reset_light(serial or "<serial>", dry_run=args.dry_run)
        shot(
            serial or "<serial>",
            str(Path(args.out_dir) / f"{args.task}-reset.png"),
            dry_run=args.dry_run,
        )
        oracle(args.task, serial or "<serial>", dry_run=args.dry_run)
    except RuntimeError as error:
        print(f"FAILED: {error}", file=sys.stderr)
        return 2
    print("reset complete: judge the task from screenshots, never from settings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
