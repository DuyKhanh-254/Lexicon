from __future__ import annotations

import base64
import json

from lexicon.cli import main
from lexicon.config import AppConfig
from lexicon.vault import Vault


def test_doctor_json_outputs_machine_readable_payload(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    AppConfig(api_key_env="MISSING_TEST_KEY").save()

    assert main(["doctor", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)

    assert data["ok"] is True
    assert data["doctor"]["api_key_set"] is False
    assert "pdftotext" in data["doctor"]["dependencies"]


def test_settings_json_outputs_machine_readable_payload(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))

    assert main(["settings", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)

    assert data["ok"] is True
    assert data["settings"]["provider"] == "local"
    assert data["settings"]["default_knowledge_mode"] == "vault+model"


def test_agent_json_reads_saves_and_initializes_agent_md(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")

    assert main(["agent", "--vault", str(vault.path), "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["ok"] is True
    assert data["agent"]["filename"] == "agent.md"
    assert "# Agent" in data["agent"]["body"]

    body = "# Agent - Test\n\n## Role\nCurate cardiology notes."
    encoded = base64.b64encode(body.encode("utf-8")).decode("ascii")
    assert main(["agent", "--vault", str(vault.path), "--body-base64", encoded, "--json"]) == 0
    saved = json.loads(capsys.readouterr().out)
    assert saved["agent"]["body"].startswith("# Agent - Test")
    assert "Curate cardiology notes." in (vault.path / "agent.md").read_text(encoding="utf-8")

    missing_agent_vault = tmp_path / "missing-agent"
    missing_agent_vault.mkdir()
    assert main(["agent", "--vault", str(missing_agent_vault), "--init", "--json"]) == 0
    initialized = json.loads(capsys.readouterr().out)
    assert initialized["agent"]["exists"] is True
    assert (missing_agent_vault / "agent.md").exists()


def test_inbox_json_list_and_show(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    (vault.inbox / "note.md").write_text(
        """---
title: "Inbox Note"
source: "manual"
suggested_folder: "concepts"
confidence: 0.5
---

# Inbox Note

Body.

## Lexicon review
- Needs review
""",
        encoding="utf-8",
    )

    assert main(["inbox", "--vault", str(vault.path), "--json"]) == 0
    listed = json.loads(capsys.readouterr().out)
    assert listed["items"][0]["filename"] == "note.md"
    assert listed["items"][0]["warnings"] == ["Needs review"]

    assert main(["inbox", "--vault", str(vault.path), "--show", "1", "--json"]) == 0
    shown = json.loads(capsys.readouterr().out)
    assert shown["item"]["title"] == "Inbox Note"
    assert "Body." in shown["item"]["body_preview"]
    assert "Body." in shown["item"]["body"]

    updated_body = "# Inbox Note\n\nUpdated body b\u1eb1ng ti\u1ebfng Vi\u1ec7t."
    body_file = tmp_path / "body.md"
    body_file.write_text(updated_body, encoding="utf-8")
    assert main(
        [
            "inbox",
            "--vault",
            str(vault.path),
            "--replace-body",
            "1",
            "--body-file",
            str(body_file),
            "--json",
        ]
    ) == 0
    updated = json.loads(capsys.readouterr().out)
    assert updated["item"]["title"] == "Inbox Note"
    assert "Updated body b\u1eb1ng ti\u1ebfng Vi\u1ec7t." in updated["item"]["body"]
    assert 'title: "Inbox Note"' in (vault.inbox / "note.md").read_text(encoding="utf-8")

    second_body = "# Inbox Note\n\nSecond update b\u1eb1ng base64."
    encoded_body = base64.b64encode(second_body.encode("utf-8")).decode("ascii")
    assert main(
        [
            "inbox",
            "--vault",
            str(vault.path),
            "--replace-body",
            "1",
            "--body-base64",
            encoded_body,
            "--json",
        ]
    ) == 0
    second_updated = json.loads(capsys.readouterr().out)
    assert "Second update b\u1eb1ng base64." in second_updated["item"]["body"]


def test_inbox_json_merge_into_existing_note(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    existing = vault.path / "concepts" / "aminoglycoside-monitoring.md"
    existing.write_text("# Aminoglycoside Monitoring\n\nExisting content.\n", encoding="utf-8")
    (vault.inbox / "aminoglycosides.md").write_text(
        """---
title: "Aminoglycosides"
source: "manual"
suggested_folder: "concepts"
confidence: 0.75
---

[[Aminoglycosides]] require monitoring.

## Lexicon review
- Potential duplicates: concepts/aminoglycoside-monitoring.md (0.82)
""",
        encoding="utf-8",
    )

    assert main(
        [
            "inbox",
            "--vault",
            str(vault.path),
            "--merge-into",
            "1",
            "--target",
            "concepts/aminoglycoside-monitoring.md",
            "--json",
        ]
    ) == 0
    data = json.loads(capsys.readouterr().out)

    assert data["ok"] is True
    assert data["target"] == "concepts/aminoglycoside-monitoring.md"
    assert not (vault.inbox / "aminoglycosides.md").exists()
    assert "[[Aminoglycosides]] require monitoring." in existing.read_text(encoding="utf-8")


def test_decay_json(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    (vault.path / "guidelines" / "expired.md").write_text(
        """---
title: "Expired"
expires_at: "2020-01-01"
reviewed_at: "2019-01-01"
---

# Expired
Body.
""",
        encoding="utf-8",
    )

    assert main(["decay", "--vault", str(vault.path), "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["items"][0]["status"] == "expired"
    assert data["items"][0]["path"] == "guidelines/expired.md"

    assert main(
        [
            "decay",
            "--vault",
            str(vault.path),
            "--update",
            "guidelines/expired.md",
            "--reviewed-at",
            "2026-06-04",
            "--expires-at",
            "2027-06-04",
            "--json",
        ]
    ) == 0
    updated = json.loads(capsys.readouterr().out)
    assert updated["item"]["status"] == "fresh"
    text = (vault.path / "guidelines" / "expired.md").read_text(encoding="utf-8")
    assert 'reviewed_at: "2026-06-04"' in text
    assert 'expires_at: "2027-06-04"' in text
    assert "Body." in text


def test_workspace_json_lists_reads_and_searches_notes(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    (vault.path / "concepts" / "lexicon.md").write_text(
        """---
title: "Lexicon Design"
---

# Lexicon Design

Standalone app with MinerU ingestion and review workflow.
""",
        encoding="utf-8",
    )

    assert main(["workspace", "--vault", str(vault.path), "--json"]) == 0
    listed = json.loads(capsys.readouterr().out)
    assert listed["notes"][0]["path"] == "concepts/lexicon.md"
    assert listed["notes"][0]["title"] == "Lexicon Design"

    assert main(["workspace", "--vault", str(vault.path), "--read", "concepts/lexicon.md", "--json"]) == 0
    read = json.loads(capsys.readouterr().out)
    assert read["note"]["frontmatter"]["title"] == "Lexicon Design"
    assert "MinerU ingestion" in read["note"]["body"]

    assert main(["scan", "--vault", str(vault.path), "--json"]) == 0
    capsys.readouterr()
    assert main(["workspace", "--vault", str(vault.path), "--search", "MinerU review", "--json"]) == 0
    searched = json.loads(capsys.readouterr().out)
    assert searched["hits"][0]["path"] == "concepts/lexicon.md"


def test_chat_json_answer_and_save_to_inbox(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    AppConfig(provider="local").save()
    vault = Vault.init(tmp_path / "vault")
    (vault.path / "concepts" / "vancomycin.md").write_text(
        "# Vancomycin\n\nVancomycin requires renal dose adjustment.",
        encoding="utf-8",
    )

    assert main(
        [
            "chat",
            "--vault",
            str(vault.path),
            "--mode",
            "vault-only",
            "--save",
            "--title",
            "Vancomycin Chat Summary",
            "--json",
            "What does the vault say about vancomycin?",
        ]
    ) == 0
    data = json.loads(capsys.readouterr().out)

    assert data["ok"] is True
    assert data["mode"] == "vault-only"
    assert "answer" in data
    assert data["saved"]
    assert (vault.inbox / "vancomycin-chat-summary.md").exists()
