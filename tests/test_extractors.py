from __future__ import annotations

from lexicon.config import AppConfig
from lexicon.extractors.router import extract
from lexicon.ingestion import materialize_assets
from lexicon.models import ExtractedContent
from lexicon.models import SourceInput
from lexicon.vault import Vault


def test_office_file_without_markitdown_returns_reviewable_warning(tmp_path):
    path = tmp_path / "slides.pptx"
    path.write_bytes(b"not really pptx")

    result = extract(SourceInput("file", str(path), title="Slides"), AppConfig())

    assert result.confidence == 0.2
    assert "MarkItDown unavailable" in result.warnings[0]
    assert "# Slides" in result.markdown


def test_markitdown_for_unknown_file_when_forced_returns_warning(tmp_path):
    path = tmp_path / "source.custom"
    path.write_text("custom", encoding="utf-8")
    config = AppConfig(file_extractor="markitdown")

    result = extract(SourceInput("file", str(path)), config)

    assert result.confidence == 0.2
    assert "MarkItDown unavailable" in result.warnings[0]


def test_http_url_extractor_uses_fallback_warning(monkeypatch):
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b"<html><title>Hello</title><body>World</body></html>"

    def fake_urlopen(req, timeout):
        return FakeResponse()

    monkeypatch.setattr("lexicon.extractors.url.request.urlopen", fake_urlopen)

    result = extract(SourceInput("url", "https://example.test"), AppConfig())

    assert result.source_label == "https://example.test"
    assert "Hello" in result.markdown
    assert "HTTP fallback" in result.warnings[0]


def test_image_file_without_mineru_creates_reviewable_asset(tmp_path):
    path = tmp_path / "figure.png"
    path.write_bytes(b"fake image")

    result = extract(SourceInput("file", str(path), title="Figure"), AppConfig())

    assert result.assets == [path.resolve()]
    assert result.confidence == 0.3
    assert "without OCR" in result.warnings[0]


def test_materialize_assets_copies_images_and_rewrites_links(tmp_path):
    vault = Vault.init(tmp_path / "vault")
    image = tmp_path / "images" / "figure.png"
    image.parent.mkdir()
    image.write_bytes(b"fake image")

    extracted = materialize_assets(
        vault,
        ExtractedContent(
            markdown="# Source\n\n![](images/figure.png)\n",
            source_label="source.pdf",
            assets=[image],
            confidence=0.85,
        ),
    )

    copied = vault.path / "_assets" / "images" / "figure.png"
    assert copied.exists()
    assert "![[_assets/images/figure.png]]" in extracted.markdown
    assert extracted.metadata["copied_assets"] == ["_assets/images/figure.png"]
