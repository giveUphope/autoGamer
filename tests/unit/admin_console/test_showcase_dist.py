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

"""Tests for the Showcase UI dist discovery in the unified server."""

import apps.admin_console.server as server_module
from apps.admin_console.server import _get_showcase_dist


def _write_index(directory):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "index.html").write_text("<html></html>", encoding="utf-8")
    return directory


def test_get_showcase_dist_prefers_vite_browser_build(tmp_path, monkeypatch):
    browser_dist = _write_index(tmp_path / "apps" / "showcase_ui_v2" / "dist" / "browser")
    monkeypatch.setattr(server_module, "_workspace_root", tmp_path)

    assert _get_showcase_dist() == browser_dist


def test_get_showcase_dist_falls_back_to_dist_root(tmp_path, monkeypatch):
    dist_root = _write_index(tmp_path / "apps" / "showcase_ui_v2" / "dist")
    monkeypatch.setattr(server_module, "_workspace_root", tmp_path)

    assert _get_showcase_dist() == dist_root


def test_get_showcase_dist_falls_back_to_bundled_wheel_resources(tmp_path, monkeypatch):
    monkeypatch.setattr(server_module, "_workspace_root", tmp_path)
    bundled = _write_index(tmp_path / "wheel" / "artemis" / "resources" / "showcase_ui")
    monkeypatch.setattr(server_module, "get_bundled_showcase_dist", lambda: bundled)

    assert _get_showcase_dist() == bundled


def test_get_showcase_dist_last_resort_points_at_vite_browser_dist(tmp_path, monkeypatch):
    monkeypatch.setattr(server_module, "_workspace_root", tmp_path)
    monkeypatch.setattr(server_module, "get_bundled_showcase_dist", lambda: None)

    assert _get_showcase_dist() == tmp_path / "apps" / "showcase_ui_v2" / "dist" / "browser"
