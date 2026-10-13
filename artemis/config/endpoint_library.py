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

"""The endpoint library: saved model endpoints the setup UI can offer.

A record is a *saved choice*, not a runtime input: the model the agent actually
calls still comes from the ``default`` block of artemis.jsonc. What makes the
library more than UI bookkeeping is pinning — a task worker can point at one
record through ``ARTEMIS_MODEL_ENDPOINT`` and every model resolution in that
process follows it, so the endpoint the selector showed at submit time is the
endpoint that task runs with, even if the global default changes mid-flight.

Both the admin console and the runtime read this module, so the record shape and
its file location have exactly one definition.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from artemis.config import paths


def library_file() -> Path:
    """Resolve the file at call time so a test (or a relocated app dir) can redirect it."""
    return paths.get_endpoint_library_file()


#: The fields one record holds. Keys are the endpoint form's own vocabulary;
#: ``api_format`` is the wire protocol the runtime dispatches on.
RECORD_FIELDS = ("name", "api_format", "api_base", "model")

#: Fields of the ``default`` block that belong to whichever endpoint is active.
#: The runtime reads them straight out of artemis.jsonc (services/llm.py), and
#: its ``api_base`` outranks OPENAI_BASE_URL, so a leftover keeps pointing at the
#: previous provider; ``fallback`` names a provider and a model too. Reasoning
#: knobs (thinking_level and friends) are deliberately absent — they describe how
#: the agent thinks, not which endpoint answers.
ENDPOINT_OWNED_KEYS = ("api_base", "api_key", "api_key_env", "fallback")


def to_default_overrides(record: dict[str, Any]) -> dict[str, Any | None]:
    """Translate a record into ``default``-block writes; None means clear it.

    One definition for both writers — the setup UI's switch endpoint and a pinned
    task worker — so switching and pinning can never disagree about which fields
    a record owns.
    """
    mapped: dict[str, Any | None] = {
        "provider": str(record.get("api_format") or "").strip() or None,
        "model": str(record.get("model") or "").strip() or None,
        "provider_label": str(record.get("name") or "").strip() or None,
    }
    for key in ENDPOINT_OWNED_KEYS:
        value = record.get(key)
        if isinstance(value, dict):
            mapped[key] = value or None
        elif isinstance(value, str) and value.strip():
            mapped[key] = value.strip()
        else:
            mapped[key] = None
    return mapped


def make_record(name: str, api_format: str, api_base: str, model: str) -> dict[str, str]:
    """Normalize one record to the four fields the endpoint form collects."""
    return {
        "name": (name or "").strip(),
        "api_format": (api_format or "").strip(),
        "api_base": (api_base or "").strip(),
        "model": (model or "").strip(),
    }


def read_library() -> list[dict[str, Any]]:
    """Return the saved records in file order.

    A missing or unreadable file reads as empty rather than raising: the setup
    screen must still show the live configuration, and a task pinned to a name
    that has gone away fails loudly at resolution time instead of here.
    """
    try:
        data = json.loads(library_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    records = data.get("endpoints", []) if isinstance(data, dict) else []
    return [
        record
        for record in records
        if isinstance(record, dict) and str(record.get("name") or "").strip()
    ]


def write_library(records: list[dict[str, Any]]) -> None:
    """Persist records; blank fields are dropped rather than stored."""
    target = library_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "endpoints": [{key: value for key, value in record.items() if value} for record in records]
    }
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def names() -> list[str]:
    """Saved record names, in file order — the selector's whole universe."""
    return [str(record.get("name") or "").strip() for record in read_library()]


def find(name: str) -> dict[str, Any] | None:
    """The record saved under ``name``, or None."""
    wanted = (name or "").strip()
    return next(
        (record for record in read_library() if str(record.get("name") or "").strip() == wanted),
        None,
    )


def upsert(record: dict[str, Any]) -> None:
    """Insert or replace the record of the same name, keeping list order."""
    records = read_library()
    for index, existing in enumerate(records):
        if str(existing.get("name") or "").strip() == str(record.get("name") or "").strip():
            records[index] = record
            break
    else:
        records.append(record)
    write_library(records)


def remove(name: str) -> bool:
    """Drop one record; returns False when no record had that name."""
    wanted = (name or "").strip()
    records = read_library()
    remaining = [r for r in records if str(r.get("name") or "").strip() != wanted]
    if len(remaining) == len(records):
        return False
    write_library(remaining)
    return True
