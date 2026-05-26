from __future__ import annotations

from pathlib import Path

from .ai import build_provider
from .config import AppConfig
from .extractors import extract
from .models import AINoteDraft, ExtractedContent, ProcessedNote, SourceInput, utc_now_iso
from .processor import build_ingestion_prompt, parse_ai_note_draft
from .search import similar_existing
from .vault import Vault, slugify


def _title_from_markdown(markdown: str, fallback: str) -> str:
    for line in markdown.splitlines():
        if line.startswith("# "):
            return line[2:].strip()[:120] or fallback
    return fallback


def process_with_ai(vault: Vault, source: SourceInput, extracted: ExtractedContent, config: AppConfig) -> ProcessedNote:
    provider = build_provider(config)
    title = source.title or _title_from_markdown(extracted.markdown, "Untitled")
    system = vault.read_agent()
    raw = provider.complete(system, build_ingestion_prompt(source, extracted))
    draft = parse_ai_note_draft(raw, fallback_title=title, fallback_body=extracted.markdown)
    warnings = list(extracted.warnings)
    warnings.extend(draft.warnings)
    duplicates = similar_existing(vault, draft.body, threshold=0.5)
    if duplicates:
        warnings.append("Potential duplicates: " + ", ".join(f"{d['path']} ({d['similarity']})" for d in duplicates[:3]))
    suggested_folder = draft.suggested_folder or _suggest_folder(draft.title, draft.body)
    confidence = max(0.0, min(1.0, min(extracted.confidence, draft.confidence) - (0.1 if duplicates else 0.0)))
    markdown = _with_frontmatter(
        draft=draft,
        body=draft.body,
        title=draft.title,
        source=extracted.source_label,
        suggested_folder=suggested_folder,
        confidence=confidence,
        warnings=warnings,
    )
    return ProcessedNote(
        title=draft.title,
        markdown=markdown,
        suggested_folder=suggested_folder,
        confidence=confidence,
        warnings=warnings,
        metadata=extracted.metadata,
    )


def ingest(vault: Vault, source: SourceInput, config: AppConfig | None = None) -> Path:
    config = config or AppConfig.load()
    extracted = extract(source, config)
    note = process_with_ai(vault, source, extracted, config)
    return vault.write_inbox_item(note)


def _suggest_folder(title: str, body: str) -> str:
    text = f"{title}\n{body}".lower()
    if any(word in text for word in ["paper", "study", "trial", "doi", "reference"]):
        return "references"
    if any(word in text for word in ["guideline", "who", "nice", "recommendation"]):
        return "guidelines"
    return "concepts"


def _with_frontmatter(
    draft: AINoteDraft,
    body: str,
    title: str,
    source: str,
    suggested_folder: str,
    confidence: float,
    warnings: list[str],
) -> str:
    warning_block = "\n".join(f"- {item}" for item in warnings) if warnings else "- None"
    now = utc_now_iso()
    clean_body = body.strip()
    tag_block = "[" + ", ".join(f'"{tag}"' for tag in draft.tags) + "]"
    return f"""---
title: "{title.replace('"', '\\"')}"
source: "{source.replace('"', '\\"')}"
created_at: "{now}"
reviewed_at: ""
expires_at: "{draft.expires_at.replace('"', '\\"')}"
suggested_folder: "{suggested_folder}"
confidence: {confidence:.2f}
tags: {tag_block}
---

{clean_body}

## Lexicon review
{warning_block}

<!-- lexicon-id: {slugify(title)}-{now} -->
"""
