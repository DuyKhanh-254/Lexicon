from __future__ import annotations

import json

from lexicon.search import chunk_markdown, index_path, rebuild_index, search, similar_existing
from lexicon.vault import Vault, parse_connected_vaults
from lexicon.workspace import read_note, search_notes


def test_chunk_markdown_splits_by_heading_and_token_windows():
    text = """---
title: "Example"
---

# Vancomycin

Renal dosing section.

## Monitoring

Trough monitoring and kidney function.
"""
    chunks = chunk_markdown(text, "note.md", "note")

    assert [chunk.heading for chunk in chunks] == ["Vancomycin", "Monitoring"]
    assert "Renal dosing" in chunks[0].text
    assert "Trough monitoring" in chunks[1].text


def test_search_ranks_relevant_chunk_and_writes_versioned_index(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    (vault.path / "concepts" / "vancomycin.md").write_text(
        "# Vancomycin\n\nRenal dose adjustment and trough monitoring.\n\n## Adverse effects\n\nOtotoxicity.",
        encoding="utf-8",
    )
    (vault.path / "concepts" / "metformin.md").write_text(
        "# Metformin\n\nDiabetes medication and lactic acidosis risk.",
        encoding="utf-8",
    )

    target = rebuild_index(vault)
    payload = json.loads(target.read_text(encoding="utf-8"))
    assert payload["version"] == 3
    assert len(payload["chunks"]) >= 2

    hits = search(vault, "renal trough dosing", limit=2)
    assert hits[0]["path"] == "concepts/vancomycin.md"
    assert hits[0]["score"] > 0
    assert "Renal dose" in hits[0]["snippet"]


def test_similar_existing_uses_chunk_similarity(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    (vault.path / "concepts" / "amikacin.md").write_text(
        "# Amikacin\n\nAmikacin requires renal dose adjustment and therapeutic drug monitoring.",
        encoding="utf-8",
    )
    rebuild_index(vault)

    matches = similar_existing(
        vault,
        "# Aminoglycoside\n\nAmikacin requires renal dose adjustment and therapeutic drug monitoring.",
        threshold=0.5,
    )

    assert matches
    assert matches[0]["path"] == "concepts/amikacin.md"
    assert matches[0]["similarity"] >= 0.5


def test_similar_existing_catches_short_paraphrase(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    vault = Vault.init(tmp_path / "vault")
    (vault.path / "guidelines" / "aminoglycoside-monitoring.md").write_text(
        "# Aminoglycoside Monitoring\n\n"
        "[[Aminoglycosides]] require renal dose adjustment. "
        "[[Therapeutic drug monitoring]] is needed. "
        "Peak and trough targets depend on the specific clinical indication.",
        encoding="utf-8",
    )
    rebuild_index(vault)

    matches = similar_existing(
        vault,
        "[[Aminoglycosides]] need [[renal dose adjustment]] and "
        "[[therapeutic drug monitoring]] with peak and trough levels depending on indication.",
        threshold=0.5,
    )

    assert matches
    assert matches[0]["path"] == "guidelines/aminoglycoside-monitoring.md"


def test_connected_vaults_are_read_only_search_context(tmp_path, monkeypatch):
    monkeypatch.setenv("LEXICON_HOME", str(tmp_path / "home"))
    primary = Vault.init(tmp_path / "primary")
    reference = Vault.init(tmp_path / "epidemiology", name="Epidemiology")
    (reference.path / "concepts" / "cohort-study-design.md").write_text(
        "# Cohort Study Design\n\nCohort studies follow exposed and unexposed groups over time.",
        encoding="utf-8",
    )
    (primary.path / "agent.md").write_text(
        f"""# Agent - Primary

## Role
Curate clinical notes.

## Connected vaults
- Epidemiology: {reference.path} (read-only)
""",
        encoding="utf-8",
    )
    rebuild_index(primary)
    rebuild_index(reference)

    connected = parse_connected_vaults((primary.path / "agent.md").read_text(encoding="utf-8"), primary.path)
    assert connected[0].name == "Epidemiology"
    assert connected[0].path == reference.path

    hits = search_notes(primary, "exposed unexposed cohort", include_connected=True)
    assert hits[0]["path"] == "vault:Epidemiology/concepts/cohort-study-design.md"
    assert hits[0]["external"] is True

    note = read_note(primary, "vault:Epidemiology/concepts/cohort-study-design.md")
    assert note["external"] is True
    assert note["vault_name"] == "Epidemiology"
    assert "exposed and unexposed" in note["body"]
