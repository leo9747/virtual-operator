from pathlib import Path

import pytest
from openpyxl import Workbook


@pytest.fixture
def review_dir(tmp_path):
    root = tmp_path / "review-files"
    root.mkdir(mode=0o700)
    documents = {
        "alpha.md": "# Synthetic Alpha\n\nThis is local QA content; nothing external happened.\n",
        "tone-prompt.md": "# Synthetic tone prompt\n\nBe concise and factual.\n",
        "tone-analysis.md": "# Synthetic tone analysis\n\nNo real mail is used in this fixture.\n",
        "inventory.csv": 'task_id,title\nqa-1,"Intro, with comma"\nqa-2,"Line one\\nLine two"\n',
        "placeholder.md": "# Empty placeholder\n\nNo substantive source brief was available.\n",
    }
    for name, text in documents.items():
        path = root / name
        path.write_text(text, encoding="utf-8")
        path.chmod(0o600)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Evidence"
    sheet.append(["Item", "Comment", "Amount"])
    sheet.append(["Alpha", "Comma, retained", 100])
    sheet.append(["Formula is text in the viewer", "=1+1", None])
    sheet = workbook.create_sheet("Next steps")
    sheet.append(["Owner", "Action"])
    sheet.append(["Leo", "Confirm source before any external action"])
    workbook.save(root / "payments.xlsx")
    (root / "payments.xlsx").chmod(0o600)
    rows = [
        ("Synthetic Alpha [Priority: P0; due: 2026-11-12]", "https://app.notion.com/p/synthetic-alpha", "alpha.md", "completed", "A question containing an escaped \\| pipe"),
        ("Synthetic tone job", "Not applicable; local sources only", "tone-prompt.md<br>tone-analysis.md", "completed", "Two local documents"),
        ("Synthetic inventory", "https://app.notion.com/p/synthetic-inventory", "inventory.csv", "blocked", "A missing test source"),
        ("Synthetic payments", "https://app.notion.com/p/synthetic-payments", "payments.xlsx", "blocked", "Evidence required"),
        ("Synthetic empty placeholder", "https://app.notion.com/p/synthetic-placeholder", "placeholder.md", "skipped", "Nothing to infer"),
    ]
    rendered_rows = []
    for title, source, paths, status, blocker in rows:
        absolute_paths = "<br>".join(str(root / name) for name in paths.split("<br>"))
        rendered_rows.append("| " + " | ".join((title, source, absolute_paths, status, blocker)) + " |")
    rendered = "\n".join(rendered_rows)
    (root / "INDEX.md").write_text(
        "# Synthetic index\n\n| Task title | Notion URL | Local output path | Status | Blocker/open question |\n"
        "|---|---|---|---|---|\n" + rendered + "\n", encoding="utf-8",
    )
    (root / "INDEX.md").chmod(0o600)
    hidden = root / ".work"
    hidden.mkdir(mode=0o700)
    (hidden / "private.json").write_text('{"must_not_be_exposed": true}\n', encoding="utf-8")
    (hidden / "private.json").chmod(0o600)
    return root


def auth():
    return {"X-VO-Key": "test-key"}


def test_saved_index_lists_only_allowlisted_documents_and_preserves_metadata(client, review_dir):
    response = client.get("/api/saved-drafts", headers=auth())
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["itemCount"] == 5
    assert result["fileCount"] == 6
    assert result["statusCounts"] == {"blocked": 2, "completed": 2, "skipped": 1}
    assert result["readOnly"] is True
    assert result["externalWritesEnabled"] is False
    assert client.get("/api/saved-drafts").status_code == 401

    alpha = result["items"][0]
    assert alpha["id"] == "alpha.md"
    assert alpha["title"] == "Synthetic Alpha [Priority: P0; due: 2026-11-12]"
    assert alpha["priority"] == "P0"
    assert alpha["due"] == "2026-11-12"
    assert alpha["sourceUrl"] == "https://app.notion.com/p/synthetic-alpha"
    assert alpha["blocker"] == "A question containing an escaped | pipe"
    assert alpha["files"] == [{"id": "alpha.md", "name": "alpha.md", "kind": "markdown"}]

    tone = result["items"][1]
    assert [entry["id"] for entry in tone["files"]] == ["tone-prompt.md", "tone-analysis.md"]
    assert tone["sourceUrl"] is None
    serialized = response.text
    assert "private.json" not in serialized
    assert str(tmp_path_forbidden(review_dir)) not in serialized


def tmp_path_forbidden(root: Path) -> Path:
    return root.parent


def test_markdown_is_readable_but_unlisted_files_are_not(client, review_dir):
    response = client.get("/api/saved-drafts/alpha.md/content", headers=auth())
    assert response.status_code == 200, response.text
    result = response.json()
    assert result == {
        "id": "alpha.md", "name": "alpha.md", "kind": "markdown",
        "text": "# Synthetic Alpha\n\nThis is local QA content; nothing external happened.\n",
    }
    assert result["text"].startswith("# Synthetic Alpha")
    assert client.get("/api/saved-drafts/alpha.md/content").status_code == 401
    assert client.get("/api/saved-drafts/INDEX.md/content", headers=auth()).status_code == 404
    assert client.get("/api/saved-drafts/.work/private.json/content", headers=auth()).status_code == 404
    assert client.get("/alpha.md").status_code == 404


def test_index_cannot_rebase_an_absolute_path_to_a_same_named_file(client, review_dir):
    index = review_dir / "INDEX.md"
    index.write_text(index.read_text(encoding="utf-8").replace(
        str(review_dir / "alpha.md"), str(review_dir.parent / "alpha.md"),
    ), encoding="utf-8")
    index.chmod(0o600)
    response = client.get("/api/saved-drafts", headers=auth())
    assert response.status_code == 503
    assert "outside" in response.json()["detail"].lower()
    assert "alpha.md" not in response.json()["detail"]


def test_csv_preserves_quoted_commas_and_multiline_cells(client, review_dir):
    path = review_dir / "inventory.csv"
    path.write_text('Task,Comment\nqa-1,"Intro, with comma"\nqa-2,"First line\nSecond line"\n', encoding="utf-8")
    path.chmod(0o600)
    response = client.get("/api/saved-drafts/inventory.csv/content", headers=auth())
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["kind"] == "csv"
    assert result["headers"] == ["Task", "Comment"]
    assert result["rows"] == [["qa-1", "Intro, with comma"], ["qa-2", "First line\nSecond line"]]
    assert result["hasMoreRows"] is False


def test_xlsx_preview_preserves_cells_without_executing_formulas_and_downloads_original(client, review_dir):
    response = client.get("/api/saved-drafts/payments.xlsx/content", headers=auth())
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["kind"] == "xlsx"
    assert [sheet["name"] for sheet in result["sheets"]] == ["Evidence", "Next steps"]
    assert result["sheets"][0]["rows"] == [
        ["Item", "Comment", "Amount"],
        ["Alpha", "Comma, retained", "100"],
        ["Formula is text in the viewer", "=1+1", ""],
    ]
    assert result["formulasEvaluated"] is False

    download = client.get("/api/saved-drafts/payments.xlsx/download", headers=auth())
    assert download.status_code == 200
    assert download.content[:2] == b"PK"
    assert "attachment" in download.headers["content-disposition"]
    assert "payments.xlsx" in download.headers["content-disposition"]
    assert client.get("/api/saved-drafts/payments.xlsx/download").status_code == 401
    assert download.content == (review_dir / "payments.xlsx").read_bytes()
