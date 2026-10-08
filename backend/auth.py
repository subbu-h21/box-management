import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request

from db import connect

SESSION_COOKIE = "session"

# Web: the page logs the user out after WEB_IDLE_MINUTES idle (and auto-saves first).
# The server allows a little longer so that final auto-save still gets through.
WEB_IDLE_MINUTES = int(os.environ.get("BOX_IDLE_MINUTES") or 30)
WEB_IDLE_LIMIT = timedelta(minutes=WEB_IDLE_MINUTES + 5)
MOBILE_SESSION_LENGTH = timedelta(days=30)  # fixed from login
TOUCH_INTERVAL = timedelta(seconds=30)  # don't write last_seen on every single request

TIME_FMT = "%Y-%m-%d %H:%M:%S"


def now() -> datetime:
    return datetime.now().replace(microsecond=0)


def fmt(dt: datetime) -> str:
    return dt.strftime(TIME_FMT)


def parse(s: str) -> datetime:
    return datetime.strptime(s, TIME_FMT)


# ---------- Passwords (scrypt from the standard library) ----------

_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, expected = stored.split("$")
        h = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(h.hex(), expected)


# A real hash to check against when the username doesn't exist, so response time
# doesn't reveal which usernames are valid.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def check_login(db: sqlite3.Connection, username: str, password: str):
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    ok = verify_password(password, user["password_hash"] if user else _DUMMY_HASH)
    if not user or not ok:
        raise HTTPException(401, "Wrong username or password")
    if user["pending"]:
        raise HTTPException(403, "Your registration is waiting for admin approval.")
    if not user["active"]:
        raise HTTPException(403, "This account is disabled. Contact the admin.")
    return user


# ---------- Sessions ----------

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: sqlite3.Connection, user_id: int, client: str) -> str:
    token = secrets.token_urlsafe(32)
    t = now()
    expires = t + (MOBILE_SESSION_LENGTH if client == "mobile" else WEB_IDLE_LIMIT)
    db.execute(
        "INSERT INTO sessions (token_hash, user_id, client, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        (_token_hash(token), user_id, client, fmt(t), fmt(t), fmt(expires)),
    )
    # Housekeeping: drop expired sessions.
    db.execute("DELETE FROM sessions WHERE expires_at < ?", (fmt(t),))
    return token


def delete_session(db: sqlite3.Connection, token: str) -> None:
    db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def delete_user_sessions(db: sqlite3.Connection, user_id: int, keep_token: str | None = None) -> None:
    """Log a user out everywhere, optionally keeping the session making this request."""
    keep = _token_hash(keep_token) if keep_token else ""
    db.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", (user_id, keep))


def request_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.cookies.get(SESSION_COOKIE)


# ---------- Dependencies ----------

def get_db():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def current_user(request: Request, db: sqlite3.Connection = Depends(get_db)) -> sqlite3.Row:
    token = request_token(request)
    if not token:
        raise HTTPException(401, "Not logged in")
    th = _token_hash(token)
    row = db.execute(
        """
        SELECT s.client, s.created_at, s.last_seen, s.expires_at,
               u.id, u.username, u.full_name, u.role, u.active, u.pending
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
        """,
        (th,),
    ).fetchone()
    t = now()
    if not row or parse(row["expires_at"]) <= t or not row["active"] or row["pending"]:
        if row:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (th,))
            db.commit()
        raise HTTPException(401, "Session expired. Please log in again.")

    # Web sessions slide forward while in use (idle timeout). Mobile sessions are fixed.
    if row["client"] == "web" and t - parse(row["last_seen"]) >= TOUCH_INTERVAL:
        db.execute(
            "UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?",
            (fmt(t), fmt(t + WEB_IDLE_LIMIT), th),
        )
        db.commit()
    request.state.token = token
    return row


def require_admin(user: sqlite3.Row = Depends(current_user)) -> sqlite3.Row:
    if user["role"] != "admin":
        raise HTTPException(403, "Only an admin can do this")
    return user


def user_public(u) -> dict:
    return {"id": u["id"], "username": u["username"], "full_name": u["full_name"], "role": u["role"]}
