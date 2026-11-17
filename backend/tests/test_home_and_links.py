from app.core import Session, SystemSetting, User, encrypt, decrypt


def test_home_requires_auth(client):
    assert client.get("/api/v1/settings/home").status_code == 401


def test_home_is_per_user_and_validated(signed_client, user):
    route = "/api/v1/settings/home"
    assert signed_client.get(route).json()["widgets"][0] == "clock"
    with Session() as db:
        db.add(
            SystemSetting(key="home:someone-else", value=encrypt({"widgets": ["news"]}))
        )
        db.commit()
    assert (
        signed_client.put(route, json={"widgets": ["clock", "calendar"]}).status_code
        == 200
    )
    assert signed_client.get(route).json()["widgets"] == ["clock", "calendar"]
    for widgets in (["clock", "clock"], ["unknown"]):
        assert signed_client.put(route, json={"widgets": widgets}).status_code == 422
    assert signed_client.put(route, json={"widgets": []}).status_code == 200
    with Session() as db:
        assert decrypt(db.get(SystemSetting, "home:someone-else").value) == {
            "widgets": ["news"]
        }


def test_android_association_is_public_and_strict(client, signed_client, user):
    route = "/.well-known/assetlinks.json"
    public = client.get(route)
    assert public.status_code == 200
    assert public.headers["content-type"] == "application/json"
    target = public.json()[0]["target"]
    assert target["package_name"] == "com.bizbazboz.omnix"
    assert len(target["sha256_cert_fingerprints"][0].split(":")) == 32
    settings = "/api/v1/settings/android-links"
    assert signed_client.put(settings, json={"fingerprints": []}).status_code == 403
    with Session() as db:
        db.get(User, user.id).is_admin = True
        db.commit()
    assert (
        signed_client.put(settings, json={"fingerprints": ["bad"]}).status_code == 422
    )
    fingerprint = ":".join(["AB"] * 32)
    assert signed_client.put(
        settings, json={"fingerprints": [fingerprint, fingerprint]}
    ).json() == {"fingerprints": [fingerprint]}
    assert client.get(route).json()[0]["target"]["sha256_cert_fingerprints"] == [
        fingerprint
    ]
    assert signed_client.put(settings, json={"fingerprints": []}).status_code == 200
    assert client.get(route).json() == []


def test_home_layout_revision_validation_and_frame_isolation(signed_client, user):
    route = "/api/v1/settings/home"
    before = signed_client.get(route).json()
    widget = {
        "id": "custom-one",
        "kind": "html",
        "title": "Private widget",
        "columns": 6,
        "html": "<h2>Private content</h2><script>window.widgetLoaded=true</script>",
    }
    response = signed_client.put(
        route, json={"layout": [widget], "expected_revision": before["revision"]}
    )
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["revision"] == before["revision"] + 1
    assert saved["layout"][0]["html"] == widget["html"]
    assert (
        signed_client.put(
            route, json={"layout": [], "expected_revision": before["revision"]}
        ).status_code
        == 409
    )
    frame = signed_client.get(route + "/widgets/custom-one/frame")
    assert frame.status_code == 200 and "Private content" in frame.text
    csp = frame.headers["content-security-policy"]
    assert "sandbox allow-scripts;" in csp and "allow-same-origin" not in csp
    assert "frame-ancestors 'self'" in csp and "form-action 'none'" in csp
    assert frame.headers["referrer-policy"] == "no-referrer"
    assert (
        signed_client.get(route + "/widgets/someone-elses-widget/frame").status_code
        == 404
    )
    for layout in (
        [widget, widget],
        [{**widget, "columns": 5}],
        [{**widget, "html": "x" * 20001}],
        [{**widget, "kind": "clock"}],
        [{"id": "external", "kind": "webview", "url": "javascript:alert(1)"}],
        [
            {
                "id": "external",
                "kind": "webview",
                "url": "https://user:password@example.com",
            }
        ],
    ):
        assert signed_client.put(route, json={"layout": layout}).status_code == 422
    assert signed_client.get(route).json() == saved
    with Session() as db:
        assert "Private content" not in db.get(SystemSetting, "home:" + user.id).value
        db.add(
            SystemSetting(
                key="home:other-account",
                value=encrypt(
                    {
                        "layout": [{**widget, "id": "other-account-widget"}],
                        "revision": 1,
                    }
                ),
            )
        )
        db.commit()
    assert (
        signed_client.get(route + "/widgets/other-account-widget/frame").status_code
        == 404
    )


def test_legacy_daily_home_visibility_is_kept_until_layout_is_edited(
    signed_client, user
):
    with Session() as db:
        db.add(
            SystemSetting(key="daily:" + user.id, value=encrypt({"widgets": ["news"]}))
        )
        db.commit()
    before = signed_client.get("/api/v1/settings/home").json()
    assert "weather" not in before["widgets"] and "transport" not in before["widgets"]
    assert "news" in before["widgets"] and "clock" in before["widgets"]
    layout = before["layout"] + [{"id": "weather", "kind": "weather", "columns": 3}]
    saved = signed_client.put(
        "/api/v1/settings/home",
        json={"layout": layout, "expected_revision": before["revision"]},
    )
    assert saved.status_code == 200, saved.text
    assert "weather" in signed_client.get("/api/v1/settings/home").json()["widgets"]
