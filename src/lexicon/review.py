from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .search import rebuild_index
from .vault import Vault


@dataclass
class InboxItem:
    index: int
    path: Path
    title: str
    source: str
    suggested_folder: str
    confidence: float | None
    warnings: list[str]
    body_preview: str


def inbox_items(vault: Vault) -> list[Path]:
    vault.inbox.mkdir(parents=True, exist_ok=True)
    return sorted(vault.inbox.glob("*.md"))


def inbox_details(vault: Vault) -> list[InboxItem]:
    return [read_inbox_item(index, path) for index, path in enumerate(inbox_items(vault), start=1)]


def read_inbox_item(index: int, path: Path) -> InboxItem:
    text = path.read_text(encoding="utf-8-sig")
    frontmatter, body = split_frontmatter(text)
    warnings = extract_review_warnings(body)
    return InboxItem(
        index=index,
        path=path,
        title=frontmatter.get("title") or path.stem,
        source=frontmatter.get("source") or "",
        suggested_folder=frontmatter.get("suggested_folder") or "concepts",
        confidence=_parse_float(frontmatter.get("confidence")),
        warnings=warnings,
        body_preview=preview_body(body),
    )


def get_inbox_detail(vault: Vault, index: int) -> InboxItem:
    items = inbox_items(vault)
    if index < 1 or index > len(items):
        raise IndexError(f"Inbox item index out of range: {index}")
    return read_inbox_item(index, items[index - 1])


def approve(vault: Vault, index: int, folder: str | None = None) -> Path:
    items = inbox_items(vault)
    if index < 1 or index > len(items):
        raise IndexError(f"Inbox item index out of range: {index}")
    target = vault.commit_inbox_item(items[index - 1], folder=folder)
    rebuild_index(vault)
    return target


def reject(vault: Vault, index: int) -> Path:
    items = inbox_items(vault)
    if index < 1 or index > len(items):
        raise IndexError(f"Inbox item index out of range: {index}")
    target = items[index - 1]
    target.unlink()
    return target


def split_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw = text[3:end]
    body = text[end + 4 :].lstrip()
    data: dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip('"')
    return data, body


def extract_review_warnings(body: str) -> list[str]:
    marker = "## Lexicon review"
    if marker not in body:
        return []
    section = body.split(marker, 1)[1]
    lines: list[str] = []
    for raw in section.splitlines():
        line = raw.strip()
        if line.startswith("<!--"):
            break
        if line.startswith("## ") and lines:
            break
        if line.startswith("- "):
            item = line[2:].strip()
            if item and item.lower() != "none":
                lines.append(item)
    return lines


def preview_body(body: str, max_chars: int = 700) -> str:
    without_review = body.split("## Lexicon review", 1)[0].strip()
    compact = "\n".join(line.rstrip() for line in without_review.splitlines() if line.strip())
    if len(compact) <= max_chars:
        return compact
    return compact[: max_chars - 3].rstrip() + "..."


def _parse_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None
