from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .review import split_frontmatter
from .search import search
from .vault import Vault


@dataclass
class WorkspaceNote:
    path: str
    title: str
    folder: str
    size: int
    modified_at: str
    preview: str


def list_notes(vault: Vault, query: str | None = None) -> list[WorkspaceNote]:
    needle = (query or "").strip().lower()
    notes: list[WorkspaceNote] = []
    for path in vault.markdown_files():
        if path.name in {"agent.md", "_index.md"}:
            continue
        note = note_summary(vault, path)
        if needle and needle not in note.title.lower() and needle not in note.path.lower() and needle not in note.preview.lower():
            continue
        notes.append(note)
    return notes


def read_note(vault: Vault, relative_path: str) -> dict[str, Any]:
    path = resolve_note_path(vault, relative_path)
    text = path.read_text(encoding="utf-8-sig")
    frontmatter, body = split_frontmatter(text)
    summary = note_summary(vault, path)
    return {
        "path": summary.path,
        "title": frontmatter.get("title") or summary.title,
        "folder": summary.folder,
        "frontmatter": frontmatter,
        "body": body,
        "size": summary.size,
        "modified_at": summary.modified_at,
    }


def search_notes(vault: Vault, query: str, limit: int = 10) -> list[dict[str, Any]]:
    hits = search(vault, query, limit=max(limit * 2, limit))
    visible = [hit for hit in hits if not str(hit.get("path", "")).startswith("_trash/")]
    return visible[:limit]


def note_summary(vault: Vault, path: Path) -> WorkspaceNote:
    rel = path.relative_to(vault.path).as_posix()
    text = path.read_text(encoding="utf-8-sig")
    frontmatter, body = split_frontmatter(text)
    stat = path.stat()
    return WorkspaceNote(
        path=rel,
        title=frontmatter.get("title") or first_heading(body) or path.stem,
        folder=Path(rel).parts[0] if len(Path(rel).parts) > 1 else "",
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        preview=preview(body),
    )


def resolve_note_path(vault: Vault, relative_path: str) -> Path:
    candidate = (vault.path / relative_path).resolve()
    if vault.path.resolve() not in candidate.parents:
        raise ValueError(f"Note path escapes vault: {relative_path}")
    if not candidate.exists() or candidate.suffix.lower() != ".md":
        raise FileNotFoundError(f"Note does not exist: {relative_path}")
    rel_parts = set(candidate.relative_to(vault.path).parts)
    if rel_parts.intersection({"_inbox", "_assets", "_trash", ".obsidian"}):
        raise ValueError(f"Workspace cannot open internal note: {relative_path}")
    return candidate


def first_heading(body: str) -> str | None:
    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return None


def preview(body: str, max_chars: int = 360) -> str:
    compact = "\n".join(line.rstrip() for line in body.splitlines() if line.strip())
    if len(compact) <= max_chars:
        return compact
    return compact[: max_chars - 3].rstrip() + "..."
