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
    assert signed_client.get(route).json() == {"widgets": ["clock", "calendar"]}
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
