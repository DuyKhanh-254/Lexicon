from __future__ import annotations

from lexicon.processor import parse_ai_note_draft


def test_parse_json_draft_strips_frontmatter_and_normalizes_tags():
    raw = """
```json
{
  "title": "Vancomycin Dosing",
  "suggested_folder": "guidelines",
  "tags": ["Drug Dosing", "Renal Impairment"],
  "confidence": 0.91,
  "expires_at": "2027-01-01",
  "warnings": ["Needs CrCl formula review"],
  "body": "---\\ntitle: bad\\n---\\n# Vancomycin\\nDose adjust in renal impairment."
}
```
"""
    draft = parse_ai_note_draft(raw, "Fallback", "Fallback body")

    assert draft.title == "Vancomycin Dosing"
    assert draft.suggested_folder == "guidelines"
    assert draft.tags == ["drug-dosing", "renal-impairment"]
    assert draft.confidence == 0.91
    assert draft.expires_at == "2027-01-01"
    assert draft.warnings == ["Needs CrCl formula review"]
    assert not draft.body.startswith("---")
    assert "Dose adjust" in draft.body


def test_parse_invalid_json_falls_back_to_markdown():
    draft = parse_ai_note_draft("```markdown\n# Note\nBody\n```", "Fallback", "Fallback body")

    assert draft.title == "Fallback"
    assert draft.body == "# Note\nBody"
    assert draft.confidence == 0.55
    assert "not valid JSON" in draft.warnings[0]
