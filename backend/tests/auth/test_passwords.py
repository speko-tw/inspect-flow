"""Tests for Argon2id password hashing (AUT-AC01).

The OWASP Password Storage Cheat Sheet configuration list below
is written independently of ``app.auth.passwords`` on purpose: it
must keep proving that the program's constants are *one of* the
approved configurations, not just equal to themselves.
"""

import re

import pytest
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError

from app.auth.passwords import (
    MEMORY_COST_KIB,
    PARALLELISM,
    TIME_COST,
    hash_password,
    needs_rehash,
    verify_password,
)

# OWASP Password Storage Cheat Sheet, m (KiB) / t / p, checked
# 2026-09-26. All five give equivalent protection.
_OWASP_ARGON2ID_CONFIGS = {
    (47104, 1, 1),
    (19456, 2, 1),
    (12288, 3, 1),
    (9216, 4, 1),
    (7168, 5, 1),
}

_PHC_PARAMS_RE = re.compile(r"^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$")


def _parse_params(password_hash: str) -> tuple[int, int, int]:
    match = _PHC_PARAMS_RE.match(password_hash)
    assert match is not None, password_hash
    m, t, p = match.groups()
    return int(m), int(t), int(p)


def test_aut_ac01_hash_password_is_argon2id_with_owasp_params():
    password = "correct horse battery staple"

    hash_a = hash_password(password)
    hash_b = hash_password(password)

    assert hash_a.startswith("$argon2id$")
    assert hash_b.startswith("$argon2id$")

    params_a = _parse_params(hash_a)
    params_b = _parse_params(hash_b)
    assert params_a == params_b
    assert params_a == (MEMORY_COST_KIB, TIME_COST, PARALLELISM)
    assert params_a in _OWASP_ARGON2ID_CONFIGS

    assert hash_a != hash_b  # distinct random salts

    assert password not in hash_a
    assert password not in hash_b


def test_aut_ac01_verify_password_accepts_correct_password():
    password = "correct horse battery staple"
    password_hash = hash_password(password)

    assert verify_password(password_hash, password) is True


def test_aut_ac01_verify_password_rejects_wrong_password():
    password_hash = hash_password("correct horse battery staple")

    assert verify_password(password_hash, "wrong password") is False


def test_verify_password_rejects_non_argon2id_prefix():
    non_id_hasher = PasswordHasher(
        time_cost=TIME_COST,
        memory_cost=MEMORY_COST_KIB,
        parallelism=PARALLELISM,
        type=Type.I,
    )
    argon2i_hash = non_id_hasher.hash("correct horse battery staple")

    assert argon2i_hash.startswith("$argon2i$")
    assert (
        verify_password(argon2i_hash, "correct horse battery staple") is False
    )


def test_verify_password_raises_on_malformed_hash_body():
    # The prefix looks right, so this passes our own Argon2id
    # check, but the rest cannot be decoded as a real Argon2 hash.
    malformed = "$argon2id$this-is-not-a-real-phc-string"

    with pytest.raises(VerificationError):
        verify_password(malformed, "correct horse battery staple")


def test_needs_rehash_raises_on_malformed_hash():
    malformed = "not-an-argon2-hash-at-all"

    with pytest.raises(InvalidHashError):
        needs_rehash(malformed)


def test_needs_rehash_false_for_current_parameters():
    password_hash = hash_password("correct horse battery staple")

    assert needs_rehash(password_hash) is False


def test_needs_rehash_true_for_outdated_owasp_parameters():
    outdated_hasher = PasswordHasher(
        time_cost=3,
        memory_cost=12288,
        parallelism=1,
        type=Type.ID,
    )
    outdated_hash = outdated_hasher.hash("correct horse battery staple")

    assert needs_rehash(outdated_hash) is True
