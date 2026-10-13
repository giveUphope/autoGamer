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

"""Unit tests for the optional cloud OCR helper and the local OCR/XML fusion.

Cloud OCR is an optional device-vision capability: with no key configured the
helper returns an empty list instead of raising, and observation falls back to
the pure-XML hierarchy. The Explorer/Perception LangChain wiring that used to
gate this lives in the DSH host now.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from artemis.config.settings import Settings
from artemis.utils.ocr_api import is_ocr_configured, perform_ocr
from artemis.utils.ocr_xml_fusion import fuse_ocr_with_xml
from artemis.utils.visualization import format_minimal_list_with_elements


@pytest.mark.asyncio
async def test_is_ocr_configured_false_when_unset(monkeypatch):
    """Verify is_ocr_configured returns False when keys are unset or placeholder."""
    monkeypatch.delenv("OCR_API_KEY", raising=False)
    monkeypatch.delenv("VISION_API_KEY", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    with patch.object(Settings, "get_api_key", return_value=None):
        assert not is_ocr_configured()


@pytest.mark.asyncio
async def test_perform_ocr_returns_empty_list_when_unconfigured(monkeypatch):
    """Verify perform_ocr returns [] when no OCR key is present."""
    with (
        patch.object(Settings, "get_api_key", return_value=None),
        patch.dict("os.environ", {}, clear=True),
    ):
        result = await perform_ocr(screenshot_b64="dummy_b64")
        assert result == []


@pytest.mark.asyncio
async def test_perform_ocr_executes_api_call_when_configured():
    """Verify perform_ocr makes API request and parses responses when configured."""
    mock_key = MagicMock()
    mock_key.get_secret_value.return_value = "test_key"

    with (
        patch.object(Settings, "get_api_key", return_value=mock_key),
        patch("artemis.utils.ocr_api.get_http_client") as mock_client,
    ):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "responses": [
                {
                    "textAnnotations": [
                        {"description": "Full text\nLogin", "boundingPoly": {}},
                        {
                            "description": "Login",
                            "boundingPoly": {
                                "vertices": [{"x": 100, "y": 200}, {"x": 300, "y": 250}]
                            },
                        },
                    ]
                }
            ]
        }
        mock_http = AsyncMock()
        mock_http.post.return_value = mock_resp
        mock_client.return_value = mock_http

        result = await perform_ocr(screenshot_b64="dummy_b64")
        assert len(result) == 1
        assert result[0]["text"] == "Login"


def test_fuse_ocr_with_xml_empty_ocr_retains_xml_pruning():
    """Verify fuse_ocr_with_xml preserves full XML structure and allows downstream pruning."""
    sample_xml = [
        {
            "class": "android.widget.TextView",
            "text": "Submit Button",
            "bounds": "[100,200][300,250]",
        },
        {
            "class": "android.widget.ImageView",
            "content-desc": "Settings Icon",
            "bounds": "[900,50][980,130]",
        },
    ]

    # Fusing with empty OCR results
    fused_xml = fuse_ocr_with_xml(sample_xml, [])
    assert len(fused_xml) == 2
    assert fused_xml[0]["text"] == "Submit Button"

    # Downstream XML formatting / pruning
    minimal_list, elements, labels = format_minimal_list_with_elements(
        fused_xml, width=1080, height=2400
    )
    assert len(elements) == 2
    assert "Submit Button" in minimal_list
    assert "Settings Icon" in minimal_list
    assert labels == ["1", "2"]
