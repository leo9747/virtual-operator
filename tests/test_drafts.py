AUTH = {"X-VO-Key": "test-key"}


def test_email_draft_is_versioned_and_audited(client):
    response = client.post(
        "/api/drafts",
        headers=AUTH,
        json={
            "kind": "email",
            "title": "Follow up with Ayanda",
            "context": "Ayanda requested the revised rollout date.",
            "payload": {
                "account": "cisai",
                "to": ["ayanda@example.org"],
                "cc": [],
                "subject": "Revised rollout date",
                "body": "Hi Ayanda,\n\nThe revised date is Friday.\n\nBest,\nLeo",
                "thread_id": "",
            },
            "native_target": None,
        },
    )

    assert response.status_code == 201, response.text
    draft = response.json()
    assert draft["id"].startswith("drf_")
    assert draft["kind"] == "email"
    assert draft["version"] == 1
    assert draft["status"] == "draft"
    assert len(draft["content_hash"]) == 64
    assert draft["native_target"] is None
    assert draft["artifact_url"] is None
    assert draft["audit"] == []
    listed = client.get("/api/drafts", headers=AUTH)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [draft["id"]]


def test_editing_reopens_review_and_acknowledgement_is_local_only(client):
    payload = {
        "kind": "email",
        "title": "Local reply",
        "context": "Source text",
        "payload": {"account": "personal", "to": [], "cc": [], "subject": "One", "body": "Body"},
        "native_target": None,
    }
    created = client.post("/api/drafts", headers=AUTH, json=payload).json()
    detail = client.get(f"/api/drafts/{created['id']}", headers=AUTH).json()
    assert [event["event"] for event in detail["audit"]] == ["draft.created"]

    payload["payload"]["subject"] = "Two"
    edited = client.patch(f"/api/drafts/{created['id']}", headers=AUTH, json=payload)
    assert edited.status_code == 200, edited.text
    assert edited.json()["version"] == 2
    assert edited.json()["content_hash"] != created["content_hash"]

    acknowledged = client.post(f"/api/drafts/{created['id']}/acknowledge", headers=AUTH)
    assert acknowledged.status_code == 200, acknowledged.text
    assert acknowledged.json()["status"] == "acknowledged"
    assert acknowledged.json()["version"] == 2
    assert acknowledged.json()["externalResult"] == "No external action performed"

    payload["payload"]["subject"] = "Three"
    reopened = client.patch(f"/api/drafts/{created['id']}", headers=AUTH, json=payload).json()
    assert reopened["status"] == "draft"
    assert reopened["version"] == 3
    events = client.get(f"/api/drafts/{created['id']}", headers=AUTH).json()["audit"]
    assert [event["event"] for event in events] == [
        "draft.created", "draft.updated", "draft.acknowledged", "draft.updated"
    ]


def test_native_google_creation_is_explicitly_locked(client):
    response = client.post(
        "/api/drafts",
        headers=AUTH,
        json={
            "kind": "email", "title": "Native", "context": "",
            "payload": {"account": "personal", "to": [], "cc": [], "subject": "S", "body": "B"},
            "native_target": "gmail",
        },
    )
    assert response.status_code == 409
    assert "OAuth write scopes" in response.json()["detail"]
    assert client.get("/api/drafts", headers=AUTH).json() == []


def test_editing_an_email_keeps_the_account_restricted(client):
    payload = {
        "kind": "email", "title": "Account check", "context": "",
        "payload": {"account": "personal", "to": "a@example.org", "cc": "", "subject": "S", "body": "B"},
    }
    created = client.post("/api/drafts", headers=AUTH, json=payload).json()
    payload["payload"]["account"] = "someone-else"
    response = client.patch(f"/api/drafts/{created['id']}", headers=AUTH, json=payload)
    assert response.status_code == 422
    assert client.get(f"/api/drafts/{created['id']}", headers=AUTH).json()["version"] == 1
