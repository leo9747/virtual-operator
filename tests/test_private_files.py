import os

import pytest

from app.models import DraftInput
from app.store import Store
from app.workbooks import create_workbook


@pytest.fixture
def permissive_umask():
    previous = os.umask(0o022)
    yield
    os.umask(previous)


def test_database_and_xlsx_artifacts_are_owner_only(tmp_path, permissive_umask):
    root = tmp_path / "private-data"
    root.mkdir(mode=0o755)
    store = Store(root / "operator.db")
    draft = store.create(DraftInput(
        kind="spreadsheet",
        title="Private QA workbook",
        context="Local-only data",
        payload={"title": "Private QA", "sheets": [{"name": "Sheet1", "rows": [["Name"], ["QA"]]}]},
    ))
    artifact = create_workbook(
        draft["id"],
        draft["payload"],
        root / "artifacts",
    )

    assert root.stat().st_mode & 0o777 == 0o700
    assert store.path.stat().st_mode & 0o777 == 0o600
    assert artifact.parent.stat().st_mode & 0o777 == 0o700
    assert artifact.stat().st_mode & 0o777 == 0o600
