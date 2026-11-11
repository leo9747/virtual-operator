from tests.test_drafts import AUTH


def test_built_frontend_is_served_without_a_credential_bootstrap(client, monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><head><title>VO</title></head><body></body></html>")
    (dist / "app.js").write_text("export const ready = true;")
    monkeypatch.setenv("VO_FRONTEND_DIST", str(dist))

    index = client.get("/")
    assert index.status_code == 200
    assert "test-key" not in index.text
    assert "/runtime-config.js" not in index.text
    asset = client.get("/app.js")
    assert asset.status_code == 200
    assert "export const ready = true;" in asset.text
    config = client.get("/runtime-config.js")
    assert config.status_code == 404
    assert "test-key" not in config.text


def test_static_handler_does_not_serve_files_outside_the_build(client, monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index")
    (tmp_path / "secret.txt").write_text("outside")
    monkeypatch.setenv("VO_FRONTEND_DIST", str(dist))
    response = client.get("/%2e%2e/secret.txt")
    assert response.status_code == 404
    assert "outside" not in response.text


def test_static_responses_use_same_origin_resource_policy(client, monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index")
    monkeypatch.setenv("VO_FRONTEND_DIST", str(dist))

    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["Cross-Origin-Resource-Policy"] == "same-origin"
