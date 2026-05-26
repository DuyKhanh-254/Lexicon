from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from .models import ProcessedNote


DEFAULT_AGENT = """# Agent

## Role
You are a domain-specific knowledge curator for this vault.

## Scope
- Keep notes factual, concise, and source-oriented.
- Prefer Markdown that works in Obsidian.
- Add links to related notes when useful.

## When ingesting
- Preserve important tables and formulas.
- Use frontmatter with source, created_at, reviewed_at, expires_at, and tags.
- Put uncertain claims in a warning section for human review.
"""


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9\u00c0-\u1ef9]+", "-", value, flags=re.IGNORECASE)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "untitled"


@dataclass
class Vault:
    path: Path

    @classmethod
    def open(cls, path: str | Path) -> "Vault":
        resolved = Path(path).expanduser().resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"Vault does not exist: {resolved}")
        if not (resolved / "agent.md").exists():
            raise FileNotFoundError(f"Missing agent.md in vault: {resolved}")
        return cls(resolved)

    @classmethod
    def init(cls, path: str | Path, name: str | None = None) -> "Vault":
        resolved = Path(path).expanduser().resolve()
        resolved.mkdir(parents=True, exist_ok=True)
        for folder in ["_inbox", "_assets/images", "_assets/diagrams", "concepts", "guidelines", "references"]:
            (resolved / folder).mkdir(parents=True, exist_ok=True)
        agent = resolved / "agent.md"
        if not agent.exists():
            title = name or resolved.name
            agent.write_text(DEFAULT_AGENT.replace("# Agent", f"# Agent - {title}"), encoding="utf-8")
        index = resolved / "_index.md"
        if not index.exists():
            index.write_text(f"# {name or resolved.name}\n\n", encoding="utf-8")
        return cls(resolved)

    @property
    def inbox(self) -> Path:
        return self.path / "_inbox"

    def read_agent(self) -> str:
        return (self.path / "agent.md").read_text(encoding="utf-8")

    def markdown_files(self) -> list[Path]:
        ignored = {"_inbox", "_assets", ".obsidian"}
        files: list[Path] = []
        for path in self.path.rglob("*.md"):
            parts = set(path.relative_to(self.path).parts)
            if ignored.intersection(parts):
                continue
            files.append(path)
        return sorted(files)

    def write_inbox_item(self, note: ProcessedNote) -> Path:
        self.inbox.mkdir(parents=True, exist_ok=True)
        filename = f"{slugify(note.title)}.md"
        target = self.inbox / filename
        counter = 2
        while target.exists():
            target = self.inbox / f"{slugify(note.title)}-{counter}.md"
            counter += 1
        target.write_text(note.markdown, encoding="utf-8")
        return target

    def commit_inbox_item(self, inbox_file: Path, folder: str | None = None) -> Path:
        if not inbox_file.is_absolute():
            inbox_file = self.inbox / inbox_file
        inbox_file = inbox_file.resolve()
        if self.inbox.resolve() not in inbox_file.parents:
            raise ValueError("Can only commit files from _inbox")
        target_folder = self.path / (folder or self._folder_from_frontmatter(inbox_file) or "concepts")
        target_folder.mkdir(parents=True, exist_ok=True)
        target = target_folder / inbox_file.name
        counter = 2
        while target.exists():
            target = target_folder / f"{inbox_file.stem}-{counter}{inbox_file.suffix}"
            counter += 1
        shutil.move(str(inbox_file), str(target))
        self.rebuild_index()
        return target

    def rebuild_index(self) -> None:
        lines = ["# Vault Index", ""]
        for md in self.markdown_files():
            if md.name in {"agent.md", "_index.md"}:
                continue
            rel = md.relative_to(self.path).as_posix()
            lines.append(f"- [[{rel[:-3]}]]")
        (self.path / "_index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    @staticmethod
    def _folder_from_frontmatter(path: Path) -> str | None:
        text = path.read_text(encoding="utf-8")
        if not text.startswith("---"):
            return None
        end = text.find("\n---", 3)
        if end == -1:
            return None
        for line in text[3:end].splitlines():
            if line.startswith("suggested_folder:"):
                return line.split(":", 1)[1].strip().strip('"')
        return None
