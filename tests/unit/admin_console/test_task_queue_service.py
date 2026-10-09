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

import asyncio
import importlib
import json
import os
import subprocess
import sys
import time
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from apps.admin_console.core.state import state
from apps.admin_console.database.repositories.session_repository import session_repo
from apps.admin_console.database.repositories.step_repository import step_repo
from apps.admin_console.routers.tasks import get_status
from apps.admin_console.services.task_queue_service import TaskQueueService, task_queue_service
from artemis.runtime.device_lock import DeviceLockOwner
from artemis.runtime.adb_endpoint import AdbEndpoint
from artemis.runtime.device_pool import device_pool


@pytest.fixture(autouse=True)
def clean_state(tmp_path, monkeypatch):
    """Reset global state between tests."""
    isolated_pause_file = tmp_path / ".artemis_paused"
    # Redirect DeviceExecutionLock's lock/queue directory into tmp_path so that
    # enqueue reservations never touch the real %TEMP%/artemis/device-locks dir
    # (a live daemon merges those tickets into its /api/status queue view).
    isolated_lock_dir = tmp_path / "device-locks"
    isolated_lock_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(
        "artemis.runtime.device_lock.get_temp_dir",
        lambda _subfolder=None: isolated_lock_dir,
    )
    state_module = importlib.import_module("apps.admin_console.core.state")
    queue_module = importlib.import_module("apps.admin_console.services.task_queue_service")
    monkeypatch.setattr(state_module, "PAUSE_FILE", isolated_pause_file)
    monkeypatch.setattr(queue_module, "PAUSE_FILE", isolated_pause_file)
    # The stop assertions below describe the legacy immediate kill; the graceful
    # cancel path has its own tests in test_graceful_stop_and_recovery.py.
    monkeypatch.setenv("ARTEMIS_CANCEL_GRACE_SECONDS", "0")
    monkeypatch.setattr(
        "artemis.runtime.cancel_requests.get_temp_dir",
        lambda _subfolder=None: isolated_lock_dir,
    )
    state.clear_queue()
    state.queue_items.clear()
    state.submission_meta.clear()
    state.held_queues.clear()
    state.current_process = None
    state.current_goal = None
    state.current_profile = None
    state.active_session_id = None
    state.active_connections.clear()
    state.manually_stopped_run_ids.clear()
    state.cancelled_session_ids.clear()
    if state.worker_task and not state.worker_task.done():
        state.worker_task.cancel()
    state.worker_task = None
    yield
    state.clear_queue()
    state.queue_items.clear()
    state.active_connections.clear()
    state.cancelled_session_ids.clear()
    state.active_session_id = None
    state.current_process = None
    state.current_goal = None
    state.current_profile = None
    state.manually_stopped_run_ids.clear()
    state.held_queues.clear()
    if hasattr(state, "recent_submissions"):
        state.recent_submissions.clear()
    if state.worker_task and not state.worker_task.done():
        state.worker_task.cancel()
    state.worker_task = None


def test_paused_error_reads_persisted_reason(tmp_path):
    pause_file = tmp_path / ".artemis_paused"
    pause_file.write_text("LLM Error: 503 UNAVAILABLE: model overloaded", encoding="utf-8")

    with patch("apps.admin_console.core.state.PAUSE_FILE", pause_file):
        assert state.is_paused is True
        assert state.paused_error == "503 UNAVAILABLE: model overloaded"


@pytest.mark.asyncio
async def test_get_next_pending_task():
    state.queue_items = [
        {"session_id": "s1", "goal": "Goal A", "status": "pending"},
        {"session_id": "s2", "goal": "Goal B", "status": "pending"},
    ]
    next_task = TaskQueueService._get_next_pending_task()
    assert next_task is not None
    assert next_task["goal"] == "Goal A"


@pytest.mark.asyncio
async def test_enqueued_task_keeps_its_adb_endpoint_snapshot():
    original = AdbEndpoint.create("127.0.0.1", 5038)
    changed = AdbEndpoint.local()
    with (
        patch.object(TaskQueueService, "ensure_worker_running"),
        patch(
            "apps.admin_console.services.task_queue_service.current_adb_endpoint",
            return_value=original,
        ),
        patch(
            "artemis.runtime.device_pool.device_pool.select_device_async",
            return_value="emulator-5554",
        ),
    ):
        result = await TaskQueueService.enqueue_tasks(["Keep endpoint"])

    task_item = result["tasks"][0]
    assert task_item["adb_endpoint"]["identity"] == original.identity

    with patch(
        "apps.admin_console.services.task_queue_service.current_adb_endpoint",
        return_value=changed,
    ):
        target = TaskQueueService._task_target(task_item)

    assert target.endpoint == original
    assert target.serial == "emulator-5554"
    assert target.lock_key == f"{original.identity}/emulator-5554"


@pytest.mark.parametrize(
    ("current_status", "returncode", "stopped", "expected"),
    [
        ("completed", 1, False, ("completed", False)),
        ("failed", 0, False, ("failed", False)),
        ("cancelled", 0, False, ("cancelled", False)),
        ("success", 1, False, ("completed", True)),
        ("running", 0, False, ("completed", True)),
        ("running", 1, False, ("failed", True)),
        ("completed", 0, True, ("cancelled", True)),
    ],
)
def test_resolve_terminal_status_preserves_authoritative_result(
    current_status, returncode, stopped, expected
):
    assert (
        TaskQueueService._resolve_terminal_status(current_status, returncode, stopped) == expected
    )


@pytest.mark.asyncio
async def test_remove_task():
    state.queue_items = [
        {"session_id": "s1", "goal": "Goal A", "status": "pending"},
        {"session_id": "s2", "goal": "Goal B", "status": "pending"},
    ]
    TaskQueueService._remove_task("s1")
    assert len(state.queue_items) == 1
    assert state.queue_items[0]["goal"] == "Goal B"


@pytest.mark.asyncio
async def test_stop_tasks_clear_all():
    state.queue_items = [
        {"session_id": "s1", "goal": "Goal 1", "status": "pending"},
        {"session_id": "s2", "goal": "Goal 2", "status": "pending"},
        {"session_id": "s3", "goal": "Goal 3", "status": "pending"},
    ]
    assert len(state.queue_tasks) == 3

    with patch.object(TaskQueueService, "ensure_worker_running"):
        stopped = task_queue_service.stop_tasks(clear_all=True)
        assert len(state.queue_tasks) == 0
        assert len(state.queue_items) == 0


@pytest.mark.asyncio
async def test_stop_tasks_keep_remaining():
    state.queue_items = [
        {"session_id": "s1", "goal": "Goal 1", "status": "running"},
        {"session_id": "s2", "goal": "Goal 2", "status": "pending"},
    ]
    state.active_session_id = "s1"

    mock_proc = MagicMock()
    mock_proc.pid = 12345
    mock_proc.returncode = None
    state.current_process = mock_proc

    with (
        patch(
            "apps.admin_console.services.task_queue_service.process_supervisor.terminate_tree"
        ) as mock_term,
        patch.object(TaskQueueService, "ensure_worker_running"),
        patch(
            "apps.admin_console.services.task_queue_service.session_repo.update_session_status"
        ) as update_status,
        patch(
            "apps.admin_console.services.task_queue_service.session_repo.mark_all_running_cancelled"
        ) as mark_all,
    ):
        stopped = task_queue_service.stop_tasks(clear_all=False)
        assert stopped is True
        mock_proc.kill.assert_called_once()
        mock_term.assert_called_once_with(12345)
        update_status.assert_called_once()
        assert update_status.call_args.args[:2] == ("s1", "cancelled")
        mark_all.assert_not_called()


@pytest.mark.asyncio
async def test_queue_worker_execution_lifecycle():
    executed_goals = []

    async def fake_subprocess_exec(*args, **kwargs):
        goal_arg = args[3]
        executed_goals.append(goal_arg)
        proc = MagicMock()
        proc.pid = 99999
        proc.wait = AsyncMock(return_value=0)
        proc.returncode = 0
        return proc

    with (
        patch("asyncio.create_subprocess_exec", side_effect=fake_subprocess_exec),
        patch("apps.admin_console.services.task_queue_service.session_repo") as mock_repo,
        patch("apps.admin_console.services.task_queue_service.media_service"),
        patch(
            "artemis.runtime.device_pool.device_pool.select_device_async",
            return_value="emulator-5554",
        ),
    ):
        mock_repo.get_running_session_id.return_value = None
        mock_repo.get_video_recording_for_session.return_value = {"status": "ready"}
        # Enqueue two tasks
        res = await task_queue_service.enqueue_tasks(["First Task", "Second Task"])
        assert res["enqueued_count"] == 2

        # Give event loop time for queue_worker to execute both tasks
        for _ in range(40):
            if len(executed_goals) == 2 and len(state.queue_items) == 0:
                break
            await asyncio.sleep(0.05)

        assert executed_goals == ["First Task", "Second Task"]
        assert len(state.queue_items) == 0
        task = state.worker_task
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


@pytest.mark.asyncio
async def test_queue_worker_cmd_construction():
    executed_cmds = []
    executed_kwargs = []

    async def fake_subprocess_exec(*args, **kwargs):
        executed_cmds.append(list(args))
        executed_kwargs.append(kwargs)
        proc = MagicMock()
        proc.pid = 88888
        proc.wait = AsyncMock(return_value=0)
        proc.returncode = 0
        return proc

    with (
        patch("asyncio.create_subprocess_exec", side_effect=fake_subprocess_exec),
        patch("apps.admin_console.services.task_queue_service.session_repo") as mock_repo,
        patch("apps.admin_console.services.task_queue_service.media_service"),
        patch(
            "artemis.runtime.device_pool.device_pool.select_device_async",
            return_value="emulator-5554",
        ),
    ):
        mock_repo.get_running_session_id.return_value = None
        mock_repo.get_video_recording_for_session.return_value = {"status": "ready"}

        enqueue_result = await task_queue_service.enqueue_tasks(
            ["Test Goal with Outputter"],
            profile="pro",
            expected_output="Final summary",
            enable_outputter=True,
            locked_app_package="com.google.android.apps.maps",
            app_path="/path/to/app.apk",
            verification_level=" Checkpoints ",
            explorer_mode="ULTRA",
        )

        for _ in range(30):
            if len(executed_cmds) == 1 and len(state.queue_items) == 0:
                break
            await asyncio.sleep(0.05)

        assert len(executed_cmds) == 1
        cmd = executed_cmds[0]
        assert "--enable-outputter" in cmd
        assert "true" not in cmd
        assert "--session-id" in cmd
        assert "--output-description" in cmd
        assert "Final summary" in cmd
        assert "--locked-app" in cmd
        assert "com.google.android.apps.maps" in cmd
        assert "--app-path" in cmd
        assert "/path/to/app.apk" in cmd
        # Pro tuning knobs are normalised (trimmed, lower-cased) and forwarded
        # to the worker as the CLI's existing spelling.
        assert cmd[cmd.index("--verification-level") + 1] == "checkpoints"
        assert cmd[cmd.index("--explorer-pro-mode") + 1] == "ultra"
        assert enqueue_result["tasks"][0]["verification_level"] == "checkpoints"
        assert enqueue_result["tasks"][0]["explorer_mode"] == "ultra"
        assert (
            executed_kwargs[0]["env"]["ARTEMIS_DEVICE_QUEUE_TICKET"]
            == (enqueue_result["tasks"][0]["queue_ticket"])
        )
        endpoint = enqueue_result["tasks"][0]["adb_endpoint"]
        assert executed_kwargs[0]["env"]["ADB_HOST"] == endpoint["host"]
        assert executed_kwargs[0]["env"]["ADB_PORT"] == str(endpoint["port"])
        assert executed_kwargs[0]["env"]["ADB_SERVER_SOCKET"] == endpoint["socket"]
        assert executed_kwargs[0]["env"]["ARTEMIS_ADB_ENDPOINT_ID"] == endpoint["identity"]
        if sys.platform == "win32":
            assert executed_kwargs[0]["creationflags"] == (
                subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
            )
            assert executed_kwargs[0]["stdout"] == asyncio.subprocess.PIPE
            assert executed_kwargs[0]["stderr"] == asyncio.subprocess.STDOUT
        else:
            assert "creationflags" not in executed_kwargs[0]

        task = state.worker_task
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


@pytest.mark.asyncio
async def test_forward_worker_output_preserves_split_utf8(capsys):
    stream = asyncio.StreamReader()
    # "worker output: \U0001f600\n" contains a 4-byte UTF-8 emoji (b'\xf0\x9f\x98\x80') starting at byte 15.
    # Splitting at index 17 cuts across the multi-byte sequence to verify partial UTF-8 buffering.
    encoded = "worker output: \U0001f600\n".encode("utf-8")
    stream.feed_data(encoded[:17])
    stream.feed_data(encoded[17:])
    stream.feed_eof()

    await TaskQueueService._forward_worker_output(stream)

    assert capsys.readouterr().out == "worker output: \U0001f600\n"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows console isolation only")
def test_windows_worker_has_no_inherited_console():
    probe = r"""
import ctypes
import json

buffer = (ctypes.c_uint32 * 32)()
count = ctypes.windll.kernel32.GetConsoleProcessList(buffer, len(buffer))
print(json.dumps(list(buffer[:min(count, len(buffer))])))
"""
    result = subprocess.run(
        [sys.executable, "-c", probe],
        check=True,
        text=True,
        **TaskQueueService._subprocess_creation_kwargs(),
    )

    attached_processes = json.loads(result.stdout)
    assert os.getpid() not in attached_processes


@pytest.mark.asyncio
async def test_stop_tasks_dead_process_resets_state():
    state.queue_items = [
        {"session_id": "s1", "goal": "Goal 1", "status": "pending"},
    ]
    mock_proc = MagicMock()
    mock_proc.pid = 99999999
    mock_proc.returncode = None
    mock_proc.kill.side_effect = ProcessLookupError("No such process")
    state.current_process = mock_proc

    with patch.object(TaskQueueService, "ensure_worker_running"):
        stopped = task_queue_service.stop_tasks(clear_all=False)
        assert stopped is True
        assert state.current_process is None
        assert state.is_running is False
        assert len(state.queue_items) == 0


def test_stop_tasks_terminates_external_global_owner_and_preserves_local_waiter():
    external_owner = DeviceLockOwner(
        pid=24680,
        process_created_at=1234.5,
        token="external-owner-token",
        device_id="emulator-5554",
        description="MCP task: inspect settings",
        acquired_at="2026-08-24T00:00:00+00:00",
        session_id="mcp-session",
        ingress="mcp",
    )
    local_waiter = MagicMock(pid=13579, returncode=None)
    state.current_process = local_waiter
    state.queue_items = [
        {
            "session_id": "frontend-waiter",
            "goal": "Run after MCP",
            "status": "running",
            "queue_ticket": "frontend-ticket",
        }
    ]
    state.active_session_id = "mcp-session"
    state.active_connections["mcp-session"] = {"pid": 24680}

    with (
        patch.object(
            TaskQueueService,
            "ensure_worker_running",
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.get_active_owner",
            return_value=external_owner,
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.is_active_owner",
            return_value=True,
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.cleanup_stale_locks"
        ),
        patch(
            "apps.admin_console.services.task_queue_service.process_supervisor.terminate_tree_verified",
            return_value=True,
        ) as terminate_verified,
        patch(
            "apps.admin_console.services.task_queue_service.session_repo.update_session_status"
        ) as update_status,
        patch("artemis.runtime.trace_store.update_trace_status") as update_trace_status,
    ):
        assert task_queue_service.stop_tasks(clear_all=False) is True

    terminate_verified.assert_called_once_with(24680, 1234.5)
    local_waiter.kill.assert_not_called()
    assert state.current_process is local_waiter
    assert state.queue_items[0]["session_id"] == "frontend-waiter"
    assert not state.manually_stopped_run_ids
    assert "frontend-waiter" not in state.cancelled_session_ids
    assert "mcp-session" not in state.active_connections
    update_status.assert_called_once()
    assert update_status.call_args.args[:2] == ("mcp-session", "cancelled")
    update_trace_status.assert_called_once_with(
        "mcp-session",
        "cancelled",
        error="Task stopped from the Artemis frontend.",
    )


def test_stop_tasks_does_not_kill_stale_reused_pid():
    stale_owner = DeviceLockOwner(
        pid=24680,
        process_created_at=1234.5,
        token="stale-token",
        device_id="emulator-5554",
        description="CLI task",
        acquired_at="2026-08-24T00:00:00+00:00",
        session_id="cli-session",
        ingress="sdk",
    )
    with (
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.get_active_owner",
            return_value=stale_owner,
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.is_active_owner",
            return_value=False,
        ),
        patch(
            "apps.admin_console.services.task_queue_service.process_supervisor.terminate_tree_verified"
        ) as terminate_verified,
    ):
        assert task_queue_service.stop_tasks(clear_all=False) is False

    terminate_verified.assert_not_called()


def test_stop_tasks_session_target_never_adopts_mismatched_fallback_owner():
    """No live owners is a legal state: a session-targeted stop must not
    terminate a fallback owner that belongs to a different session."""
    other_owner = DeviceLockOwner(
        pid=24680,
        process_created_at=1234.5,
        token="other-owner-token",
        device_id="emulator-5554",
        description="Task for another session",
        acquired_at="2026-08-24T00:00:00+00:00",
        session_id="other-session",
        ingress="cli",
    )
    with (
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.get_active_owners",
            return_value={},
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.get_active_owner",
            return_value=other_owner,
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.is_active_owner",
            return_value=True,
        ),
        patch(
            "apps.admin_console.services.task_queue_service.process_supervisor.terminate_tree_verified"
        ) as terminate_verified,
        patch("apps.admin_console.services.task_queue_service.session_repo.update_session_status"),
        patch(
            "apps.admin_console.services.task_queue_service.session_repo.get_session_by_id",
            return_value=None,
        ),
    ):
        task_queue_service.stop_tasks(clear_all=False, session_id="wanted-session")

    terminate_verified.assert_not_called()


@pytest.mark.asyncio
async def test_status_reports_external_global_owner_without_ipc_connection():
    external_owner = DeviceLockOwner(
        pid=24680,
        process_created_at=1234.5,
        token="external-owner-token",
        device_id="emulator-5554",
        description="CLI task: inspect settings",
        acquired_at="2026-08-24T00:00:00+00:00",
        session_id="cli-session",
        ingress="cli",
    )
    with (
        patch.object(TaskQueueService, "ensure_worker_running"),
        patch(
            "apps.admin_console.routers.tasks.DeviceExecutionLock.get_active_owner",
            return_value=external_owner,
        ),
        patch("apps.admin_console.routers.tasks.session_repo") as repo,
        patch("apps.admin_console.routers.tasks.model_service") as models,
    ):
        repo.get_latest_session.return_value = None
        repo.get_session_by_id.return_value = None
        models.get_active_model_info.return_value = None
        result = await get_status()

    assert result["status"] == "running"
    assert result["session_id"] == "cli-session"
    assert result["pid"] == 24680
    assert result["goal"] == "CLI task: inspect settings"


@pytest.mark.asyncio
async def test_status_backfills_conversation_id_from_registry():
    """Ticket view and active_tasks carry the thread id even after the worker
    dequeued the task: without it the console renders a just-submitted round as
    its own phantom conversation until the DB row lands."""
    state.remember_submission(
        "dequeued-session",
        conversation_id="conv-registry",
        created_at=1791456000.0,
        goal="复现测试",
    )
    external_owner = DeviceLockOwner(
        pid=13579,
        process_created_at=1234.5,
        token="queued-owner-token",
        device_id="emulator-5554",
        description="frontend task: 复现测试",
        acquired_at="2026-10-08T00:00:00+00:00",
        session_id="dequeued-session",
        ingress="frontend",
    )
    ticket_view = {
        "session_id": "dequeued-session",
        "goal": "frontend task: 复现测试",
        "device_id": "pending",
        "status": "pending",
        # 票据视图自带 created_at（取号文件 mtime，晚于真实提交时刻）——
        # 注册表的真实提交时刻必须优先，否则轮次会"顶"到后面排队轮次下方
        "created_at": 1791456999.0,
    }
    with (
        patch.object(TaskQueueService, "ensure_worker_running"),
        patch(
            "apps.admin_console.routers.tasks.DeviceExecutionLock.get_active_owner",
            return_value=external_owner,
        ),
        patch(
            "apps.admin_console.routers.tasks.DeviceExecutionLock.get_active_owners",
            return_value={"default": external_owner},
        ),
        patch(
            "apps.admin_console.routers.tasks.DeviceExecutionLock.get_queued_tasks",
            return_value=[ticket_view],
        ),
        patch("apps.admin_console.routers.tasks.session_repo") as repo,
        patch("apps.admin_console.routers.tasks.model_service") as models,
    ):
        repo.get_latest_session.return_value = None
        repo.get_session_by_id.return_value = None
        models.get_active_model_info.return_value = None
        result = await get_status()

    assert result["active_tasks"][0]["conversation_id"] == "conv-registry"
    assert result["active_tasks"][0]["created_at"] == 1791456000.0
    # 轮次标题必须是用户的原始消息，而不是 "frontend task: …" 格式的锁描述
    assert result["active_tasks"][0]["goal"] == "复现测试"
    queued = [q for q in result["queue"] if str(q.get("session_id")) == "dequeued-session"]
    assert queued and queued[0]["conversation_id"] == "conv-registry"
    assert queued[0]["created_at"] == 1791456000.0
    assert queued[0]["goal"] == "复现测试"


@pytest.mark.asyncio
async def test_worker_env_carries_submitted_at_for_round_ordering():
    """The worker exports the enqueue moment so the engine can persist it as
    submitted_at: chat rounds order by submission time, not device-turn time."""
    task_item = {
        "session_id": "sess-order",
        "goal": "g",
        "profile": "flash",
        "created_at": 1791456000.5,
        "conversation_id": "conv-1",
        "queue_ticket": None,
    }
    target = MagicMock()
    target.endpoint.apply_to_environment = MagicMock()
    target.lock_scope = "scope"

    _cmd, env = TaskQueueService._build_worker_invocation(
        task_item, "run-key", "sess-order", "g", "flash", target
    )

    assert env["ARTEMIS_SUBMITTED_AT"] == "1791456000.5"
    assert env["ARTEMIS_CONVERSATION_ID"] == "conv-1"


@pytest.mark.asyncio
async def test_cancel_task_triggers_next_pending_task():
    executed_goals = []

    async def fake_subprocess_exec(*args, **kwargs):
        goal_arg = args[3]
        executed_goals.append(goal_arg)
        proc = MagicMock()
        proc.pid = 77777

        async def wait_side_effect():
            if goal_arg == "Task 1":
                # Simulate task 1 being stopped manually mid-execution
                await asyncio.sleep(0.05)
                task_queue_service.stop_tasks(clear_all=False)
                return -9
            await asyncio.sleep(0.02)
            return 0

        proc.wait = AsyncMock(side_effect=wait_side_effect)
        proc.returncode = 0
        return proc

    with (
        patch("asyncio.create_subprocess_exec", side_effect=fake_subprocess_exec),
        patch("apps.admin_console.services.task_queue_service.session_repo") as mock_repo,
        patch("apps.admin_console.services.task_queue_service.media_service"),
        patch(
            "artemis.runtime.device_pool.device_pool.select_device_async",
            return_value="emulator-5554",
        ),
    ):
        mock_repo.get_running_session_id.return_value = None
        mock_repo.get_video_recording_for_session.return_value = {"status": "ready"}
        await task_queue_service.enqueue_tasks(["Task 1", "Task 2"])

        for _ in range(40):
            if len(executed_goals) == 2 and len(state.queue_items) == 0:
                break
            await asyncio.sleep(0.05)

        assert executed_goals == ["Task 1", "Task 2"]
        assert len(state.queue_items) == 0

        task = state.worker_task
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


@pytest.mark.asyncio
async def test_immediate_cancel_ignores_stale_ipc_and_runs_next_task():
    executed_goals = []
    task1_session_id = None

    async def fake_subprocess_exec(*args, **kwargs):
        goal_arg = args[3]
        executed_goals.append(goal_arg)
        proc = MagicMock()
        proc.pid = 88888

        async def wait_side_effect():
            if goal_arg == "Task 1":
                return -9
            await asyncio.sleep(0.02)
            return 0

        proc.wait = AsyncMock(side_effect=wait_side_effect)
        proc.returncode = 0
        return proc

    with (
        patch("asyncio.create_subprocess_exec", side_effect=fake_subprocess_exec),
        patch("apps.admin_console.services.task_queue_service.session_repo") as mock_repo,
        patch("apps.admin_console.services.task_queue_service.media_service"),
        patch(
            "artemis.runtime.device_pool.device_pool.select_device_async",
            return_value="emulator-5554",
        ),
    ):
        mock_repo.get_running_session_id.return_value = None
        mock_repo.get_video_recording_for_session.return_value = {"status": "ready"}

        # Enqueue Task 1
        res1 = await task_queue_service.enqueue_tasks(["Task 1"])
        task1_session_id = res1["tasks"][0]["session_id"]

        # Immediately stop Task 1
        task_queue_service.stop_tasks(clear_all=False)
        assert task1_session_id in state.cancelled_session_ids

        # Simulate stale session_started arriving over IPC for the cancelled Task 1
        from apps.admin_console.services.ipc_service import ipc_service

        ipc_service.sanitize_event_data("session_started", {"session_id": task1_session_id})
        # If IPC handler checks cancelled_session_ids, state.active_session_id should not get stuck
        assert state.active_session_id != task1_session_id
        assert state.is_running is False

        # Enqueue Task 2 and verify it runs immediately without getting stuck in pending
        await task_queue_service.enqueue_tasks(["Task 2"])

        for _ in range(40):
            if "Task 2" in executed_goals and len(state.queue_items) == 0:
                break
            await asyncio.sleep(0.05)

        assert "Task 2" in executed_goals
        assert len(state.queue_items) == 0

        task = state.worker_task
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


@pytest.mark.asyncio
async def test_wait_for_worker_process_watchdog_handles_reaped_process():
    """Verify that _wait_for_worker_process never hangs even if the process was already reaped."""
    mock_proc = MagicMock()
    mock_proc.pid = 999999
    mock_proc.returncode = None

    async def hanging_wait():
        await asyncio.sleep(10)
        return 0

    mock_proc.wait = AsyncMock(side_effect=hanging_wait)

    with patch("psutil.Process") as mock_psutil_proc:
        mock_p = MagicMock()
        mock_p.is_running.return_value = False
        mock_psutil_proc.return_value = mock_p

        rc = await TaskQueueService._wait_for_worker_process(mock_proc)
        assert rc == -15


def test_darwin_terminate_process_tree_preserves_direct_child_for_asyncio():
    """Verify darwin terminate_process_tree does not pass direct children to psutil.wait_procs."""
    import os
    from artemis.platform.darwin import DarwinPlatformProcess

    process = DarwinPlatformProcess()
    current_pid = os.getpid()

    with (
        patch("psutil.Process") as mock_psutil_proc,
        patch("psutil.wait_procs") as mock_wait_procs,
    ):
        parent = MagicMock()
        parent.pid = 12345
        parent.ppid.return_value = current_pid
        parent.children.return_value = []
        parent.is_running.return_value = False

        mock_psutil_proc.return_value = parent
        mock_wait_procs.return_value = ([], [])

        success = process.terminate_process_tree(12345, timeout_seconds=0.1)
        assert success is True
        parent.send_signal.assert_called_once()
        for call_args in mock_wait_procs.call_args_list:
            procs_waited = call_args[0][0]
            assert parent not in procs_waited


@pytest.mark.asyncio
async def test_enqueue_tasks_unified_ingress():
    """Verify enqueue_tasks correctly propagates ingress, custom session_id, and conversation_id."""
    with (
        patch.object(TaskQueueService, "ensure_worker_running"),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.reserve",
            return_value="mock-ticket-unified",
        ),
    ):
        res = await task_queue_service.enqueue_tasks(
            ["Test unified goal"],
            profile="flash",
            ingress="mcp",
            session_id="custom-mcp-session-123",
            conversation_id="conv-456",
        )
        assert res["status"] in ("started", "queued")
        assert len(res["tasks"]) == 1
        task = res["tasks"][0]
        assert task["session_id"] == "custom-mcp-session-123"
        assert task["ingress"] == "mcp"
        assert task["conversation_id"] == "conv-456"
        assert task["goal"] == "Test unified goal"


@pytest.mark.asyncio
async def test_enqueue_tasks_assigns_conversation_id_when_absent():
    """Without a caller-supplied thread id, each submission gets its own real
    conversation_id (never NULL) so the console can group and continue chats."""
    with (
        patch.object(TaskQueueService, "ensure_worker_running"),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.reserve",
            return_value="mock-ticket-unified",
        ),
    ):
        res = await task_queue_service.enqueue_tasks(["Solo goal"], profile="flash")
        assert res["tasks"][0]["conversation_id"]
        # 注册表同步记录线程 id 与提交时刻，供 /api/status 在任务被取走后回填
        sid = res["tasks"][0]["session_id"]
        assert state.conversation_for(sid) == res["tasks"][0]["conversation_id"]
        assert state.submission_for(sid).get("created_at") == res["tasks"][0]["created_at"]

        res2 = await task_queue_service.enqueue_tasks(["Another goal"], profile="flash")
        first = res["tasks"][0]["conversation_id"]
        second = res2["tasks"][0]["conversation_id"]
        # 两次独立提交各得一个线程 id，且不会拿到空值或互相串线程
        assert second and second != first

        # 显式传入空白值同样按未提供处理
        res3 = await task_queue_service.enqueue_tasks(
            ["Blank thread goal"], profile="flash", conversation_id="   "
        )
        assert res3["tasks"][0]["conversation_id"]


@pytest.mark.asyncio
async def test_queue_worker_notifies_conversation():
    """Verify queue_worker calls notify() when conversation_id is attached to task."""
    executed_cmds = []

    async def fake_subprocess_exec(*args, **kwargs):
        executed_cmds.append(list(args))
        proc = MagicMock()
        proc.pid = 99999
        proc.wait = AsyncMock(return_value=0)
        proc.returncode = 0
        return proc

    with (
        patch("asyncio.create_subprocess_exec", side_effect=fake_subprocess_exec),
        patch("apps.admin_console.services.task_queue_service.media_service"),
        patch("mcp_server.notifiers.notify") as mock_notify,
        patch("apps.admin_console.services.task_queue_service.session_repo") as mock_repo,
        patch(
            "artemis.runtime.device_pool.device_pool.try_list_devices_async",
            new=AsyncMock(return_value=[]),
        ),
    ):
        mock_repo.get_running_session_id.return_value = None

        await task_queue_service.enqueue_tasks(
            ["Notify goal"],
            profile="flash",
            ingress="mcp",
            conversation_id="conv-789",
            device_serial="test-mock-serial",
        )

        for _ in range(30):
            if mock_notify.called and len(state.queue_items) == 0:
                break
            await asyncio.sleep(0.05)

        mock_notify.assert_called_once()
        kwargs = mock_notify.call_args[1]
        assert kwargs["conversation_id"] == "conv-789"
        assert "Notify goal" in kwargs["message"]

        task = state.worker_task
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


def test_stop_tasks_by_session_id_targets_correct_task_among_multiple():
    """Stopping by session_id terminates only the targeted owner among multiple concurrent devices."""
    owner_a = DeviceLockOwner(
        pid=11111,
        process_created_at=100.0,
        token="token-a",
        device_id="device-a",
        description="Task on device A",
        acquired_at="2026-08-24T00:00:00+00:00",
        session_id="session-a",
        ingress="cli",
    )
    owner_b = DeviceLockOwner(
        pid=22222,
        process_created_at=200.0,
        token="token-b",
        device_id="device-b",
        description="Task on device B",
        acquired_at="2026-08-24T00:00:00+00:00",
        session_id="session-b",
        ingress="mcp",
    )

    with (
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.get_active_owners",
            return_value={"device_a": owner_a, "device_b": owner_b},
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.is_active_owner",
            return_value=True,
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.cleanup_stale_locks"
        ) as cleanup_locks,
        patch(
            "apps.admin_console.services.task_queue_service.process_supervisor.terminate_tree_verified",
            return_value=True,
        ) as terminate_verified,
        patch(
            "apps.admin_console.services.task_queue_service.session_repo.update_session_status"
        ) as update_status,
        patch("artemis.runtime.trace_store.update_trace_status") as update_trace,
    ):
        # Explicitly stop session-b
        assert task_queue_service.stop_tasks(clear_all=False, session_id="session-b") is True

        # Only session-b's process (22222) should be terminated
        terminate_verified.assert_called_once_with(22222, 200.0)
        cleanup_locks.assert_called_once_with("device-b")
        update_status.assert_called_once()
        assert update_status.call_args[0][0] == "session-b"
        assert update_status.call_args[0][1] == "cancelled"
        update_trace.assert_called_once_with(
            "session-b",
            "cancelled",
            error="Task stopped from the Artemis frontend.",
        )


def test_stop_tasks_by_device_id_targets_specific_device():
    """Stopping by device_id targets the active task on that specific device."""
    owner_a = DeviceLockOwner(
        pid=33333,
        process_created_at=300.0,
        token="token-a",
        device_id="pixel-8",
        description="Task on Pixel 8",
        acquired_at="2026-08-24T00:00:00+00:00",
        session_id="session-pixel8",
        ingress="sdk",
    )

    with (
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.get_active_owners",
            return_value={"pixel_8": owner_a},
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.is_active_owner",
            return_value=True,
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.cleanup_stale_locks"
        ),
        patch(
            "apps.admin_console.services.task_queue_service.process_supervisor.terminate_tree_verified",
            return_value=True,
        ) as terminate_verified,
        patch("apps.admin_console.services.task_queue_service.session_repo.update_session_status"),
    ):
        assert task_queue_service.stop_tasks(clear_all=False, device_id="pixel-8") is True
        terminate_verified.assert_called_once_with(33333, 300.0)


def test_stop_tasks_queued_item_by_session_id():
    """Stopping a queued task by session_id cancels its reservation and removes it from queue."""
    state.queue_items = [
        {
            "session_id": "queue-1",
            "goal": "Goal 1",
            "status": "pending",
            "queue_ticket": "ticket-1",
        },
        {
            "session_id": "queue-2",
            "goal": "Goal 2",
            "status": "pending",
            "queue_ticket": "ticket-2",
        },
    ]

    with (
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.get_active_owners",
            return_value={},
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.get_active_owner",
            return_value=None,
        ),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.cancel_reservation",
            return_value=True,
        ) as cancel_res,
        patch(
            "apps.admin_console.services.task_queue_service.session_repo.update_session_status"
        ) as update_status,
    ):
        assert task_queue_service.stop_tasks(clear_all=False, session_id="queue-1") is True
        cancel_res.assert_called_once_with("ticket-1")
        # queue-2 should remain in queue
        assert len(state.queue_items) == 1
        update_status.assert_called_once()
        assert update_status.call_args[0][0] == "queue-1"
        assert update_status.call_args[0][1] == "cancelled"


@pytest.mark.asyncio
async def test_enqueue_tasks_deduplicates_by_session_id():
    state.queue_items = []
    state.active_session_id = None

    with (
        patch("apps.admin_console.services.task_queue_service.session_repo"),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.reserve",
            return_value="ticket-123",
        ),
    ):
        res1 = await task_queue_service.enqueue_tasks(["Task goal"], session_id="sid-dedup-1")
        assert len(state.queue_items) == 1
        assert res1["enqueued_count"] == 1

        # Second submission with same session_id must not enqueue a duplicate
        res2 = await task_queue_service.enqueue_tasks(["Task goal again"], session_id="sid-dedup-1")
        assert len(state.queue_items) == 1
        assert res2["enqueued_count"] == 0
        assert res2["tasks"][0]["session_id"] == "sid-dedup-1"


@pytest.mark.asyncio
async def test_manual_stop_of_one_run_does_not_pollute_concurrent_run():
    """Stopping run A must not flip run B's terminal status or its payload.

    Regression test for the process-global ``was_stopped_manually`` flag that
    used to mark *every* in-flight run as manually stopped. Two concurrent runs
    on different devices: device A's task is stopped manually, device B's task
    then finishes normally and must still be reported as completed.
    """
    ended_payloads: dict[str, dict] = {}

    def capture(event_type, data):
        if event_type == "session_ended":
            ended_payloads[str(data.get("session_id"))] = dict(data)

    class FakeProc:
        def __init__(self, pid):
            self.pid = pid
            self.returncode = None
            self.stdout = None
            self._done = asyncio.Event()

        async def wait(self):
            await self._done.wait()
            return self.returncode

        def finish(self, returncode):
            self.returncode = returncode
            self._done.set()

        def kill(self):
            self.finish(-9)

    procs: dict[str, FakeProc] = {}

    async def fake_subprocess_exec(*args, **kwargs):
        goal = args[3]
        # Use our own pid so the reaped-process watchdog keeps waiting.
        proc = FakeProc(os.getpid())
        procs[goal] = proc
        return proc

    item_a = {
        "session_id": "run-a",
        "goal": "Goal A",
        "status": "pending",
        "device_serial": "dev-a",
    }
    item_b = {
        "session_id": "run-b",
        "goal": "Goal B",
        "status": "pending",
        "device_serial": "dev-b",
    }
    state.queue_items = [item_a, item_b]
    state.ipc_subscribers.append(capture)

    try:
        with (
            patch("asyncio.create_subprocess_exec", side_effect=fake_subprocess_exec),
            patch("apps.admin_console.services.task_queue_service.session_repo") as mock_repo,
            patch("apps.admin_console.services.task_queue_service.media_service"),
            patch(
                "apps.admin_console.services.task_queue_service.process_supervisor.terminate_tree",
                return_value=True,
            ),
        ):
            mock_repo.get_session_status.return_value = "running"
            mock_repo.get_video_recording_for_session.return_value = {"status": "ready"}

            task_a = asyncio.create_task(TaskQueueService._execute_task_item(item_a))
            task_b = asyncio.create_task(TaskQueueService._execute_task_item(item_b))
            for _ in range(40):
                if "run-a" in state.active_runs and "run-b" in state.active_runs:
                    break
                await asyncio.sleep(0.02)
            assert {"run-a", "run-b"} <= set(state.active_runs)
            # B launched last, so the legacy single-task mirror points at B.
            assert state.active_session_id == "run-b"

            # Manually stop device A's task without naming its session id.
            assert task_queue_service.stop_tasks(clear_all=False, device_id="dev-a") is True
            await asyncio.wait_for(task_a, timeout=5.0)

            # B finishes normally afterwards.
            procs["Goal B"].finish(0)
            await asyncio.wait_for(task_b, timeout=5.0)

        assert ended_payloads["run-a"]["status"] == "cancelled"
        assert ended_payloads["run-a"]["was_stopped_manually"] is True
        assert ended_payloads["run-b"]["status"] == "completed"
        assert ended_payloads["run-b"]["was_stopped_manually"] is False

        persisted = {
            call.args[0]: call.args[1] for call in mock_repo.update_session_status.call_args_list
        }
        assert persisted.get("run-a") == "cancelled"
        assert persisted.get("run-b") == "completed"
        assert "run-b" not in state.cancelled_session_ids
        assert "run-b" not in state.manually_stopped_run_ids
    finally:
        state.ipc_subscribers.remove(capture)


@pytest.mark.asyncio
async def test_enqueue_tasks_debounces_rapid_identical_submissions():
    state.queue_items = []
    state.active_session_id = None

    with (
        patch("apps.admin_console.services.task_queue_service.session_repo"),
        patch(
            "apps.admin_console.services.task_queue_service.DeviceExecutionLock.reserve",
            return_value="ticket-456",
        ),
        patch(
            "artemis.runtime.device_pool.device_pool.try_list_devices_async",
            new=AsyncMock(return_value=[]),
        ),
        patch.object(TaskQueueService, "ensure_worker_running"),
    ):
        res1 = await task_queue_service.enqueue_tasks(
            ["Rapid duplicate goal"], device_serial="dev-1"
        )
        assert len(state.queue_items) == 1
        assert res1["enqueued_count"] == 1

        # Immediate second submission (within 1s) must debounce
        res2 = await task_queue_service.enqueue_tasks(
            ["Rapid duplicate goal"], device_serial="dev-1"
        )
        assert len(state.queue_items) == 1
        assert res2["enqueued_count"] == 0


# ---- 设备队列熔断：零步骤失败保留队列，报错只落在断点 ----


@pytest.fixture
def device_probe_ok(monkeypatch):
    """Fake device probes so enqueue accepts the fake serial outright."""
    monkeypatch.setattr(
        device_pool, "validate_explicit_serial_async", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        device_pool, "select_device_async", AsyncMock(return_value="EMULATOR1")
    )


@pytest.mark.asyncio
async def test_worker_death_before_session_row_persists_failed_round(
    monkeypatch, device_probe_ok
):
    """零步骤失败且 worker 从未落库（start_session 前就崩溃）：队列服务补写
    failed 行。没有它，该轮在时间线上消失、队列消息与轮次顺序无法对应，
    报错也只能落在队列状态区而非消息区。"""
    with patch.object(TaskQueueService, "ensure_worker_running"):
        await task_queue_service.enqueue_tasks(
            ["失败轮"], device_serial="EMULATOR1", conversation_id="conv-fail"
        )
    item = state.queue_items[0]

    async def fake_exec(*args, **kwargs):
        proc = MagicMock()
        proc.pid = 424242
        proc.stdout = None
        proc.wait = AsyncMock(return_value=1)
        proc.returncode = 1
        return proc

    events = []

    def capture(et, d):
        events.append((et, d))

    state.ipc_subscribers.append(capture)
    try:
        with (
            patch("asyncio.create_subprocess_exec", side_effect=fake_exec),
            patch("apps.admin_console.services.task_queue_service.session_repo") as mock_repo,
            patch("apps.admin_console.services.task_queue_service.media_service"),
            patch("mcp_server.notifiers.notify"),
            patch.object(step_repo, "has_steps", lambda session_id: False),
        ):
            mock_repo.get_session_status.return_value = None  # 从未落库
            mock_repo.update_session_status.return_value = False
            mock_repo.get_video_recording_for_session.return_value = {"status": "ready"}
            mock_repo.get_session_by_id.return_value = None
            mock_repo.create_failed_session.return_value = True
            await TaskQueueService._execute_task_item(item)
    finally:
        state.ipc_subscribers.remove(capture)

    mock_repo.create_failed_session.assert_called_once()
    kwargs = mock_repo.create_failed_session.call_args.kwargs
    assert kwargs["session_id"] == item["session_id"]
    assert kwargs["initial_goal"] == "失败轮"
    assert kwargs["conversation_id"] == "conv-fail"
    # 提交时刻锚点随行落库：时间线按它排序，轮次顺序才与队列一致
    assert kwargs["submitted_at"] == item["created_at"]
    assert kwargs["start_time"] == item["created_at"]
    # 真实错误（worker stdout 末行）或兜底文案，必须带原因
    assert kwargs["error_message"]

    # 熔断仍创建；repo 为 mock 时 reason 走兜底文案（真实 reason 取自补写行的
    # error_message，见下方仓储层用例）
    hold = state.held_queues.get(TaskQueueService._task_target(item).lock_key)
    assert hold and hold["reason"]
    ended = [d for et, d in events if et == "session_ended"]
    assert ended and ended[0]["status"] == "failed"


@pytest.mark.asyncio
async def test_terminal_status_update_success_never_inserts_failed_row():
    """worker 已落库（行存在）时，终态走常规 UPDATE，不补插失败行。"""
    with patch("apps.admin_console.services.task_queue_service.session_repo") as mock_repo:
        mock_repo.get_session_status.return_value = "running"
        mock_repo.update_session_status.return_value = True
        await TaskQueueService._persist_terminal_session_status(
            "sess-x", 1, False, {"session_id": "sess-x", "goal": "g", "created_at": 1.0}
        )
    mock_repo.update_session_status.assert_called_once()
    mock_repo.create_failed_session.assert_not_called()


@pytest.mark.asyncio
async def test_manual_stop_without_row_never_inserts_failed_row():
    """手动停止未落库的任务（从队列移除）：按既有语义直接消失，
    不得补插 failed 行把它复活成一条失败轮次。"""
    with patch("apps.admin_console.services.task_queue_service.session_repo") as mock_repo:
        mock_repo.get_session_status.return_value = None  # 从未落库
        mock_repo.update_session_status.return_value = False
        await TaskQueueService._persist_terminal_session_status(
            "sess-stop", 1, True, {"session_id": "sess-stop", "goal": "g", "created_at": 1.0}
        )
    mock_repo.create_failed_session.assert_not_called()


def test_create_failed_session_inserts_minimal_row(tmp_path):
    """仓储层：补写最小 failed 行；已有行不被覆盖（INSERT OR IGNORE）。"""
    from apps.admin_console.database.repositories.session_repository import SessionRepository

    repo = SessionRepository(db_path=tmp_path / "test.db")
    now = time.time()
    assert repo.create_failed_session(
        session_id="sid-fail",
        initial_goal="失败轮",
        start_time=now,
        end_time=now + 1,
        conversation_id="conv-1",
        submitted_at=now,
        error_message="DeviceNotFoundError: No device found. Exiting.",
    ) is True

    row = repo.get_session_by_id("sid-fail")
    assert row["status"] == "failed"
    assert row["initial_goal"] == "失败轮"
    assert row["conversation_id"] == "conv-1"
    assert row["submitted_at"] == now
    assert "No device found" in row["error_message"]

    # 幂等：同一会话不覆盖
    assert repo.create_failed_session(
        session_id="sid-fail", initial_goal="other", start_time=now, end_time=now + 2
    ) is False
    assert repo.get_session_by_id("sid-fail")["initial_goal"] == "失败轮"


def test_worker_error_tail_reads_last_stdout_line(tmp_path, monkeypatch):
    """从 worker 遗留的 stdout.log 末行提取错误，并剥掉 traceback 的模块路径。"""
    from artemis.runtime import trace_store

    trace_dir = tmp_path / "trace-sid"
    trace_dir.mkdir()
    (trace_dir / "stdout.log").write_text(
        "Traceback (most recent call last):\n"
        "  File \"x.py\", line 1, in <module>\n"
        "third_party.mobile_use.sdk.types.exceptions.DeviceNotFoundError: "
        "No device found. Exiting.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        trace_store,
        "get_trace_stdout_log_path",
        lambda trace_id: str(trace_dir / "stdout.log"),
    )

    tail = TaskQueueService._worker_error_tail("trace-sid")
    assert tail == "DeviceNotFoundError: No device found. Exiting."

    # 日志缺失 → None（调用方落到兜底文案）
    monkeypatch.setattr(
        trace_store,
        "get_trace_stdout_log_path",
        lambda trace_id: str(tmp_path / "missing" / "stdout.log"),
    )
    assert TaskQueueService._worker_error_tail("trace-sid") is None

    # 非 traceback 行原样保留
    monkeypatch.setattr(
        trace_store,
        "get_trace_stdout_log_path",
        lambda trace_id: str(trace_dir / "stdout.log"),
    )
    (trace_dir / "stdout.log").write_text(
        "Task execution failed: timeout\n", encoding="utf-8"
    )
    assert TaskQueueService._worker_error_tail("trace-sid") == "Task execution failed: timeout"


@pytest.mark.asyncio
async def test_zero_step_failure_holds_device_queue_and_retains_messages(
    monkeypatch, device_probe_ok
):
    await enqueue_two_tasks()

    # 环境级失败：worker 退出、状态 failed、一步都没执行
    monkeypatch.setattr(step_repo, "has_steps", lambda session_id: False)
    monkeypatch.setattr(
        session_repo,
        "get_session_by_id",
        lambda session_id: {
            "error_message": "Device EMULATOR1 is not available (adb does not list it)."
        },
    )

    events = []
    capture = lambda event_type, data: events.append((event_type, data))
    state.ipc_subscribers.append(capture)
    try:
        failed_item = state.queue_items[0]
        target = TaskQueueService._task_target(failed_item)
        await TaskQueueService._maybe_hold_device_queue(
            failed_item, target, failed_item["session_id"]
        )
    finally:
        state.ipc_subscribers.remove(capture)

    hold = state.held_queues.get(target.lock_key)
    assert hold, "zero-step failure must hold the device queue"
    assert "not available" in hold["reason"]
    assert hold["session_id"] == failed_item["session_id"]

    # 断点事件广播：前端/订阅方可感知队列因何挂起
    held_events = [d for et, d in events if et == "queue_held"]
    assert held_events and held_events[0]["lock_key"] == target.lock_key
    assert held_events[0]["session_id"] == failed_item["session_id"]
    assert "not available" in held_events[0]["reason"]
    assert held_events[0]["failure_class"] == "environment"

    # 熔断期间 dispatcher 不得派发该设备的任何 pending 消息（保留在队列中）
    with patch.object(TaskQueueService, "_execute_task_item", new=AsyncMock()):
        TaskQueueService._dispatch_pending_tasks()
    assert [i["status"] for i in state.queue_items] == ["pending", "pending"]


@pytest.mark.asyncio
async def test_task_level_failure_never_holds_queue(monkeypatch, device_probe_ok):
    await enqueue_two_tasks()

    # 任务级失败：已经执行过步骤（agent 跑过），队列必须继续
    monkeypatch.setattr(step_repo, "has_steps", lambda session_id: True)
    item = state.queue_items[0]
    target = TaskQueueService._task_target(item)
    await TaskQueueService._maybe_hold_device_queue(item, target, item["session_id"])
    assert state.held_queues == {}

    # 探测失败不误伤：队列照常派发
    with patch.object(TaskQueueService, "_execute_task_item", new=AsyncMock()):
        TaskQueueService._dispatch_pending_tasks()
    assert state.queue_items[0]["status"] == "running"

    with patch.object(TaskQueueService, "_execute_task_item", new=AsyncMock()):
        TaskQueueService._dispatch_pending_tasks()
    assert state.queue_items[0]["status"] == "running"


@pytest.mark.asyncio
async def test_step_probe_failure_keeps_queue_dispatching(monkeypatch, device_probe_ok):
    await enqueue_two_tasks()

    # 探测本身出错：宁可继续派发，也不误伤队列
    monkeypatch.setattr(
        step_repo,
        "has_steps",
        lambda session_id: (_ for _ in ()).throw(RuntimeError("db busy")),
    )
    item = state.queue_items[0]
    target = TaskQueueService._task_target(item)
    await TaskQueueService._maybe_hold_device_queue(item, target, item["session_id"])
    assert state.held_queues == {}

    # 探测失败不误伤：队列照常派发
    with patch.object(TaskQueueService, "_execute_task_item", new=AsyncMock()):
        TaskQueueService._dispatch_pending_tasks()
    assert state.queue_items[0]["status"] == "running"


@pytest.mark.asyncio
async def test_held_queue_auto_resumes_when_device_comes_back(
    monkeypatch, device_probe_ok
):
    from artemis.runtime.device_pool import DeviceStatus

    await enqueue_two_tasks()
    item = state.queue_items[0]
    target = TaskQueueService._task_target(item)
    seed_hold(target.lock_key, item)

    def statuses(*serials):
        return [DeviceStatus(serial=s, state="device") for s in serials]

    resumed_events = []
    capture = lambda et, d: resumed_events.append((et, d))
    state.ipc_subscribers.append(capture)
    try:
        # 设备重新出现在真实枚举里：熔断解除，队列可继续派发
        monkeypatch.setattr(
            device_pool, "try_list_devices_async", AsyncMock(return_value=statuses("EMULATOR1"))
        )
        await TaskQueueService._probe_held_queues()
        assert target.lock_key not in state.held_queues
    finally:
        state.ipc_subscribers.remove(capture)
    resumed = [d for et, d in resumed_events if et == "queue_resumed"]
    assert resumed and resumed[0]["device_serial"] == "EMULATOR1"
    assert resumed[0]["lock_key"] == target.lock_key

    # 枚举成功但该序列号不在其中：保持熔断
    seed_hold(target.lock_key, item)
    monkeypatch.setattr(
        device_pool, "try_list_devices_async", AsyncMock(return_value=statuses("OTHER"))
    )
    await TaskQueueService._probe_held_queues()
    assert target.lock_key in state.held_queues

    # 枚举不确定（adb 本身不可达返回 None）：保持熔断，不误续跑
    monkeypatch.setattr(
        device_pool, "try_list_devices_async", AsyncMock(return_value=None)
    )
    state.held_queues[target.lock_key]["last_probe"] = 0.0
    await TaskQueueService._probe_held_queues()
    assert target.lock_key in state.held_queues

    # 枚举本身抛错（adb 崩溃）：保持熔断且不向外抛
    monkeypatch.setattr(
        device_pool,
        "try_list_devices_async",
        AsyncMock(side_effect=RuntimeError("adb crashed")),
    )
    state.held_queues[target.lock_key]["last_probe"] = 0.0
    await TaskQueueService._probe_held_queues()
    assert target.lock_key in state.held_queues

    # 节流：刚探测过（5s 内）即使设备在线也不重复探测/解除
    probe = AsyncMock(return_value=statuses("EMULATOR1"))
    monkeypatch.setattr(device_pool, "try_list_devices_async", probe)
    state.held_queues[target.lock_key]["last_probe"] = time.monotonic()
    await TaskQueueService._probe_held_queues()
    assert target.lock_key in state.held_queues
    probe.assert_not_called()


@pytest.mark.asyncio
async def test_new_submission_lifts_device_queue_hold(monkeypatch, device_probe_ok):
    await enqueue_two_tasks()
    item = state.queue_items[0]
    target = TaskQueueService._task_target(item)
    seed_hold(target.lock_key, item)

    # 同设备新提交 = 用户重新介入：熔断解除，保留消息与新消息都在队列
    with patch.object(TaskQueueService, "ensure_worker_running"):
        await task_queue_service.enqueue_tasks(["第三条"], device_serial="EMULATOR1")
    assert state.held_queues == {}
    assert [i["goal"] for i in state.queue_items] == ["第一", "第二", "第三条"]


@pytest.mark.asyncio
async def test_stop_all_clears_device_queue_holds(monkeypatch, device_probe_ok):
    await enqueue_two_tasks()
    item = state.queue_items[0]
    target = TaskQueueService._task_target(item)
    seed_hold(target.lock_key, item)

    with patch.object(TaskQueueService, "ensure_worker_running"):
        assert task_queue_service.stop_tasks(clear_all=True) is True
    assert state.held_queues == {}


@pytest.mark.asyncio
async def test_hold_is_per_device_other_device_keeps_dispatching(
    monkeypatch, device_probe_ok
):
    with patch.object(TaskQueueService, "ensure_worker_running"):
        await task_queue_service.enqueue_tasks(["设备A任务"], device_serial="EMULATOR1")
        await task_queue_service.enqueue_tasks(["设备B任务"], device_serial="EMULATOR2")

    monkeypatch.setattr(step_repo, "has_steps", lambda session_id: False)
    monkeypatch.setattr(
        session_repo,
        "get_session_by_id",
        lambda session_id: {"error_message": "Device EMULATOR1 is not available."},
    )

    a_item = state.queue_items[0]
    a_target = TaskQueueService._task_target(a_item)
    await TaskQueueService._maybe_hold_device_queue(a_item, a_target, a_item["session_id"])
    assert a_target.lock_key in state.held_queues

    # 熔断只针对故障设备：设备 B 的 pending 任务照常派发
    with patch.object(TaskQueueService, "_execute_task_item", new=AsyncMock()):
        TaskQueueService._dispatch_pending_tasks()
    statuses = {i["session_id"]: i["status"] for i in state.queue_items}
    assert statuses[a_item["session_id"]] == "pending"
    assert statuses[state.queue_items[1]["session_id"]] == "running"


def test_failure_classification_separates_environment_from_task():
    classify = TaskQueueService._classify_failure
    # 零步骤：断点必然在环境层
    assert classify(False, None) == "environment"
    assert classify(False, "Task failed: verification mismatch") == "environment"
    # 有步骤 + 环境特征：执行途中遭遇环境故障（不可接受）
    assert classify(True, "LLM Error: 503 UNAVAILABLE. High demand.") == "environment"
    assert classify(True, "Device EMULATOR1 is not available (adb does not list it).") == "environment"
    assert classify(True, "Connection to model provider timed out") == "environment"
    # 有步骤 + 无环境特征：任务级失败（可接受，队列继续）
    assert classify(True, None) == "task"
    assert classify(True, "Task failed: expected output not found on screen") == "task"


@pytest.mark.asyncio
async def test_mid_run_environment_failure_holds_queue(monkeypatch, device_probe_ok):
    """执行了步骤但错误是 LLM 提供方故障：环境级失败，同样熔断。"""
    with patch.object(TaskQueueService, "ensure_worker_running"):
        await task_queue_service.enqueue_tasks(["第一"], device_serial="EMULATOR1")
    item = state.queue_items[0]
    target = TaskQueueService._task_target(item)

    monkeypatch.setattr(step_repo, "has_steps", lambda session_id: True)
    monkeypatch.setattr(
        session_repo,
        "get_session_by_id",
        lambda session_id: {"error_message": "LLM Error: 503 UNAVAILABLE. High demand."},
    )
    await TaskQueueService._maybe_hold_device_queue(item, target, item["session_id"])
    assert target.lock_key in state.held_queues
    assert state.held_queues[target.lock_key]["failure_class"] == "environment"


@pytest.mark.asyncio
async def test_task_level_failure_never_holds_queue_full(monkeypatch, device_probe_ok):
    """任务级失败（有步骤且错误无环境特征）：不熔断且队列继续派发。"""
    await enqueue_two_tasks()
    monkeypatch.setattr(step_repo, "has_steps", lambda session_id: True)
    monkeypatch.setattr(
        session_repo,
        "get_session_by_id",
        lambda session_id: {"error_message": "Task failed: expected output not found on screen"},
    )
    item = state.queue_items[0]
    target = TaskQueueService._task_target(item)
    await TaskQueueService._maybe_hold_device_queue(item, target, item["session_id"])
    assert state.held_queues == {}

    with patch.object(TaskQueueService, "_execute_task_item", new=AsyncMock()):
        TaskQueueService._dispatch_pending_tasks()
    assert state.queue_items[0]["status"] == "running"


@pytest.mark.asyncio
async def test_auto_device_failure_holds_default_queue(monkeypatch, device_probe_ok):
    """UI 提交通常不带序列号：auto 任务的环境失败熔断端点默认队列键。"""
    monkeypatch.setattr(device_pool, "select_device_async", AsyncMock(return_value=None))
    with patch.object(TaskQueueService, "ensure_worker_running"):
        await task_queue_service.enqueue_tasks(["自动一", "自动二"])
    auto_items = [i for i in state.queue_items if i.get("device_serial") is None]
    assert len(auto_items) == 2

    monkeypatch.setattr(step_repo, "has_steps", lambda session_id: False)
    monkeypatch.setattr(
        session_repo,
        "get_session_by_id",
        lambda session_id: {
            "error_message": "Device 127.0.0.1:16384 is not available (adb does not list it)."
        },
    )
    item = auto_items[0]
    target = TaskQueueService._task_target(item)
    await TaskQueueService._maybe_hold_device_queue(item, target, item["session_id"])
    assert target.lock_key in state.held_queues
    assert state.held_queues[target.lock_key]["device_serial"] == "auto"

    # dispatcher 跳过 auto 队列的所有 pending 消息（保留在队列中）
    with patch.object(TaskQueueService, "_execute_task_item", new=AsyncMock()):
        TaskQueueService._dispatch_pending_tasks()
    assert all(i["status"] == "pending" for i in auto_items)

    # auto 队列的新提交解除熔断
    with patch.object(TaskQueueService, "ensure_worker_running"):
        await task_queue_service.enqueue_tasks(["自动三"])
    assert state.held_queues == {}


async def enqueue_two_tasks():
    with (
        patch.object(TaskQueueService, "ensure_worker_running"),
        patch(
            "apps.admin_console.services.task_queue_service.session_repo"
        ),
    ):
        await task_queue_service.enqueue_tasks(
            ["第一", "第二"], device_serial="EMULATOR1"
        )


def seed_hold(lock_key: str, item: dict):
    state.held_queues[lock_key] = {
        "reason": "Device EMULATOR1 is not available (adb does not list it).",
        "session_id": item["session_id"],
        "device_serial": "EMULATOR1",
        "last_probe": 0.0,
    }


@pytest.mark.asyncio
async def test_manual_pause_gates_dispatch_and_resume_clears_holds(
    monkeypatch, device_probe_ok
):
    await enqueue_two_tasks()

    # 手动暂停：pending 全部保留不派发
    with patch.object(TaskQueueService, "ensure_worker_running"):
        assert task_queue_service.pause_queue() is True
    with patch.object(TaskQueueService, "_execute_task_item", new=AsyncMock()):
        TaskQueueService._dispatch_pending_tasks()
    assert all(i["status"] == "pending" for i in state.queue_items)

    # 继续队列 = 手动暂停与熔断挂起一并解除
    item = state.queue_items[0]
    state.held_queues[TaskQueueService._task_target(item).lock_key] = {
        "reason": "env",
        "session_id": item["session_id"],
        "device_serial": "EMULATOR1",
        "last_probe": 0.0,
    }
    events = []
    capture = lambda et, d: events.append((et, d))
    state.ipc_subscribers.append(capture)
    try:
        with patch.object(TaskQueueService, "ensure_worker_running"):
            assert task_queue_service.resume_queue() is True
    finally:
        state.ipc_subscribers.remove(capture)
    assert state.queue_manually_paused is False
    assert state.held_queues == {}
    assert [et for et, _ in events if et == "queue_resumed"]

    # 继续后照常 FIFO 派发
    with patch.object(TaskQueueService, "_execute_task_item", new=AsyncMock()):
        TaskQueueService._dispatch_pending_tasks()
    assert state.queue_items[0]["status"] == "running"


def test_queue_router_registers_expected_routes():
    """Router-level guard: a decorator misplacement once attached
    ``GET /api/status`` to the pause handler, so every frontend status poll
    paused the queue while the real status handler went unregistered."""
    from apps.admin_console.routers.tasks import router

    by_key = {}
    for route in router.routes:
        if hasattr(route, "methods"):
            for method in route.methods:
                by_key[(method, route.path)] = route.endpoint.__name__

    assert by_key[("GET", "/api/status")] == "get_status"
    assert by_key[("POST", "/api/queue/pause")] == "pause_queue"
    assert by_key[("POST", "/api/queue/resume")] == "resume_queue"
    assert by_key[("POST", "/api/run")] == "run_task"
