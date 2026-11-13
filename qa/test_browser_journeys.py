import json
import urllib.request

from openpyxl import load_workbook
from playwright.sync_api import expect
import pytest

from qa.browser_authentication import QA_KEY, qa_url, sign_in
from qa.test_browser_rendering import OUTPUT


SCREENSHOTS = OUTPUT / "screenshots"


def api(page, path: str):
    """Read back stored state directly, to verify what the interface claims."""
    request = urllib.request.Request(qa_url(page) + "/api" + path, headers={"X-VO-Key": QA_KEY})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


def compose(page, kind: str, title: str):
    page.goto(qa_url(page) + "/#compose", wait_until="networkidle")
    sign_in(page)
    page.reload(wait_until="networkidle")
    sign_in(page)
    page.get_by_role("button", name=kind, exact=True).click()
    page.get_by_label("Draft title", exact=False).fill(title)
    page.get_by_label("Context", exact=True).fill("Synthetic local QA content. No external action is requested.")


def create(page):
    page.get_by_role("button", name="Create draft", exact=False).click()
    page.locator(".creation-result").wait_for(state="visible")
    page.get_by_role("button", name="Open inbox", exact=False).click()
    expect(page.get_by_role("heading", name="Inbox", exact=True)).to_be_visible()


def fill(page, label: str, value: str):
    page.get_by_role("textbox", name=label, exact=False).fill(value)


def reader(page):
    return page.locator(".reader")


def open_details(page):
    reader(page).get_by_role("button", name="Details", exact=True).click()
    drawer = page.locator(".details-drawer")
    expect(drawer).to_be_visible()
    return drawer


def close_details(page):
    page.get_by_role("button", name="Close details", exact=True).click()
    expect(page.locator(".details-drawer")).to_have_count(0)


def assert_no_horizontal_overflow(page):
    assert page.evaluate("document.documentElement.scrollWidth") <= page.evaluate("innerWidth")


def reachable(locator) -> bool:
    locator.evaluate("el => el.scrollIntoView({block:'center', behavior:'instant'})")
    return locator.evaluate("""el => {
      const rect = el.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return target !== null && el.contains(target);
    }""")


def test_access_key_is_required_and_only_lives_in_page_memory(browser_session):
    page, errors = browser_session
    origin = qa_url(page)
    api_requests = []
    page.on("request", lambda request: api_requests.append(request.url)
            if request.url.startswith(origin + "/api/") else None)
    response = page.goto(origin, wait_until="networkidle")
    assert response.status == 200
    access_key = page.get_by_label("Local access key", exact=True)
    access_key.wait_for(state="visible")
    assert access_key.get_attribute("type") == "password"
    assert api_requests == []
    assert page.locator(".app-shell").count() == 0
    assert page.locator(".item-row").count() == 0
    page.screenshot(path=SCREENSHOTS / "access-gate-desktop.png")
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert page.locator(".access-form input").evaluate("el => el.getBoundingClientRect().height") >= 44
    assert page.locator(".access-form button").evaluate("el => el.getBoundingClientRect().height") >= 44
    page.screenshot(path=SCREENSHOTS / "access-gate-mobile.png")
    page.set_viewport_size({"width": 1440, "height": 960})

    sign_in(page)
    expect(page.locator(".item-row").first).to_be_visible()
    assert api_requests
    assert page.evaluate("window.__VO_API_KEY__ === undefined")
    assert page.evaluate("localStorage.length") == 0
    assert page.evaluate("sessionStorage.length") == 0
    assert page.context.cookies() == []
    assert errors == []

    page.reload(wait_until="networkidle")
    page.get_by_label("Local access key", exact=True).wait_for(state="visible")
    assert page.get_by_label("Local access key", exact=True).input_value() == ""
    assert page.locator(".app-shell").count() == 0


def test_legacy_view_links_open_the_inbox(browser_session):
    page, errors = browser_session
    for legacy in ("review", "saved"):
        page.goto(qa_url(page) + f"/#{legacy}", wait_until="networkidle")
        sign_in(page)
        expect(page.get_by_role("heading", name="Inbox", exact=True)).to_be_visible()
        page.reload(wait_until="networkidle")
    assert errors == []


def test_email_rich_edit_version_audit_and_local_acknowledgement(browser_session):
    page, errors = browser_session
    compose(page, "Email", "QA email lifecycle")
    fill(page, "To", "qa@example.com")
    page.get_by_role("button", name="Create draft", exact=False).click()
    assert page.get_by_role("textbox", name="Subject", exact=False).evaluate("el => el.validity.valueMissing")
    fill(page, "Subject", "Local review check")
    fill(page, "Body", "Local-only QA. Nothing is to be sent.")
    create(page)

    # The newest draft opens straight into the reading pane, draft first.
    expect(reader(page).locator(".paper-title")).to_have_text("QA email lifecycle")
    body = reader(page).get_by_role("textbox", name="Email body", exact=True)
    expect(body).to_have_text("Local-only QA. Nothing is to be sent.")
    expect(reader(page).get_by_role("textbox", name="Subject", exact=True)).to_have_value("Local review check")
    # Context, version, hash, and audit are not on the page until requested.
    assert "Synthetic local QA content" not in reader(page).inner_text()
    drawer = open_details(page)
    expect(drawer.locator(".audit-list li")).to_have_count(1)
    expect(drawer).to_contain_text("Synthetic local QA content")
    draft_id = drawer.locator(".detail-rows code:not(.hash)").first.inner_text()
    assert draft_id.startswith("drf_") or len(draft_id) >= 8, draft_id
    assert len(drawer.locator(".hash").first.get_attribute("title")) == 64
    close_details(page)

    # Edit the body as rich text: replace it, then add bold text via the toolbar.
    reader(page).get_by_role("textbox", name="Subject", exact=True).fill('Local review check — v2 & quoted "QA"')
    body.click()
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.type("Second local version.")
    page.keyboard.press("Enter")
    page.get_by_role("button", name="Bold", exact=True).click()
    page.keyboard.type("Important")
    page.get_by_role("button", name="Bold", exact=True).click()
    page.keyboard.type(" and <b>this stays text</b>.")
    reader(page).get_by_role("combobox", name="From").select_option("cisai")
    expect(reader(page).locator(".dirty-dot")).to_be_visible()
    # Acknowledging is disabled while there are unsaved edits.
    expect(page.get_by_role("button", name="Acknowledge locally", exact=False)).to_be_disabled()
    page.get_by_role("button", name="Save", exact=True).click()
    expect(page.get_by_text("Saved as version 2.", exact=True)).to_be_visible()
    expect(reader(page).locator(".dirty-dot")).to_have_count(0)

    stored = api(page, f"/drafts/{draft_id}")
    assert stored["version"] == 2
    assert stored["payload"]["account"] == "cisai"
    assert stored["payload"]["to"] == "qa@example.com"
    assert stored["payload"]["subject"] == 'Local review check — v2 & quoted "QA"'
    assert stored["payload"]["body"].startswith("Second local version.\n\n**Important** and ")
    assert "this stays text" in stored["payload"]["body"]
    assert reader(page).locator(".rich-surface b, .rich-surface script").count() == 0

    drawer = open_details(page)
    expect(drawer.locator(".audit-list li")).to_have_count(2)
    expect(drawer).to_contain_text("Draft updated")
    close_details(page)

    page.get_by_role("button", name="Acknowledge locally", exact=False).click()
    expect(page.get_by_text("Acknowledged locally. Nothing was sent or published.", exact=False)).to_be_visible()
    expect(page.get_by_role("button", name="Save", exact=True)).to_have_count(0)
    assert page.get_by_role("button", name="Send", exact=False).count() == 0
    assert reader(page).get_by_role("textbox", name="Email body").get_attribute("contenteditable") == "false"
    assert api(page, f"/drafts/{draft_id}")["status"] == "acknowledged"
    # Reviewed drafts stay listed while open, then leave the open inbox but remain available.
    row = page.locator(".item-row", has_text="QA email lifecycle")
    page.get_by_role("button", name="Refresh inbox", exact=True).click()
    expect(row).to_have_count(1)
    dialogs = []
    page.on("dialog", lambda dialog: (dialogs.append(dialog.message), dialog.dismiss()))
    page.locator(".item-row", has_text="Synthetic Alpha").click()
    assert dialogs == [], dialogs
    expect(row).to_have_count(0)
    page.get_by_label("Include reviewed and skipped", exact=True).check()
    expect(row).to_have_count(1)
    assert_no_horizontal_overflow(page)
    page.screenshot(path=SCREENSHOTS / "email-reviewed-desktop.png", full_page=True)
    assert errors == []


def test_spreadsheet_csv_edit_and_xlsx_download(browser_session):
    page, errors = browser_session
    compose(page, "Spreadsheet", "QA CSV workbook")
    fill(page, "Spreadsheet title", "Local QA workbook")
    fill(page, "Sheet1 rows (CSV)", 'Item,Comment\nAlpha,"A comma, and a quote: ""yes"""\nBeta,"Line 1\nLine 2"')
    create(page)
    expect(reader(page).locator(".artifact-table")).to_contain_text('A comma, and a quote: "yes"')
    page.get_by_role("button", name="Edit as CSV", exact=True).click()
    fill(page, "Sheet1 rows (CSV)", 'Item,Comment\nAlpha,"Updated, local value"\nBeta,"Line 1\nLine 2"')
    expect(page.get_by_role("button", name="Download XLSX", exact=False)).to_be_disabled()
    page.get_by_role("button", name="Save", exact=True).click()
    expect(page.get_by_text("Saved as version 2.", exact=True)).to_be_visible()
    page.get_by_role("button", name="Show table", exact=True).click()
    expect(reader(page).locator(".artifact-table")).to_contain_text("Updated, local value")

    with page.expect_download() as download_event:
        page.get_by_role("button", name="Download XLSX", exact=False).click()
    download = download_event.value
    assert download.suggested_filename.endswith(".xlsx")
    workbook_path = OUTPUT / "verified-artifact.xlsx"
    download.save_as(workbook_path)
    workbook_path.chmod(0o600)
    assert workbook_path.read_bytes()[:2] == b"PK"
    sheet = load_workbook(workbook_path, read_only=True)["Sheet1"]
    assert [list(row) for row in sheet.iter_rows(values_only=True)] == [
        ["Item", "Comment"], ["Alpha", "Updated, local value"], ["Beta", "Line 1\nLine 2"],
    ]
    page.get_by_role("button", name="Acknowledge locally", exact=False).click()
    expect(page.get_by_text("Acknowledged locally. Nothing was sent or published.", exact=False)).to_be_visible()
    page.screenshot(path=SCREENSHOTS / "xlsx-desktop.png", full_page=True)
    assert errors == []


def test_notion_slack_whatsapp_airtable_and_rejection(browser_session):
    page, errors = browser_session
    cases = [
        ("Slack", "QA Slack draft", [("Workspace", "qa-workspace"), ("Channel", "#local-qa"), ("Message", "*Local* QA only")]),
        ("WhatsApp", "QA WhatsApp draft", [("Recipient", "+270****0000"), ("Message", "Local QA only")]),
        ("Notion", "QA Notion draft", [("Database title", "QA database"), ("Page ID", "qa-page-not-connected")]),
        ("Airtable", "QA Airtable draft", [("Base ID", "baseQaNotConnected"), ("Table", "QA records"), ("Record ID", "recQaNotConnected")]),
    ]
    for kind, title, fields in cases:
        compose(page, kind, title)
        for label, value in fields:
            fill(page, label, value)
        if kind in {"Notion", "Airtable"}:
            fill(page, "Field", "Status")
            fill(page, "Before", "Draft")
            fill(page, "After", "Reviewed locally")
        create(page)
        expect(reader(page).locator(".paper-title")).to_have_text(title)
        if kind == "Slack":
            expect(reader(page).get_by_role("textbox", name="Message", exact=True)).to_have_value("*Local* QA only")
            reader(page).get_by_role("button", name="Preview", exact=True).click()
            expect(reader(page).locator(".chat-preview strong")).to_have_text("Local")
        if kind in {"Notion", "Airtable"}:
            diff = reader(page).get_by_role("list", name="Proposed changes")
            expect(diff).to_contain_text("Status")
            expect(diff.locator(".change-after")).to_contain_text("Reviewed locally")
        drawer = open_details(page)
        expect(drawer.locator(".audit-list li")).to_have_count(1)
        close_details(page)

    # Airtable is the newest; edit a change, save, then reject.
    page.get_by_role("button", name="Edit changes", exact=True).click()
    fill(page, "After", "Confirmed locally")
    page.get_by_role("button", name="Done editing changes", exact=True).click()
    page.get_by_role("button", name="Save", exact=True).click()
    expect(page.get_by_text("Saved as version 2.", exact=True)).to_be_visible()
    expect(reader(page).locator(".change-after")).to_contain_text("Confirmed locally")
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Reject", exact=True).click()
    expect(page.get_by_text("Rejected. No external action was taken.", exact=True)).to_be_visible()
    page.screenshot(path=SCREENSHOTS / "airtable-local-desktop.png", full_page=True)
    assert errors == []


def test_unsaved_changes_are_not_discarded_silently(browser_session):
    page, errors = browser_session
    compose(page, "WhatsApp", "QA unsaved guard")
    fill(page, "Recipient", "+270****0001")
    fill(page, "Message", "Original text")
    create(page)
    expect(reader(page).locator(".paper-title")).to_have_text("QA unsaved guard")
    fill(page, "Message", "Edited but not saved")
    dialogs = []

    def dismiss(dialog):
        dialogs.append(dialog.message)
        dialog.dismiss()

    page.once("dialog", dismiss)
    page.locator(".item-row", has_text="Synthetic Alpha").click()
    expect(reader(page).locator(".paper-title")).to_have_text("QA unsaved guard")
    expect(reader(page).get_by_role("textbox", name="Message", exact=True)).to_have_value("Edited but not saved")
    page.once("dialog", dismiss)
    page.get_by_role("button", name="Compose", exact=True).click()
    expect(reader(page).locator(".paper-title")).to_have_text("QA unsaved guard")
    assert len(dialogs) == 2 and all("unsaved" in message.lower() for message in dialogs)
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator(".item-row", has_text="Synthetic Alpha").click()
    expect(reader(page).locator(".paper-title")).to_have_text("Synthetic Alpha")
    assert errors == []


def test_real_hermes_proposal_from_the_compose_surface(browser_session):
    page, errors = browser_session
    compose(page, "Email", "QA real Hermes proposal")
    page.get_by_role("button", name="Generate with agent", exact=False).first.click()
    fill(page, "Instructions", "Write a short local-only email using only the supplied context. Never send it. Keep it below 45 words.")
    fill(page, "Destination", "qa@example.net")
    page.get_by_label("Account", exact=False).select_option("cisai")
    # Supply a fact in the reviewer context so the agent needs no invented details.
    fill(page, "Context", "The local Virtual Operator QA exercise is complete. No external message should be sent.")
    with page.expect_response(lambda response: response.url.endswith("/api/agent/proposals"), timeout=200_000) as event:
        page.locator(".compose-submit button[type=submit]").click()
    assert event.value.status == 201
    proposal = event.value.json()
    assert proposal["kind"] == "email"
    assert proposal["payload"]["to"] == "qa@example.net"
    assert proposal["payload"]["account"] == "cisai"
    assert proposal["payload"]["subject"].strip()
    assert proposal["payload"]["body"].strip()
    page.locator(".creation-result, .error-list").first.wait_for(state="visible", timeout=200_000)
    assert page.locator(".creation-result").is_visible(), page.locator(".error-list").all_inner_texts()
    assert "Agent proposal returned" in page.locator(".creation-result").inner_text()
    page.get_by_role("button", name="Open inbox", exact=False).click()
    expect(reader(page).get_by_role("textbox", name="To", exact=True)).to_have_value("qa@example.net")
    expect(reader(page).get_by_role("combobox", name="From")).to_have_value("cisai")
    drawer = open_details(page)
    assert any("hermes" in item.inner_text() for item in drawer.locator(".audit-list li").all())
    page.screenshot(path=SCREENSHOTS / "hermes-proposal-desktop.png", full_page=True)
    (OUTPUT / "hermes-browser-verified.json").write_text(json.dumps({
        "kind": proposal["kind"],
        "account": proposal["payload"]["account"],
        "to": proposal["payload"]["to"],
        "id": proposal["id"],
        "audit_count": drawer.locator(".audit-list li").count(),
    }, indent=2) + "\n", encoding="utf-8")
    assert errors == []


def test_source_adapters_and_connection_readiness(browser_session):
    page, errors = browser_session
    page.goto(qa_url(page) + "/#sources", wait_until="networkidle")
    sign_in(page)
    counts = {}
    for account in ("personal", "cisai"):
        page.get_by_label("Account", exact=False).select_option(account)
        with page.expect_response(lambda response: "/api/context/gmail" in response.url) as event:
            page.get_by_role("button", name="Load this source", exact=False).click()
        result = event.value
        assert result.status == 200
        payload = result.json()
        assert isinstance(payload, list) and len(payload) <= 5
        counts[f"gmail_{account}_messages"] = len(payload)
        page.locator(".source-content .result-caption, .source-content .empty-state").first.wait_for()
    page.get_by_role("button", name="Airtable", exact=False).click()
    with page.expect_response(lambda response: "/api/context/airtable" in response.url) as event:
        page.get_by_role("button", name="Load this source", exact=False).click()
    result = event.value
    assert result.status == 200
    payload = result.json()
    assert isinstance(payload, dict) and isinstance(payload.get("bases"), list)
    counts["airtable_bases"] = len(payload["bases"])
    (OUTPUT / "source-read-summary.json").write_text(json.dumps(counts, indent=2) + "\n", encoding="utf-8")
    # Do not save screenshots or message contents from private sources.
    page.goto(qa_url(page) + "/#connections", wait_until="networkidle")
    sign_in(page)
    assert "Capabilities & write locks" in page.locator("h2").all_inner_texts()
    write_capability = page.locator(".capability-data .data-property").first.inner_text().lower()
    assert "externalwritesenabled" in write_capability
    assert "no" in write_capability
    page.screenshot(path=SCREENSHOTS / "connections-desktop.png", full_page=True)
    assert errors == []


@pytest.mark.parametrize("width,height", [(390, 844), (768, 1024)])
def test_mobile_compose_targets_and_inbox_navigation(browser_session, width, height):
    page, errors = browser_session
    page.set_viewport_size({"width": width, "height": height})
    compose(page, "Spreadsheet", f"QA mobile {width}")
    minimums = page.evaluate('''() => [...document.querySelectorAll('button,a,input,select,textarea')]
      .filter(e => e.offsetWidth > 0 && e.offsetHeight > 0 && !e.classList.contains('skip-link') && !e.closest('.sr-only'))
      .map(e => ({label:e.innerText || e.getAttribute('aria-label') || e.value || e.tagName, width:e.getBoundingClientRect().width, height:e.getBoundingClientRect().height}))
    ''')
    assert all(item["height"] >= 44 and item["width"] >= 44 for item in minimums), minimums
    assert_no_horizontal_overflow(page)
    fill(page, "Sheet1 rows (CSV)", "Name,Status\nQA,Local")
    page.screenshot(path=SCREENSHOTS / f"compose-{width}px.png", full_page=True)
    create(page)
    # On narrow screens the list comes first; nothing opens until chosen.
    expect(page.locator(".inbox-list")).to_be_visible()
    expect(page.locator(".inbox-reader")).to_be_hidden()
    assert_no_horizontal_overflow(page)
    page.locator(".item-row", has_text=f"QA mobile {width}").click()
    expect(page.locator(".mobile-back")).to_be_visible()
    expect(page.locator(".inbox-list")).to_be_hidden()
    assert_no_horizontal_overflow(page)
    small = page.evaluate("""() => [...document.querySelectorAll('.reader button, .reader input, .reader select, .reader textarea')]
      .filter(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden')
      .filter(el => el.getBoundingClientRect().height < 44)
      .map(el => ({text: el.innerText || el.getAttribute('aria-label'), height: el.getBoundingClientRect().height}))""")
    assert small == [], small
    workbook = page.get_by_role("textbox", name="Workbook", exact=True)
    workbook.click()
    assert workbook.evaluate("el => el === document.activeElement")
    workbook.fill(f"QA mobile {width} edited")
    save = page.get_by_role("button", name="Save", exact=True)
    assert reachable(save), "The fixed navigation must not block the mobile save control"
    save.click()
    expect(page.get_by_text("Saved as version 2.", exact=True)).to_be_visible()
    page.screenshot(path=SCREENSHOTS / f"reader-{width}px.png", full_page=True)
    acknowledge = page.get_by_role("button", name="Acknowledge locally", exact=False)
    assert reachable(acknowledge), {
        "control": acknowledge.bounding_box(),
        "navigation": page.locator(".navigation-rail").bounding_box(),
        "viewport": page.viewport_size,
    }
    acknowledge.click()
    expect(page.get_by_text("Acknowledged locally. Nothing was sent or published.", exact=False)).to_be_visible()
    expect(reader(page).locator(".reader-bar .status-badge")).to_contain_text("acknowledged")
    page.locator(".mobile-back").click()
    expect(page.locator(".inbox-list")).to_be_visible()
    expect(page.locator(".inbox-reader")).to_be_hidden()
    page.reload(wait_until="networkidle")
    sign_in(page)
    page.evaluate("document.activeElement?.blur()")
    page.keyboard.press("Tab")
    assert page.locator(".skip-link").evaluate("el => el === document.activeElement")
    assert errors == []
