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

"""Contract tests for release metadata and bundled runtime resources."""

import ast
from fnmatch import fnmatch
from importlib.metadata import version
from pathlib import Path

import artemis
from artemis import resources

SETUP_PY = Path(__file__).resolve().parents[2] / "setup.py"


def _setup_call_keyword(keyword_name):
    """Extract a literal keyword argument from the ``setup()`` call in setup.py."""
    tree = ast.parse(SETUP_PY.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "setup":
            for keyword in node.keywords:
                if keyword.arg == keyword_name:
                    return ast.literal_eval(keyword.value)
    raise AssertionError(f"setup() keyword {keyword_name!r} not found in setup.py")


def _load_setup_showcase_dist():
    """Load ``_showcase_dist`` from setup.py without executing ``setup()``."""
    tree = ast.parse(SETUP_PY.read_text(encoding="utf-8"))
    module = ast.Module(
        body=[
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "_showcase_dist"
        ],
        type_ignores=[],
    )
    namespace = {"Path": Path}
    exec(compile(module, str(SETUP_PY), "exec"), namespace)
    return namespace["_showcase_dist"]


def test_public_version_comes_from_distribution_metadata():
    assert artemis.__version__ == version("artemis")


def test_source_tree_contains_complete_release_resources():
    config_path = resources.get_bundled_config_path("artemis.jsonc")
    showcase_path = resources.get_bundled_showcase_dist()

    assert config_path is not None and config_path.is_file()
    assert showcase_path is not None and (showcase_path / "index.html").is_file()


def test_bundled_showcase_dist_supports_vite_asset_tree(tmp_path, monkeypatch):
    resource_root = tmp_path / "resources"
    showcase_dir = resource_root / "showcase_ui"
    (showcase_dir / "assets").mkdir(parents=True)
    (showcase_dir / "index.html").write_text("<html></html>", encoding="utf-8")
    (showcase_dir / "assets" / "index-CMeBErSD.js").write_text("js", encoding="utf-8")

    monkeypatch.setattr(resources, "files", lambda _package: resource_root)

    assert resources.get_bundled_showcase_dist() == showcase_dir


def test_setup_showcase_dist_prefers_vite_source_build(tmp_path):
    showcase_dist = _load_setup_showcase_dist()
    browser_dist = tmp_path / "apps" / "showcase_ui_v2" / "dist" / "browser"
    browser_dist.mkdir(parents=True)
    (browser_dist / "index.html").write_text("<html></html>", encoding="utf-8")

    assert showcase_dist(tmp_path) == browser_dist


def test_setup_showcase_dist_falls_back_to_bundled_resources(tmp_path):
    showcase_dist = _load_setup_showcase_dist()
    bundled = tmp_path / "artemis" / "resources" / "showcase_ui"
    bundled.mkdir(parents=True)
    (bundled / "index.html").write_text("<html></html>", encoding="utf-8")

    assert showcase_dist(tmp_path) == bundled


def test_package_data_patterns_cover_vite_asset_tree():
    package_data = _setup_call_keyword("package_data")
    patterns = package_data["artemis.resources"]

    assert "showcase_ui/*" in patterns
    assert "showcase_ui/**/*" in patterns
    # Vite output shape: entry document at the root, hashed bundles under assets/.
    assert fnmatch("showcase_ui/index.html", "showcase_ui/*")
    assert fnmatch("showcase_ui/favicon.ico", "showcase_ui/*")
    assert fnmatch("showcase_ui/assets/index-CMeBErSD.js", "showcase_ui/**/*")
    assert fnmatch("showcase_ui/assets/index-8cJomhOD.css", "showcase_ui/**/*")


def test_bundled_resource_accessors_require_complete_assets(tmp_path, monkeypatch):
    resource_root = tmp_path / "resources"
    config_dir = resource_root / "config"
    showcase_dir = resource_root / "showcase_ui"
    config_dir.mkdir(parents=True)
    showcase_dir.mkdir()
    (config_dir / "artemis.jsonc").write_text("{}", encoding="utf-8")
    (showcase_dir / "index.html").write_text("<html></html>", encoding="utf-8")

    monkeypatch.setattr(resources, "files", lambda _package: resource_root)

    assert resources.get_bundled_config_path("artemis.jsonc") == (config_dir / "artemis.jsonc")
    assert resources.get_bundled_config_path("missing.jsonc") is None
    assert resources.get_bundled_showcase_dist() == showcase_dir


def test_incomplete_showcase_resource_is_rejected(tmp_path, monkeypatch):
    resource_root = tmp_path / "resources"
    (resource_root / "showcase_ui").mkdir(parents=True)
    monkeypatch.setattr(resources, "files", lambda _package: resource_root)

    assert resources.get_bundled_showcase_dist() is None
