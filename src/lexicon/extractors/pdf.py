from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from lexicon.models import ExtractedContent, SourceInput


def extract_pdf(source: SourceInput) -> ExtractedContent:
    path = Path(source.value).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(path)
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        return ExtractedContent(
            markdown=f"# {source.title or path.stem}\n\nSource: {path}\n",
            source_label=str(path),
            warnings=["pdftotext not found; PDF content was not extracted."],
            confidence=0.2,
        )
    result = subprocess.run(
        [pdftotext, "-layout", str(path), "-"],
        check=True,
        text=True,
        capture_output=True,
        timeout=120,
    )
    text = result.stdout.strip()
    warnings = []
    confidence = 0.75
    if not text:
        warnings.append("PDF has no text layer; configure MinerU OCR for scanned documents.")
        confidence = 0.25
    markdown = f"# {source.title or path.stem}\n\nSource: {path}\n\n{text}\n"
    return ExtractedContent(markdown=markdown, source_label=str(path), warnings=warnings, confidence=confidence)
