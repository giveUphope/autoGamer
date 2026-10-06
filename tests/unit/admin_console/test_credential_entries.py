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

"""Tests for the user-defined credential bindings endpoints.

The setup UI lets users manage arbitrary env-var-name → provider credential
entries; values live in .env and the name→provider mapping in
credential_bindings.json, which is replayed at startup.
"""

import json
import os
import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from apps.admin_console.server import app


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost")


@pytest.fixture
def storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    """Point .env and credential_bindings.json at throwaway files."""
    import artemis.config  # noqa: F401  (ensure the package is imported)
    import artemis.config.paths as paths

    # artemis.config re-exports the singleton as `settings`, shadowing the
    # submodule name; resolve the real module for patching.
    settings_module = sys.modules["artemis.config.settings"]

    env_file = tmp_path / ".env"
    bindings_file = tmp_path / "credential_bindings.json"
    bindings_stub = lambda: bindings_file  # noqa: E731
    # settings.py binds the helpers at import time, so patch both modules.
    monkeypatch.setattr(paths, "get_credentials_bindings_file", bindings_stub)
    monkeypatch.setattr(settings_module, "get_credentials_bindings_file", bindings_stub)
    monkeypatch.setattr(settings_module, "get_env_file", lambda: env_file)
    return {"env": env_file, "bindings": bindings_file}


@pytest.mark.asyncio
async def test_upsert_writes_env_and_bindings_and_applies_runtime(
    storage: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    from artemis.config.settings import Settings

    recorded: dict = {}

    def fake_set_api_key(self, provider: str, key: str, persist_to_env: bool = False) -> None:
        recorded["api_key"] = (provider, key, persist_to_env)

    monkeypatch.setattr(Settings, "set_api_key", fake_set_api_key)
    monkeypatch.setenv("MY_LLM_KEY", "")

    async with _client() as client:
        res = await client.post(
            "/api/system/credentials/entries",
            json={"name": "MY_LLM_KEY", "provider": "openai", "value": "sk-custom-1"},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "success"

    # Value persisted under the user-defined name only.
    assert "MY_LLM_KEY=sk-custom-1" in storage["env"].read_text(encoding="utf-8")
    # Binding recorded for startup replay.
    bindings = json.loads(storage["bindings"].read_text(encoding="utf-8"))
    assert bindings["entries"] == [{"name": "MY_LLM_KEY", "provider": "openai"}]
    # Known provider applied to the live session without touching .env.
    assert recorded["api_key"] == ("openai", "sk-custom-1", False)


@pytest.mark.asyncio
async def test_upsert_updates_provider_without_rewriting_value(
    storage: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    storage["env"].write_text("MY_KEY=keep-me\n", encoding="utf-8")
    storage["bindings"].write_text(
        json.dumps({"entries": [{"name": "MY_KEY", "provider": "openai"}]}),
        encoding="utf-8",
    )

    async with _client() as client:
        res = await client.post(
            "/api/system/credentials/entries",
            json={"name": "MY_KEY", "provider": "anthropic"},
        )

    assert res.status_code == 200
    assert "MY_KEY=keep-me" in storage["env"].read_text(encoding="utf-8")
    bindings = json.loads(storage["bindings"].read_text(encoding="utf-8"))
    assert bindings["entries"] == [{"name": "MY_KEY", "provider": "anthropic"}]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"name": "9 BAD-NAME", "provider": "openai", "value": "v"},
        {"name": "PATH", "provider": "openai", "value": "v"},
        {"name": "ARTEMIS_DATA_DIR", "provider": "openai", "value": "v"},
        {"name": "VALID_NAME", "provider": "  ", "value": "v"},
    ],
)
async def test_upsert_rejects_invalid_entries(storage: dict[str, Path], payload: dict) -> None:
    async with _client() as client:
        res = await client.post("/api/system/credentials/entries", json=payload)
    assert res.status_code == 400
    assert not storage["bindings"].exists()


@pytest.mark.asyncio
async def test_list_masks_values(storage: dict[str, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    storage["bindings"].write_text(
        json.dumps(
            {
                "entries": [
                    {"name": "MY_LLM_KEY", "provider": "openai"},
                    {"name": "OTHER_KEY", "provider": "ocr"},
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("MY_LLM_KEY", "sk-abcdefghij1234")
    monkeypatch.setenv("OTHER_KEY", "null")  # treated as placeholder by is_placeholder_key

    async with _client() as client:
        res = await client.get("/api/system/credentials/entries")

    assert res.status_code == 200
    entries = res.json()["entries"]
    mine = next(e for e in entries if e["name"] == "MY_LLM_KEY")
    other = next(e for e in entries if e["name"] == "OTHER_KEY")
    assert mine == {
        "name": "MY_LLM_KEY",
        "provider": "openai",
        "is_set": True,
        "preview": "****1234",
    }
    # Placeholder-looking values are reported as unset.
    assert other["is_set"] is False
    assert other["preview"] is None


@pytest.mark.asyncio
async def test_delete_removes_env_line_and_binding(
    storage: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    storage["env"].write_text("A=1\nMY_KEY=secret\nB=2\n# MY_KEY=old\n", encoding="utf-8")
    storage["bindings"].write_text(
        json.dumps(
            {
                "entries": [
                    {"name": "MY_KEY", "provider": "openai"},
                    {"name": "A", "provider": "xai"},
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("MY_KEY", "secret")

    async with _client() as client:
        res = await client.delete("/api/system/credentials/entries/MY_KEY")

    assert res.status_code == 200
    content = storage["env"].read_text(encoding="utf-8")
    assert "MY_KEY" not in content
    assert "A=1" in content and "B=2" in content
    bindings = json.loads(storage["bindings"].read_text(encoding="utf-8"))
    assert [e["name"] for e in bindings["entries"]] == ["A"]
    assert os.environ.get("MY_KEY") is None


def test_apply_custom_credential_bindings_feeds_runtime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from artemis.config.settings import Settings

    bindings_file = tmp_path / "credential_bindings.json"
    bindings_file.write_text(
        json.dumps(
            {
                "entries": [
                    {"name": "CUSTOM_LLM_KEY", "provider": "openai"},
                    {"name": "EMPTY_KEY", "provider": "google"},
                    {"name": "GHOST_KEY", "provider": "xai"},
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        sys.modules["artemis.config.settings"],
        "get_credentials_bindings_file",
        lambda: bindings_file,
    )
    monkeypatch.setenv("CUSTOM_LLM_KEY", "sk-live-1")
    monkeypatch.setenv("EMPTY_KEY", "")

    recorded: dict = {}

    def fake_set_api_key(self, provider: str, key: str, persist_to_env: bool = False) -> None:
        recorded.setdefault("applied", []).append((provider, key, persist_to_env))

    monkeypatch.setattr(Settings, "set_api_key", fake_set_api_key)

    applied = Settings().apply_custom_credential_bindings()

    assert applied == 1
    assert recorded["applied"] == [("openai", "sk-live-1", False)]
