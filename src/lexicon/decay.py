from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .vault import Vault


@dataclass
class DecayInfo:
    path: str
    title: str
    status: str
    expires_at: str
    reviewed_at: str
    days_until_expiry: int | None


def note_decay_info(vault: Vault, note_path: Path, due_soon_days: int = 30, today: date | None = None) -> DecayInfo:
    today = today or datetime.now(timezone.utc).date()
    text = note_path.read_text(encoding="utf-8-sig")
    frontmatter, _body = split_frontmatter(text)
    expires_at = frontmatter.get("expires_at", "")
    reviewed_at = frontmatter.get("reviewed_at", "")
    title = frontmatter.get("title", note_path.stem)
    expiry = parse_date(expires_at)
    rel = note_path.relative_to(vault.path).as_posix()

    if expiry is None:
        return DecayInfo(rel, title, "no_expiry", expires_at, reviewed_at, None)

    delta = (expiry - today).days
    if delta < 0:
        status = "expired"
    elif delta <= due_soon_days:
        status = "due_soon"
    else:
        status = "fresh"
    return DecayInfo(rel, title, status, expires_at, reviewed_at, delta)


def scan_decay(vault: Vault, due_soon_days: int = 30, include_fresh: bool = False) -> list[DecayInfo]:
    rows: list[DecayInfo] = []
    for path in vault.markdown_files():
        if path.name in {"agent.md", "_index.md"}:
            continue
        info = note_decay_info(vault, path, due_soon_days=due_soon_days)
        if include_fresh or info.status in {"expired", "due_soon"}:
            rows.append(info)
    return sorted(rows, key=_sort_key)


def update_decay_metadata(
    vault: Vault,
    relative_path: str,
    reviewed_at: str | None = None,
    expires_at: str | None = None,
    extend_days: int | None = None,
    today: date | None = None,
) -> DecayInfo:
    path = _resolve_note_path(vault, relative_path)
    today = today or datetime.now(timezone.utc).date()
    if reviewed_at is None:
        reviewed_at = today.isoformat()
    if extend_days is not None:
        expires_at = (today + timedelta(days=extend_days)).isoformat()
    text = path.read_text(encoding="utf-8-sig")
    updated = update_frontmatter(text, {"reviewed_at": reviewed_at, "expires_at": expires_at})
    path.write_text(updated, encoding="utf-8")
    return note_decay_info(vault, path, today=today)


def decay_warning(status: str, expires_at: str) -> str:
    if status == "expired":
        return f"WARNING: this note expired on {expires_at}; information may be outdated."
    if status == "due_soon":
        return f"NOTICE: this note expires soon on {expires_at}; verify freshness if used for decisions."
    return ""


def parse_date(value: str) -> date | None:
    value = value.strip().strip('"')
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


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


def update_frontmatter(text: str, updates: dict[str, str | None]) -> str:
    clean_updates = {key: value for key, value in updates.items() if value is not None}
    if not clean_updates:
        return text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            raw = text[3:end]
            body = text[end + 4 :].lstrip()
            lines = raw.splitlines()
            seen: set[str] = set()
            next_lines: list[str] = []
            for line in lines:
                if ":" not in line:
                    next_lines.append(line)
                    continue
                key, _value = line.split(":", 1)
                clean_key = key.strip()
                if clean_key in clean_updates:
                    next_lines.append(f'{clean_key}: "{clean_updates[clean_key]}"')
                    seen.add(clean_key)
                else:
                    next_lines.append(line)
            for key, value in clean_updates.items():
                if key not in seen:
                    next_lines.append(f'{key}: "{value}"')
            return "---\n" + "\n".join(next_lines).strip() + "\n---\n\n" + body

    lines = [f'{key}: "{value}"' for key, value in clean_updates.items()]
    return "---\n" + "\n".join(lines) + "\n---\n\n" + text.lstrip()


def _sort_key(info: DecayInfo) -> tuple[int, str, str]:
    rank = {"expired": 0, "due_soon": 1, "fresh": 2, "no_expiry": 3}
    return (rank.get(info.status, 9), info.expires_at or "9999-99-99", info.path)


def _resolve_note_path(vault: Vault, relative_path: str) -> Path:
    candidate = (vault.path / relative_path).resolve()
    if vault.path.resolve() not in candidate.parents:
        raise ValueError(f"Note path escapes vault: {relative_path}")
    if not candidate.exists() or candidate.suffix.lower() != ".md":
        raise FileNotFoundError(f"Note does not exist: {relative_path}")
    rel_parts = set(candidate.relative_to(vault.path).parts)
    if rel_parts.intersection({"_inbox", "_assets", "_trash", ".obsidian"}):
        raise ValueError(f"Decay cannot update internal note: {relative_path}")
    return candidate
