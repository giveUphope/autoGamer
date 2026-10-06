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

"""Tests for the read-only endpoint-form mirror endpoint and startup bindings.

The endpoint form is the single entry point that writes credentials; the
entries endpoint mirrors the saved state as form-shaped fields (provider,
format, base URL, model, masked key) for the display list.
"""

import json
import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from apps.admin_console.server import app


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost")


JSONC_SAMPLE = """{
  // header comment — keep this comment
  "default": {
    "provider": "openai",
    "provider_label": "deepseek",
    "model": "old-model",
    "thinking_level": "medium",
    // nested comment
    "fallback": { "provider": "openai", "model": "old-model" }
  }
}
"""


@pytest.fixture
def config_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "artemis.jsonc"
    target.write_text(JSONC_SAMPLE, encoding="utf-8")
    monkeypatch.setattr("artemis.config.paths.get_config_path", lambda name: target)
    return target


@pytest.mark.asyncio
async def test_entries_mirror_endpoint_form_fields(
    config_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pydantic import SecretStr

    from artemis.config import settings as settings_obj

    # The singleton loaded the real .env at import time; patch its field so the
    # resolved key under test is deterministic.
    monkeypatch.setattr(settings_obj, "OPENAI_API_KEY", SecretStr("sk-abcdefghij1234"))
    monkeypatch.setenv("OPENAI_BASE_URL", "")

    async with _client() as client:
        res = await client.get("/api/system/credentials/entries")

    assert res.status_code == 200
    rows = res.json()["rows"]
    # One row per saved endpoint record; fields are the columns.
    assert len(rows) == 1
    row = rows[0]
    assert row["provider"] == "deepseek"
    assert row["api_format"] == "openai"
    # No api_base in the jsonc and no env fallback → unset.
    assert row["api_base"] is None
    assert row["model"] == "old-model"
    # The key resolves through the provider store and is masked.
    assert row["api_key"] == "****1234"
    assert "sk-abcdefghij1234" not in res.text


@pytest.mark.asyncio
async def test_entries_api_base_falls_back_to_env(
    config_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", "http://10.0.0.5:8000/v1")

    async with _client() as client:
        res = await client.get("/api/system/credentials/entries")

    rows = res.json()["rows"]
    assert rows[0]["api_base"] == "http://10.0.0.5:8000/v1"


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
