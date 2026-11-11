import importlib
import os
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VO_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("VO_API_KEY", "test-key")
    monkeypatch.setenv("HERMES_HOME", str(Path.home() / ".hermes"))
    monkeypatch.setenv("VO_REVIEW_DIR", str(tmp_path / "review-files"))
    import app.main

    importlib.reload(app.main)
    with TestClient(app.main.create_app(), base_url="http://localhost:8765") as test_client:
        yield test_client
