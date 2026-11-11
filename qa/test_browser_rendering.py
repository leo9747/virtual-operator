import os
from pathlib import Path

from qa.browser_authentication import qa_url, sign_in


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "qa" / "output"
CHROME = os.environ.get("VO_CHROMIUM")


def launch_browser(playwright):
    """Provide an explicit minimal font setup, even on hosts with no fonts."""
    OUTPUT.mkdir(parents=True, exist_ok=True)
    font_config = OUTPUT / "fonts.conf"
    font_config.write_text(f'''<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>{ROOT / "frontend" / "public" / "fonts"}</dir>
  <cachedir>{OUTPUT / "font-cache"}</cachedir>
  <match target="pattern">
    <test qual="any" name="family"><string>sans-serif</string></test>
    <edit name="family" mode="prepend" binding="same"><string>Operator Sans</string></edit>
  </match>
  <match target="pattern">
    <test qual="any" name="family"><string>monospace</string></test>
    <edit name="family" mode="prepend" binding="same"><string>SFMono-Regular</string></edit>
  </match>
</fontconfig>
''', encoding="utf-8")
    environment = {
        key: os.environ[key]
        for key in ("HOME", "PATH", "LANG", "TMPDIR", "LD_LIBRARY_PATH")
        if key in os.environ
    }
    environment["FONTCONFIG_FILE"] = str(font_config)
    return playwright.chromium.launch(
        executable_path=CHROME,
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
        env=environment,
    )


def collect_errors(page) -> list[str]:
    errors = []
    page.on("pageerror", lambda error: errors.append(f"page: {error}"))
    page.on(
        "console",
        lambda message: errors.append(f"console: {message.text}")
        if message.type == "error" else None,
    )
    page.on(
        "response",
        lambda response: errors.append(f"http {response.status}: {response.url}")
        if response.status >= 400 else None,
    )
    return errors


def test_review_queue_renders_readable_text_without_host_fonts(browser_session):
    page, errors = browser_session
    response = page.goto(qa_url(page), wait_until="networkidle")
    assert response.status == 200
    sign_in(page)
    assert page.locator("h1").inner_text() == "Review queue"
    assert "No drafts yet" in page.locator(".queue-list").inner_text()
    assert errors == []
    page.screenshot(path=OUTPUT / "review-desktop.png", full_page=True)
