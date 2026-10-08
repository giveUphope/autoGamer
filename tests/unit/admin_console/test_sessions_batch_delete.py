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

"""Batch conversation deletion endpoint: one request, server-side loop."""

from uuid import uuid4

import pytest
from fastapi import HTTPException

from apps.admin_console.routers.sessions import (
    SessionBatchDeleteRequest,
    delete_sessions_batch_endpoint,
)


class StubStorage:
    calls: list[str] = []

    def __init__(self, *args, **kwargs):
        StubStorage.calls = []

    def delete_session(self, session_id):
        StubStorage.calls.append(str(session_id))


@pytest.mark.asyncio
async def test_batch_delete_removes_every_session_in_one_pass(monkeypatch):
    ids = [str(uuid4()) for _ in range(3)]
    monkeypatch.setattr("artemis.data_engine.storage.StorageManager", StubStorage)

    result = await delete_sessions_batch_endpoint(SessionBatchDeleteRequest(session_ids=ids))

    assert result["status"] == "success"
    assert result["deleted_count"] == 3
    assert result["failed"] == []
    # 一个 StorageManager、一轮循环——不是每会话一次连接/一次请求
    assert StubStorage.calls == ids


@pytest.mark.asyncio
async def test_batch_delete_degrades_invalid_ids_to_per_item_failures(monkeypatch):
    good = str(uuid4())
    monkeypatch.setattr("artemis.data_engine.storage.StorageManager", StubStorage)

    result = await delete_sessions_batch_endpoint(
        SessionBatchDeleteRequest(session_ids=["not-a-uuid", good])
    )

    assert result["status"] == "partial"
    assert result["deleted_count"] == 1
    assert result["failed"][0]["session_id"] == "not-a-uuid"
    assert "error" in result["failed"][0]


@pytest.mark.asyncio
async def test_batch_delete_rejects_empty_and_oversized_batches(monkeypatch):
    monkeypatch.setattr("artemis.data_engine.storage.StorageManager", StubStorage)

    with pytest.raises(HTTPException) as empty:
        await delete_sessions_batch_endpoint(SessionBatchDeleteRequest(session_ids=[]))
    assert empty.value.status_code == 400

    with pytest.raises(HTTPException) as oversized:
        await delete_sessions_batch_endpoint(
            SessionBatchDeleteRequest(session_ids=[str(uuid4())] * 501)
        )
    assert oversized.value.status_code == 400
