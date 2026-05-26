from __future__ import annotations

import re
from urllib import request

from lexicon.models import ExtractedContent, SourceInput


TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")


def extract_url(source: SourceInput) -> ExtractedContent:
    req = request.Request(source.value, headers={"User-Agent": "Lexicon/0.1"})
    with request.urlopen(req, timeout=30) as response:
        html = response.read().decode("utf-8", errors="replace")
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.I | re.S)
    title = source.title or (title_match.group(1).strip() if title_match else source.value)
    text = TAG_RE.sub(" ", html)
    text = SPACE_RE.sub(" ", text).strip()
    markdown = f"# {title}\n\nSource: {source.value}\n\n{text}\n"
    return ExtractedContent(
        markdown=markdown,
        source_label=source.value,
        warnings=["URL extracted with simple HTTP fallback; JS-rendered content may be incomplete."],
        confidence=0.65,
    )
