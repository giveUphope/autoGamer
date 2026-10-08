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

"""Isolation guards for data_engine unit tests.

DataEngine auto-connects to the desktop console's IPC bridge through the
shared port file under %TEMP% — no environment variable required. While
the ARTEMIS console server is running, every engine a test constructs
streams its test sessions into the live daemon: the daemon broadcasts
them as running sessions, and the console's session list fills with
phantom conversations that never go away. Tests must be hermetic, so the
default IPC port discovery resolves to nothing for every test in this
package; IPC-specific tests re-patch these seams explicitly.
"""

import pytest

from artemis.data_engine import engine


@pytest.fixture(autouse=True)
def _no_live_ipc_bridge(tmp_path, monkeypatch):
    monkeypatch.setattr(engine, "read_ipc_port", lambda: None)
    monkeypatch.setattr(engine, "get_ipc_port_file", lambda: tmp_path / "no-ipc-port-file")
    yield
