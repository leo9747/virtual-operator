import hashlib
import json
import urllib.request

from openpyxl import load_workbook
from playwright.sync_api import expect

from qa.browser_authentication import QA_KEY, qa_url, sign_in
from qa.test_browser_journeys import OUTPUT, SCREENSHOTS, api, assert_no_horizontal_overflow, close_details, open_details, reader


SOURCE = OUTPUT / "saved-review-source"


def digests() -> dict[str, str]:
    return {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(SOURCE.iterdir()) if path.is_file()}


def open_item(page, title: str):
    page.locator(".item-row", has_text=title).first.click()
    expect(reader(page).locator(".paper-title")).to_have_text(title)


def test_saved_documents_read_edit_as_versions_and_download(browser_session):
    page, errors = browser_session
    origin = qa_url(page)
    external_requests = []
    page.on("request", lambda request: external_requests.append(request.url)
            if not (request.url.startswith(origin) or request.url.startswith("blob:")) else None)
    before = digests()
    page.goto(origin, wait_until="networkidle")
    sign_in(page)

    # Saved files share the inbox with queued drafts; skipped entries are hidden by default.
    page.get_by_role("button", name="Documents", exact=False).click()
    expect(page.locator(".item-row")).to_have_count(4)
    page.get_by_label("Include reviewed and skipped", exact=True).check()
    expect(page.locator(".item-row")).to_have_count(5)
    page.get_by_label("Include reviewed and skipped", exact=True).uncheck()
    assert page.get_by_role("button", name="Send", exact=False).count() == 0
    assert page.get_by_role("button", name="Publish", exact=False).count() == 0
    assert "must not appear" not in page.content()

    # Alpha holds raw HTML, so it opens as a readable Markdown preview, never as live HTML.
    open_item(page, "Synthetic Alpha")
    preview = reader(page).locator(".artifact-markdown")
    expect(preview.get_by_role("heading", name="Synthetic Alpha", exact=True)).to_be_visible()
    expect(reader(page)).to_contain_text("Opened as Markdown")
    assert "Check the source before acting" in preview.inner_text()
    assert preview.locator("script").count() == 0
    assert page.evaluate("window.__unsafeScriptRan") is None
    citation = preview.get_by_role("link", name="Example citation", exact=True)
    assert citation.get_attribute("href") == "https://example.com/review?a=1&b=2"
    assert "noopener" in citation.get_attribute("rel")
    assert page.locator('a[href^="javascript:"]').count() == 0
    # Blocker and source details wait in the drawer.
    assert "escaped | pipe" not in reader(page).inner_text()
    drawer = open_details(page)
    expect(drawer).to_contain_text("escaped | pipe")
    expect(drawer.get_by_role("link", name="Open source task")).to_have_attribute("href", "https://app.notion.com/p/synthetic-alpha")
    expect(drawer).to_contain_text("No edits saved yet")
    close_details(page)
    page.screenshot(path=SCREENSHOTS / "saved-alpha-desktop.png", full_page=True)

    reader(page).get_by_role("button", name="Write", exact=True).click()
    source = reader(page).get_by_role("textbox", name="Edit alpha.md (Markdown)", exact=True)
    original = source.input_value()
    source.fill(original + "\nReviewer note: confirmed locally.\n")
    expect(reader(page).locator(".dirty-dot")).to_be_visible()
    page.get_by_role("button", name="Save version", exact=True).click()
    expect(page.get_by_text("Saved as edited version 1. The original file was not changed.", exact=True)).to_be_visible()
    expect(reader(page).locator(".version-chip")).to_have_text("Edited v1")
    reader(page).get_by_role("button", name="Original", exact=True).click()
    expect(reader(page).locator(".artifact-markdown")).not_to_contain_text("Reviewer note")
    reader(page).get_by_role("button", name="Edited copy · v1", exact=True).click()
    versions = api(page, "/saved-drafts/alpha.md/versions")
    assert [item["version"] for item in versions["versions"]] == [1]
    assert versions["latest"]["text"] == original + "\nReviewer note: confirmed locally.\n"
    assert versions["originalWritten"] is False
    drawer = open_details(page)
    with page.expect_download() as event:
        drawer.get_by_role("button", name="Download version 1", exact=True).click()
    target = OUTPUT / "saved-alpha-v1.md"
    event.value.save_as(target)
    target.chmod(0o600)
    assert event.value.suggested_filename == "alpha.edited-v1.md"
    assert target.read_text(encoding="utf-8") == versions["latest"]["text"]
    close_details(page)

    # A clean Markdown document is edited as rich text, and the cursor survives saving.
    page.get_by_label("Search drafts", exact=True).fill("tone")
    open_item(page, "Synthetic tone job")
    reader(page).get_by_role("tab", name="tone-analysis.md", exact=True).click()
    expect(reader(page).get_by_role("heading", name="Synthetic tone analysis", exact=True)).to_be_visible()
    reader(page).get_by_role("tab", name="tone-prompt.md", exact=True).click()
    editor = reader(page).get_by_role("textbox", name="Edit tone-prompt.md", exact=True)
    expect(editor.get_by_role("heading", name="Synthetic tone prompt", exact=True)).to_be_visible()
    editor.locator("p").last.click()
    page.keyboard.press("End")
    page.keyboard.type(" Keep it short.")
    page.keyboard.press("ControlOrMeta+s")
    expect(page.get_by_text("Saved as edited version 1. The original file was not changed.", exact=True)).to_be_visible()
    page.keyboard.type(" More")
    expect(reader(page).locator(".dirty-dot")).to_be_visible()
    assert "Keep it short. More" in editor.inner_text()
    saved = api(page, "/saved-drafts/tone-prompt.md/versions")["latest"]["text"]
    assert saved == "# Synthetic tone prompt\n\nBe concise, warm and specific. Do not send the example. Keep it short.\n"
    # Returning to the saved text clears the unsaved marker.
    for _ in " More":
        page.keyboard.press("Backspace")
    expect(editor).to_contain_text("Keep it short.")
    expect(reader(page).locator(".dirty-dot")).to_have_count(0)

    # A stale save is refused, rather than overwriting a newer version.
    page.get_by_label("Search drafts", exact=True).fill("payments")
    open_item(page, "Synthetic payments")
    expect(reader(page).get_by_role("tab", name="Evidence", exact=True)).to_be_visible()
    table = reader(page).locator(".artifact-table")
    assert "Comma, retained" in table.inner_text()
    assert "=1+1" in table.inner_text()
    reader(page).get_by_role("tab", name="Next steps", exact=True).click()
    expect(table).to_contain_text("Confirm source before any external action")
    with page.expect_download() as event:
        reader(page).get_by_role("button", name="Download", exact=True).click()
    download = event.value
    assert download.suggested_filename == "payments.xlsx"
    target = OUTPUT / "saved-review-verified.xlsx"
    download.save_as(target)
    target.chmod(0o600)
    rows = [list(row) for row in load_workbook(target)["Evidence"].iter_rows(values_only=True)]
    assert rows[1] == ["Alpha", "Comma, retained", 100]
    assert rows[2][1] == "=1+1"

    page.get_by_label("Search drafts", exact=True).fill("inventory")
    open_item(page, "Synthetic inventory")
    table = reader(page).locator(".artifact-table")
    assert "Intro, with comma" in table.inner_text()
    assert "First line\nSecond line" in table.inner_text()

    page.set_viewport_size({"width": 390, "height": 844})
    assert_no_horizontal_overflow(page)
    last_row = table.locator("tbody tr").last
    last_row.evaluate("element => element.scrollIntoView({block: 'center', behavior: 'instant'})")
    box = last_row.bounding_box()
    assert box is not None
    hit = page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.tagName", [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2])
    assert hit == "TD"
    page.screenshot(path=SCREENSHOTS / "saved-inventory-mobile.png")
    page.locator(".mobile-back").click()
    expect(page.locator(".item-row")).to_have_count(1)
    page.get_by_label("Search drafts", exact=True).fill("")
    page.get_by_role("button", name="All", exact=True).click()
    open_item(page, "Synthetic Alpha")
    assert_no_horizontal_overflow(page)
    small = page.evaluate("""() => [...document.querySelectorAll('.reader button, .reader select, .reader textarea, .inbox-list button')]
      .filter(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden')
      .filter(el => el.getBoundingClientRect().height < 44)
      .map(el => ({text: el.innerText || el.getAttribute('aria-label'), height: el.getBoundingClientRect().height}))""")
    assert small == [], small
    page.screenshot(path=SCREENSHOTS / "saved-alpha-mobile.png")

    # Nothing under the review folder was written.
    assert digests() == before
    assert errors == []
    assert external_requests == []


def test_saved_document_conflicts_keep_every_version(browser_session):
    page, errors = browser_session
    page.goto(qa_url(page), wait_until="networkidle")
    sign_in(page)
    page.get_by_label("Search drafts", exact=True).fill("tone")
    open_item(page, "Synthetic tone job")
    reader(page).get_by_role("tab", name="tone-analysis.md", exact=True).click()
    editor = reader(page).get_by_role("textbox", name="Edit tone-analysis.md", exact=True)
    expect(editor).to_be_visible()
    # Another window saves a version after this one opened the document.
    digest = api(page, "/saved-drafts/tone-analysis.md/content")["sha256"]
    body = json.dumps({"text": "# Other window\n", "base_version": 0, "original_sha256": digest}).encode()
    request = urllib.request.Request(qa_url(page) + "/api/saved-drafts/tone-analysis.md/versions", data=body, method="POST",
                                     headers={"X-VO-Key": QA_KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 201
    editor.locator("p").last.click()
    page.keyboard.press("End")
    page.keyboard.type(" Mine.")
    page.get_by_role("button", name="Save version", exact=True).click()
    conflict = reader(page).locator(".conflict")
    expect(conflict).to_contain_text("Edited version 1 was saved in another window")
    assert "Mine." in editor.inner_text()
    conflict.get_by_role("button", name="Save mine as version 2", exact=True).click()
    expect(page.get_by_text("Saved as edited version 2. The original file was not changed.", exact=True)).to_be_visible()
    versions = api(page, "/saved-drafts/tone-analysis.md/versions")
    assert [item["version"] for item in versions["versions"]] == [1, 2]
    assert versions["latest"]["text"].endswith("no real mail is present. Mine.\n")
    drawer = open_details(page)
    expect(drawer.locator(".version-list li")).to_have_count(2)
    close_details(page)
    # The refused first attempt is the only error the page saw.
    assert [error for error in errors if "409" not in error] == []
