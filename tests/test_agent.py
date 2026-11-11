import json

import pytest

from app.agent import AgentError, AgentRequest, generate_payload
from tests.test_drafts import AUTH


def test_agent_email_proposal_becomes_a_local_versioned_draft(client, monkeypatch):
    def fake_generate(request):
        assert request.kind == "email"
        return {
            "account": request.account,
            "to": request.destination,
            "cc": "",
            "subject": "Pilot follow-up",
            "body": "Hello Ayanda,\n\nThank you for the update.",
            "thread_id": None,
        }

    monkeypatch.setattr("app.agent.generate_payload", fake_generate)
    response = client.post(
        "/api/agent/proposals",
        headers=AUTH,
        json={
            "kind": "email",
            "title": "Follow up with Ayanda",
            "context": "Ayanda confirmed the first pilot session.",
            "instructions": "Write a brief, warm thank-you and ask for available dates.",
            "account": "cisai",
            "destination": "ayanda@example.org",
        },
    )

    assert response.status_code == 201, response.text
    draft = response.json()
    assert draft["kind"] == "email"
    assert draft["payload"]["account"] == "cisai"
    assert draft["payload"]["to"] == "ayanda@example.org"
    assert draft["native_target"] is None
    assert draft["status"] == "draft"
    detail = client.get(f"/api/drafts/{draft['id']}", headers=AUTH).json()
    assert detail["audit"][0]["actor"] == "hermes"


def test_hermes_generation_is_tool_free_and_returns_structured_json(monkeypatch):
    calls = []

    class Result:
        returncode = 0
        stdout = '{"recipient":"+270****0000","body":"Thanks for confirming."}'
        stderr = ""

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        assert kwargs["timeout"] == 180
        assert kwargs["check"] is False
        return Result()

    monkeypatch.setattr("app.agent.subprocess.run", fake_run)
    monkeypatch.setattr("app.agent.shutil.which", lambda name: "/usr/local/bin/hermes")
    monkeypatch.setenv("HERMES_SESSION_ID", "parent-session-must-not-leak")
    monkeypatch.setenv("HERMES_HOME", "/isolated-profile")
    payload = generate_payload(AgentRequest(
        kind="whatsapp",
        title="Thank the participant",
        context="A participant confirmed attendance.",
        instructions="Write a short acknowledgement. Do not ask another question.",
        account="personal",
        destination="+270****0000",
    ))

    assert payload == {"recipient": "+270****0000", "body": "Thanks for confirming."}
    command, options = calls[0]
    assert command[:4] == ["/usr/local/bin/hermes", "chat", "-t", ""]
    assert "--max-turns" in command and command[command.index("--max-turns") + 1] == "1"
    assert command[command.index("--source") + 1] == "tool"
    assert command[command.index("--query-file") + 1] == "-"
    assert "-q" not in command
    assert "--ignore-rules" in command
    prompt = options["input"]
    assert "A participant confirmed attendance." in prompt
    assert "UNTRUSTED" in prompt
    assert "HERMES_SESSION_ID" not in options["env"]
    assert options["env"]["HERMES_HOME"] == "/isolated-profile"


def test_agent_pins_the_user_selected_google_account(monkeypatch):
    class Result:
        returncode = 0
        stdout = '{"account":"personal","to":"ayanda@example.org","cc":"","subject":"Hello","body":"Body","thread_id":null}'
        stderr = ""

    monkeypatch.setattr("app.agent.subprocess.run", lambda *args, **kwargs: Result())
    monkeypatch.setattr("app.agent.shutil.which", lambda name: "/usr/local/bin/hermes")
    result = generate_payload(AgentRequest(
        kind="email", title="Reply", context="", instructions="Reply briefly",
        account="cisai", destination="ayanda@example.org",
    ))
    assert result["account"] == "cisai"


@pytest.mark.parametrize(("kind", "output"), [
    ("email", {"account": "personal"}),
    ("notion", {"database_title": "Programs", "page_id": "page", "changes": "not-a-list"}),
    ("slack", {"workspace": "CISAI", "channel": 4, "body": "Hello"}),
    ("whatsapp", {"recipient": "+27123", "body": None}),
    ("spreadsheet", {"title": "Workbook", "sheets": []}),
    ("airtable", {"base_id": "base", "table": "Contacts", "record_id": "rec", "changes": [{"field": "Status"}]}),
])
def test_agent_output_is_validated_against_the_selected_draft_schema(kind, output, monkeypatch):
    class Result:
        returncode = 0
        stdout = json.dumps(output)
        stderr = ""

    monkeypatch.setattr("app.agent.subprocess.run", lambda *args, **kwargs: Result())
    monkeypatch.setattr("app.agent.shutil.which", lambda name: "/usr/local/bin/hermes")
    with pytest.raises(AgentError):
        generate_payload(AgentRequest(
            kind=kind, title="Proposal", context="", instructions="Create the proposal",
            account="personal", destination="",
        ))


def test_agent_pins_the_explicit_recipient(monkeypatch):
    class Result:
        returncode = 0
        stdout = '{"recipient":"+27999","body":"Hello"}'
        stderr = ""

    monkeypatch.setattr("app.agent.subprocess.run", lambda *args, **kwargs: Result())
    monkeypatch.setattr("app.agent.shutil.which", lambda name: "/usr/local/bin/hermes")
    result = generate_payload(AgentRequest(
        kind="whatsapp", title="Message", context="", instructions="Write a brief message",
        account="personal", destination="+27123",
    ))
    assert result["recipient"] == "+27123"


def test_agent_spreadsheet_proposal_creates_an_xlsx_artifact(client, monkeypatch):
    monkeypatch.setattr("app.agent.generate_payload", lambda request: {
        "title": request.title,
        "sheets": [{"name": "Sheet1", "rows": [["Participant", "Confirmed"], ["Ayanda", "Yes"]]}],
    })
    response = client.post("/api/agent/proposals", headers=AUTH, json={
        "kind": "spreadsheet", "title": "Participant tracker", "context": "Confirmed attendees",
        "instructions": "Create one small tracking sheet", "account": "personal", "destination": "",
    })
    assert response.status_code == 201, response.text
    assert response.json()["artifact_url"]
    artifact = client.get(response.json()["artifact_url"], headers=AUTH)
    assert artifact.status_code == 200
    assert artifact.content[:2] == b"PK"


def test_agent_surfaces_cli_diagnostic_when_stderr_is_empty(monkeypatch):
    class Result:
        returncode = 1
        stdout = "Hermes couldn't start the model connection: runtime_draining."
        stderr = ""

    monkeypatch.setattr("app.agent.subprocess.run", lambda *args, **kwargs: Result())
    monkeypatch.setattr("app.agent.shutil.which", lambda name: "/usr/local/bin/hermes")
    request = AgentRequest(
        kind="whatsapp",
        title="Local QA",
        context="",
        instructions="Create a short local draft",
        account="personal",
        destination="",
    )
    with pytest.raises(AgentError, match="runtime_draining"):
        generate_payload(request)
