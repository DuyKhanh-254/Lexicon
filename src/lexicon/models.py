from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass(frozen=True)
class SourceInput:
    kind: str
    value: str
    title: str | None = None
    note: str | None = None


@dataclass
class ExtractedContent:
    markdown: str
    source_label: str
    assets: list[Path] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    confidence: float = 0.8
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProcessedNote:
    title: str
    markdown: str
    suggested_folder: str
    confidence: float
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class AINoteDraft:
    title: str
    body: str
    suggested_folder: str = "concepts"
    tags: list[str] = field(default_factory=list)
    confidence: float = 0.75
    warnings: list[str] = field(default_factory=list)
    expires_at: str = ""
