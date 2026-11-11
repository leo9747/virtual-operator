from io import BytesIO

from openpyxl import load_workbook

from tests.test_drafts import AUTH


def test_spreadsheet_draft_creates_a_real_xlsx_artifact(client):
    response = client.post(
        "/api/drafts",
        headers=AUTH,
        json={
            "kind": "spreadsheet",
            "title": "Pilot contacts",
            "context": "A draft contact worksheet",
            "payload": {
                "title": "Pilot contacts",
                "sheets": [{
                    "name": "Contacts",
                    "rows": [["Name", "Amount", "Checked"], ["Ayanda", 12, "=SUM(B2:B2)"]],
                }],
            },
            "native_target": None,
        },
    )

    assert response.status_code == 201, response.text
    draft = response.json()
    assert draft["artifact_url"].endswith("/artifact")
    artifact = client.get(draft["artifact_url"], headers=AUTH)
    assert artifact.status_code == 200, artifact.text
    assert artifact.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    workbook = load_workbook(BytesIO(artifact.content), data_only=False)
    sheet = workbook["Contacts"]
    assert sheet["A1"].value == "Name"
    assert sheet["B2"].value == 12
    assert sheet["C2"].value == "=SUM(B2:B2)"
    assert sheet.freeze_panes == "A2"
    assert artifact.content[:2] == b"PK"


def spreadsheet_request(rows):
    return {
        "kind": "spreadsheet",
        "title": "Workbook",
        "context": "",
        "payload": {"title": "Workbook", "sheets": [{"name": "Data", "rows": rows}]},
        "native_target": None,
    }


def test_spreadsheet_edit_rebuilds_artifact(client):
    created = client.post(
        "/api/drafts", headers=AUTH, json=spreadsheet_request([["Name", "Value"], ["A", 1]])
    ).json()
    response = client.patch(
        f"/api/drafts/{created['id']}",
        headers=AUTH,
        json=spreadsheet_request([["Name", "Value"], ["A", 99]]),
    )
    assert response.status_code == 200, response.text
    artifact = client.get(response.json()["artifact_url"], headers=AUTH)
    workbook = load_workbook(BytesIO(artifact.content), data_only=False)
    assert workbook["Data"]["B2"].value == 99


def test_invalid_spreadsheet_does_not_leave_a_database_record(client):
    response = client.post(
        "/api/drafts", headers=AUTH, json=spreadsheet_request([]) | {"payload": {"sheets": []}}
    )
    assert response.status_code == 422
    assert client.get("/api/drafts", headers=AUTH).json() == []
