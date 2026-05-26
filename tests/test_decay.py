from __future__ import annotations

import json
from datetime import date

from lexicon.cli import format_decay
from lexicon.decay import note_decay_info, scan_decay
from lexicon.search import rebuild_index, search
from lexicon.vault import Vault


def test_note_decay_info_statuses(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    expired = vault.path / "guidelines" / "expired.md"
    expired.write_text(
        """---
title: "Expired"
expires_at: "2026-01-01"
reviewed_at: "2025-01-01"
---

# Expired
content
""",
        encoding="utf-8",
    )
    soon = vault.path / "concepts" / "soon.md"
    soon.write_text(
        """---
title: "Soon"
expires_at: "2026-06-01"
reviewed_at: ""
---

# Soon
content
""",
        encoding="utf-8",
    )

    assert note_decay_info(vault, expired, today=date(2026, 5, 20)).status == "expired"
    assert note_decay_info(vault, soon, due_soon_days=20, today=date(2026, 5, 20)).status == "due_soon"


def test_scan_decay_and_format(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    (vault.path / "guidelines" / "expired.md").write_text(
        """---
title: "Expired"
expires_at: "2020-01-01"
reviewed_at: "2019-01-01"
---

# Expired
content
""",
        encoding="utf-8",
    )
    rows = scan_decay(vault)
    output = format_decay(rows)

    assert rows[0].status == "expired"
    assert "expired" in output
    assert "guidelines/expired.md" in output


def test_index_includes_decay_metadata_for_chat_context(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    (vault.path / "guidelines" / "old.md").write_text(
        """---
title: "Old Guideline"
expires_at: "2020-01-01"
reviewed_at: "2019-01-01"
---

# Old Guideline
Vancomycin renal dosing guidance.
""",
        encoding="utf-8",
    )

    target = rebuild_index(vault)
    payload = json.loads(target.read_text(encoding="utf-8"))
    assert payload["version"] == 3
    assert payload["chunks"][0]["decay_status"] == "expired"

    hits = search(vault, "vancomycin renal", limit=1)
    assert hits[0]["decay_status"] == "expired"
    assert hits[0]["expires_at"] == "2020-01-01"
