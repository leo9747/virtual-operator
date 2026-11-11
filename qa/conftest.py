import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

from qa.saved_review_fixture import create_saved_review_fixture
from qa.test_browser_rendering import OUTPUT, collect_errors, launch_browser


ROOT = Path(__file__).resolve().parents[1]
QA_KEY = "isolated-browser-qa-key"


@pytest.fixture(scope="module")
def qa_server(tmp_path_factory):
    """Run the application with an ephemeral port, synthetic documents, and a throwaway store."""
    data_dir = tmp_path_factory.mktemp("vo-browser") / "private-data"
    environment = {
        key: os.environ[key]
        for key in ("HOME", "PATH", "LANG", "TMPDIR", "LD_LIBRARY_PATH")
        if key in os.environ
    }
    environment["VO_DATA_DIR"] = str(data_dir)
    environment["VO_API_KEY"] = QA_KEY
    environment["VO_FRONTEND_DIST"] = str(ROOT / "frontend" / "dist")
    environment["VO_REVIEW_DIR"] = str(create_saved_review_fixture())
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "screenshots").mkdir(parents=True, exist_ok=True)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    log_path = OUTPUT / "isolated-server.log"
    with log_path.open("a", encoding="utf-8") as logfile:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=ROOT,
            env=environment,
            stdout=logfile,
            stderr=subprocess.STDOUT,
        )
        ready = False
        for _ in range(100):
            if process.poll() is not None:
                break
            request = urllib.request.Request(origin + "/api/health", headers={"X-VO-Key": QA_KEY})
            try:
                with urllib.request.urlopen(request, timeout=0.5) as response:
                    if response.status == 200:
                        ready = True
                        break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.1)
        if not ready:
            process.terminate()
            process.wait(timeout=5)
            raise RuntimeError(f"Isolated server did not start; see {log_path}")
        try:
            yield origin
        finally:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    database = data_dir / "operator.db"
    if database.exists():
        assert database.stat().st_mode & 0o777 == 0o600


@pytest.fixture
def browser_session(qa_server):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        page = browser.new_page(
            viewport={"width": 1440, "height": 960},
            accept_downloads=True,
        )
        page.set_default_timeout(20_000)
        page._qa_origin = qa_server
        errors = collect_errors(page)
        try:
            yield page, errors
        finally:
            browser.close()
