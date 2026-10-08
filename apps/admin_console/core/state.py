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
from collections.abc import Callable
from typing import Any

from artemis.config import PAUSE_FILE
from artemis.runtime.process_probe import pid_is_alive


class ServerState:
    """Encapsulates all runtime states of the debug server."""

    def __init__(self):
        self.ipc_subscribers: list[Callable[[str, Any], None]] = []
        self.ipc_server: asyncio.Server | None = None
        self.ipc_serve_task: asyncio.Task | None = None
        self.ipc_port: int | None = None
        self.port: int = 8000
        self.host: str = "127.0.0.1"
        self.is_shutting_down: bool = False

        self.current_process: asyncio.subprocess.Process | None = None
        self.current_goal: str | None = None
        self.current_profile: str | None = None
        self.active_connections: dict[str, dict[str, Any]] = {}
        self.active_session_id: str | None = None
        # Run keys (session id, or the synthetic run key of session-less runs)
        # that were stopped manually. Tracked per run so a manual stop of one
        # device's task never pollutes the terminal-status resolution of a
        # concurrently running task on another device. Entries are discarded by
        # each run's finalizer.
        self.manually_stopped_run_ids: set[str] = set()
        self.cancelled_session_ids: set[str] = set()
        self.startup_progress: dict[str, list[dict[str, Any]]] = {}

        # Concurrent task executions keyed by session_id. Each value holds
        # {"process", "device_id", "goal", "profile"}. `current_process` /
        # `active_session_id` mirror the most recently launched run for
        # backward compatibility with single-task consumers.
        self.active_runs: dict[str, dict[str, Any]] = {}

        # Unified single source of truth for task queue
        self.queue_items: list[dict[str, Any]] = []

        # 设备队列熔断（lock_key -> {"reason", "session_id", "device_serial",
        # "last_probe"}）：某设备上一个任务「零步骤即失败」（环境级故障，如设备
        # 掉线）时，该设备队列停止派发，剩余消息保留 pending，避免同一报错
        # 重复打穿整个队列。设备重新上线（节流探测）、stop 全部或对该设备的
        # 新提交会解除熔断。
        self.held_queues: dict[str, dict[str, Any]] = {}

        # 用户手动暂停队列：dispatcher 停止派发新的 pending 任务（运行中的任务
        # 不受影响），消息全部保留；resume_queue / stop 全部解除。
        self.queue_manually_paused: bool = False

        # session_id -> 提交元数据（conversation_id / created_at）：worker 取走
        # 任务后 queue_items 里就查不到了，而设备锁票据视图不带这些字段；
        # /api/status 靠这张表把线程 id 与提交时刻回填到 pending/running 表示上，
        # 保证前端在 DB 行落库前也能把新轮归入正确线程并按提交顺序排序。
        self.submission_meta: dict[str, dict[str, Any]] = {}
        self._wake_event: asyncio.Event | None = None
        self._shutdown_event: asyncio.Event | None = None
        self.worker_task: asyncio.Task | None = None

    def remember_submission(
        self,
        session_id: str | None,
        conversation_id: str | None = None,
        created_at: float | None = None,
        goal: str | None = None,
    ) -> None:
        """Record one task's submission metadata, bounded to recent submissions."""
        if not session_id:
            return
        meta = self.submission_meta.setdefault(str(session_id), {})
        if conversation_id:
            meta["conversation_id"] = str(conversation_id)
        if created_at is not None:
            meta["created_at"] = float(created_at)
        if goal:
            meta["goal"] = str(goal)
        while len(self.submission_meta) > 500:
            oldest = next(iter(self.submission_meta))
            self.submission_meta.pop(oldest, None)

    def submission_for(self, session_id: str | None) -> dict[str, Any]:
        """Look up the recorded submission metadata of a queued/running task."""
        if session_id is None:
            return {}
        return self.submission_meta.get(str(session_id), {})

    def remember_conversation(self, session_id: str | None, conversation_id: str | None) -> None:
        """Backward-compatible wrapper around remember_submission."""
        self.remember_submission(session_id, conversation_id=conversation_id)

    def conversation_for(self, session_id: str | None) -> str | None:
        """Look up the conversation thread of a queued/running task."""
        return self.submission_for(session_id).get("conversation_id")

    @property
    def wake_event(self) -> asyncio.Event:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if self._wake_event is None or (
            loop
            and getattr(self._wake_event, "_loop", None) is not None
            and self._wake_event._loop != loop
        ):
            self._wake_event = asyncio.Event()
        return self._wake_event

    @property
    def shutdown_event(self) -> asyncio.Event:
        """Event set as soon as the HTTP server receives a shutdown signal."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if self._shutdown_event is None or (
            loop
            and getattr(self._shutdown_event, "_loop", None) is not None
            and self._shutdown_event._loop != loop
        ):
            self._shutdown_event = asyncio.Event()
        return self._shutdown_event

    @property
    def task_queue(self) -> list[dict[str, Any]]:
        """Backward compatibility alias for queue_items."""
        return self.queue_items

    @property
    def queue_tasks(self) -> list[dict[str, Any]]:
        """Returns all currently pending tasks in the queue."""
        return [t for t in self.queue_items if isinstance(t, dict) and t.get("status") == "pending"]

    @queue_tasks.setter
    def queue_tasks(self, val: list[dict[str, Any]]):
        # Compatibility setter
        self.queue_items = list(val)

    @property
    def queue_goals(self) -> list[str]:
        """Backward compatibility helper for queue goals."""
        return [t.get("goal", "") for t in self.queue_tasks]

    @queue_goals.setter
    def queue_goals(self, val: list[Any]):
        pass

    def prune_finished_runs(self) -> None:
        """Drop finished entries from active_runs.

        Besides reaped processes (returncode set), also drops entries whose pid no
        longer exists: if a run coroutine dies without reaping its child, the entry
        must not permanently block the scheduler.
        """
        for sid, run in list(self.active_runs.items()):
            proc = run.get("process")
            if proc is None or proc.returncode is not None:
                self.active_runs.pop(sid, None)
                continue
            pid = getattr(proc, "pid", None)
            if pid and not pid_is_alive(pid):
                self.active_runs.pop(sid, None)

    @property
    def busy_device_ids(self) -> set[str]:
        """Device serials currently owned by an in-flight run."""
        self.prune_finished_runs()
        return {
            str(run.get("lock_key") or run["device_id"])
            for run in self.active_runs.values()
            if run.get("device_id")
        }

    @property
    def is_running(self) -> bool:
        self.prune_finished_runs()
        if self.active_runs:
            return True
        has_proc = False
        if self.current_process is not None:
            if self.current_process.returncode is not None:
                has_proc = False
                self.current_process = None
            else:
                pid = getattr(self.current_process, "pid", None)
                if pid and pid_is_alive(pid):
                    has_proc = True
                else:
                    has_proc = False
                    self.current_process = None

        has_running_item = any(
            isinstance(t, dict) and t.get("status") == "running" for t in self.queue_items
        )

        has_live_connection = False
        for sid, conn in list(self.active_connections.items()):
            c_pid = conn.get("pid")
            if c_pid:
                if pid_is_alive(c_pid):
                    has_live_connection = True
                else:
                    self.active_connections.pop(sid, None)

        if not has_proc and not has_running_item and not has_live_connection:
            self.active_session_id = None
            self.current_process = None
            return False

        return True

    @property
    def is_paused(self) -> bool:
        return PAUSE_FILE.exists()

    @property
    def paused_error(self) -> str | None:
        """Return the persisted pause reason for clients that missed the SSE event."""
        if not PAUSE_FILE.exists():
            return None
        try:
            message = PAUSE_FILE.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return "AI model request failed. The task is paused."
        if message.startswith("LLM Error: "):
            message = message[len("LLM Error: ") :]
        return message or "AI model request failed. The task is paused."

    def add_subscriber(self, callback: Callable[[str, Any], None]):
        if callback not in self.ipc_subscribers:
            self.ipc_subscribers.append(callback)

    def remove_subscriber(self, callback: Callable[[str, Any], None]):
        if callback in self.ipc_subscribers:
            self.ipc_subscribers.remove(callback)

    def record_startup_progress(self, data: dict[str, Any]) -> None:
        """Retain the short pre-trace timeline so late SSE clients can catch up."""
        session_id = data.get("session_id")
        stage = data.get("stage")
        if not session_id or not stage:
            return

        key = str(session_id)
        events = self.startup_progress.setdefault(key, [])
        replacement_index = next(
            (index for index, item in enumerate(events) if item.get("stage") == stage),
            None,
        )
        snapshot = dict(data)
        if replacement_index is None:
            events.append(snapshot)
        else:
            events[replacement_index] = snapshot
        self.startup_progress[key] = events[-16:]

    def get_startup_progress(self, session_id: str) -> list[dict[str, Any]]:
        return [dict(item) for item in self.startup_progress.get(str(session_id), [])]

    def clear_queue(self):
        """Clears all pending items from the task queue."""
        self.queue_items = [t for t in self.queue_items if t.get("status") == "running"]
        if self._wake_event:
            self._wake_event.set()


# Global shared instance
state = ServerState()

import sys

if __name__ == "admin_console.core.state":
    sys.modules["apps.admin_console.core.state"] = sys.modules[__name__]
elif __name__ == "apps.admin_console.core.state":
    sys.modules["admin_console.core.state"] = sys.modules[__name__]
