from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .review import split_frontmatter
from .search import search
from .vault import ConnectedVault, Vault


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
    target_vault, path, connected = resolve_note_reference(vault, relative_path)
    text = path.read_text(encoding="utf-8-sig")
    frontmatter, body = split_frontmatter(text)
    summary = note_summary(target_vault, path)
    display_path = f"vault:{connected.name}/{summary.path}" if connected else summary.path
    return {
        "path": display_path,
        "title": frontmatter.get("title") or summary.title,
        "folder": f"{connected.name}/{summary.folder}" if connected and summary.folder else summary.folder,
        "frontmatter": frontmatter,
        "body": body,
        "size": summary.size,
        "modified_at": summary.modified_at,
        "vault_name": connected.name if connected else "",
        "vault_path": str(target_vault.path),
        "external": connected is not None,
    }


def search_notes(vault: Vault, query: str, limit: int = 10, include_connected: bool = False) -> list[dict[str, Any]]:
    hits = [_annotate_hit(hit, None) for hit in search(vault, query, limit=max(limit * 2, limit))]
    if include_connected:
        for connected in vault.connected_vaults():
            connected_vault = _open_connected_vault(connected)
            if connected_vault is None:
                continue
            hits.extend(
                _annotate_hit(hit, connected)
                for hit in search(connected_vault, query, limit=max(limit, 3))
            )
    visible = [hit for hit in hits if not _is_internal_hit(hit)]
    visible.sort(key=lambda item: float(item.get("score", 0)), reverse=True)
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


def resolve_note_reference(vault: Vault, reference: str) -> tuple[Vault, Path, ConnectedVault | None]:
    if reference.startswith("vault:"):
        vault_name, note_path = _split_vault_reference(reference)
        connected = next((item for item in vault.connected_vaults() if item.name.lower() == vault_name.lower()), None)
        if connected is None:
            raise FileNotFoundError(f"Connected vault is not declared in agent.md: {vault_name}")
        connected_vault = _open_connected_vault(connected)
        if connected_vault is None:
            raise FileNotFoundError(f"Connected vault is not readable: {connected.path}")
        return connected_vault, resolve_note_path(connected_vault, note_path), connected
    return vault, resolve_note_path(vault, reference), None


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


def _annotate_hit(hit: dict[str, Any], connected: ConnectedVault | None) -> dict[str, Any]:
    item = dict(hit)
    raw_path = str(item.get("path", ""))
    if connected:
        item["path"] = f"vault:{connected.name}/{raw_path}"
        item["vault_name"] = connected.name
        item["vault_path"] = str(connected.path)
        item["external"] = True
    else:
        item["vault_name"] = ""
        item["vault_path"] = ""
        item["external"] = False
    return item


def _is_internal_hit(hit: dict[str, Any]) -> bool:
    path = str(hit.get("path", ""))
    if path.startswith("vault:"):
        path = path.split("/", 1)[1] if "/" in path else path
    return path.startswith("_trash/")


def _split_vault_reference(reference: str) -> tuple[str, str]:
    body = reference.removeprefix("vault:").strip()
    if "/" not in body:
        raise ValueError(f"Cross-vault note reference must include a note path: {reference}")
    vault_name, note_path = body.split("/", 1)
    note_path = note_path.strip()
    if not note_path.lower().endswith(".md"):
        note_path = f"{note_path}.md"
    return vault_name.strip(), note_path


def _open_connected_vault(connected: ConnectedVault) -> Vault | None:
    try:
        return Vault.open(connected.path)
    except (FileNotFoundError, ValueError):
        return None
