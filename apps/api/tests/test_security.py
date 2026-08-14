from app.core.security import hash_password, verify_password


def test_hash_then_verify_succeeds() -> None:
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_verify_wrong_password_fails() -> None:
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong password", hashed) is False


def test_hash_is_not_plaintext() -> None:
    raw = "correct horse battery staple"
    hashed = hash_password(raw)
    assert raw not in hashed


def test_hash_uses_argon2id() -> None:
    hashed = hash_password("correct horse battery staple")
    assert hashed.startswith("$argon2id$")


def test_same_password_different_hashes() -> None:
    raw = "correct horse battery staple"
    assert hash_password(raw) != hash_password(raw)
