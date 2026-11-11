import json
from pathlib import Path
import subprocess
import sys

from qa.browser_authentication import qa_url, sign_in
from qa.test_browser_journeys import OUTPUT, SCREENSHOTS


def test_saved_drafts_full_review_journey(browser_session):
    page, errors = browser_session
    page.set_default_timeout(10_000)
    origin = qa_url(page)
    external_requests = []
    page.on("request", lambda request: external_requests.append(request.url)
            if not (request.url.startswith(origin) or request.url.startswith("blob:")) else None)
    page.goto(origin, wait_until="networkidle")
    sign_in(page)
    page.get_by_role("button", name="Saved drafts", exact=True).click()
    page.get_by_role("heading", name="Saved drafts", exact=True).wait_for()
    assert "5" in page.locator(".saved-summary").inner_text()
    assert "6" in page.locator(".saved-summary").inner_text()
    assert page.locator(".saved-row").count() == 5
    assert page.get_by_role("button", name="Send", exact=False).count() == 0
    assert page.get_by_role("button", name="Publish", exact=False).count() == 0

    page.get_by_role("button", name="Ready locally", exact=True).click()
    assert page.locator(".saved-row").count() == 2
    page.get_by_label("Priority focus", exact=True).select_option("P0")
    assert page.locator(".saved-row").count() == 1
    page.get_by_role("button", name="Open Synthetic Alpha", exact=False).click()
    page.locator(".artifact-markdown").get_by_role("heading", name="Synthetic Alpha", exact=True).wait_for()
    assert "Check the source before acting" in page.locator(".artifact-markdown").inner_text()
    assert "escaped | pipe" in page.locator(".saved-blocker").inner_text()
    assert page.locator(".artifact-markdown script").count() == 0
    assert page.evaluate("window.__unsafeScriptRan") is None
    citation = page.locator(".artifact-markdown").get_by_role("link", name="Example citation", exact=True)
    assert citation.get_attribute("href") == "https://example.com/review?a=1&b=2"
    assert "noopener" in citation.get_attribute("rel")
    assert page.locator('.artifact-markdown a[href^="javascript:"]').count() == 0
    assert "javascript:" in page.locator(".artifact-markdown").inner_text()
    page.screenshot(path=SCREENSHOTS / "saved-drafts-desktop.png", full_page=True)

    page.get_by_label("Search saved drafts", exact=True).fill("tone")
    page.get_by_label("Priority focus", exact=True).select_option("all")
    page.get_by_role("button", name="Open Synthetic tone job", exact=False).click()
    page.get_by_label("Document within entry", exact=True).select_option("tone-analysis.md")
    page.locator(".artifact-markdown").get_by_role("heading", name="Synthetic tone analysis", exact=True).wait_for()
    assert "no real mail" in page.locator(".artifact-markdown").inner_text()
    assert page.locator(".saved-document-select option").count() == 2

    page.get_by_label("Search saved drafts", exact=True).fill("payments")
    page.get_by_role("button", name="Needs input", exact=True).click()
    page.get_by_role("button", name="Open Synthetic payments", exact=False).click()
    page.get_by_role("tab", name="Evidence", exact=True).wait_for()
    assert "Comma, retained" in page.locator(".artifact-table").inner_text()
    assert "=1+1" in page.locator(".artifact-table").inner_text()
    assert page.get_by_role("tab", name="Next steps", exact=True).count() == 1
    page.get_by_role("tab", name="Next steps", exact=True).click()
    assert "Confirm source before any external action" in page.locator(".artifact-table").inner_text()

    with page.expect_download() as event:
        page.get_by_role("button", name="Download local copy", exact=True).click()
    download = event.value
    assert download.suggested_filename == "payments.xlsx"
    target = OUTPUT / "saved-review-verified.xlsx"
    download.save_as(target)
    target.chmod(0o600)
    helper = Path.home() / ".hermes/skills/productivity/microsoft-office/scripts/xlsx_read.py"
    evidence = json.loads(subprocess.check_output([
        sys.executable, str(helper), str(target), "--json", "--sheet", "Evidence",
    ], text=True))
    assert evidence["rows"][1] == ["Alpha", "Comma, retained", 100]
    assert evidence["rows"][2][1] == "=1+1"

    page.get_by_label("Search saved drafts", exact=True).fill("inventory")
    page.get_by_role("button", name="Open Synthetic inventory", exact=False).click()
    table = page.locator(".artifact-table")
    assert "Intro, with comma" in table.inner_text()
    assert "First line\nSecond line" in table.inner_text()

    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth") <= 390
    last_row = table.locator("tbody tr").last
    last_row.evaluate("element => element.scrollIntoView({block: 'center', behavior: 'instant'})")
    row_box = last_row.bounding_box()
    assert row_box is not None
    center = {"x": row_box["x"] + row_box["width"] / 2, "y": row_box["y"] + row_box["height"] / 2}
    element_center = page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.tagName", [center["x"], center["y"]])
    probe = page.evaluate("""([x, y]) => {
      const point = document.elementFromPoint(x, y);
      const rectangle = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; };
      return {point, x, y, hit: point?.outerHTML.slice(0, 300), scrollY: window.scrollY,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        documentHeight: document.documentElement.scrollHeight,
        workspace: rectangle('.workspace'), row: rectangle('.artifact-table tbody tr:last-child'),
        navigation: rectangle('.navigation-rail')};
    }""", [center["x"], center["y"]])
    print("Mobile row-center diagnostic:", probe)
    assert element_center == "TD", probe
    assert "Second line" in last_row.inner_text()
    page.screenshot(path=SCREENSHOTS / "saved-drafts-mobile.png")
    page.get_by_role("button", name="Back to saved drafts", exact=True).click()
    assert page.locator(".saved-row").count() == 1
    page.get_by_label("Search saved drafts", exact=True).fill("")
    page.get_by_role("button", name="All", exact=True).click()
    page.get_by_role("button", name="Open Synthetic Alpha", exact=False).click()
    page.locator(".artifact-markdown").get_by_role("heading", name="Synthetic Alpha", exact=True).wait_for()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390
    small_targets = page.evaluate("""() => [...document.querySelectorAll('.saved-view button, .saved-view select, .saved-view .button')]
      .filter(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden')
      .filter(el => el.getBoundingClientRect().height < 44)
      .map(el => ({text: el.innerText || el.getAttribute('aria-label'), height: el.getBoundingClientRect().height}))""")
    assert small_targets == []
    assert errors == []
    assert external_requests == []
