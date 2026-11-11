from fastapi.testclient import TestClient


def test_health_requires_local_api_key(client: TestClient):
    unauthenticated = client.get("/api/health")
    authenticated = client.get("/api/health", headers={"X-VO-Key": "test-key"})

    assert unauthenticated.status_code == 401
    assert authenticated.status_code == 200
    assert authenticated.json() == {
        "status": "ok",
        "version": "0.1.0",
        "externalWritesEnabled": False,
    }


def test_capabilities_list_each_draft_kind_separately(client: TestClient):
    response = client.get("/api/capabilities", headers={"X-VO-Key": "test-key"})

    assert response.status_code == 200
    assert response.json()["draftKinds"] == [
        "email", "notion", "slack", "whatsapp", "spreadsheet", "airtable",
    ]
