from __future__ import annotations

from lexicon.cli import format_inbox_detail, format_inbox_list
from lexicon.review import merge_inbox_into_note, read_inbox_item, replace_inbox_body, split_frontmatter
from lexicon.vault import Vault


def test_split_frontmatter_and_read_inbox_item(tmp_path):
    path = tmp_path / "note.md"
    path.write_text(
        """---
title: "Gentamicin Dosing"
source: "manual"
suggested_folder: "guidelines"
confidence: 0.82
tags: ["gentamicin"]
---

# Gentamicin Dosing

Requires renal dosing.

## Lexicon review
- Needs target trough review
- Needs CrCl formula

<!-- lexicon-id: test -->
""",
        encoding="utf-8",
    )

    frontmatter, body = split_frontmatter(path.read_text(encoding="utf-8"))
    assert frontmatter["title"] == "Gentamicin Dosing"
    assert "Requires renal dosing." in body

    item = read_inbox_item(1, path)
    assert item.title == "Gentamicin Dosing"
    assert item.suggested_folder == "guidelines"
    assert item.confidence == 0.82
    assert item.warnings == ["Needs target trough review", "Needs CrCl formula"]
    assert "Requires renal dosing." in item.body_preview

    listing = format_inbox_list([item])
    assert "0.82" in listing
    assert "Gentamicin Dosing !" in listing

    detail = format_inbox_detail(item)
    assert "Warnings:" in detail
    assert "Needs CrCl formula" in detail


def test_replace_inbox_body_preserves_frontmatter(tmp_path):
    vault = Vault.init(tmp_path / "vault")
    path = vault.inbox / "note.md"
    path.write_text(
        """---
title: "Editable Note"
source: "manual"
suggested_folder: "references"
confidence: 0.75
---

# Editable Note

Old body.
""",
        encoding="utf-8",
    )

    replace_inbox_body(vault, 1, "# Editable Note\n\nUpdated Vietnamese body: kiến trúc độc lập.")

    text = path.read_text(encoding="utf-8")
    assert 'title: "Editable Note"' in text
    assert 'suggested_folder: "references"' in text
    assert "Old body." not in text
    assert "Updated Vietnamese body: kiến trúc độc lập." in text

    item = read_inbox_item(1, path)
    assert item.suggested_folder == "references"
    assert item.body.startswith("# Editable Note")


def test_merge_inbox_into_committed_note_appends_body_and_removes_inbox(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / ".lexicon"))
    vault = Vault.init(tmp_path / "vault")
    committed = vault.path / "concepts" / "aminoglycoside-monitoring.md"
    committed.write_text("# Aminoglycoside Monitoring\n\nExisting guidance.\n", encoding="utf-8")
    inbox = vault.inbox / "aminoglycosides.md"
    inbox.write_text(
        """---
title: "Aminoglycosides"
source: "pasted text"
suggested_folder: "concepts"
confidence: 0.75
---

[[Aminoglycosides]] require [[therapeutic drug monitoring]].

## Lexicon review
- Potential duplicates: concepts/aminoglycoside-monitoring.md (0.82)

<!-- lexicon-id: test -->
""",
        encoding="utf-8",
    )

    target = merge_inbox_into_note(vault, 1, "concepts/aminoglycoside-monitoring.md")

    assert target == committed.resolve()
    assert not inbox.exists()
    merged = committed.read_text(encoding="utf-8")
    assert "Existing guidance." in merged
    assert "## Merged review item" in merged
    assert "**Source:** pasted text" in merged
    assert "[[therapeutic drug monitoring]]" in merged
    assert "Potential duplicates" not in merged
