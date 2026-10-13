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

"""Device subprocess stdin isolation and stdout purity for MCP stdio mode.

The device MCP server runs over stdio, so every helper subprocess we spawn
(adb commands, the awake service, the uiAutomator client) must detach stdin
and the logging banner must stay on stderr so it never pollutes the JSON-RPC
stream on stdout.
"""

import io
import subprocess
import sys
from unittest.mock import MagicMock, patch

from artemis.runtime.awake_lease import ScreenAwakeLease
from artemis.runtime.awake_service import _run_awake_adb_command
from third_party.mobile_use.clients import ui_automator_client
from third_party.mobile_use.utils.logger import get_logger


def test_awake_service_adb_command_isolates_stdin():
    """Verify _run_awake_adb_command always sets stdin=subprocess.DEVNULL."""
    with patch("artemis.runtime.awake_service.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="ok", stderr="")
        _run_awake_adb_command("test-dev-1", ["shell", "date"], "test command")

        assert mock_run.called
        kwargs = mock_run.call_args.kwargs
        assert kwargs.get("stdin") == subprocess.DEVNULL, (
            "Expected stdin=subprocess.DEVNULL to prevent stdin hijacking!"
        )


def test_awake_lease_run_isolates_stdin():
    """Verify ScreenAwakeLease._run always sets stdin=subprocess.DEVNULL."""
    lease = ScreenAwakeLease("test-dev-1")
    with patch("artemis.runtime.awake_lease.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="ok", stderr="")
        lease._run(["shell", "date"], "test lease command")

        assert mock_run.called
        kwargs = mock_run.call_args.kwargs
        assert kwargs.get("stdin") == subprocess.DEVNULL, (
            "Expected stdin=subprocess.DEVNULL to prevent stdin hijacking!"
        )


def test_ui_automator_client_isolates_stdin():
    """Verify ui_automator_client helper commands isolate stdin."""
    with patch("third_party.mobile_use.clients.ui_automator_client.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="package:com.test\n", stderr="")
        ui_automator_client._is_package_installed("dev-1", "com.test")
        assert mock_run.called
        assert mock_run.call_args.kwargs.get("stdin") == subprocess.DEVNULL

    with patch("third_party.mobile_use.clients.ui_automator_client.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ui_automator_client._uninstall_package("dev-1", "com.test")
        assert mock_run.called
        assert mock_run.call_args.kwargs.get("stdin") == subprocess.DEVNULL


def test_logger_header_does_not_pollute_stdout():
    """Verify logger.header directs output to stderr and never pollutes sys.stdout."""
    logger = get_logger("test_purity_logger")
    captured_stdout = io.StringIO()
    captured_stderr = io.StringIO()

    orig_stdout = sys.stdout
    orig_stderr = sys.stderr
    try:
        sys.stdout = captured_stdout
        sys.stderr = captured_stderr
        logger.header("IMPORTANT PROTOCOL BANNER")
    finally:
        sys.stdout = orig_stdout
        sys.stderr = orig_stderr

    assert captured_stdout.getvalue() == "", (
        f"Detected stdout pollution from logger.header: {captured_stdout.getvalue()!r}. "
        "In MCP stdio mode, stdout MUST be reserved exclusively for JSON-RPC messages!"
    )
    assert "IMPORTANT PROTOCOL BANNER" in captured_stderr.getvalue()
