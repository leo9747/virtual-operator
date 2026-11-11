import json
from pathlib import Path
import subprocess
import sys

import pytest

from qa.browser_authentication import qa_url, sign_in
from qa.test_browser_rendering import OUTPUT


SCREENSHOTS = OUTPUT / "screenshots"

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
    page.get_by_role("button", name="Open Review", exact=False).click()
    page.get_by_role("heading", name="Review queue", exact=True).wait_for(state="visible")


def fill(page, label: str, value: str):
    page.get_by_role("textbox", name=label, exact=False).fill(value)


def assert_no_horizontal_overflow(page):
    assert page.evaluate("document.documentElement.scrollWidth") <= page.evaluate("innerWidth")


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
    assert page.locator(".draft-row").count() == 0
    page.screenshot(path=SCREENSHOTS / "access-gate-desktop.png")
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert page.locator(".access-form input").evaluate("el => el.getBoundingClientRect().height") >= 44
    assert page.locator(".access-form button").evaluate("el => el.getBoundingClientRect().height") >= 44
    page.screenshot(path=SCREENSHOTS / "access-gate-mobile.png")

    sign_in(page)
    page.get_by_text("No drafts yet", exact=True).wait_for()
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


def test_email_edit_version_audit_and_local_acknowledgement(browser_session):
    page, errors = browser_session
    compose(page, "Email", "QA email lifecycle")
    fill(page, "To", "qa@example.com")
    page.get_by_role("button", name="Create draft", exact=False).click()
    assert page.get_by_role("textbox", name="Subject", exact=False).evaluate("el => el.validity.valueMissing")
    assert page.get_by_role("textbox", name="Body", exact=False).evaluate("el => el.validity.valueMissing")
    assert page.get_by_label("Draft title", exact=False).input_value() == "QA email lifecycle"
    fill(page, "Subject", "Local review check")
    fill(page, "Body", "Local-only QA. Nothing is to be sent.")
    create(page)
    assert "draft" in page.locator(".draft-inspector .status-badge").inner_text().lower()
    assert page.locator(".audit-list li").count() == 1
    assert len(page.locator(".metadata-strip code").inner_text()) == 64

    fill(page, "Subject", "Local review check — v2 & quoted \"QA\"")
    fill(page, "Body", "Second local version.\nNo message is sent.\n<b>This is plain text.</b>")
    page.get_by_label("Sending account", exact=False).select_option("cisai")
    page.get_by_role("button", name="Save changes", exact=True).click()
    page.get_by_text("Draft saved as version 2.", exact=True).wait_for()
    assert page.locator(".audit-list li").count() == 2
    assert "2" in page.locator(".metadata-strip").inner_text()

    page.get_by_role("button", name="Acknowledge locally", exact=False).click()
    page.get_by_text("Acknowledged locally. Nothing was sent or published.", exact=False).wait_for()
    assert page.get_by_role("button", name="Save changes", exact=True).count() == 0
    assert page.get_by_role("button", name="Send", exact=False).count() == 0
    page.get_by_role("button", name="All", exact=True).click()
    assert page.get_by_role("button", name="Open QA email lifecycle, email, acknowledged", exact=True).count() == 1
    assert_no_horizontal_overflow(page)
    page.screenshot(path=SCREENSHOTS / "email-reviewed-desktop.png", full_page=True)
    assert errors == []


def test_spreadsheet_csv_edit_and_xlsx_download(browser_session):
    page, errors = browser_session
    compose(page, "Spreadsheet", "QA CSV workbook")
    fill(page, "Spreadsheet title", "Local QA workbook")
    fill(page, "Sheet1 rows (CSV)", 'Item,Comment\nAlpha,"A comma, and a quote: ""yes"""\nBeta,"Line 1\nLine 2"')
    create(page)
    assert "1" in page.locator(".metadata-strip").inner_text()
    fill(page, "Sheet1 rows (CSV)", 'Item,Comment\nAlpha,"Updated, local value"\nBeta,"Line 1\nLine 2"')
    page.get_by_role("button", name="Save changes", exact=True).click()
    page.get_by_text("Draft saved as version 2.", exact=True).wait_for()
    page.get_by_role("button", name="Acknowledge locally", exact=False).click()
    page.locator(".artifact-ready").wait_for(state="visible")

    with page.expect_download() as download_event:
        page.locator(".artifact-ready a").click()
    download = download_event.value
    assert download.suggested_filename.endswith(".xlsx")
    workbook = OUTPUT / "verified-artifact.xlsx"
    download.save_as(workbook)
    # Browser download saving does not guarantee the backend artifact's mode.
    workbook.chmod(0o600)
    assert workbook.read_bytes()[:2] == b"PK"
    helper = Path.home() / ".hermes/skills/productivity/microsoft-office/scripts/xlsx_read.py"
    result = json.loads(subprocess.check_output(
        [sys.executable, str(helper), str(workbook), "--json", "--sheet", "Sheet1"],
        text=True,
    ))
    assert result == {
        "sheet": "Sheet1",
        "rows": [
            ["Item", "Comment"],
            ["Alpha", "Updated, local value"],
            ["Beta", "Line 1\nLine 2"],
        ],
    }
    assert workbook.stat().st_mode & 0o777 == 0o600
    page.screenshot(path=SCREENSHOTS / "xlsx-ready-desktop.png", full_page=True)
    assert errors == []


def test_notion_slack_whatsapp_airtable_and_rejection(browser_session):
    page, errors = browser_session
    cases = [
        ("Slack", "QA Slack draft", [("Workspace", "qa-workspace"), ("Channel", "#local-qa"), ("Message", "Local QA only")]),
        ("WhatsApp", "QA WhatsApp draft", [("Recipient", "+27000000000"), ("Message", "Local QA only")]),
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
            page.get_by_role("button", name="Add change", exact=True).click()
            assert page.locator(".change-row").count() == 2
        create(page)
        assert title in page.locator(".inspector-heading").inner_text()
        assert page.locator(".audit-list li").count() == 1

    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Reject", exact=True).click()
    page.get_by_text("Draft rejected. No external action was taken.", exact=True).wait_for()
    assert page.locator(".inspector-heading").is_visible()
    page.screenshot(path=SCREENSHOTS / "airtable-local-desktop.png", full_page=True)
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
    page.get_by_role("button", name="Open Review", exact=False).click()
    assert page.get_by_role("textbox", name="To", exact=False).input_value() == "qa@example.net"
    assert page.get_by_label("Sending account", exact=False).input_value() == "cisai"
    assert any("hermes" in event.inner_text() for event in page.locator(".audit-list li").all())
    page.screenshot(path=SCREENSHOTS / "hermes-proposal-desktop.png", full_page=True)
    (OUTPUT / "hermes-browser-verified.json").write_text(json.dumps({
        "kind": proposal["kind"],
        "account": proposal["payload"]["account"],
        "to": proposal["payload"]["to"],
        "id": proposal["id"],
        "audit_count": page.locator(".audit-list li").count(),
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
def test_mobile_compose_targets_and_review_navigation(browser_session, width, height):
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
    page.goto(qa_url(page) + "/#review", wait_until="networkidle")
    page.get_by_role("button", name="All", exact=True).click()
    page.locator(".draft-row").first.click()
    assert page.locator(".mobile-back").is_visible()
    assert_no_horizontal_overflow(page)
    page.get_by_role("textbox", name="Spreadsheet title", exact=True).click()
    assert page.get_by_role("textbox", name="Spreadsheet title", exact=True).evaluate("el => el === document.activeElement")
    # The bottom-navigation breakpoint also narrows the inspector gutters.
    if width <= 760:
        assert page.locator(".inspector-topbar").evaluate("el => getComputedStyle(el).padding") == "8px 17px"
    save = page.get_by_role("button", name="Save changes", exact=True)
    save.evaluate("el => el.scrollIntoView({block:'center', behavior:'instant'})")
    reachable = save.evaluate("""el => {
      const rect = el.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return target !== null && el.contains(target);
    }""")
    assert reachable, "The fixed navigation must not block the mobile save control"
    page.screenshot(path=SCREENSHOTS / f"review-{width}px.png", full_page=True)
    page.locator(".decision-panel").screenshot(path=SCREENSHOTS / f"decision-{width}px.png")
    acknowledge = page.get_by_role("button", name="Acknowledge locally", exact=False)
    acknowledge.evaluate("el => el.scrollIntoView({block:'center', behavior:'instant'})")
    acknowledgement_reachable = acknowledge.evaluate("""el => {
      const rect = el.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return target !== null && el.contains(target);
    }""")
    assert acknowledgement_reachable, {
        "control": acknowledge.bounding_box(),
        "navigation": page.locator(".navigation-rail").bounding_box(),
        "viewport": page.viewport_size,
    }
    page.screenshot(path=SCREENSHOTS / f"decision-{width}-viewport.png")
    acknowledge.click()
    page.get_by_text("Acknowledged locally. Nothing was sent or published.", exact=False).wait_for()
    assert "acknowledged" in page.locator(".draft-inspector .status-badge").inner_text().lower()
    page.get_by_role("button", name="Queue", exact=True).click()
    assert page.locator(".queue-panel").is_visible()
    assert page.locator(".inspector-panel .draft-inspector").count() == 0
    page.reload(wait_until="networkidle")
    sign_in(page)
    page.evaluate("document.activeElement?.blur()")
    page.keyboard.press("Tab")
    assert page.locator(".skip-link").evaluate("el => el === document.activeElement")
    assert errors == []
