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

"""Contract tests for release metadata.

The bundled Vue showcase and the ``artemis.jsonc`` LLM agent config (and the
legacy ``setup.py`` that packaged them) were removed in the DSH plugin
contraction, so the release-resource completeness tests that pinned them are
gone too. What remains is the package version metadata.
"""

from importlib.metadata import version

import artemis


def test_public_version_comes_from_distribution_metadata():
    assert artemis.__version__ == version("artemis")
