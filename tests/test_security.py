import hmac


def test_private_html_and_error_responses_have_security_headers(client):
    html = client.get("/")
    rejected = client.get("/api/health")

    for response in (html, rejected):
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["content-security-policy"] == (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "font-src 'self'; img-src 'self' data:; connect-src 'self'; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        )


def test_server_rejects_non_local_host_headers(client):
    response = client.get("/", headers={"Host": "attacker.example"})
    assert response.status_code == 400
    assert response.text == "Invalid host header"


def test_key_comparison_is_constant_time(client, monkeypatch):
    calls = []
    real_compare_digest = hmac.compare_digest

    def checked(first, second):
        calls.append((first, second))
        return real_compare_digest(first, second)

    monkeypatch.setattr("app.main.hmac.compare_digest", checked)
    response = client.get("/api/health", headers={"X-VO-Key": "test-key"})
    assert response.status_code == 200
    assert calls == [(b"test-key", b"test-key")]
