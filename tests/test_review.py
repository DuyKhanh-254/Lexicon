from __future__ import annotations

from lexicon.cli import format_inbox_detail, format_inbox_list
from lexicon.review import read_inbox_item, split_frontmatter


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
