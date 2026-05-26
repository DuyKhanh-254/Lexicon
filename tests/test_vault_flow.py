from __future__ import annotations

from lexicon.chat import answer
from lexicon.chat import save_answer_to_inbox
from lexicon.config import AppConfig
from lexicon.ingestion import ingest
from lexicon.models import SourceInput
from lexicon.review import approve, inbox_items
from lexicon.vault import Vault


def test_ingest_review_chat_flow(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    AppConfig().save()
    vault = Vault.init(tmp_path / "vault", name="Clinical Pharmacology")

    inbox_file = ingest(
        vault,
        SourceInput(
            kind="text",
            value="Vancomycin dosing should be adjusted in renal impairment.",
            title="Vancomycin dosing",
        ),
    )

    assert inbox_file.exists()
    inbox_text = inbox_file.read_text(encoding="utf-8")
    assert inbox_text.startswith("---")
    assert inbox_text.count("---") == 2
    assert "suggested_folder:" in inbox_text
    assert len(inbox_items(vault)) == 1

    committed = approve(vault, 1)
    assert committed.exists()
    assert not inbox_file.exists()
    assert "vancomycin" in (vault.path / "_index.md").read_text(encoding="utf-8")

    response = answer(vault, "renal vancomycin", mode="vault-only")
    assert "Vancomycin" in response


def test_save_chat_answer_to_inbox_and_approve(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    AppConfig().save()
    vault = Vault.init(tmp_path / "vault", name="Clinical Pharmacology")

    target = save_answer_to_inbox(
        vault,
        question="What does the vault say about vancomycin?",
        response="The vault says [[Vancomycin]] requires renal dose adjustment.",
        title="Vancomycin Chat Summary",
        mode="vault-only",
    )

    items = inbox_items(vault)
    assert len(items) == 1
    assert str(items[0]) == target
    text = items[0].read_text(encoding="utf-8")
    assert 'source: "chat"' in text
    assert 'tags: ["chat-answer"]' in text
    assert "AI-generated chat answer" in text

    committed = approve(vault, 1)
    assert committed.exists()
    assert committed.parent.name == "concepts"
