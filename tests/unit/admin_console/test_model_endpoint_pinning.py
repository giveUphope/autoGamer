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

"""Task-level model pinning: the endpoint shown at submit time is the endpoint
the task runs with, and the session keeps saying so afterwards.

The pin crosses four seams, so each one gets its own test:
``/api/run`` (only a saved record is accepted) -> the queue item -> the worker's
environment -> the config layer that resolves every node's model -> the read
path that reports which model a finished run used.
"""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from artemis.config.constants import ENV_ARTEMIS_MODEL_ENDPOINT

PINNED_JSONC = """{
  // header comment — keep this comment
  "default": {
    "provider": "openai",
    "model": "global-model",
    "api_base": "http://127.0.0.1:1234/v1",
    "api_key": "sk-global-1234567890",
    "thinking_level": "medium",
    "fallback": { "provider": "openai", "model": "global-model" }
  }
}
"""

RECORD = {
    "name": "mine",
    "api_format": "openai",
    "api_base": "http://127.0.0.1:9999/v1",
    "model": "pinned-model",
}


@pytest.fixture
def llm_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A throwaway artemis.jsonc plus an empty library and no ambient pin.

    ``llm.py`` imports ``get_config_path`` by name, so the patch has to target
    that reference rather than the one on ``artemis.config.paths``.
    """
    target = tmp_path / "artemis.jsonc"
    target.write_text(PINNED_JSONC, encoding="utf-8")
    monkeypatch.setattr("artemis.config.llm.get_config_path", lambda name: target)
    monkeypatch.delenv(ENV_ARTEMIS_MODEL_ENDPOINT, raising=False)
    return target


def _seed_library(path: Path, *records: dict) -> None:
    path.write_text(json.dumps({"endpoints": list(records)}, ensure_ascii=False), encoding="utf-8")


def test_unpinned_config_resolves_exactly_as_written(llm_config: Path) -> None:
    from artemis.config.llm import load_default_model_cfg

    cfg = load_default_model_cfg()
    assert cfg["model"] == "global-model"
    assert cfg["api_base"] == "http://127.0.0.1:1234/v1"
    assert cfg["api_key"] == "sk-global-1234567890"


def test_pin_replaces_model_and_endpoint_but_keeps_reasoning(
    llm_config: Path, isolated_endpoint_library: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from artemis.config.llm import load_default_model_cfg

    _seed_library(isolated_endpoint_library, RECORD)
    monkeypatch.setenv(ENV_ARTEMIS_MODEL_ENDPOINT, "mine")

    cfg = load_default_model_cfg()
    assert cfg["model"] == "pinned-model"
    assert cfg["api_base"] == "http://127.0.0.1:9999/v1"
    # thinking_level describes how the agent reasons, not which endpoint answers
    assert cfg["thinking_level"] == "medium"


def test_pin_clears_endpoint_owned_fields_the_record_lacks(
    llm_config: Path, isolated_endpoint_library: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A local record must not inherit the previous provider's key or fallback."""
    from artemis.config.llm import load_default_model_cfg

    _seed_library(
        isolated_endpoint_library,
        {k: v for k, v in RECORD.items() if k not in ("api_base",)},
    )
    monkeypatch.setenv(ENV_ARTEMIS_MODEL_ENDPOINT, "mine")

    cfg = load_default_model_cfg()
    assert "api_key" not in cfg
    assert "fallback" not in cfg
    assert "api_base" not in cfg


def test_pin_applies_to_the_pro_path_too(
    llm_config: Path, isolated_endpoint_library: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Flash reads the default block directly; Pro instantiates LLMConfig.

    Both must follow the pin — a seam that only one of them consults would make
    the architecture profile decide the model.
    """
    from artemis.config.llm import parse_llm_config

    _seed_library(isolated_endpoint_library, RECORD)
    monkeypatch.setenv(ENV_ARTEMIS_MODEL_ENDPOINT, "mine")

    config = parse_llm_config()
    assert config.operator.model == "pinned-model"
    assert config.planner.model == "pinned-model"


def test_unknown_pin_raises_instead_of_running_on_the_global_default(
    llm_config: Path, isolated_endpoint_library: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from artemis.config.llm import load_default_model_cfg

    _seed_library(isolated_endpoint_library, RECORD)
    monkeypatch.setenv(ENV_ARTEMIS_MODEL_ENDPOINT, "ghost")

    with pytest.raises(RuntimeError, match="ghost"):
        load_default_model_cfg()


@pytest.mark.parametrize("record", [{"name": "mine", "api_format": "openai"}, {"name": "mine"}])
def test_pin_needs_both_format_and_model(
    llm_config: Path,
    isolated_endpoint_library: Path,
    monkeypatch: pytest.MonkeyPatch,
    record: dict,
) -> None:
    from artemis.config.llm import load_default_model_cfg

    _seed_library(isolated_endpoint_library, record)
    monkeypatch.setenv(ENV_ARTEMIS_MODEL_ENDPOINT, "mine")

    with pytest.raises(RuntimeError, match="api_format and model"):
        load_default_model_cfg()


def test_worker_command_exports_pin_only_for_pinned_tasks(monkeypatch: pytest.MonkeyPatch) -> None:
    from apps.admin_console.services.task_queue_service import TaskQueueService

    monkeypatch.delenv(ENV_ARTEMIS_MODEL_ENDPOINT, raising=False)
    target = MagicMock()
    target.lock_scope = "scope-1"
    build = TaskQueueService._build_worker_invocation

    _, pinned_env = build({"model_endpoint": "mine"}, "run-key", "sid", "goal", "flash", target)
    assert pinned_env[ENV_ARTEMIS_MODEL_ENDPOINT] == "mine"

    _, plain_env = build({"model_endpoint": None}, "run-key", "sid", "goal", "flash", target)
    assert ENV_ARTEMIS_MODEL_ENDPOINT not in plain_env


def test_queue_item_records_the_pin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from apps.admin_console.services.task_queue_service import TaskQueueService

    # Reserving a ticket writes into the device-lock dir; keep it out of %TEMP%
    # where a live daemon would merge the stray ticket into its queue view.
    lock_dir = tmp_path / "device-locks"
    lock_dir.mkdir()
    monkeypatch.setattr("artemis.runtime.device_lock.get_temp_dir", lambda _sub=None: lock_dir)

    endpoint = MagicMock()
    endpoint.identity = "endpoint-1"
    endpoint.to_dict.return_value = {"identity": "endpoint-1"}

    item = TaskQueueService._create_queue_item(
        endpoint=endpoint,
        goal="goal",
        index=0,
        now=1.0,
        single_session_id=None,
        profile="flash",
        expected_output=None,
        enable_outputter=None,
        locked_app_package=None,
        app_path=None,
        device_serial=None,
        ingress="frontend",
        conversation_id=None,
        model_endpoint="mine",
    )
    assert item["model_endpoint"] == "mine"


@pytest.mark.asyncio
async def test_run_rejects_unknown_model_endpoint_before_enqueue() -> None:
    from fastapi import HTTPException

    from apps.admin_console.routers import tasks as tasks_router
    from apps.admin_console.schemas.task_schema import RunRequest

    with patch.object(tasks_router, "task_queue_service") as queue:
        with pytest.raises(HTTPException) as raised:
            await tasks_router.run_task(RunRequest(goal="goal", model_endpoint="ghost"))

    assert raised.value.status_code == 400
    assert "ghost" in raised.value.detail
    queue.enqueue_tasks.assert_not_called()


@pytest.mark.asyncio
async def test_run_forwards_saved_model_endpoint_to_enqueue(
    isolated_endpoint_library: Path,
) -> None:
    from apps.admin_console.routers import tasks as tasks_router
    from apps.admin_console.schemas.task_schema import RunRequest

    _seed_library(isolated_endpoint_library, RECORD)
    enqueue = AsyncMock(return_value={"status": "queued", "tasks": [], "enqueued_count": 1})

    with (
        patch.object(tasks_router.task_queue_service, "enqueue_tasks", enqueue),
        patch.object(tasks_router.readiness_engine, "run_device_submission_probe") as probe,
    ):
        probe.return_value = None
        await tasks_router.run_task(RunRequest(goal="goal", model_endpoint=" mine "))

    assert enqueue.await_args.kwargs["model_endpoint"] == "mine"


def test_pinned_model_info_reports_the_record_not_the_global_default(
    isolated_endpoint_library: Path,
) -> None:
    from apps.admin_console.services.model_service import ModelService

    _seed_library(isolated_endpoint_library, RECORD)
    with patch.object(
        ModelService, "_get_llm_provider_and_model", return_value=("openai", "global-model")
    ):
        info = ModelService.get_pinned_model_info("mine", "pro")

    assert info["id"] == "pinned-model"
    assert info["provider"] == "openai"
    assert info["endpoint"] == "mine"
    assert info["name"] == "Pro"


def test_pinned_model_info_of_a_deleted_record_keeps_the_name_only(
    isolated_endpoint_library: Path,
) -> None:
    """The record is gone, so the run's model is unknown.

    Falling back to the current global default would credit whichever provider
    happens to be configured today with a run it never served.
    """
    from apps.admin_console.services.model_service import ModelService

    _seed_library(isolated_endpoint_library, RECORD)
    with patch.object(
        ModelService, "_get_llm_provider_and_model", return_value=("openai", "global-model")
    ):
        info = ModelService.get_pinned_model_info("ghost", "flash")

    assert info["endpoint"] == "ghost"
    assert info["id"] == ""
    assert info["provider"] == ""


@pytest.mark.asyncio
async def test_list_sessions_reports_pinned_model_per_row(
    isolated_endpoint_library: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from apps.admin_console.routers import sessions as sessions_router

    _seed_library(isolated_endpoint_library, RECORD)

    repo = MagicMock()
    repo.get_all_sessions.return_value = [
        {
            "session_id": "pinned-run",
            "status": "completed",
            "start_time": 1.0,
            "device_info": '{"profile": "flash"}',
            "model_endpoint": "mine",
        },
        {
            "session_id": "global-run",
            "status": "completed",
            "start_time": 2.0,
            "device_info": '{"profile": "flash"}',
            "model_endpoint": None,
        },
    ]
    repo.get_video_recordings_map.return_value = {}
    repo.get_latest_video_recordings_map.return_value = {}
    repo.get_llm_traces_for_profiles_map.return_value = {}
    repo.get_agent_trace_names_map.return_value = {}

    monkeypatch.setattr(sessions_router, "session_repo", repo, raising=False)
    monkeypatch.setattr(
        sessions_router.media_service, "build_video_index", MagicMock(return_value={})
    )
    monkeypatch.setattr(
        sessions_router.media_service, "resolve_video_url", MagicMock(return_value=None)
    )

    result = await sessions_router.list_sessions()

    by_id = {row["session_id"]: row for row in result}
    assert by_id["pinned-run"]["model_info"]["id"] == "pinned-model"
    assert by_id["pinned-run"]["model_info"]["endpoint"] == "mine"
    assert by_id["global-run"]["model_info"].get("endpoint") is None


def test_session_storage_round_trips_the_pin(tmp_path: Path) -> None:
    from artemis.data_engine.models import SessionMetadata
    from artemis.data_engine.storage import StorageManager

    storage = StorageManager(tmp_path / "sessions.db", tmp_path / "traces")
    session_id = "11111111-1111-1111-1111-111111111111"
    storage.create_session(
        SessionMetadata(
            session_id=session_id,
            initial_goal="goal",
            start_time=1.0,
            model_endpoint="mine",
        )
    )

    row = storage.get_session(session_id)
    assert row is not None
    assert row.model_endpoint == "mine"

    storage.create_session(
        SessionMetadata(
            session_id="22222222-2222-2222-2222-222222222222", initial_goal="g", start_time=1.0
        )
    )
    unpinned = storage.get_session("22222222-2222-2222-2222-222222222222")
    assert unpinned is not None
    assert unpinned.model_endpoint is None
