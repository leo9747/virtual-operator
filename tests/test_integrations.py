from tests.test_drafts import AUTH


def test_capabilities_report_locked_native_writes(client):
    caps = client.get("/api/capabilities", headers=AUTH)
    assert caps.status_code == 200
    body = caps.json()
    assert body["externalWritesEnabled"] is False
    assert set(body["draftKinds"]) == {
        "email", "notion", "slack", "whatsapp", "spreadsheet", "airtable"
    }
    targets = {item["target"]: item for item in body["nativeTargets"]}
    assert targets["gmail"]["enabled"] is False
    assert "https://www.googleapis.com/auth/gmail.compose" in (
        targets["gmail"]["requiredScopes"]
    )
    assert targets["google_sheets"]["enabled"] is False
    assert "https://www.googleapis.com/auth/spreadsheets" in (
        targets["google_sheets"]["requiredScopes"]
    )


def test_connections_categorize_current_and_deferred_integrations(client):
    response = client.get("/api/connections", headers=AUTH)
    assert response.status_code == 200
    services = {item["service"]: item for item in response.json()}
    assert services["slack"]["status"] == "setup_required"
    assert services["whatsapp"]["status"] == "setup_required"
    assert services["notion"]["status"] == "agent_broker"
    for service in ("gmail_personal", "gmail_cisai", "airtable"):
        assert service in services


def test_gmail_read_uses_isolated_cisai_credentials_and_a_bounded_limit(client, monkeypatch):
    calls = []

    def fake_read(arguments, account_home_override=None):
        calls.append((arguments, account_home_override))
        return [{"id": "message-one", "subject": "Pilot update"}]

    monkeypatch.setattr("app.integrations.run_json", fake_read)
    response = client.get("/api/context/gmail?account=cisai&limit=3", headers=AUTH)

    assert response.status_code == 200, response.text
    assert response.json() == [{"id": "message-one", "subject": "Pilot update"}]
    arguments, home = calls[0]
    assert home.as_posix().endswith("/google-accounts/cisai")
    assert arguments[-3:] == ["newer_than:30d", "--max", "3"]


def test_airtable_context_returns_base_schemas_without_reading_records(client, monkeypatch):
    commands = []

    def fake_read(arguments, account_home_override=None):
        commands.append(arguments)
        if arguments[-1] == "bases":
            return {"bases": [{"id": "base-one", "name": "CRM"}]}
        return {"tables": [{"id": "table-one", "name": "Contacts", "fields": []}]}

    monkeypatch.setattr("app.integrations.run_json", fake_read)
    response = client.get("/api/context/airtable", headers=AUTH)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["bases"][0]["name"] == "CRM"
    assert body["bases"][0]["tables"][0]["name"] == "Contacts"
    assert commands[0][-1] == "bases"
    assert commands[1][-2:] == ["schema", "base-one"]
    assert all("list" not in command for command in commands)


def test_gmail_adapter_uses_the_hermes_python_runtime(client, monkeypatch):
    calls = []
    monkeypatch.setenv("VO_GOOGLE_PYTHON", "/runtime/hermes-python")

    def fake_read(arguments, account_home_override=None):
        calls.append(arguments)
        return []

    monkeypatch.setattr("app.integrations.run_json", fake_read)
    response = client.get("/api/context/gmail?account=personal&limit=1", headers=AUTH)
    assert response.status_code == 200, response.text
    assert calls[0][0] == "/runtime/hermes-python"
