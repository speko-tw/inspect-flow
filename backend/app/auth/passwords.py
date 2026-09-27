"""Argon2id password hashing (AUT-R01, AUT-R02) and the length rule
(AUT-R04) enforced when a password is set.

Parameters below are one of the OWASP Password Storage Cheat
Sheet configurations (checked 2026-09-26): m/t/p in KiB of
47104/1/1, 19456/2/1, 12288/3/1, 9216/4/1 or 7168/5/1 all give
equivalent protection. This module uses 19456/2/1, the value
suggested by AUT-R01. Changing these constants also requires
updating the "T1" row of
``docs/specs/authentication/plan.md``.
"""

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError

_ARGON2ID_PREFIX = "$argon2id$"

# AUT-R04: length bounds enforced when a password is set, in
# Unicode code points -- Python's ``len(str)`` already counts code
# points, never UTF-8 bytes, so no separate decoding step is needed
# to satisfy "以 Unicode 字元（code point）計算，不以位元組計算".
# No character-composition rule (case, digits, symbols) is
# required. The upper bound guards against very long input slowing
# down the Argon2id hash above; it is not itself a security
# requirement.
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128

# OWASP Password Storage Cheat Sheet, m/t/p = 19456 KiB / 2 / 1.
MEMORY_COST_KIB = 19456
TIME_COST = 2
PARALLELISM = 1
HASH_LEN = 32
SALT_LEN = 16

_hasher = PasswordHasher(
    time_cost=TIME_COST,
    memory_cost=MEMORY_COST_KIB,
    parallelism=PARALLELISM,
    hash_len=HASH_LEN,
    salt_len=SALT_LEN,
    type=Type.ID,
)


def check_password_length(password: str) -> bool:
    """AUT-R04: whether ``password``'s length, in Unicode code
    points, falls within [:data:`MIN_PASSWORD_LENGTH`,
    :data:`MAX_PASSWORD_LENGTH`], inclusive of both ends. Callers
    (the set-password command, and later the change-password API)
    must reject a password that fails this check without writing
    anything.
    """
    return MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH


def hash_password(password: str) -> str:
    """Hash ``password`` with Argon2id, returning a PHC string."""
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Check ``password`` against a stored Argon2id ``password_hash``.

    Returns ``True`` when the password matches, ``False`` when it
    does not, and also ``False`` when ``password_hash`` is not an
    Argon2id hash (its PHC string does not start with
    ``$argon2id$``) — ``PasswordHasher.verify`` picks the variant
    from the hash's own prefix, so an ``$argon2i$`` or ``$argon2d$``
    hash could otherwise verify successfully even though AUT-R01
    requires Argon2id.

    A structurally invalid PHC string is not caught here and
    propagates to the caller — as ``argon2.exceptions.
    VerificationError`` when the header parses but the rest of the
    hash does not, or as ``argon2.exceptions.InvalidHashError``
    when even the header is unrecognized. Either way that
    indicates data corruption in storage rather than a wrong
    password, and should surface instead of being reported as a
    failed login.
    """
    if not password_hash.startswith(_ARGON2ID_PREFIX):
        return False
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def needs_rehash(password_hash: str) -> bool:
    """Report whether ``password_hash`` uses outdated parameters.

    Delegates to ``PasswordHasher.check_needs_rehash``, which only
    decodes the PHC string's variant and parameter segment and
    compares it against the module's current Argon2id parameters
    (AUT-R02). It does not validate the salt or digest bytes, so a
    hash with a corrupted salt or digest can still report
    ``False`` here — this function must not be used as hash-format
    validation. Callers must confirm ``verify_password`` returns
    ``True`` before calling this function, since AUT-R02 only
    rehashes after a successful password verification.

    ``check_needs_rehash`` on a structurally damaged PHC string may
    raise ``argon2.exceptions.InvalidHashError``, or may instead
    return ``True`` or ``False``, depending on where the damage
    falls — for example, dropping the digest segment entirely
    raises ``InvalidHashError``, while truncating the digest to an
    empty string returns ``True``. Callers must not assume that a
    particular kind of damage will or will not raise.
    """
    return _hasher.check_needs_rehash(password_hash)
