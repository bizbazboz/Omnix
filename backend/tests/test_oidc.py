import time
import pytest
from authlib.jose import JsonWebKey, jwt
from app.main import verify_id_token


@pytest.fixture(scope="module")
def key():
    return JsonWebKey.generate_key("RSA", 2048, is_private=True)


def claims():
    return {
        "iss": "https://id.example/realm",
        "sub": "subject-one",
        "aud": "omnix",
        "iat": int(time.time()),
        "exp": int(time.time()) + 300,
        "nonce": "one-use-nonce",
    }


def encoded(key, payload):
    return jwt.encode({"alg": "RS256", "kid": key.thumbprint()}, payload, key)


def public(key):
    data = key.as_dict(is_private=False)
    data["kid"] = key.thumbprint()
    return {"keys": [data]}


def test_signed_oidc_identity(key):
    result = verify_id_token(
        encoded(key, claims()),
        public(key),
        "https://id.example/realm",
        "omnix",
        "one-use-nonce",
    )
    assert result["sub"] == "subject-one"


@pytest.mark.parametrize(
    "field,value",
    [
        ("iss", "https://attacker.invalid"),
        ("aud", "another-client"),
        ("nonce", "wrong-nonce"),
        ("exp", 1),
        ("azp", "another-client"),
    ],
)
def test_oidc_rejects_invalid_claims(key, field, value):
    payload = {**claims(), field: value}
    with pytest.raises(Exception):
        verify_id_token(
            encoded(key, payload),
            public(key),
            "https://id.example/realm",
            "omnix",
            "one-use-nonce",
        )


def test_oidc_rejects_invalid_signature(key):
    other = JsonWebKey.generate_key("RSA", 2048, is_private=True)
    with pytest.raises(Exception):
        verify_id_token(
            encoded(other, claims()),
            public(key),
            "https://id.example/realm",
            "omnix",
            "one-use-nonce",
        )


def test_multiple_audiences_require_authorized_party(key):
    payload = {**claims(), "aud": ["omnix", "another-client"]}
    with pytest.raises(ValueError):
        verify_id_token(
            encoded(key, payload),
            public(key),
            "https://id.example/realm",
            "omnix",
            "one-use-nonce",
        )


def test_pocketid_ed25519_signing_key():
    key = JsonWebKey.generate_key("OKP", "Ed25519", is_private=True)
    token = jwt.encode({"alg": "EdDSA", "kid": key.thumbprint()}, claims(), key)
    verified = verify_id_token(
        token, public(key), "https://id.example/realm", "omnix", "one-use-nonce"
    )
    assert verified["sub"] == "subject-one"
