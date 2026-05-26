from __future__ import annotations

from pathlib import Path

from lexicon.models import ExtractedContent, SourceInput


def extract_with_markitdown(source: SourceInput) -> ExtractedContent:
    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        raise RuntimeError("MarkItDown adapter requires installing markitdown.") from exc

    target = source.value
    result = MarkItDown().convert(target)
    markdown = getattr(result, "text_content", "") or str(result)
    label = target
    if source.kind == "file":
        label = str(Path(target).expanduser().resolve())
    return ExtractedContent(
        markdown=f"# {source.title or Path(target).stem}\n\nSource: {label}\n\n{markdown.strip()}\n",
        source_label=label,
        confidence=0.72,
        metadata={"extractor": "markitdown"},
    )


def markitdown_unavailable(source: SourceInput, reason: str) -> ExtractedContent:
    path = Path(source.value).expanduser()
    return ExtractedContent(
        markdown=f"# {source.title or path.stem}\n\nSource: {path}\n",
        source_label=str(path),
        warnings=[f"MarkItDown unavailable; file content was not extracted: {reason}"],
        confidence=0.2,
        metadata={"extractor": "markitdown-unavailable"},
    )
