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

import json
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
  "nodes": {
    "planner": { "model": "sibling-model" }
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
    assert '"model": "sibling-model"' in text


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
        # The default block is gone; comments and the sibling section survive byte-identical.
        assert '"default"' not in text
        assert "// header comment — keep this comment" in text
        assert '"nodes"' in text
        assert '"model": "sibling-model"' in text

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
    target.write_text('{\n  "nodes": {}\n}\n', encoding="utf-8")
    monkeypatch.setattr("artemis.config.paths.get_config_path", lambda name: target)

    async with _client() as client:
        res = await client.delete("/api/system/model-config")

    assert res.status_code == 404
    assert target.read_text(encoding="utf-8") == '{\n  "nodes": {}\n}\n'


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


# ---------------------------------------------------------------------------
# 端点库与选用（/endpoints/use）：库里保存过的记录是唯一来源
# ---------------------------------------------------------------------------

ENDPOINT_JSONC = """{
  // keep me
  "default": {
    "provider": "openai",
    "model": "local-model",
    "api_base": "http://127.0.0.1:1234/v1",
    "api_key": "stale-local-key",
    "thinking_level": "medium",
    "fallback": {
      "provider": "openai",
      "model": "local-model"
    }
  },
  "nodes": {
    // sibling section the default-block editor must never reach into
    "planner": { "model": "sibling-model" }
  }
}
"""


@pytest.fixture
def endpoint_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A jsonc with a live default endpoint plus a sibling section to protect."""
    target = tmp_path / "artemis.jsonc"
    target.write_text(ENDPOINT_JSONC, encoding="utf-8")
    monkeypatch.setattr("artemis.config.paths.get_config_path", lambda name: target)
    return target


def _write_library(path: Path, *records: dict) -> None:
    """Seed the endpoint library the way a hand edit of the file would."""
    path.write_text(json.dumps({"endpoints": list(records)}, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def credential_writes(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Record credential/base-URL writes instead of touching the developer's .env."""
    from artemis.config.settings import Settings

    recorded: dict = {}

    def fake_set_api_key(self, provider: str, key: str, persist_to_env: bool = False) -> None:
        recorded["api_key"] = (provider, key, persist_to_env)

    def fake_set_base_url(self, base_url: str | None, persist_to_env: bool = True) -> None:
        recorded["base_url"] = (base_url, persist_to_env)

    monkeypatch.setattr(Settings, "set_api_key", fake_set_api_key)
    monkeypatch.setattr(Settings, "set_openai_base_url", fake_set_base_url)
    return recorded


@pytest.mark.asyncio
async def test_use_endpoint_applies_saved_record(
    endpoint_config: Path, credential_writes: dict, isolated_endpoint_library: Path
) -> None:
    _write_library(
        isolated_endpoint_library,
        {
            "name": "mine",
            "api_format": "openai",
            "api_base": "http://127.0.0.1:1234/v1",
            "model": "qwen-vl",
        },
    )

    async with _client() as client:
        res = await client.post("/api/system/endpoints/use", json={"name": "mine"})

    assert res.status_code == 200
    dm = res.json()["default_model"]
    assert dm["provider"] == "openai"
    assert dm["model"] == "qwen-vl"
    assert dm["provider_label"] == "mine"
    assert dm["api_base"] == "http://127.0.0.1:1234/v1"
    # 库里不存密钥：这次切换只该把 jsonc 里那条清掉，不该写凭据存储
    assert "api_key" not in dm
    assert "api_key" not in credential_writes
    assert credential_writes["base_url"] == ("http://127.0.0.1:1234/v1", True)
    text = endpoint_config.read_text(encoding="utf-8")
    assert "// keep me" in text
    assert "stale-local-key" not in text
    # 记录没声明 fallback，旧的整条（连嵌套体）必须一起消失，否则它会继续指着
    # 上一家的模型；兄弟区块不许被顺手改写。
    assert "local-model" not in text.split('"nodes"')[0]
    assert '"model": "sibling-model"' in text


@pytest.mark.asyncio
async def test_use_endpoint_clears_endpoint_owned_fields_the_record_lacks(
    endpoint_config: Path, credential_writes: dict, isolated_endpoint_library: Path
) -> None:
    """A cloud record must not inherit the local base URL that outranks .env."""
    _write_library(
        isolated_endpoint_library,
        {"name": "cloud", "api_format": "google", "model": "gemini-2.5-flash"},
    )

    async with _client() as client:
        res = await client.post("/api/system/endpoints/use", json={"name": "cloud"})

    assert res.status_code == 200
    dm = res.json()["default_model"]
    assert dm["provider"] == "google"
    assert dm["model"] == "gemini-2.5-flash"
    assert "api_base" not in dm
    assert "api_key" not in dm
    assert "fallback" not in dm
    # Reasoning knobs are not endpoint-owned, so they survive the switch.
    assert dm["thinking_level"] == "medium"
    assert credential_writes["base_url"] == (None, True)
    assert '"api_key": "stale-local-key"' not in endpoint_config.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_use_endpoint_unknown_name_leaves_config_untouched(
    endpoint_config: Path, credential_writes: dict, isolated_endpoint_library: Path
) -> None:
    _write_library(
        isolated_endpoint_library, {"name": "mine", "api_format": "openai", "model": "m"}
    )

    async with _client() as client:
        res = await client.post("/api/system/endpoints/use", json={"name": "no-such-endpoint"})

    assert res.status_code == 404
    assert "mine" in res.json()["detail"]
    assert endpoint_config.read_text(encoding="utf-8") == ENDPOINT_JSONC
    assert credential_writes == {}


@pytest.mark.asyncio
async def test_use_endpoint_requires_format_and_model(
    endpoint_config: Path, credential_writes: dict, isolated_endpoint_library: Path
) -> None:
    _write_library(isolated_endpoint_library, {"name": "broken", "api_format": "google"})

    async with _client() as client:
        res = await client.post("/api/system/endpoints/use", json={"name": "broken"})

    assert res.status_code == 400
    assert endpoint_config.read_text(encoding="utf-8") == ENDPOINT_JSONC


@pytest.mark.asyncio
async def test_use_endpoint_blank_name_is_rejected(endpoint_config: Path) -> None:
    async with _client() as client:
        res = await client.post("/api/system/endpoints/use", json={"name": "  "})

    assert res.status_code == 400


@pytest.mark.asyncio
async def test_model_config_env_never_ships_raw_keys(endpoint_config: Path) -> None:
    """The card and the config viewer read presence, not the secret itself."""
    async with _client() as client:
        res = await client.get("/api/system/model-config-env")

    assert res.status_code == 200
    data = res.json()
    assert "api_key" not in data["default_model"]
    assert data["default_model"]["model"] == "local-model"
    # 厂商预设已从配置文件与响应契约一起退场：端点库是唯一来源
    assert "presets" not in data
    # The raw-JSONC viewer is masked too: it shows structure, not secrets.
    assert "stale-local-key" not in data["config_content"]
    assert '"api_key": "****-key"' in data["config_content"]


@pytest.mark.asyncio
async def test_saving_named_endpoints_builds_the_library(
    endpoint_config: Path,
    credential_writes: dict,
    isolated_endpoint_library: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A named save is what "已保存" means: one record per name, order kept."""
    from pydantic import SecretStr

    from artemis.config import settings as settings_obj

    # The key column resolves through the credential store by protocol, so pin
    # what the store holds rather than depending on the developer's real .env.
    monkeypatch.setattr(settings_obj, "OPENAI_API_KEY", SecretStr("sk-live-9876"))

    async with _client() as client:
        await client.post(
            "/api/system/model-config",
            json={
                "provider": "deepseek",
                "api_format": "openai",
                "model": "deepseek-vl",
                "api_base": "https://api.deepseek.example/v1",
                "api_key": "sk-deepseek-1",
            },
        )
        res = await client.post(
            "/api/system/model-config",
            json={
                "provider": "my-gateway",
                "api_format": "openai",
                "model": "gateway-1",
                "api_base": "https://gateway.example/v1",
            },
        )
        assert res.status_code == 200
        entries = await client.get("/api/system/credentials/entries")

    rows = entries.json()["rows"]
    assert [(r["provider"], r["model"], r["is_active"], r["source"]) for r in rows] == [
        ("deepseek", "deepseek-vl", False, "library"),
        ("my-gateway", "gateway-1", True, "library"),
    ]
    # Both records speak the openai protocol, so both show the store's key for
    # it — masked, and never read back out of the library file.
    assert rows[0]["api_key"] == "****9876"
    assert rows[1]["api_key"] == "****9876"
    assert "sk-live-9876" not in entries.text
    stored = json.loads(isolated_endpoint_library.read_text(encoding="utf-8"))
    assert [e["name"] for e in stored["endpoints"]] == ["deepseek", "my-gateway"]
    assert all("api_key" not in e for e in stored["endpoints"])


@pytest.mark.asyncio
async def test_resaving_same_name_updates_record_instead_of_duplicating(
    endpoint_config: Path, credential_writes: dict, isolated_endpoint_library: Path
) -> None:
    async with _client() as client:
        for model in ("v1", "v2"):
            res = await client.post(
                "/api/system/model-config",
                json={"provider": "mine", "api_format": "openai", "model": model},
            )
            assert res.status_code == 200
        entries = await client.get("/api/system/credentials/entries")

    rows = entries.json()["rows"]
    assert len(rows) == 1
    assert rows[0]["model"] == "v2"


@pytest.mark.asyncio
async def test_use_endpoint_clears_fallback_the_record_never_declared(
    endpoint_config: Path, credential_writes: dict
) -> None:
    """A saved endpoint without a fallback must not inherit the previous vendor's."""
    async with _client() as client:
        await client.post(
            "/api/system/model-config",
            json={"provider": "plain", "api_format": "openai", "model": "m-plain"},
        )
        res = await client.post("/api/system/endpoints/use", json={"name": "plain"})

    dm = res.json()["default_model"]
    assert dm["model"] == "m-plain"
    assert "fallback" not in dm
    # Reasoning knobs are still not endpoint-owned, so they survive.
    assert dm["thinking_level"] == "medium"


@pytest.mark.asyncio
async def test_delete_endpoint_removes_record_and_keeps_live_default_visible(
    endpoint_config: Path, credential_writes: dict
) -> None:
    async with _client() as client:
        await client.post(
            "/api/system/model-config",
            json={"provider": "first", "api_format": "openai", "model": "m1"},
        )
        await client.post(
            "/api/system/model-config",
            json={"provider": "second", "api_format": "openai", "model": "m2"},
        )
        res = await client.delete("/api/system/endpoints/second")
        entries = await client.get("/api/system/credentials/entries")

    assert res.status_code == 200
    rows = entries.json()["rows"]
    # The record is gone, but the endpoint the runtime still uses is not hidden.
    assert [(r["provider"], r["is_active"], r["source"]) for r in rows] == [
        ("second", True, "default"),
        ("first", False, "library"),
    ]


@pytest.mark.asyncio
async def test_delete_endpoint_unknown_name_returns_404(
    endpoint_config: Path, credential_writes: dict
) -> None:
    async with _client() as client:
        res = await client.delete("/api/system/endpoints/ghost")

    assert res.status_code == 404
    assert "ghost" in res.json()["detail"]


def test_default_block_removal_of_last_entry_keeps_jsonc_valid(tmp_path: Path) -> None:
    """The final entry owns no comma; the edit must take the previous one too."""
    from apps.admin_console.routers.system import _update_jsonc_default_block

    target = tmp_path / "artemis.jsonc"
    target.write_text(
        '{\n  "default": {\n    "provider": "openai",\n    "api_key": "stale"\n  }\n}\n',
        encoding="utf-8",
    )

    out = _update_jsonc_default_block(target, {"model": "m"}, removals=("api_key", "api_base"))

    assert out == {"provider": "openai", "model": "m"}
    assert '"api_key"' not in target.read_text(encoding="utf-8")


def test_default_block_edits_only_depth_one_keys(tmp_path: Path) -> None:
    """A key that also appears inside ``fallback`` must not be touched."""
    from apps.admin_console.routers.system import _update_jsonc_default_block

    target = tmp_path / "artemis.jsonc"
    target.write_text(
        '{\n  "default": {\n    "model": "outer",\n'
        '    "fallback": { "model": "inner" } // trailing note\n'
        "  }\n}\n",
        encoding="utf-8",
    )

    out = _update_jsonc_default_block(target, {"model": "next"})

    assert out["model"] == "next"
    assert out["fallback"] == {"model": "inner"}
    text = target.read_text(encoding="utf-8")
    assert '"model": "outer"' not in text
    assert "// trailing note" in text
