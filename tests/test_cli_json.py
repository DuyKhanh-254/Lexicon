from __future__ import annotations

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
