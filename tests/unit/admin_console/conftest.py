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

"""Shared isolation for the admin console tests."""

import pytest


@pytest.fixture(autouse=True)
def isolated_endpoint_library(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Point the endpoint library at the throwaway dir.

    The library defaults to living next to the canonical ``.env`` — the real
    developer file. A test that saves a named endpoint would otherwise append
    to it, and every later run would read those records back.
    """
    target = tmp_path / "endpoint_library.json"
    monkeypatch.setattr("artemis.config.paths.get_endpoint_library_file", lambda: target)
    return target
