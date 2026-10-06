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

"""Tests for the POST /api/system/model-config endpoint and its JSONC editing.

The endpoint powers the setup UI's endpoint form: users fill in provider,
base URL, model, and key instead of editing artemis.jsonc / .env by hand.
"""

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from apps.admin_console.server import app

JSONC_SAMPLE = """{
  // header comment — keep this comment
  "default": {
    "provider": "openai",
    "model": "old-model",
    "thinking_level": "medium",
    // nested comment
    "fallback": { "provider": "openai", "model": "old-model" }
  },
  "presets": {
    "p": { "provider": "openai", "model": "preset-model" }
  }
}
"""


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost")


@pytest.fixture
def config_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point get_config_path at a throwaway artemis.jsonc copy."""
    target = tmp_path / "artemis.jsonc"
    target.write_text(JSONC_SAMPLE, encoding="utf-8")
    monkeypatch.setattr("artemis.config.paths.get_config_path", lambda name: target)
    return target


@pytest.mark.asyncio
async def test_update_model_config_writes_default_block(config_file: Path) -> None:
    async with _client() as client:
        res = await client.post(
            "/api/system/model-config",
            json={
                "provider": "openai",
                "model": "qwen3-32b",
                "api_base": "http://127.0.0.1:1234/v1",
            },
        )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "success"
    assert body["default_model"]["model"] == "qwen3-32b"
    assert body["default_model"]["api_base"] == "http://127.0.0.1:1234/v1"

    text = config_file.read_text(encoding="utf-8")
    # Comments and unrelated keys survive the surgical edit.
    assert "// header comment — keep this comment" in text
    assert '"thinking_level": "medium"' in text
    # Only the first (top-level) "model" is rewritten; fallback keeps its own.
    assert body["default_model"]["fallback"]["model"] == "old-model"
    assert '"model": "preset-model"' in text


@pytest.mark.asyncio
async def test_update_model_config_inserts_missing_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "artemis.jsonc"
    target.write_text(
        '{\n  // c\n  "default": {\n    "provider": "openai"\n  }\n}\n',
        encoding="utf-8",
    )
    monkeypatch.setattr("artemis.config.paths.get_config_path", lambda name: target)

    async with _client() as client:
        res = await client.post(
            "/api/system/model-config",
            json={"api_base": "http://10.0.0.5:8000/v1"},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["default_model"]["api_base"] == "http://10.0.0.5:8000/v1"
    assert body["default_model"]["provider"] == "openai"


@pytest.mark.asyncio
async def test_update_model_config_rejects_bad_base_url(config_file: Path) -> None:
    async with _client() as client:
        res = await client.post(
            "/api/system/model-config",
            json={"api_base": "ftp://not-http"},
        )
    assert res.status_code == 400
    # Nothing was written.
    assert config_file.read_text(encoding="utf-8") == JSONC_SAMPLE


@pytest.mark.asyncio
async def test_update_model_config_requires_changes(config_file: Path) -> None:
    async with _client() as client:
        res = await client.post("/api/system/model-config", json={})
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_update_model_config_routes_api_key_to_credential_store(
    config_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from artemis.config.settings import Settings

    recorded: dict = {}

    def fake_set_api_key(self, provider: str, key: str, persist_to_env: bool = False) -> None:
        recorded["api_key"] = (provider, key, persist_to_env)

    def fake_set_base_url(self, base_url: str | None, persist_to_env: bool = True) -> None:
        recorded["base_url"] = (base_url, persist_to_env)

    monkeypatch.setattr(Settings, "set_api_key", fake_set_api_key)
    monkeypatch.setattr(Settings, "set_openai_base_url", fake_set_base_url)

    async with _client() as client:
        res = await client.post(
            "/api/system/model-config",
            json={"provider": "openai", "api_key": "sk-test-123"},
        )

    assert res.status_code == 200
    assert recorded["api_key"] == ("openai", "sk-test-123", True)
    # No api_base supplied → the endpoint store must not be touched.
    assert "base_url" not in recorded
    # The secret never lands in artemis.jsonc.
    assert "sk-test-123" not in config_file.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_update_model_config_splits_provider_label_and_api_format(config_file: Path) -> None:
    """The user-defined provider name becomes provider_label; api_format drives dispatch."""
    async with _client() as client:
        res = await client.post(
            "/api/system/model-config",
            json={"provider": "deepseek", "api_format": "openai", "model": "qwen3-32b"},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["default_model"]["provider"] == "openai"
    assert body["default_model"]["provider_label"] == "deepseek"


@pytest.mark.asyncio
async def test_update_model_config_rejects_unknown_api_format(config_file: Path) -> None:
    async with _client() as client:
        res = await client.post("/api/system/model-config", json={"api_format": "not-a-protocol"})

    assert res.status_code == 400
    assert config_file.read_text(encoding="utf-8") == JSONC_SAMPLE


def test_model_provider_accepts_openai_responses() -> None:
    from artemis.llm.router import ModelProvider

    assert ModelProvider.from_string("openai_responses") == ModelProvider.OPENAI_RESPONSES
    assert ModelProvider.from_string("responses").value == "openai_responses"


def test_set_api_key_routes_openai_responses_to_openai_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "")
    from artemis.config.settings import Settings

    s = Settings()
    s.set_api_key("openai_responses", "sk-resp-1", persist_to_env=False)
    assert s.OPENAI_API_KEY is not None
    assert s.OPENAI_API_KEY.get_secret_value() == "sk-resp-1"


@pytest.mark.asyncio
async def test_update_model_config_persists_openai_responses_format(config_file: Path) -> None:
    async with _client() as client:
        res = await client.post("/api/system/model-config", json={"api_format": "openai_responses"})

    assert res.status_code == 200
    assert res.json()["default_model"]["provider"] == "openai_responses"


@pytest.mark.asyncio
async def test_delete_model_config_removes_default_block(
    config_file: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sys

    # Point .env at a throwaway file: DELETE also clears the persisted
    # OPENAI_BASE_URL, which must not touch the developer's real .env.
    settings_module = sys.modules["artemis.config.settings"]
    env_file = tmp_path / ".env"
    env_file.write_text("OPENAI_BASE_URL=http://10.0.0.5:8000/v1\n", encoding="utf-8")
    monkeypatch.setattr(settings_module, "get_env_file", lambda: env_file)
    monkeypatch.setenv("OPENAI_BASE_URL", "http://10.0.0.5:8000/v1")

    async with _client() as client:
        res = await client.delete("/api/system/model-config")
        assert res.status_code == 200

        text = config_file.read_text(encoding="utf-8")
        # The default block is gone; comments and presets survive byte-identical.
        assert '"default"' not in text
        assert "// header comment — keep this comment" in text
        assert '"presets"' in text
        assert '"model": "preset-model"' in text

        # The persisted base URL is cleared from .env as well.
        assert "http://10.0.0.5:8000/v1" not in env_file.read_text(encoding="utf-8")

        # The display list is now empty.
        list_res = await client.get("/api/system/credentials/entries")
        assert list_res.json()["rows"] == []


@pytest.mark.asyncio
async def test_delete_model_config_without_default_returns_404(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "artemis.jsonc"
    target.write_text('{\n  "presets": {}\n}\n', encoding="utf-8")
    monkeypatch.setattr("artemis.config.paths.get_config_path", lambda name: target)

    async with _client() as client:
        res = await client.delete("/api/system/model-config")

    assert res.status_code == 404
    assert target.read_text(encoding="utf-8") == '{\n  "presets": {}\n}\n'


@pytest.mark.asyncio
async def test_api_key_is_routed_by_api_format_not_label(
    config_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from artemis.config.settings import Settings

    recorded: dict = {}

    def fake_set_api_key(self, provider: str, key: str, persist_to_env: bool = False) -> None:
        recorded["api_key"] = (provider, key, persist_to_env)

    monkeypatch.setattr(Settings, "set_api_key", fake_set_api_key)

    async with _client() as client:
        res = await client.post(
            "/api/system/model-config",
            json={"provider": "deepseek", "api_format": "openai", "api_key": "sk-1"},
        )

    assert res.status_code == 200
    # The label "deepseek" is not a runtime provider; the protocol is.
    assert recorded["api_key"] == ("openai", "sk-1", True)


@pytest.mark.asyncio
async def test_update_model_config_invalid_jsonc_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "artemis.jsonc"
    target.write_text("{ not jsonc", encoding="utf-8")
    monkeypatch.setattr("artemis.config.paths.get_config_path", lambda name: target)

    async with _client() as client:
        res = await client.post("/api/system/model-config", json={"model": "m1"})

    assert res.status_code == 500
    assert target.read_text(encoding="utf-8") == "{ not jsonc"


def test_set_openai_base_url_persists_to_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sys

    from artemis.config.settings import Settings

    # artemis.config re-exports the singleton as `settings`, shadowing the
    # submodule name; resolve the real module for patching.
    settings_module = sys.modules["artemis.config.settings"]

    env_file = tmp_path / ".env"
    env_file.write_text(
        "# commented line\n# OPENAI_BASE_URL=http://old:1/v1\nOTHER=x\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(settings_module, "get_env_file", lambda: env_file)
    # setenv records the prior value so code-under-test mutations are reverted.
    monkeypatch.setenv("OPENAI_BASE_URL", "")

    s = Settings()
    s.set_openai_base_url("http://new:2/v1", persist_to_env=True)

    content = env_file.read_text(encoding="utf-8")
    assert "OPENAI_BASE_URL=http://new:2/v1" in content
    assert "http://old:1/v1" not in content
    assert "OTHER=x" in content
    assert s.OPENAI_BASE_URL == "http://new:2/v1"


def test_persist_to_env_files_upserts_multiple_keys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The shared helper replaces commented/active lines in place and appends missing keys."""
    import sys

    from artemis.config.settings import Settings

    settings_module = sys.modules["artemis.config.settings"]
    env_file = tmp_path / ".env"
    env_file.write_text(
        "OPENAI_API_KEY=stale\n# GEMINI_API_KEY=old\nOTHER=x\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(settings_module, "get_env_file", lambda: env_file)

    s = Settings()
    s.persist_env_values({"OPENAI_API_KEY": "sk-fresh", "GEMINI_API_KEY": "g-fresh"})

    content = env_file.read_text(encoding="utf-8")
    assert "OPENAI_API_KEY=sk-fresh" in content
    assert "GEMINI_API_KEY=g-fresh" in content
    assert "stale" not in content
    assert "OTHER=x" in content
