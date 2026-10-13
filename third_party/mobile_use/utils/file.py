# Copyright 2025-2026 Minitap, Inc.
# Modifications Copyright 2026 Google LLC
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
#
# Originally from mobile-use (https://github.com/minitap-ai/mobile-use).
# See third_party/mobile_use/METADATA for the upstream source and local modifications.

import json
import re
from typing import IO


def strip_json_comments(text: str) -> str:
    """Strip // and /* */ comments from JSONC text while preserving string literals.

    String-aware: ``//`` inside a quoted value (e.g. an ``http://`` api_base
    URL) must not start a comment, so quoted strings are matched and kept
    verbatim before comment patterns get a chance.
    """
    pattern = r"//.*?$|/\*.*?\*/|'(?:\\.|[^\\'])*'|\"(?:\\.|[^\\\"])*\""

    def replacer(match: re.Match) -> str:
        s = match.group(0)
        if s.startswith("/"):
            return ""
        return s

    return re.sub(pattern, replacer, text, flags=re.DOTALL | re.MULTILINE)


def load_jsonc(file: IO) -> dict:
    return json.loads(strip_json_comments(file.read()))
