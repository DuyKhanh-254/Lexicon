from __future__ import annotations

from pathlib import Path

from lexicon.models import ExtractedContent, SourceInput


def extract_with_mineru(source: SourceInput, endpoint: str, timeout_seconds: int = 900) -> ExtractedContent:
    try:
        import requests
        from requests import RequestException
    except ImportError as exc:
        raise RuntimeError("MinerU HTTP adapter requires installing requests.") from exc

    path = Path(source.value).expanduser().resolve()
    url = endpoint.rstrip("/") + "/file_parse"
    try:
        with path.open("rb") as file:
            response = requests.post(
                url,
                files=[("files", (path.name, file, "application/pdf"))],
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
    return ExtractedContent(
        markdown=markdown,
        source_label=str(path),
        warnings=data.get("warnings", []),
        confidence=float(data.get("confidence", 0.85)),
        metadata={"mineru": data},
    )


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
