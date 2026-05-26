from __future__ import annotations

from pathlib import Path

from lexicon.config import AppConfig
from lexicon.models import ExtractedContent, SourceInput

from .markitdown import extract_with_markitdown, markitdown_unavailable
from .pdf import extract_pdf
from .text import extract_text
from .url import extract_url

MARKITDOWN_SUFFIXES = {".docx", ".pptx", ".xlsx", ".xls", ".html", ".htm", ".csv"}


def extract(source: SourceInput, config: AppConfig | None = None) -> ExtractedContent:
    config = config or AppConfig.load()
    if source.kind == "url":
        return extract_url_source(source, config)
    if source.kind == "text":
        return extract_text(source)
    if source.kind == "file":
        return extract_file_source(source, config)
    raise ValueError(f"Unsupported source kind: {source.kind}")


def extract_url_source(source: SourceInput, config: AppConfig) -> ExtractedContent:
    if config.url_extractor == "playwright":
        try:
            from .playwright_url import extract_url_with_playwright

            return extract_url_with_playwright(source)
        except Exception as exc:
            extracted = extract_url(source)
            extracted.warnings.append(f"Playwright failed, used HTTP fallback: {exc}")
            extracted.confidence = min(extracted.confidence, 0.55)
            return extracted
    if config.url_extractor == "markitdown":
        try:
            return extract_with_markitdown(source)
        except Exception as exc:
            extracted = extract_url(source)
            extracted.warnings.append(f"MarkItDown URL extraction failed, used HTTP fallback: {exc}")
            extracted.confidence = min(extracted.confidence, 0.55)
            return extracted
    return extract_url(source)


def extract_file_source(source: SourceInput, config: AppConfig) -> ExtractedContent:
    path = Path(source.value)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        if config.mineru_endpoint:
            try:
                from .mineru import extract_with_mineru

                return extract_with_mineru(source, config.mineru_endpoint, config.mineru_timeout_seconds)
            except Exception as exc:  # fallback should keep ingestion usable
                extracted = extract_pdf(source)
                extracted.warnings.append(f"MinerU failed, used pdftotext fallback: {exc}")
                extracted.confidence = min(extracted.confidence, 0.55)
                return extracted
        return extract_pdf(source)
    if suffix in {".md", ".txt"}:
        return extract_text(source)
    if suffix in MARKITDOWN_SUFFIXES or config.file_extractor == "markitdown":
        try:
            return extract_with_markitdown(source)
        except Exception as exc:
            return markitdown_unavailable(source, str(exc))
    raise ValueError(f"Unsupported file type: {suffix}")
