"""Password hashing, session tokens and a small login rate limiter."""

import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()
# Used to keep login timing similar whether or not the username exists.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))

MIN_PASSWORD_LENGTH = 10


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class LoginRateLimiter:
    """In-memory sliding window limiter keyed by client IP.

    Good enough for a single-process deployment (the default). It resets on restart.
    """

    def __init__(self) -> None:
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, window: int, now: float) -> deque[float]:
        q = self._attempts[key]
        while q and now - q[0] > window:
            q.popleft()
        return q

    def is_blocked(self, key: str, max_attempts: int, window: int) -> bool:
        with self._lock:
            return len(self._prune(key, window, time.monotonic())) >= max_attempts

    def record_failure(self, key: str, window: int) -> None:
        with self._lock:
            now = time.monotonic()
            self._prune(key, window, now).append(now)

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._attempts.clear()
            else:
                self._attempts.pop(key, None)


login_limiter = LoginRateLimiter()
