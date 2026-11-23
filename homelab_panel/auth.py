"""Password check and session cookie. The password never goes back to the page."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets

SESSION_COOKIE = "panel_session"
SESSION_SECONDS = 12 * 60 * 60


def hash_password(password):
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    if not isinstance(password, str) or not isinstance(stored, str):
        return False
    try:
        scheme, n_text, r_text, p_text, salt_hex, digest_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        check = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt_hex),
            n=int(n_text),
            r=int(r_text),
            p=int(p_text),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(check, bytes.fromhex(digest_hex))


def new_session():
    return secrets.token_urlsafe(32)


def session_token(cookie_header):
    if not cookie_header:
        return ""
    for part in cookie_header.split(";"):
        name, _, value = part.strip().partition("=")
        if name == SESSION_COOKIE:
            return value
    return ""


def set_cookie(token):
    return f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}"


def clear_cookie():
    return f"{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
