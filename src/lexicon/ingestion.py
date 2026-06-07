from __future__ import annotations

import re
import shutil
from pathlib import Path

from .ai import build_provider
from .config import AppConfig
from .extractors import extract
from .models import AINoteDraft, ExtractedContent, ProcessedNote, SourceInput, utc_now_iso
from .processor import build_ingestion_prompt, parse_ai_note_draft
from .search import similar_existing
from .vault import Vault, slugify

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}


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
    extracted = materialize_assets(vault, extracted)
    note = process_with_ai(vault, source, extracted, config)
    return vault.write_inbox_item(note)


def materialize_assets(vault: Vault, extracted: ExtractedContent) -> ExtractedContent:
    if not extracted.assets:
        return _warn_unmaterialized_image_refs(extracted)

    image_dir = vault.path / "_assets" / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    warnings = list(extracted.warnings)
    metadata = dict(extracted.metadata)
    replacements: dict[str, str] = {}
    copied: list[str] = []

    for asset in extracted.assets:
        source = Path(asset).expanduser().resolve()
        if not source.exists():
            warnings.append(f"Extracted asset was referenced but not found on disk: {asset}")
            continue
        if source.suffix.lower() not in IMAGE_SUFFIXES:
            warnings.append(f"Extracted non-image asset was not copied: {source.name}")
            continue

        target = _unique_asset_path(image_dir, f"{slugify(source.stem)}{source.suffix.lower()}")
        shutil.copy2(source, target)
        vault_ref = f"_assets/images/{target.name}"
        copied.append(vault_ref)
        for key in _asset_reference_keys(source):
            replacements[key] = vault_ref

    markdown = _rewrite_asset_links(extracted.markdown, replacements)
    if copied:
        metadata["copied_assets"] = copied
    updated = ExtractedContent(
        markdown=markdown,
        source_label=extracted.source_label,
        assets=[],
        warnings=warnings,
        confidence=extracted.confidence,
        metadata=metadata,
    )
    return _warn_unmaterialized_image_refs(updated)


def _suggest_folder(title: str, body: str) -> str:
    text = f"{title}\n{body}".lower()
    if any(word in text for word in ["paper", "study", "trial", "doi", "reference"]):
        return "references"
    if any(word in text for word in ["guideline", "who", "nice", "recommendation"]):
        return "guidelines"
    return "concepts"


def _unique_asset_path(folder: Path, filename: str) -> Path:
    target = folder / filename
    counter = 2
    while target.exists():
        target = folder / f"{Path(filename).stem}-{counter}{Path(filename).suffix}"
        counter += 1
    return target


def _asset_reference_keys(path: Path) -> set[str]:
    normalized = path.as_posix()
    return {
        path.name,
        normalized,
        str(path).replace("\\", "/"),
        f"images/{path.name}",
        f"./images/{path.name}",
    }


def _rewrite_asset_links(markdown: str, replacements: dict[str, str]) -> str:
    if not replacements:
        return markdown

    def replace_markdown(match: re.Match[str]) -> str:
        alt = match.group(1)
        target = _clean_link_target(match.group(2))
        replacement = _lookup_asset_replacement(target, replacements)
        if not replacement:
            return match.group(0)
        if alt:
            return f"![{alt}]({replacement})"
        return f"![[{replacement}]]"

    def replace_obsidian(match: re.Match[str]) -> str:
        target = _clean_link_target(match.group(1))
        replacement = _lookup_asset_replacement(target, replacements)
        return f"![[{replacement}]]" if replacement else match.group(0)

    rewritten = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", replace_markdown, markdown)
    return re.sub(r"!\[\[([^\]]+)\]\]", replace_obsidian, rewritten)


def _clean_link_target(target: str) -> str:
    return target.strip().strip('"').strip("'").replace("\\", "/")


def _lookup_asset_replacement(target: str, replacements: dict[str, str]) -> str | None:
    normalized = target.replace("\\", "/")
    candidates = {
        normalized,
        normalized.lstrip("./"),
        Path(normalized).name,
    }
    for candidate in candidates:
        if candidate in replacements:
            return replacements[candidate]
    return None


def _warn_unmaterialized_image_refs(extracted: ExtractedContent) -> ExtractedContent:
    refs = _markdown_image_refs(extracted.markdown)
    unresolved = [
        ref
        for ref in refs
        if ref.startswith("images/") or ref.startswith("./images/") or ref.startswith("../images/")
    ]
    if not unresolved:
        return extracted
    warnings = list(extracted.warnings)
    warnings.append(
        "MinerU markdown references image assets that were not copied into the vault: "
        + ", ".join(sorted(set(unresolved))[:5])
    )
    return ExtractedContent(
        markdown=extracted.markdown,
        source_label=extracted.source_label,
        assets=extracted.assets,
        warnings=warnings,
        confidence=min(extracted.confidence, 0.75),
        metadata=extracted.metadata,
    )


def _markdown_image_refs(markdown: str) -> list[str]:
    refs = [_clean_link_target(match) for match in re.findall(r"!\[[^\]]*\]\(([^)]+)\)", markdown)]
    refs.extend(_clean_link_target(match) for match in re.findall(r"!\[\[([^\]]+)\]\]", markdown))
    return refs


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
