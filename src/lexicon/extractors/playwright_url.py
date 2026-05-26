from __future__ import annotations

import re

from lexicon.models import ExtractedContent, SourceInput

SPACE_RE = re.compile(r"\s+")


def extract_url_with_playwright(source: SourceInput) -> ExtractedContent:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright adapter requires installing playwright.") from exc

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(source.value, wait_until="networkidle", timeout=45000)
            title = source.title or page.title() or source.value
            text = SPACE_RE.sub(" ", page.locator("body").inner_text(timeout=10000)).strip()
        finally:
            browser.close()

    return ExtractedContent(
        markdown=f"# {title}\n\nSource: {source.value}\n\n{text}\n",
        source_label=source.value,
        warnings=["URL extracted with Playwright; review dynamic or authenticated content carefully."],
        confidence=0.75,
        metadata={"extractor": "playwright"},
    )
