from __future__ import annotations

from .ai import build_provider
from .config import AppConfig
from .decay import decay_warning
from .models import ProcessedNote, utc_now_iso
from .vault import Vault, slugify
from .workspace import search_notes


def answer(vault: Vault, question: str, mode: str | None = None, config: AppConfig | None = None) -> str:
    config = config or AppConfig.load()
    mode = mode or config.default_knowledge_mode
    hits = search_notes(vault, question, limit=8, include_connected=True)
    context = "\n\n".join(
        f"[[{hit['path']}]]"
        f"{' / ' + hit['heading'] if hit.get('heading') else ''}"
        f" (score {hit['score']})"
        f"{_decay_context_warning(hit)}\n{hit['snippet']}"
        for hit in hits
    )
    if mode == "vault-only" and not hits:
        return "Không tìm thấy trong vault. Bật Vault + Model để dùng thêm kiến thức có sẵn."
    system = vault.read_agent()
    user = f"""Answer the question using the selected knowledge mode.

Knowledge mode: {mode}

Vault context:
{context or "(no matching vault context)"}

Question:
{question}

Rules:
- Cite vault notes with [[note]] when using them.
- Cite connected read-only vault notes with [[vault:VaultName/path.md]] when using them.
- If a context note includes an expiry warning, mention that the source may be outdated.
- If vault-only and context is missing, say the vault does not contain the answer.
- If using model knowledge, clearly separate it from vault-backed claims.
- Connected vault context is read-only reference material; do not imply it was written into the active vault.
"""
    return build_provider(config).complete(system, user)


def _decay_context_warning(hit: dict) -> str:
    warning = decay_warning(str(hit.get("decay_status", "")), str(hit.get("expires_at", "")))
    return f"\n{warning}" if warning else ""


def save_answer_to_inbox(
    vault: Vault,
    question: str,
    response: str,
    title: str | None = None,
    mode: str | None = None,
) -> str:
    note_title = title or _title_from_question(question)
    now = utc_now_iso()
    markdown = f"""---
title: "{note_title.replace('"', '\\"')}"
source: "chat"
created_at: "{now}"
reviewed_at: ""
expires_at: ""
suggested_folder: "concepts"
confidence: 0.70
tags: ["chat-answer"]
---

# {note_title}

## Question

{question.strip()}

## Answer

{response.strip()}

## Lexicon review
- AI-generated chat answer; review citations and claims before committing.
- Knowledge mode: {mode or "vault+model"}

<!-- lexicon-id: {slugify(note_title)}-{now} -->
"""
    note = ProcessedNote(
        title=note_title,
        markdown=markdown,
        suggested_folder="concepts",
        confidence=0.70,
        warnings=["AI-generated chat answer; review before committing."],
    )
    return str(vault.write_inbox_item(note))


def _title_from_question(question: str) -> str:
    clean = " ".join(question.strip().split())
    if not clean:
        return "Chat Answer"
    clean = clean.rstrip("?")
    return clean[:80] or "Chat Answer"
