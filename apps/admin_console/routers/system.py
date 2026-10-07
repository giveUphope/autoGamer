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
    ``provider`` is a user-defined display name (e.g. deepseek, my-gateway)
    stored as ``provider_label``; the wire protocol arrives via ``api_format``
    and drives the runtime's provider dispatch (jsonc ``provider`` key).
    """

    provider: str | None = Field(
        default=None,
        description="User-defined provider name, stored as provider_label (display only)",
    )
    api_format: str | None = Field(
        default=None,
        description="Wire protocol for runtime dispatch (openai, openrouter, anthropic, xai, google, ollama, vllm, custom)",
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


# Wire protocols the runtime dispatches on (ModelProvider.from_string). The UI
# exposes a subset, but every value accepted here must survive config parsing.
_ALLOWED_API_FORMATS = {
    "openai",
    "openai_responses",
    "openrouter",
    "anthropic",
    "xai",
    "google",
    "ollama",
    "vllm",
    "custom",
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
        config_content = _mask_jsonc_secrets(config_path_obj.read_text(encoding="utf-8"))
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
        "default_model": _without_secrets(parsed_config.get("default", {})),
        "env_path": str(env_path),
        "env_filename": ".env",
        "env_vars": env_vars,
    }


def _read_jsonc_string(text: str, start: int) -> tuple[str, int]:
    """Return the string literal opened at ``start`` and the index past its close quote."""
    i = start + 1
    out: list[str] = []
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            out.append(text[i : i + 2])
            i += 2
            continue
        if ch == '"':
            return "".join(out), i + 1
        out.append(ch)
        i += 1
    return "".join(out), i


def _skip_jsonc_value(text: str, i: int) -> int:
    """Return the index just past the JSON value that starts at ``i``."""
    n = len(text)
    if i >= n:
        return i
    if text[i] in "{[":
        depth = 0
        while i < n:
            ch = text[i]
            if ch == '"':
                _, i = _read_jsonc_string(text, i)
                continue
            if ch in "{[":
                depth += 1
            elif ch in "}]":
                depth -= 1
                if depth == 0:
                    return i + 1
            i += 1
        return i
    if text[i] == '"':
        _, i = _read_jsonc_string(text, i)
        return i
    while i < n:
        ch = text[i]
        if ch in ",}\n":
            break
        if ch == "/" and i + 1 < n and text[i + 1] in "/*":
            break
        i += 1
    return i


def _scan_jsonc_object_entries(body: str) -> list[tuple[str, int, int, int]]:
    """Enumerate the depth-1 ``"key": value`` entries of a JSONC object body.

    Yields ``(key, key_start, value_start, value_end)``. Nested objects, string
    literals and comments are skipped as opaque text, so a key that only exists
    inside ``"fallback"`` is never reported as a top-level one.
    """
    entries: list[tuple[str, int, int, int]] = []
    i = 0
    n = len(body)
    while i < n:
        ch = body[i]
        if ch in " \t\r\n,":
            i += 1
            continue
        if ch == "/" and i + 1 < n and body[i + 1] == "/":
            newline = body.find("\n", i)
            i = n if newline == -1 else newline + 1
            continue
        if ch == "/" and i + 1 < n and body[i + 1] == "*":
            end = body.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch != '"':
            break
        key_start = i
        key, i = _read_jsonc_string(body, key_start)
        while i < n and body[i] in " \t\r\n":
            i += 1
        if i >= n or body[i] != ":":
            break
        i += 1
        while i < n and body[i] in " \t\r\n":
            i += 1
        value_start = i
        value_end = _skip_jsonc_value(body, value_start)
        entries.append((key, key_start, value_start, value_end))
        i = value_end
    return entries


def _update_jsonc_default_block(
    config_path: Path,
    updates: dict[str, object],
    removals: tuple[str, ...] = (),
) -> dict:
    """Set and clear keys inside the top-level ``"default"`` object of a JSONC file.

    Comment-preserving by design: only matched value spans are rewritten and a
    removed key is cut out whole, so comments and formatting elsewhere survive
    the edit; missing keys are inserted at the top of the block. Values are
    replaced as whole spans, so a nested ``fallback`` object can be swapped for
    another endpoint's fallback instead of corrupting the block. Returns the
    reparsed ``default`` object and raises ``ValueError`` when the file has no
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
    entries = {key: (ks, vs, ve) for key, ks, vs, ve in _scan_jsonc_object_entries(block)}
    ops: list[tuple[int, int, str]] = []

    for key in removals:
        found = entries.get(key)
        if not found:
            continue
        key_start, _, value_end = found
        trailing = re.match(r"[ \t\r\n]*,", block[value_end:])
        if trailing:
            # Take the entry's own comma, plus the line break and indent that
            # only existed to put that entry on its own line.
            cut_end = value_end + trailing.end()
            prefix = block[:key_start]
            collapsed = re.sub(r"[ \t]*\n[ \t]*$", "\n", prefix)
            cut_from = len(collapsed) - 1 if collapsed.endswith("\n") else key_start
        else:
            # Last entry of the block: the comma that keeps the JSON valid
            # belongs to the entry before it.
            cut_from = key_start
            cut_end = value_end
            head = block[:key_start].rstrip()
            if head.endswith(","):
                cut_from = len(head) - 1
        ops.append((cut_from, cut_end, ""))

    for key, value in updates.items():
        encoded = json.dumps(value, ensure_ascii=False)
        found = entries.get(key)
        if found:
            _, value_start, value_end = found
            ops.append((value_start, value_end, encoded))
        else:
            ops.append((0, 0, f'\n    "{key}": {encoded},'))

    new_block = block
    for start, end, text in sorted(ops, key=lambda op: op[0], reverse=True):
        new_block = new_block[:start] + text + new_block[end:]
    if not entries:
        new_block = re.sub(r",\s*$", "", new_block.rstrip()) + "\n  "

    candidate = original[:block_start] + new_block + original[block_end:]
    try:
        parsed = load_jsonc(io.StringIO(candidate))
    except Exception as exc:
        raise ValueError(f"Editing the default block produced invalid JSONC: {exc}") from exc
    config_path.write_text(candidate, encoding="utf-8")
    return parsed.get("default", {})


def _without_secrets(entry: object) -> object:
    """Drop credential fields from a config block headed for the browser.

    The raw key never needs to render: the endpoint table shows the masked
    preview from the credential store instead. Presets carry placeholder keys
    (``lm-studio``) that are no different in kind.
    """
    if isinstance(entry, dict):
        return {k: v for k, v in entry.items() if k not in ("api_key", "api_key_env")}
    return entry


def _read_jsonc_section(config_path: Path, section: str) -> dict:
    """Best-effort read of one top-level object of artemis.jsonc."""
    from third_party.mobile_use.utils.file import load_jsonc

    try:
        with open(config_path, encoding="utf-8") as f:
            value = load_jsonc(f).get(section, {})
    except Exception:  # pylint: disable=broad-exception-caught
        return {}
    return value if isinstance(value, dict) else {}


def _read_jsonc_default(config_path: Path) -> dict:
    """Best-effort reparse of artemis.jsonc to echo the current default model."""
    return _read_jsonc_section(config_path, "default")


# Sentinel: the caller says nothing about OPENAI_BASE_URL, so .env is left alone.
_ENV_BASE_UNCHANGED = object()


def _apply_default_endpoint(
    config_path: Path,
    updates: dict[str, object],
    *,
    removals: tuple[str, ...] = (),
    api_key: str = "",
    api_key_protocol: str | None = None,
    env_base_url: object = _ENV_BASE_UNCHANGED,
) -> None:
    """Write one endpoint into every place the runtime reads it from.

    Shared by the endpoint form and the preset chooser so both land the same
    three writes: the jsonc ``default`` block, the provider credential store,
    and ``OPENAI_BASE_URL``. The key is routed by wire protocol, never by the
    display label (unknown providers are no-ops in ``set_api_key`` and the key
    would be dropped), and it is resolved after the block is written so an
    omitted ``api_format`` picks up the protocol just saved.
    """
    from artemis.config import settings

    try:
        if updates or removals:
            _update_jsonc_default_block(config_path, updates, removals=removals)
        if api_key:
            protocol = api_key_protocol or str(
                _read_jsonc_default(config_path).get("provider") or "openai"
            )
            settings.set_api_key(protocol, api_key, persist_to_env=True)
        if env_base_url is not _ENV_BASE_UNCHANGED:
            settings.set_openai_base_url(str(env_base_url or "") or None, persist_to_env=True)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to update model config: {exc}"
        ) from exc


@router.post("/model-config")
async def update_model_config(request: UpdateModelConfigRequest):
    """Persist default-model endpoint settings so users never edit config files by hand.

    Writes go to the two places the runtime actually reads: the ``"default"``
    block of artemis.jsonc (its api_base takes precedence over OPENAI_BASE_URL
    at routing time) and, when an api_key is supplied, the provider credential
    store with .env persistence. The wire protocol (``api_format``) becomes the
    jsonc ``provider`` the runtime dispatches on; the user-defined provider
    name is stored alongside as ``provider_label`` (ignored by the runtime,
    surfaced in the UI). Unlike POST /credentials this never hard-fails on key
    verification — custom endpoints (LM Studio, vLLM, proxies) cannot be
    validated against a cloud vendor — so callers use POST /credentials/test
    for explicit checks.
    """
    from artemis.config.paths import get_config_path

    updates: dict[str, str] = {}
    for field in ("model", "api_base", "thinking_level"):
        value = getattr(request, field)
        if value and value.strip():
            updates[field] = value.strip()

    api_format = (request.api_format or "").strip().lower()
    if api_format:
        if api_format not in _ALLOWED_API_FORMATS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported api_format {api_format!r}. Valid formats: {sorted(_ALLOWED_API_FORMATS)}",
            )
        updates["provider"] = api_format
    provider_label = (request.provider or "").strip()
    if provider_label:
        updates["provider_label"] = provider_label

    api_key = (request.api_key or "").strip()

    if not updates and not api_key:
        raise HTTPException(status_code=400, detail="No model configuration changes supplied.")

    api_base = updates.get("api_base")
    if api_base and not api_base.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="api_base must start with http:// or https://")

    config_path = get_config_path("artemis.jsonc")
    _apply_default_endpoint(
        config_path,
        updates,
        api_key=api_key,
        api_key_protocol=api_format or None,
        env_base_url=api_base if api_base else _ENV_BASE_UNCHANGED,
    )

    # A named endpoint is also a library record: saving from the form is what
    # "已保存" means, and the record mirrors the block that was just written so
    # the two can never disagree about which endpoint is live.
    if provider_label:
        saved = _read_jsonc_default(config_path)
        _upsert_endpoint_record(
            _endpoint_record(
                provider_label,
                str(saved.get("provider") or ""),
                str(saved.get("api_base") or ""),
                str(saved.get("model") or ""),
            )
        )

    readiness_engine.invalidate_cache()
    return {
        "status": "success",
        "message": "Model endpoint configuration saved and applied.",
        "provider": updates.get("provider_label"),
        "default_model": _without_secrets(_read_jsonc_default(config_path)),
    }


# Fields of the ``default`` block that belong to whichever endpoint is active.
# The runtime reads them straight out of artemis.jsonc (services/llm.py), and
# its ``api_base`` outranks OPENAI_BASE_URL, so a leftover value here keeps
# pointing at the previous provider even after the model name has changed.
# ``fallback`` is in this set because it names a provider and a model too: a
# record that declares no fallback must not inherit one that points at the
# endpoint being replaced.
_ENDPOINT_OWNED_KEYS = ("api_base", "api_key", "api_key_env", "fallback")


class UseEndpointRequest(BaseModel):
    """Selects an endpoint to make the one the runtime uses."""

    name: str = Field(
        ...,
        description="Endpoint library record name to make the active default",
    )


def _text_field(source: dict, key: str) -> str:
    """Non-blank string value of ``key`` — records store blanks as absent."""
    return str(source.get(key) or "").strip()


@router.post("/endpoints/use")
async def use_endpoint(request: UseEndpointRequest):
    """Make a saved endpoint library record the active model configuration.

    The record is read server-side, so a library edited by hand takes effect
    without a restart and no key is involved in the request at all. Endpoint-owned
    fields the record does not declare are cleared rather than inherited (see
    ``_ENDPOINT_OWNED_KEYS``): the jsonc ``api_base`` outranks
    ``OPENAI_BASE_URL``, so a leftover local URL would keep pointing a cloud
    endpoint at 127.0.0.1, and a stale ``fallback`` would name the vendor being
    replaced. Reasoning knobs such as ``thinking_level`` are left alone — they
    describe how the agent thinks, not which endpoint answers.
    """
    from artemis.config.paths import get_config_path

    name = (request.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="An endpoint name is required.")

    records = _read_endpoint_library()
    record = next((r for r in records if _text_field(r, "name") == name), None)
    if record is None:
        saved = sorted(_text_field(r, "name") for r in records)
        raise HTTPException(
            status_code=404,
            detail=f"Unknown endpoint {name!r}. Saved endpoints: {saved}",
        )

    provider = _text_field(record, "api_format")
    model = _text_field(record, "model")
    if not provider or not model:
        raise HTTPException(
            status_code=400, detail=f"Endpoint {name!r} needs both an API format and a model."
        )

    updates: dict[str, object] = {"provider": provider, "model": model, "provider_label": name}
    for field in ("api_base", "thinking_level"):
        value = _text_field(record, field)
        if value:
            updates[field] = value
    removals = tuple(key for key in _ENDPOINT_OWNED_KEYS if key not in updates)

    config_path = get_config_path("artemis.jsonc")
    _apply_default_endpoint(
        config_path,
        updates,
        removals=removals,
        env_base_url=updates.get("api_base") or None,
    )

    readiness_engine.invalidate_cache()
    return {
        "status": "success",
        "message": f"Endpoint “{name}” is now the active default model.",
        "provider": name,
        "default_model": _without_secrets(_read_jsonc_default(config_path)),
    }


def _delete_jsonc_default_block(config_path: Path) -> None:
    """Remove the top-level ``"default"`` object from a JSONC file.

    Comment-preserving like the update helper: everything outside the block
    (comments, sibling sections) stays byte-identical. The runtime falls back to factory
    defaults when the block is absent, so this is how the UI "un-saves" an
    endpoint. Raises ``ValueError`` when the block is missing, braces are
    unbalanced, or the spliced result no longer parses (file untouched then).
    """
    from third_party.mobile_use.utils.file import load_jsonc

    original = config_path.read_text(encoding="utf-8")
    match = re.search(r'"default"\s*:\s*\{', original)
    if not match:
        raise ValueError(f'No "default" object found in {config_path}')

    # Brace-match the block body, honouring string literals.
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

    # Splice from the start of the line holding "default" through the closing
    # brace, absorbing one trailing comma so the following key stays valid.
    line_start = original.rfind("\n", 0, match.start()) + 1
    end = cursor
    if end < len(original) and original[end] == ",":
        end += 1
    candidate = original[:line_start] + original[end:]
    # A block that sat last in its parent leaves a dangling comma; drop it.
    dangling = re.search(r",(\s*\})", candidate[line_start:])
    if dangling:
        pos = line_start + dangling.start()
        candidate = candidate[:pos] + candidate[pos + 1 :]

    try:
        load_jsonc(io.StringIO(candidate))
    except Exception as exc:
        raise ValueError(f"Removing the default block produced invalid JSONC: {exc}") from exc
    config_path.write_text(candidate, encoding="utf-8")


@router.delete("/model-config")
async def delete_model_config():
    """Remove the saved endpoint information.

    Deletes the whole ``"default"`` block from artemis.jsonc (the runtime then
    falls back to its factory default configuration) and clears the custom
    base URL that the form persisted to .env. API keys are left untouched so
    "leave blank to keep the configured key" semantics survive a delete.
    """
    from artemis.config import settings
    from artemis.config.paths import get_config_path

    try:
        config_path = get_config_path("artemis.jsonc")
        _delete_jsonc_default_block(config_path)
        settings.set_openai_base_url(None, persist_to_env=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete model config: {exc}"
        ) from exc

    readiness_engine.invalidate_cache()
    return {
        "status": "success",
        "message": "Saved endpoint information removed from artemis.jsonc.",
    }


def _mask_secret(k: str | None) -> str | None:
    """Expose only enough of a secret to recognize it, never a usable fragment."""
    if not k:
        return None
    if len(k) <= 8:
        return "****"
    return f"****{k[-4:]}"


# A jsonc ``"api_key": "…"`` assignment. Only the string form is matched, so a
# nested object or a number can't be swallowed by the substitution.
_JSONC_API_KEY_RE = re.compile(r'("api_key"\s*:\s*)"([^"]*)"')


def _mask_jsonc_secrets(text: str) -> str:
    """Mask ``api_key`` values in raw JSONC text headed for the config viewer.

    The viewer exists to show the file's structure, not to echo credentials
    back over HTTP — the same reason the structured blocks drop them.
    ``api_key_env`` is a variable *name*, so it stays readable, and the
    replacement is masked with the same rule as everywhere else.
    """
    return _JSONC_API_KEY_RE.sub(lambda m: f'{m.group(1)}"{_mask_secret(m.group(2))}"', text)


# Mirrors the endpoint form fields so the library table shows exactly what the
# form saves, in the same order and vocabulary.
_ENDPOINT_FORM_FIELDS = ("provider", "api_format", "api_base", "model", "api_key")

# Where a row came from: a saved library record, or the live ``default`` block
# (an endpoint in use that was never saved to the library).
_ENDPOINT_SOURCE_LIBRARY = "library"
_ENDPOINT_SOURCE_DEFAULT = "default"


def _read_endpoint_library() -> list[dict]:
    """Return the saved endpoint records, tolerating a missing or broken file."""
    import json

    from artemis.config.paths import get_endpoint_library_file

    try:
        data = json.loads(get_endpoint_library_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    records = data.get("endpoints", []) if isinstance(data, dict) else []
    return [
        record
        for record in records
        if isinstance(record, dict) and str(record.get("name") or "").strip()
    ]


def _write_endpoint_library(records: list[dict]) -> None:
    """Persist endpoint records; blank fields are dropped rather than stored."""
    import json

    from artemis.config.paths import get_endpoint_library_file

    library_file = get_endpoint_library_file()
    library_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {"endpoints": [{k: v for k, v in record.items() if v} for record in records]}
    library_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _endpoint_record(name: str, api_format: str, api_base: str, model: str) -> dict:
    """Normalize one record to the four fields the endpoint form collects."""
    return {
        "name": name.strip(),
        "api_format": (api_format or "").strip(),
        "api_base": (api_base or "").strip(),
        "model": (model or "").strip(),
    }


def _upsert_endpoint_record(record: dict) -> None:
    """Insert or replace the record of the same name, keeping list order."""
    records = _read_endpoint_library()
    for index, existing in enumerate(records):
        if str(existing.get("name") or "").strip() == record["name"]:
            records[index] = record
            break
    else:
        records.append(record)
    _write_endpoint_library(records)


def _masked_key_for(api_format: str) -> str | None:
    """Masked preview of the key the credential store holds for a protocol."""
    from artemis.config import settings

    secret = settings.get_api_key(api_format) if api_format else None
    return _mask_secret(secret.get_secret_value()) if secret else None


@router.get("/credentials/entries")
async def list_credential_entries():
    """Return the endpoint library for the display table, one row per record.

    Records come from the endpoint library file; the endpoint the runtime
    actually calls is read from artemis.jsonc's ``default`` block and marked
    ``is_active``. A live endpoint that was never saved is still listed (as
    ``source: "default"``, its base URL falling back to OPENAI_BASE_URL the way
    the router's precedence does) so the table can never claim nothing is
    configured while the next task is about to use it. Keys are resolved per
    protocol from the credential store and masked — records hold no secrets.
    """
    from artemis.config.paths import get_config_path

    default = _read_jsonc_default(get_config_path("artemis.jsonc"))
    active_label = str(default.get("provider_label") or "").strip()
    active_provider = str(default.get("provider") or "").strip()
    active_model = str(default.get("model") or "").strip()

    rows = []
    for record in _read_endpoint_library():
        name = str(record.get("name") or "").strip()
        api_format = str(record.get("api_format") or "").strip()
        rows.append(
            {
                "provider": name,
                "api_format": api_format or None,
                "api_base": str(record.get("api_base") or "").strip() or None,
                "model": str(record.get("model") or "").strip() or None,
                "api_key": _masked_key_for(api_format),
                "is_active": bool(active_label) and active_label == name,
                "source": _ENDPOINT_SOURCE_LIBRARY,
            }
        )

    if not any(row["is_active"] for row in rows) and (active_provider or active_model):
        rows.insert(
            0,
            {
                "provider": active_label or None,
                "api_format": active_provider or None,
                "api_base": str(default.get("api_base") or "").strip()
                or (os.environ.get("OPENAI_BASE_URL") or "").strip()
                or None,
                "model": active_model or None,
                "api_key": _masked_key_for(active_provider),
                "is_active": True,
                "source": _ENDPOINT_SOURCE_DEFAULT,
            },
        )
    return {"rows": rows}


@router.delete("/endpoints/{name}")
async def delete_endpoint(name: str):
    """Remove one record from the endpoint library.

    Only the record goes: the endpoint the runtime reads lives in the jsonc
    ``default`` block, so deleting a saved-but-inactive endpoint cannot change
    what the next task uses. Deleting the active one leaves that block in place
    and the row reappears as ``source: "default"`` — taking the live
    configuration down is DELETE /model-config, a deliberately separate act.
    """
    wanted = (name or "").strip()
    records = _read_endpoint_library()
    remaining = [r for r in records if str(r.get("name") or "").strip() != wanted]
    if len(remaining) == len(records):
        raise HTTPException(status_code=404, detail=f"Endpoint {wanted!r} is not in the library.")
    _write_endpoint_library(remaining)
    return {
        "status": "success",
        "message": f"Endpoint {wanted!r} removed from the library.",
        "rows_removed": len(records) - len(remaining),
    }


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
