"""Dry-run locks for scripts/spike_reset.py (G43).

The reset procedure itself is the deliverable: these tests pin the exact adb
invocations (UI/platform commands only, never `settings put`) so the
procedure cannot drift silently. Live runs need an emulator and are covered
by the P1-live acceptance, not here.
"""

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "spike_reset.py"

EXPECTED_COMMANDS = [
    "shell am start",
    "category.HOME",
    "shell dumpsys window",
    "shell cmd uimode night no",
    "exec-out screencap -p",
    "shell settings get secure ui_night_mode",
]


def run_dry(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--dry-run", *args],
        capture_output=True,
        text=True,
    )


def test_dry_run_lists_every_step() -> None:
    proc = run_dry("--task", "T2")
    assert proc.returncode == 0, proc.stderr
    for fragment in EXPECTED_COMMANDS:
        assert fragment in proc.stdout, fragment


def test_dry_run_never_writes_settings() -> None:
    for task in ("T1", "T2"):
        proc = run_dry("--task", task)
        assert proc.returncode == 0, proc.stderr
        assert "settings put" not in proc.stdout
        assert "never from settings" in proc.stdout


def test_missing_serial_fails_fast_without_dry_run(monkeypatch) -> None:
    monkeypatch.delenv("ADB_DEVICE_SERIAL", raising=False)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--task", "T1"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2
