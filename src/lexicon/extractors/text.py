from __future__ import annotations

from pathlib import Path

from lexicon.models import ExtractedContent, SourceInput


def extract_text(source: SourceInput) -> ExtractedContent:
    if source.kind == "text":
        value = source.value
        label = source.title or "pasted text"
    else:
        path = Path(source.value).expanduser().resolve()
        value = path.read_text(encoding="utf-8")
        label = str(path)
    markdown = value if value.lstrip().startswith("#") else f"# {source.title or label}\n\n{value.strip()}\n"
    return ExtractedContent(markdown=markdown, source_label=label, confidence=0.85)
