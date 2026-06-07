from __future__ import annotations

from pathlib import Path
from typing import Any

from lexicon.models import ExtractedContent, SourceInput

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}


def extract_with_mineru(source: SourceInput, endpoint: str, timeout_seconds: int = 900) -> ExtractedContent:
    try:
        import requests
        from requests import RequestException
    except ImportError as exc:
        raise RuntimeError("MinerU HTTP adapter requires installing requests.") from exc

    path = Path(source.value).expanduser().resolve()
    url = endpoint.rstrip("/") + "/file_parse"
    content_type = _content_type(path)
    try:
        with path.open("rb") as file:
            response = requests.post(
                url,
                files=[("files", (path.name, file, content_type))],
                data={"return_md": "true", "backend": "pipeline"},
                timeout=(5, timeout_seconds),
            )
        response.raise_for_status()
    except RequestException as exc:
        raise RuntimeError(f"MinerU endpoint is not reachable at {url}: {exc}") from exc
    data = response.json()
    markdown = _extract_markdown(data)
    if not markdown:
        raise ValueError("MinerU response did not contain markdown")
    assets = _extract_local_assets(data, base_dir=path.parent)
    if path.suffix.lower() in IMAGE_SUFFIXES:
        assets.append(path)
    return ExtractedContent(
        markdown=markdown,
        source_label=str(path),
        assets=_unique_assets(assets),
        warnings=_extract_warnings(data),
        confidence=float(data.get("confidence", 0.85)),
        metadata={"mineru": data},
    )


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".gif":
        return "image/gif"
    if suffix in {".tif", ".tiff"}:
        return "image/tiff"
    return "application/octet-stream"


def _extract_markdown(data: dict) -> str:
    direct = (
        data.get("markdown")
        or data.get("md_content")
        or data.get("document_md")
        or data.get("content")
        or data.get("data", {}).get("markdown")
        or data.get("data", {}).get("md_content")
    )
    if direct:
        return direct

    results = data.get("results")
    if isinstance(results, dict):
        chunks: list[str] = []
        for result in results.values():
            if not isinstance(result, dict):
                continue
            content = result.get("md_content") or result.get("markdown") or result.get("content")
            if content:
                chunks.append(str(content))
        if chunks:
            return "\n\n".join(chunks)

    return ""


def _extract_warnings(data: dict[str, Any]) -> list[str]:
    warnings = data.get("warnings", [])
    if isinstance(warnings, list):
        return [str(item) for item in warnings if str(item).strip()]
    if warnings:
        return [str(warnings)]
    return []


def _extract_local_assets(data: Any, base_dir: Path) -> list[Path]:
    assets: list[Path] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for item in value.values():
                visit(item)
            return
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, str):
            return
        candidate = value.strip()
        if not candidate or Path(candidate).suffix.lower() not in IMAGE_SUFFIXES:
            return
        path = Path(candidate)
        choices = [path]
        if not path.is_absolute():
            choices.append(base_dir / path)
            choices.append(base_dir / "images" / path.name)
        for choice in choices:
            try:
                resolved = choice.expanduser().resolve()
            except OSError:
                continue
            if resolved.exists():
                assets.append(resolved)
                return

    visit(data)
    return assets


def _unique_assets(paths: list[Path]) -> list[Path]:
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in paths:
        resolved = path.expanduser().resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(resolved)
    return unique
