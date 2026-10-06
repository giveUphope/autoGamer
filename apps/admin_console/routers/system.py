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

"""System Readiness & Diagnostics Router for Artemis Admin Console."""

import ipaddress
import io
import json
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from artemis.core.diagnostics import readiness_engine
from artemis.core.diagnostics.adb_server_connection import (
    InvalidAdbServerEndpoint,
    adb_server_connection,
)
from artemis.core.diagnostics.schema import SystemReadinessReport

router = APIRouter(prefix="/api/system", tags=["system"])


def _require_local_admin_request(request: Request) -> None:
    """Keep endpoint probing and mutation on the local administration boundary."""
    client_host = request.client.host if request.client else None
    allow_remote = os.getenv("ARTEMIS_ALLOW_REMOTE_ADB_CONFIGURATION", "").lower() in {
        "1",
        "true",
        "yes",
    }
    if client_host and not allow_remote:
        try:
            is_loopback = ipaddress.ip_address(client_host).is_loopback
        except ValueError:
            is_loopback = client_host.lower() == "localhost"
        if not is_loopback:
            raise HTTPException(
                status_code=403,
                detail=(
                    "ADB server settings are local-only. Set "
                    "ARTEMIS_ALLOW_REMOTE_ADB_CONFIGURATION=true to manage them from another "
                    "computer."
                ),
            )

    origin = request.headers.get("origin")
    host = request.headers.get("host")
    if not origin or not host:
        return
    origin_host = urlsplit(origin).netloc.lower()
    if origin_host != host.lower():
        raise HTTPException(
            status_code=403,
            detail="ADB server settings can only be changed from the Artemis console.",
        )


def _require_loopback_request(request: Request, detail: str) -> None:
    """Reject requests whose TCP peer is not the local machine."""
    client_host = request.client.host if request.client else None
    try:
        is_loopback = bool(client_host and ipaddress.ip_address(client_host).is_loopback)
    except ValueError:
        is_loopback = bool(client_host and client_host.lower() == "localhost")
    if not is_loopback:
        raise HTTPException(status_code=403, detail=detail)


def _require_local_lifecycle_request(request: Request) -> None:
    """Authorize a process-lifecycle request from the local CLI only."""
    _require_loopback_request(request, "Server lifecycle controls are local-only.")

    expected = getattr(request.app.state, "lifecycle_token", None)
    supplied = request.headers.get("x-artemis-lifecycle-token")
    if not (
        isinstance(expected, str)
        and isinstance(supplied, str)
        and secrets.compare_digest(expected, supplied)
    ):
        raise HTTPException(status_code=403, detail="Invalid server lifecycle token.")


class SelectDeviceRequest(BaseModel):
    """Payload to select an active target Android device."""

    serial: str = Field(description="Serial number or identifier of the Android device to select")


@router.get("/readiness", response_model=SystemReadinessReport)
async def get_system_readiness(force: bool = False) -> SystemReadinessReport:
    """Execute all diagnostic probes and return a comprehensive system readiness report."""
    return await readiness_engine.run_all(force_refresh=force)


@router.post("/devices/select")
async def select_active_device(request: SelectDeviceRequest):
    """Select the active Android device or emulator for subsequent automated tasks."""
    serial = request.serial.strip()
    if not serial:
        raise HTTPException(status_code=400, detail="Device serial cannot be empty.")

    readiness_engine.set_probe_target_serial(serial)
    # Return updated readiness
    report = await readiness_engine.run_all(force_refresh=True)
    return {
        "status": "success",
        "selected_serial": serial,
        "report": report,
    }


@router.post("/adb/restart")
async def restart_adb_server():
    """Restart local ADB server and return an updated readiness check."""
    restart_result = await readiness_engine.restart_adb_server()
    readiness_engine.invalidate_cache()
    updated_report = await readiness_engine.run_all(force_refresh=True)
    return {
        "restart_result": restart_result,
        "report": updated_report,
    }


@router.post("/adb/heal-keys")
async def heal_adb_keys():
    """Auto-heal corrupted ADB authentication RSA keys and return updated readiness."""
    heal_result = await readiness_engine.heal_adb_keys()
    updated_report = await readiness_engine.run_all()
    return {
        "heal_result": heal_result,
        "report": updated_report,
    }


class ConnectAdbRequest(BaseModel):
    """Payload to connect to an Android device over Wi-Fi."""

    host: str = Field(description="IP address of Android device")
    port: int = Field(default=5555, description="Port number")


@router.post("/adb/connect")
async def connect_wireless_adb(request: ConnectAdbRequest):
    """Connect to a device over Wi-Fi and return updated readiness."""
    connect_result = await readiness_engine.connect_wireless_adb(request.host, request.port)
    readiness_engine.invalidate_cache()
    updated_report = await readiness_engine.run_all(force_refresh=True)
    return {
        "connect_result": connect_result,
        "report": updated_report,
    }


class ConnectAdbServerRequest(BaseModel):
    """Payload to select an ADB server endpoint accessible from this computer."""

    host: str = Field(description="Host name or IP address of the ADB server")
    port: int = Field(default=5037, ge=1, le=65535, description="ADB server port")
    persist: bool = Field(default=True, description="Persist the endpoint for future launches")


@router.get("/adb/server")
async def get_adb_server_status():
    """Return the process-wide ADB server endpoint currently used by Artemis."""
    return adb_server_connection.status()


@router.post("/adb/server/connect")
async def connect_adb_server(payload: ConnectAdbServerRequest, request: Request):
    """Validate and activate an ADB server endpoint."""
    _require_local_admin_request(request)
    try:
        connection_result = await adb_server_connection.connect(
            payload.host,
            payload.port,
            persist=payload.persist,
        )
    except InvalidAdbServerEndpoint as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    response: dict[str, object] = {"connection_result": connection_result}
    if connection_result["success"]:
        readiness_engine.set_probe_target_serial(None)
        readiness_engine.invalidate_cache()
        response["report"] = await readiness_engine.run_all(force_refresh=True)
    return response


@router.post("/adb/server/probe")
async def probe_adb_server(payload: ConnectAdbServerRequest, request: Request):
    """Test an ADB server endpoint without changing the active endpoint."""
    _require_local_admin_request(request)
    try:
        connection_result = await adb_server_connection.probe(payload.host, payload.port)
    except InvalidAdbServerEndpoint as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"connection_result": connection_result}


@router.post("/adb/server/local")
async def use_local_adb_server(request: Request, persist: bool = True):
    """Restore the standard local ADB server without touching a remote daemon."""
    _require_local_admin_request(request)
    connection_result = await adb_server_connection.use_local_server(persist=persist)
    readiness_engine.set_probe_target_serial(None)
    readiness_engine.invalidate_cache()
    updated_report = await readiness_engine.run_all(force_refresh=True)
    return {
        "connection_result": connection_result,
        "report": updated_report,
    }


class LaunchEmulatorRequest(BaseModel):
    """Payload to launch a local Android Virtual Device (AVD)."""

    avd_name: str = Field(
        description="Name of the installed AVD emulator to launch (e.g. Android_2)"
    )


@router.post("/emulator/launch")
async def launch_emulator(request: LaunchEmulatorRequest):
    """Launch an Android emulator in the background and return initiation status."""
    avd_name = request.avd_name.strip()
    if not avd_name:
        raise HTTPException(status_code=400, detail="AVD name cannot be empty.")

    launch_res = await readiness_engine.launch_emulator(avd_name)
    return launch_res


@router.get("/emulator/status")
async def get_emulator_status():
    """Query real-time progress and logs of background emulator launch."""
    return readiness_engine.get_emulator_status()


@router.post("/emulator/stop")
async def stop_emulator():
    """Stop active emulator process."""
    return await readiness_engine.stop_emulator()


@router.post("/emulator/dismiss")
async def dismiss_emulator():
    """Dismiss emulator launch tracking state."""
    return readiness_engine.dismiss_emulator()


class UpdateCredentialsRequest(BaseModel):
    """Payload to update and configure LLM or Vision OCR API credentials."""

    provider: str = Field(
        default="google",
        description="Provider identifier (e.g. google, gemini, openai, anthropic, openrouter, ocr)",
    )
    api_key: str = Field(description="The secret API key string to configure")
    persist_to_env: bool = Field(
        default=True, description="Whether to persist the key to .env file"
    )


class ValidateCredentialsRequest(BaseModel):
    """Payload to test and verify LLM or Vision OCR API credentials without saving."""

    provider: str = Field(
        default="google",
        description="Provider identifier (e.g. google, gemini, openai, anthropic, openrouter, ocr)",
    )
    api_key: str = Field(description="The secret API key string to test")
    base_url: str | None = Field(default=None, description="Optional custom base URL")


class UpdateModelConfigRequest(BaseModel):
    """Payload to persist default-model endpoint settings from the setup UI.

    All fields are optional; only supplied (non-blank) values are written. The
    API key is handled separately so it never lands in artemis.jsonc.
    """

    provider: str | None = Field(
        default=None,
        description="Provider identifier (openai, openrouter, anthropic, xai, google)",
    )
    model: str | None = Field(default=None, description="Model name for the default entry")
    api_base: str | None = Field(
        default=None,
        description="OpenAI-compatible API base URL (LM Studio, vLLM, DeepSeek, proxies)",
    )
    api_key: str | None = Field(
        default=None,
        description="Optional API key; blank leaves the currently configured key untouched",
    )
    thinking_level: str | None = Field(
        default=None, description="Optional thinking level (e.g. low, medium, high)"
    )


class CredentialEntryRequest(BaseModel):
    """Payload to upsert a user-defined credential binding.

    Entries pair a freely chosen environment variable name with a provider so
    credentials are managed from the UI instead of hand-editing .env.
    """

    name: str = Field(description="User-defined environment variable name (e.g. MY_LLM_KEY)")
    provider: str = Field(
        description="Provider the variable binds to (e.g. openai, google, my-provider)"
    )
    value: str | None = Field(
        default=None,
        description="Secret value; blank keeps the current value and only updates the binding",
    )


# User-defined credential variables must be syntactically valid env names and
# must not clobber variables the runtime or OS depends on.
_ENV_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_RESERVED_ENV_NAMES = {
    "PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "HOME",
    "TEMP",
    "TMP",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "SHELL",
}


@router.get("/credentials")
async def get_credentials():
    """Report which providers have an API key configured.

    Secret values never leave the process: this endpoint intentionally returns
    presence booleans only. Keys are written via POST /credentials and used
    server-side.
    """
    from artemis.config import settings

    providers = ("google", "openai", "anthropic", "openrouter", "ocr")
    status = {name: bool(settings.get_api_key(name)) for name in providers}
    status["gemini"] = status["google"]
    return {
        "providers": [
            {"name": name, "configured": configured} for name, configured in status.items()
        ]
    }


@router.post("/credentials/test")
async def test_credentials(request: ValidateCredentialsRequest):
    """Test and verify whether an API key is valid and usable with the corresponding provider endpoint."""
    from artemis.utils.credentials_validator import validate_api_key

    provider = request.provider.strip().lower()
    key = request.api_key.strip()

    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty.")

    is_valid, message = await validate_api_key(
        provider=provider,
        api_key=key,
        base_url=request.base_url,
    )
    if not is_valid:
        raise HTTPException(status_code=400, detail=message)

    return {
        "valid": True,
        "provider": provider,
        "message": message,
    }


@router.post("/credentials")
async def update_credentials(request: UpdateCredentialsRequest):
    """Dynamically configure and persist LLM or Vision API key, returning updated readiness report."""
    from artemis.utils.credentials_validator import validate_api_key

    provider = request.provider.strip().lower()
    key = request.api_key.strip()

    # If a non-empty key is provided, verify it before saving
    if key:
        is_valid, validation_msg = await validate_api_key(provider=provider, api_key=key)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"API key verification failed: {validation_msg}",
            )

    try:
        from artemis.config import settings

        settings.set_api_key(provider, key, persist_to_env=request.persist_to_env)

        # Re-run all diagnostic probes to build updated report
        readiness_engine.invalidate_cache()
        updated_report = await readiness_engine.run_all(force_refresh=True)
        action_desc = (
            "successfully verified, updated, and applied" if key else "successfully cleared"
        )
        return {
            "status": "success",
            "message": f"API key for {provider} {action_desc}.",
            "provider": provider,
            "report": updated_report,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update credentials: {exc}")


@router.get("/model-config-env")
async def get_model_config_and_env():
    """Retrieve the current active artemis.jsonc configuration and .env status for custom setup."""
    import os
    from artemis.config.paths import get_config_path, get_env_file
    from artemis.config import settings
    from third_party.mobile_use.utils.file import load_jsonc

    from artemis.config.settings import is_placeholder_key

    # 1. Config file resolution
    config_path = None
    config_content = ""
    parsed_config = {}
    try:
        config_path_obj = get_config_path("artemis.jsonc")
        config_path = str(config_path_obj)
        config_content = config_path_obj.read_text(encoding="utf-8")
        with open(config_path_obj, encoding="utf-8") as f:
            parsed_config = load_jsonc(f)
    except Exception as e:
        config_content = f"// Error reading config: {e}"

    # 2. Env file resolution
    env_path = get_env_file()

    # 3. Relevant Env Variables status
    def get_real_env_value(key_name: str, provider: str) -> str | None:
        k = settings.get_api_key(provider)
        if k and not is_placeholder_key(k):
            return k.get_secret_value()
        val = os.environ.get(key_name)
        if val and val.strip() and not is_placeholder_key(val):
            return val.strip()
        return None

    def mask_key(k: str | None) -> str | None:
        # Expose only enough to recognize which key is active, never a usable
        # fragment of the secret itself.
        if not k:
            return None
        if len(k) <= 8:
            return "****"
        return f"****{k[-4:]}"

    gemini_real = get_real_env_value("GEMINI_API_KEY", "google") or get_real_env_value(
        "GOOGLE_API_KEY", "google"
    )
    openai_real = get_real_env_value("OPENAI_API_KEY", "openai")
    anthropic_real = get_real_env_value("ANTHROPIC_API_KEY", "anthropic")
    openrouter_real = get_real_env_value("OPEN_ROUTER_API_KEY", "openrouter")
    xai_real = get_real_env_value("XAI_API_KEY", "xai")
    base_url_val = settings.OPENAI_BASE_URL or os.environ.get("OPENAI_BASE_URL")
    if base_url_val and is_placeholder_key(base_url_val):
        base_url_val = None
    ocr_real = get_real_env_value("OCR_API_KEY", "ocr") or get_real_env_value(
        "VISION_API_KEY", "ocr"
    )

    env_vars = [
        {
            "name": "GEMINI_API_KEY",
            "provider": "google",
            "is_set": bool(gemini_real),
            "preview": mask_key(gemini_real),
            "description": "Google Gemini multimodal vision API key (free tier available)",
        },
        {
            "name": "OPENAI_API_KEY",
            "provider": "openai",
            "is_set": bool(openai_real),
            "preview": mask_key(openai_real),
            "description": "OpenAI API key (GPT-4o, GPT-4o-mini)",
        },
        {
            "name": "ANTHROPIC_API_KEY",
            "provider": "anthropic",
            "is_set": bool(anthropic_real),
            "preview": mask_key(anthropic_real),
            "description": "Anthropic Claude API key (Claude 3.5 Sonnet, Claude 3.7)",
        },
        {
            "name": "OPEN_ROUTER_API_KEY",
            "provider": "openrouter",
            "is_set": bool(openrouter_real),
            "preview": mask_key(openrouter_real),
            "description": "OpenRouter unified API gateway key",
        },
        {
            "name": "XAI_API_KEY",
            "provider": "xai",
            "is_set": bool(xai_real),
            "preview": mask_key(xai_real),
            "description": "xAI Grok vision API key",
        },
        {
            "name": "OPENAI_BASE_URL",
            "provider": "custom",
            "is_set": bool(base_url_val),
            "preview": base_url_val,
            "description": "Custom API endpoint (for local Ollama, vLLM, DeepSeek, or proxies)",
        },
        {
            "name": "VISION_API_KEY",
            "provider": "ocr",
            "is_set": bool(ocr_real),
            "preview": mask_key(ocr_real),
            "description": "Google Cloud Vision OCR key for screen text detection (optional)",
        },
    ]

    return {
        "config_path": config_path or "config/artemis.jsonc",
        "config_filename": "artemis.jsonc",
        "config_content": config_content,
        "default_model": parsed_config.get("default", {}),
        "presets": parsed_config.get("presets", {}),
        "env_path": str(env_path),
        "env_filename": ".env",
        "env_vars": env_vars,
    }


def _update_jsonc_default_block(config_path: Path, updates: dict[str, str]) -> dict:
    """Surgically update keys inside the top-level ``"default"`` object of a JSONC file.

    Comment-preserving by design: only matched ``"key": value`` spans are
    rewritten, so comments and formatting elsewhere survive the edit; missing
    keys are inserted at the top of the block. Returns the reparsed
    ``default`` object and raises ``ValueError`` when the file has no
    ``default`` object or the edit would produce invalid JSONC (the file is
    left untouched in that case).
    """
    from third_party.mobile_use.utils.file import load_jsonc

    original = config_path.read_text(encoding="utf-8")
    match = re.search(r'"default"\s*:\s*\{', original)
    if not match:
        raise ValueError(f'No "default" object found in {config_path}')

    # Brace-match the "default" object, honouring string literals so braces in
    # comments or values cannot derail the scan.
    depth = 1
    in_string = False
    escaped = False
    cursor = match.end()
    while cursor < len(original) and depth > 0:
        ch = original[cursor]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        cursor += 1
    if depth != 0:
        raise ValueError(f'Unbalanced braces in the "default" object of {config_path}')

    block_start, block_end = match.end(), cursor - 1
    block = original[block_start:block_end]

    for key, value in updates.items():
        encoded = json.dumps(value)
        pattern = re.compile(rf'("{re.escape(key)}"\s*:\s*)("[^"]*"|[^,}}]+)')
        if pattern.search(block):
            block = pattern.sub(lambda m: f"{m.group(1)}{encoded}", block, count=1)
        elif block.strip():
            # Insert after the opening brace, ahead of the existing keys.
            block = f'\n    "{key}": {encoded},' + block
        else:
            block = f'\n    "{key}": {encoded}\n  '

    candidate = original[:block_start] + block + original[block_end:]
    try:
        parsed = load_jsonc(io.StringIO(candidate))
    except Exception as exc:
        raise ValueError(f"Editing the default block produced invalid JSONC: {exc}") from exc
    config_path.write_text(candidate, encoding="utf-8")
    return parsed.get("default", {})


def _read_jsonc_default(config_path: Path) -> dict:
    """Best-effort reparse of artemis.jsonc to echo the current default model."""
    from third_party.mobile_use.utils.file import load_jsonc

    try:
        with open(config_path, encoding="utf-8") as f:
            return load_jsonc(f).get("default", {})
    except Exception:  # pylint: disable=broad-exception-caught
        return {}


@router.post("/model-config")
async def update_model_config(request: UpdateModelConfigRequest):
    """Persist default-model endpoint settings so users never edit config files by hand.

    Writes go to the two places the runtime actually reads: the ``"default"``
    block of artemis.jsonc (its api_base takes precedence over OPENAI_BASE_URL
    at routing time) and, when an api_key is supplied, the provider credential
    store with .env persistence. Unlike POST /credentials this never hard-fails
    on key verification — custom endpoints (LM Studio, vLLM, proxies) cannot be
    validated against a cloud vendor — so callers use POST /credentials/test
    for explicit checks.
    """
    from artemis.config import settings
    from artemis.config.paths import get_config_path

    updates: dict[str, str] = {}
    for field in ("provider", "model", "api_base", "thinking_level"):
        value = getattr(request, field)
        if value and value.strip():
            updates[field] = value.strip()
    api_key = (request.api_key or "").strip()

    if not updates and not api_key:
        raise HTTPException(status_code=400, detail="No model configuration changes supplied.")

    api_base = updates.get("api_base")
    if api_base and not api_base.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="api_base must start with http:// or https://")

    try:
        config_path = get_config_path("artemis.jsonc")
        if updates:
            _update_jsonc_default_block(config_path, updates)
        if api_key:
            settings.set_api_key(updates.get("provider") or "openai", api_key, persist_to_env=True)
        if api_base:
            settings.set_openai_base_url(api_base, persist_to_env=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update model config: {exc}")

    readiness_engine.invalidate_cache()
    return {
        "status": "success",
        "message": "Model endpoint configuration saved and applied.",
        "provider": updates.get("provider"),
        "default_model": _read_jsonc_default(config_path),
    }


def _mask_secret(k: str | None) -> str | None:
    """Expose only enough of a secret to recognize it, never a usable fragment."""
    if not k:
        return None
    if len(k) <= 8:
        return "****"
    return f"****{k[-4:]}"


def _read_credential_bindings() -> list[dict]:
    """Load the user-defined name→provider bindings; missing file means empty."""
    from artemis.config.paths import get_credentials_bindings_file

    try:
        with open(get_credentials_bindings_file(), encoding="utf-8") as f:
            data = json.load(f)
        entries = data.get("entries", []) if isinstance(data, dict) else []
        return [e for e in entries if isinstance(e, dict)]
    except FileNotFoundError:
        return []
    except Exception:  # pylint: disable=broad-exception-caught
        return []


def _write_credential_bindings(entries: list[dict]) -> None:
    from artemis.config.paths import get_credentials_bindings_file

    path = get_credentials_bindings_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"entries": entries}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


@router.get("/credentials/entries")
async def list_credential_entries():
    """List user-defined credential bindings with masked value previews."""
    from artemis.config.paths import get_credentials_bindings_file
    from artemis.config.settings import is_placeholder_key

    entries = []
    for entry in _read_credential_bindings():
        name = str(entry.get("name") or "").strip()
        provider = str(entry.get("provider") or "").strip()
        if not name:
            continue
        raw = os.environ.get(name)
        if raw and is_placeholder_key(raw):
            raw = None
        entries.append(
            {
                "name": name,
                "provider": provider,
                "is_set": bool(raw),
                "preview": _mask_secret(raw),
            }
        )
    return {"entries": entries, "bindings_path": str(get_credentials_bindings_file())}


@router.post("/credentials/entries")
async def upsert_credential_entry(request: CredentialEntryRequest):
    """Create or update a user-defined credential binding.

    The secret is written to .env under the user-chosen variable name and the
    name→provider mapping is recorded in credential_bindings.json, which is
    replayed at startup so custom names feed the runtime credential store.
    Known providers additionally take effect immediately in this session.
    """
    from artemis.config import settings

    name = request.name.strip()
    provider = request.provider.strip()
    value = (request.value or "").strip()

    if not _ENV_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid variable name: use letters, digits and underscores, starting with a letter or underscore.",
        )
    if name.upper() in _RESERVED_ENV_NAMES or name.upper().startswith("ARTEMIS_"):
        raise HTTPException(status_code=400, detail=f"'{name}' is a reserved variable name.")
    if not provider:
        raise HTTPException(status_code=400, detail="Provider is required.")

    try:
        if value:
            settings.persist_env_values({name: value})
            os.environ[name] = value
            # Known providers take effect in this session immediately; custom
            # names keep working across restarts via the bindings file.
            settings.set_api_key(provider, value, persist_to_env=False)

        entries = [e for e in _read_credential_bindings() if str(e.get("name")) != name]
        entries.append({"name": name, "provider": provider})
        _write_credential_bindings(entries)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save credential entry: {exc}")

    readiness_engine.invalidate_cache()
    return {
        "status": "success",
        "message": f"Credential '{name}' saved.",
        "name": name,
        "provider": provider,
    }


@router.delete("/credentials/entries/{name}")
async def delete_credential_entry(name: str):
    """Remove a user-defined credential binding from .env and the bindings file."""
    from artemis.config import settings

    trimmed = name.strip()
    try:
        settings.remove_env_values([trimmed])
        entries = [e for e in _read_credential_bindings() if str(e.get("name")) != trimmed]
        _write_credential_bindings(entries)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete credential entry: {exc}")

    readiness_engine.invalidate_cache()
    return {"status": "success", "message": f"Credential '{trimmed}' removed."}


@router.get("/server-status")
async def get_server_runtime_status():
    """Retrieve runtime status, PID, port, and uptime of the Artemis server.

    Answers from in-process state. ``server_lifecycle.get_server_status`` is
    not used here: it runs ``lsof``/``fuser``, which can take over a second and
    is too slow for the ``is_artemis_daemon`` probe.
    """
    import os
    import time

    from artemis.runtime.process_probe import pid_is_alive
    from artemis.runtime.server_lifecycle import read_server_info

    try:
        from apps.admin_console.core.state import state
    except ImportError:
        from admin_console.core.state import state

    port = getattr(state, "port", 8000)
    current_pid = os.getpid()
    pids = {current_pid}
    started_at = None

    info = read_server_info()
    if info and info.get("port") == port:
        saved_pid = info.get("pid")
        if isinstance(saved_pid, int) and saved_pid != current_pid and pid_is_alive(saved_pid):
            pids.add(saved_pid)
        if isinstance(info.get("started_at"), (int, float)):
            started_at = float(info["started_at"])
    if started_at is None:
        try:
            import psutil

            started_at = psutil.Process(current_pid).create_time()
        except Exception:  # pylint: disable=broad-exception-caught
            # psutil is optional; uptime is best-effort.
            started_at = None

    uptime_seconds = max(0.0, time.time() - started_at) if started_at is not None else None
    # Explicit DTO: the raw metadata file additionally holds the lifecycle
    # token, cmdline, and filesystem paths, none of which belong on the wire.
    return {
        "running": True,
        "port": port,
        "pids": sorted(pids),
        "active_pid": current_pid,
        "uptime_seconds": uptime_seconds,
        "url": f"http://localhost:{port}",
        "admin_url": f"http://localhost:{port}/admin",
        "current_pid": current_pid,
    }


@router.post("/restart")
async def restart_server_endpoint(request: Request):
    """Request a graceful restart of the Artemis server from thin clients/UI."""
    import asyncio
    import os
    import sys
    import threading

    _require_loopback_request(request, "Server lifecycle controls are local-only.")

    try:
        from apps.admin_console.core.state import state
    except ImportError:
        from admin_console.core.state import state

    port = getattr(state, "port", 8000)
    current_pid = os.getpid()

    def _restart_worker():
        import time

        time.sleep(0.6)
        if sys.platform != "win32":
            try:
                os.execv(sys.executable, [sys.executable] + sys.argv)
            except Exception:
                import subprocess

                subprocess.Popen([sys.executable] + sys.argv)
                os._exit(0)
        else:
            import subprocess

            subprocess.Popen([sys.executable] + sys.argv)
            os._exit(0)

    threading.Thread(target=_restart_worker, daemon=True).start()

    return {
        "status": "restarting",
        "message": "Artemis server is restarting. Client reconnection should occur in 2-3 seconds.",
        "previous_pid": current_pid,
        "port": port,
    }


@router.post("/shutdown", status_code=202)
async def shutdown_server_endpoint(request: Request):
    """Request a graceful shutdown of the Artemis server."""
    import asyncio

    try:
        from apps.admin_console.core.state import state
    except ImportError:
        from admin_console.core.state import state

    _require_local_lifecycle_request(request)
    server = getattr(request.app.state, "uvicorn_server", None)
    if server is None:
        raise HTTPException(status_code=503, detail="Server lifecycle controller is unavailable.")

    async def _shutdown_after_response() -> None:
        # Let Starlette flush the accepted response before Uvicorn leaves its
        # main loop and invokes the FastAPI shutdown lifecycle.
        await asyncio.sleep(0.05)
        state.is_shutting_down = True
        state.shutdown_event.set()
        server.should_exit = True

    asyncio.create_task(_shutdown_after_response())

    return {
        "status": "shutting_down",
        "message": "Artemis server is shutting down.",
        "pid": os.getpid(),
    }
