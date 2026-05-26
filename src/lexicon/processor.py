from __future__ import annotations

import json
import re
from json import JSONDecodeError
from typing import Any

from .models import AINoteDraft, ExtractedContent, SourceInput

ALLOWED_FOLDERS = {"concepts", "guidelines", "references"}


def build_ingestion_prompt(source: SourceInput, extracted: ExtractedContent) -> str:
    return f"""Normalize this source into a Lexicon vault note.

Return ONLY valid JSON. Do not wrap it in Markdown fences.

JSON schema:
{{
  "title": "short note title",
  "suggested_folder": "concepts | guidelines | references",
  "tags": ["lowercase-tag"],
  "confidence": 0.0,
  "expires_at": "",
  "warnings": ["human review warning if any"],
  "body": "Obsidian-compatible Markdown body without YAML frontmatter"
}}

Rules:
- The body must not include YAML frontmatter.
- Keep factual claims tied to the source.
- Preserve important tables, formulas, and units.
- Use Obsidian links like [[Existing Concept]] only when semantically useful.
- Put missing clinical/technical details in warnings instead of inventing them.
- suggested_folder should be:
  - "references" for papers, trials, citations, DOI-heavy sources.
  - "guidelines" for WHO/NICE/standards/recommendations.
  - "concepts" for general concepts or short notes.

Source: {extracted.source_label}
User note: {source.note or ""}
Preferred title: {source.title or ""}

Raw extracted markdown:
{extracted.markdown}
"""


def parse_ai_note_draft(raw: str, fallback_title: str, fallback_body: str) -> AINoteDraft:
    text = raw.strip()
    data = _try_parse_json(text)
    if data is None:
        data = _try_parse_json(_extract_json_candidate(text))
    if data is None:
        return AINoteDraft(
            title=fallback_title,
            body=_strip_markdown_fence(text) or fallback_body,
            suggested_folder="concepts",
            confidence=0.55,
            warnings=["AI response was not valid JSON; stored best-effort Markdown for review."],
        )

    title = _clean_string(data.get("title")) or fallback_title
    body = _clean_string(data.get("body")) or fallback_body
    folder = _clean_string(data.get("suggested_folder")).lower() or "concepts"
    if folder not in ALLOWED_FOLDERS:
        folder = "concepts"
    tags = [_slug_tag(item) for item in _as_list(data.get("tags"))]
    tags = [item for item in tags if item]
    warnings = [_clean_string(item) for item in _as_list(data.get("warnings"))]
    warnings = [item for item in warnings if item]
    confidence = _coerce_confidence(data.get("confidence"), default=0.75)
    expires_at = _clean_string(data.get("expires_at"))
    return AINoteDraft(
        title=title[:120],
        body=_remove_frontmatter(_strip_markdown_fence(body)).strip(),
        suggested_folder=folder,
        tags=tags[:12],
        confidence=confidence,
        warnings=warnings,
        expires_at=expires_at,
    )


def _try_parse_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    try:
        data = json.loads(text)
    except JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _extract_json_candidate(text: str) -> str:
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.S)
    if fence:
        return fence.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return text[start : end + 1]
    return ""


def _strip_markdown_fence(text: str) -> str:
    match = re.fullmatch(r"```(?:markdown|md|json)?\s*(.*?)\s*```", text.strip(), flags=re.S)
    return match.group(1).strip() if match else text


def _remove_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    if end == -1:
        return text
    return text[end + 4 :].lstrip()


def _clean_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _slug_tag(value: Any) -> str:
    text = _clean_string(value).lower()
    text = re.sub(r"[^a-z0-9\u00c0-\u1ef9-]+", "-", text, flags=re.IGNORECASE)
    return re.sub(r"-+", "-", text).strip("-")


def _coerce_confidence(value: Any, default: float) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, confidence))
