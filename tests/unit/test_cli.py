# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit tests for the contracted device-action CLI.

Only ``doctor``, ``mcp`` and ``helper`` remain after the smart agent stack and
web console moved to the DSH host. The autonomous ``run``/``batch``/``trace``
commands and the server lifecycle/restart commands are gone, and the MCP
``--install`` / ``--generate-config`` IDE injection moved to the host.
"""

import json

from typer.testing import CliRunner

from artemis.interfaces.cli.main import app

runner = CliRunner()


# ---------------------------------------------------------------------------
# Top-level command surface
# ---------------------------------------------------------------------------


def test_cli_help():
    """The top-level help lists exactly the device subcommands."""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "device-action" in result.output
    for name in ("doctor", "mcp", "helper"):
        assert name in result.output


def test_cli_version():
    """--version prints the device-action core banner."""
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "ARTEMIS device-action core" in result.output


def test_removed_commands_are_unknown():
    """The smart-agent and server-lifecycle commands no longer exist."""
    for command in ("run", "batch", "trace", "server", "restart", "stop", "status", "ui", "init"):
        result = runner.invoke(app, [command, "--help"])
        assert result.exit_code != 0, command


def test_cli_mcp_help():
    """'artemis mcp --help' lists the device server types and transport options."""
    result = runner.invoke(app, ["mcp", "--help"])
    assert result.exit_code == 0
    for flag in ("--type", "--transport", "--host", "--port"):
        assert flag in result.output
    for kind in ("adb", "mock", "xml"):
        assert kind in result.output
    # The IDE config injection moved to the DSH host.
    assert "--generate-config" not in result.output
    assert "--install" not in result.output


# ---------------------------------------------------------------------------
# artemis doctor (readiness-engine backed)
# ---------------------------------------------------------------------------

_RAW_SECRET = "sk-RAWSECRET0123456789abcdef"


def _probe(
    probe_id: str,
    *,
    status="pass",
    blocker: bool = True,
    summary: str = "OK",
    description: str = "fine",
    actions=(),
    metadata=None,
):
    from artemis.core.diagnostics.schema import (
        ProbeAction,
        ProbeCategory,
        ProbeResult,
        ProbeStatus,
    )

    return ProbeResult(
        id=probe_id,
        category=ProbeCategory.RUNTIME,
        title=f"Title {probe_id}",
        status=ProbeStatus(status),
        is_blocker=blocker,
        summary=summary,
        description=description,
        metadata=metadata or {},
        actions=[ProbeAction(action_type=t, label=lbl, payload=p) for t, lbl, p in actions],
    )


def _all_pass_probes():
    """The three surviving device probes, green, in CHECK_ORDER."""
    return [
        _probe("python_runtime"),
        _probe("android_adb", metadata={"installed": True, "adb_keys": {"is_corrupted": False}}),
        _probe("toolchain", blocker=False),
    ]


def _install_doctor_fakes(monkeypatch, probes, *, heal_result=None):
    """Patch the readiness engine and disable the CLI-only helper row."""
    import time
    from unittest.mock import AsyncMock

    from artemis.core.diagnostics.engine import readiness_engine
    from artemis.core.diagnostics.schema import ProbeStatus, SystemReadinessReport
    import artemis.interfaces.cli.commands.doctor as doctor_module

    monkeypatch.setenv("COLUMNS", "200")
    blockers = [p for p in probes if p.is_blocker]
    report = SystemReadinessReport(
        overall_ready=all(p.status is ProbeStatus.PASS for p in blockers),
        blocker_count=len(blockers),
        passed_blocker_count=sum(p.status is ProbeStatus.PASS for p in blockers),
        probes=list(probes),
        os_type="windows",
        timestamp=time.time(),
    )
    run_all = AsyncMock(return_value=report)
    monkeypatch.setattr(readiness_engine, "run_all", run_all)
    heal = AsyncMock(return_value=heal_result or {"success": True, "message": "Keys regenerated."})
    monkeypatch.setattr(readiness_engine, "heal_adb_keys", heal)
    # No real device or accessibility helper in the CLI tests.
    monkeypatch.setattr(doctor_module, "_helper_row", lambda results: None)
    return {"run_all": run_all, "heal": heal}


def test_cli_doctor_all_pass_renders_table_in_fix_order(monkeypatch):
    """All-green run: engine rows in fix order, exit 0, ready footer."""
    _install_doctor_fakes(monkeypatch, _all_pass_probes())

    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 0, result.output
    out = result.output
    assert "Artemis System & Environment Doctor" in out
    assert "Details & Recommendations" in out
    assert out.count("✔ OK") == 3
    assert "Node.js / npm" not in out and "Showcase UI" not in out
    assert "All system checks passed" in out
    assert 'artemis run "Open Settings and check Battery level"' in out

    order = ["Title python_runtime", "Title android_adb", "Title toolchain"]
    positions = [out.index(name) for name in order]
    assert positions == sorted(positions)


def test_cli_doctor_blocker_failure_shows_run_lines_and_splits_chains(monkeypatch):
    """A failing blocker prints each action on its own line; && chains are split."""
    probes = [p for p in _all_pass_probes() if p.id != "android_adb"]
    probes.append(
        _probe(
            "android_adb",
            status="fail",
            summary="ADB Missing",
            description="adb was not found.",
            actions=[
                ("command", "Install", "winget install Google.PlatformTools && adb start-server"),
                ("hint", "Enable USB", "Enable USB debugging on the phone."),
                ("link", "Docs", "https://developer.android.com/tools/adb"),
            ],
            metadata={"installed": False},
        )
    )
    _install_doctor_fakes(monkeypatch, probes)

    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 1, result.output
    out = result.output
    assert "✖ ADB Missing" in out
    assert "Run: winget install Google.PlatformTools" in out
    assert "Run: adb start-server" in out
    assert "&&" not in out
    assert "Enable USB debugging on the phone." in out
    assert "https://developer.android.com/tools/adb" in out
    assert "Action Required" in out
    assert "artemis init" in out
    assert "mobile_diagnose" in out


def test_cli_doctor_optional_failure_is_degraded_not_blocked(monkeypatch):
    """Non-blocker FAIL renders as Optional, keeps exit 0, and yields 'degraded'."""
    probes = [p for p in _all_pass_probes() if p.id != "toolchain"]
    probes.append(
        _probe(
            "toolchain",
            status="fail",
            blocker=False,
            summary="Missing FFmpeg",
            actions=[("command", "Install", "winget install Gyan.FFmpeg")],
        )
    )
    _install_doctor_fakes(monkeypatch, probes)

    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 0, result.output
    assert "⚪ Optional" in result.output
    assert "Run: winget install Gyan.FFmpeg" in result.output
    assert "optional gaps" in result.output

    result = runner.invoke(app, ["doctor", "--json"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["verdict"] == "degraded"


def test_cli_doctor_never_prints_raw_keys_from_metadata(monkeypatch):
    """Probe metadata (which may carry raw credentials) never reaches output."""
    probes = [
        _probe("python_runtime"),
        _probe(
            "android_adb",
            description="ADB credential is active (sk-RAW...cdef).",
            metadata={"installed": True, "raw_key": _RAW_SECRET},
        ),
        _probe("toolchain", blocker=False),
    ]
    _install_doctor_fakes(monkeypatch, probes)

    table = runner.invoke(app, ["doctor"])
    assert table.exit_code == 0, table.output
    assert "RAWSECRET" not in table.output
    assert "sk-RAW...cdef" in table.output  # the masked description is still shown

    as_json = runner.invoke(app, ["doctor", "--json"])
    assert as_json.exit_code == 0, as_json.output
    assert "RAWSECRET" not in as_json.output
    assert "metadata" not in as_json.output


def test_cli_doctor_json_shape_and_ready_verdict(monkeypatch):
    """--json emits the documented document shape and nothing else."""
    _install_doctor_fakes(monkeypatch, _all_pass_probes())

    result = runner.invoke(app, ["doctor", "--json"])
    assert result.exit_code == 0, result.output
    doc = json.loads(result.output)
    assert set(doc) == {"verdict", "checks", "extras", "fixes"}
    assert doc["verdict"] == "ready"
    assert doc["fixes"] == []
    assert doc["extras"] == {}
    assert [c["id"] for c in doc["checks"]] == [
        "python_runtime",
        "android_adb",
        "toolchain",
    ]
    for check in doc["checks"]:
        assert set(check) == {"id", "title", "status", "required", "summary", "detail", "fix"}
        assert check["status"] == "pass"
        assert check["fix"] == []


def test_cli_doctor_json_blocked_verdict_and_exit_code(monkeypatch):
    """A blocker that is not PASS makes the verdict 'blocked' and the exit code 1."""
    probes = [p for p in _all_pass_probes() if p.id != "android_adb"]
    probes.append(
        _probe(
            "android_adb",
            status="fail",
            summary="ADB Missing",
            description="No platform-tools on PATH.",
            actions=[
                ("command", "Install platform-tools", "winget install Google.PlatformTools"),
                ("link", "Docs", "https://developer.android.com/tools/adb"),
            ],
            metadata={"installed": False},
        )
    )
    _install_doctor_fakes(monkeypatch, probes)

    result = runner.invoke(app, ["doctor", "--json"])
    assert result.exit_code == 1, result.output
    doc = json.loads(result.output)
    assert doc["verdict"] == "blocked"
    adb_check = next(c for c in doc["checks"] if c["id"] == "android_adb")
    assert adb_check["status"] == "fail"
    assert adb_check["required"] is True
    assert adb_check["fix"] == [
        {
            "type": "command",
            "label": "Install platform-tools",
            "payload": "winget install Google.PlatformTools",
        },
        {"type": "link", "label": "Docs", "payload": "https://developer.android.com/tools/adb"},
    ]


def test_cli_doctor_fix_heals_corrupted_keys_and_sweeps_locks(monkeypatch):
    """--fix heals ADB keys when the probe reports corruption and sweeps stale locks."""
    from artemis.runtime.device_lock import DeviceExecutionLock

    probes = [p for p in _all_pass_probes() if p.id != "android_adb"]
    probes.append(
        _probe(
            "android_adb",
            status="fail",
            summary="Keys Corrupted",
            metadata={"installed": True, "adb_keys": {"is_corrupted": True}},
        )
    )
    fakes = _install_doctor_fakes(monkeypatch, probes)
    cleanup_calls: list = []
    monkeypatch.setattr(
        DeviceExecutionLock,
        "cleanup_stale_locks",
        classmethod(lambda cls, device_id=None: cleanup_calls.append(device_id) or 3),
    )

    result = runner.invoke(app, ["doctor", "--fix"])
    fakes["heal"].assert_awaited_once()
    assert cleanup_calls == [None]
    assert fakes["run_all"].await_count == 2  # report is re-collected after the repairs
    assert "Repairs (--fix)" in result.output
    assert "Keys regenerated." in result.output
    assert "Removed 3 stale device lock(s)" in result.output


def test_cli_doctor_fix_skips_heal_when_keys_are_healthy(monkeypatch):
    """--fix does not touch healthy ADB keys but still sweeps stale locks."""
    from artemis.runtime.device_lock import DeviceExecutionLock

    fakes = _install_doctor_fakes(monkeypatch, _all_pass_probes())
    monkeypatch.setattr(
        DeviceExecutionLock, "cleanup_stale_locks", classmethod(lambda cls, device_id=None: 0)
    )

    result = runner.invoke(app, ["doctor", "--fix"])
    assert result.exit_code == 0, result.output
    fakes["heal"].assert_not_awaited()
    assert "nothing to repair" in result.output
    assert "No stale device locks" in result.output


# ---------------------------------------------------------------------------
# artemis helper smoke (end-to-end device observation smoke test)
# ---------------------------------------------------------------------------


def _patch_smoke(monkeypatch, verdict):
    import artemis.interfaces.cli.commands.helper as helper_module
    from artemis.core.diagnostics import device_smoke as smoke_module

    async def fake_smoke(device_serial=None, timeout_seconds=20.0):
        report = dict(verdict)
        report["serial"] = device_serial
        return report

    monkeypatch.setattr(helper_module, "_resolve_serial", lambda _s: "emulator-5554")
    monkeypatch.setattr(smoke_module, "smoke_test_device", fake_smoke)


def test_cli_helper_smoke_ok_renders_verdict(monkeypatch):
    """A passing observation exits 0 and shows the screenshot/element counts."""
    _patch_smoke(
        monkeypatch,
        {
            "ok": True,
            "elapsed_seconds": 1.2,
            "screenshot_bytes": 42000,
            "element_count": 17,
            "hierarchy_backend": "helper",
            "error": None,
            "fix": [],
        },
    )
    result = runner.invoke(app, ["helper", "smoke"])
    assert result.exit_code == 0, result.output
    assert "SMOKE OK" in result.output
    assert "42000" in result.output and "17" in result.output


def test_cli_helper_smoke_failure_shows_guidance_and_exits_1(monkeypatch):
    """A placeholder/hang verdict exits 1 and surfaces the error and repair steps."""
    _patch_smoke(
        monkeypatch,
        {
            "ok": False,
            "elapsed_seconds": 20.0,
            "screenshot_bytes": 67,
            "element_count": 0,
            "hierarchy_backend": None,
            "error": "Screenshot capture failed (driver returned a 67-byte placeholder image)",
            "fix": [
                "Unlock the phone and keep the screen on.",
                "Restart the on-device UIAutomator server.",
            ],
        },
    )
    result = runner.invoke(app, ["helper", "smoke"])
    assert result.exit_code == 1, result.output
    assert "SMOKE FAILED" in result.output
    assert "placeholder" in result.output
    assert "Unlock the phone" in result.output


def test_cli_helper_smoke_json_emits_verdict(monkeypatch):
    """--json prints the raw smoke verdict and keeps the exit code."""
    _patch_smoke(
        monkeypatch,
        {
            "ok": True,
            "elapsed_seconds": 0.5,
            "screenshot_bytes": 1000,
            "element_count": 3,
            "hierarchy_backend": "uiautomator",
            "error": None,
            "fix": [],
        },
    )
    result = runner.invoke(app, ["helper", "smoke", "--json"])
    assert result.exit_code == 0, result.output
    doc = json.loads(result.output)
    assert doc["ok"] is True and doc["serial"] == "emulator-5554"
    assert doc["element_count"] == 3 and doc["hierarchy_backend"] == "uiautomator"
