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
    body: str


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
        body=body,
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


def merge_inbox_into_note(vault: Vault, index: int, target: str | Path) -> Path:
    items = inbox_items(vault)
    if index < 1 or index > len(items):
        raise IndexError(f"Inbox item index out of range: {index}")

    inbox_file = items[index - 1]
    target_path = _resolve_committed_note(vault, target)
    item = read_inbox_item(index, inbox_file)
    target_text = target_path.read_text(encoding="utf-8-sig").rstrip()
    incoming = _body_without_review(item.body)
    merged = "\n\n".join(
        part
        for part in [
            target_text,
            "## Merged review item",
            f"**Title:** {item.title}",
            f"**Source:** {item.source or 'unknown'}",
            incoming,
        ]
        if part.strip()
    )
    target_path.write_text(merged.rstrip() + "\n", encoding="utf-8")
    inbox_file.unlink()
    vault.rebuild_index()
    rebuild_index(vault)
    return target_path


def reject(vault: Vault, index: int) -> Path:
    items = inbox_items(vault)
    if index < 1 or index > len(items):
        raise IndexError(f"Inbox item index out of range: {index}")
    target = items[index - 1]
    target.unlink()
    return target


def replace_inbox_body(vault: Vault, index: int, body: str) -> Path:
    items = inbox_items(vault)
    if index < 1 or index > len(items):
        raise IndexError(f"Inbox item index out of range: {index}")
    target = items[index - 1]
    text = target.read_text(encoding="utf-8-sig")
    prefix = ""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            prefix = text[: end + 4].rstrip() + "\n\n"
    clean_body = body.strip()
    target.write_text(prefix + clean_body + "\n", encoding="utf-8")
    return target


def _resolve_committed_note(vault: Vault, target: str | Path) -> Path:
    target_path = Path(target)
    if not target_path.is_absolute():
        target_path = vault.path / target_path
    resolved = target_path.resolve()
    vault_root = vault.path.resolve()
    if vault_root not in resolved.parents:
        raise ValueError(f"Target note is outside the vault: {target}")
    rel_parts = set(resolved.relative_to(vault_root).parts)
    if rel_parts.intersection({"_inbox", "_assets", "_trash", ".obsidian"}):
        raise ValueError(f"Target note must be a committed vault note: {target}")
    if resolved.suffix.lower() != ".md":
        raise ValueError(f"Target note must be Markdown: {target}")
    if not resolved.exists():
        raise FileNotFoundError(f"Target note does not exist: {target}")
    return resolved


def _body_without_review(body: str) -> str:
    return body.split("## Lexicon review", 1)[0].strip()


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
