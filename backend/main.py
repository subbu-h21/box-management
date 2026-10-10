import hmac
import json
import secrets
import socket
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from auth import (
    SESSION_COOKIE,
    WEB_IDLE_MINUTES,
    check_login,
    create_session,
    current_user,
    delete_session,
    delete_user_sessions,
    fmt,
    get_db,
    hash_password,
    now,
    parse,
    request_token,
    require_admin,
    user_public,
    verify_password,
)
from db import init_db, write_tx
from printing import job_print_options, render_job

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    agent_token()  # make sure the print agent's token file exists
    yield


app = FastAPI(title="Distributor Box Management", lifespan=lifespan)

User = sqlite3.Row  # type alias for readability


def today() -> str:
    return date.today().isoformat()


def parse_date(value: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise HTTPException(400, f"Invalid date '{value}', expected YYYY-MM-DD")


def is_admin(user: User) -> bool:
    return user["role"] == "admin"


def audit(
    db: sqlite3.Connection,
    user: User,
    action: str,
    entity: str,
    entity_id: int | None,
    summary: str,
    details: dict | None = None,
    boxes_added: int = 0,
    boxes_removed: int = 0,
    bags_added: int = 0,
    bags_removed: int = 0,
    auto_saved: bool = False,
) -> None:
    db.execute(
        """
        INSERT INTO audit_log (at, user_id, action, entity, entity_id, summary, details,
                               boxes_added, boxes_removed, bags_added, bags_removed, auto_saved)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            fmt(now()), user["id"], action, entity, entity_id, summary,
            json.dumps(details) if details is not None else None,
            boxes_added, boxes_removed, bags_added, bags_removed, int(auto_saved),
        ),
    )


def describe_changes(before: dict, after: dict, fields: dict[str, str]) -> str:
    parts = [
        f"{label}: '{before[k]}' → '{after[k]}'"
        for k, label in fields.items()
        if before[k] != after[k]
    ]
    return "; ".join(parts) or "no changes"


class Stripped(BaseModel):
    """Trims surrounding spaces from text fields (never from passwords)."""

    @field_validator("*", mode="before")
    @classmethod
    def strip(cls, v, info: ValidationInfo):
        if isinstance(v, str) and "password" not in info.field_name:
            return v.strip()
        return v


# ======================= Auth =======================

USERNAME = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9._-]+$")
PASSWORD = Field(min_length=6, max_length=128)


class SetupIn(Stripped):
    username: str = USERNAME
    full_name: str = Field(min_length=1, max_length=100)
    password: str = PASSWORD


class LoginIn(Stripped):
    username: str = Field(min_length=1, max_length=30)
    password: str = Field(min_length=1, max_length=128)
    client: Literal["web", "mobile"] = "web"


PHONE = Field(min_length=7, max_length=20, pattern=r"^[0-9+\- ]+$")


class RegisterIn(Stripped):
    full_name: str = Field(min_length=1, max_length=100)
    phone: str = PHONE
    username: str = USERNAME
    password: str = PASSWORD


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = PASSWORD


def set_session_cookie(response: Response, token: str) -> None:
    # No max_age: the server enforces the idle timeout.
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", path="/")


def me_payload(user, client: str) -> dict:
    return {
        **user_public(user),
        "client": client,
        "idle_minutes": WEB_IDLE_MINUTES if client == "web" else None,
    }


@app.get("/api/auth/status")
def auth_status(db: sqlite3.Connection = Depends(get_db)):
    has_users = db.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
    return {"setup_required": not has_users}


@app.post("/api/auth/setup")
def first_run_setup(body: SetupIn, response: Response, db: sqlite3.Connection = Depends(get_db)):
    """Create the first admin. Only works while there are no users at all."""
    with write_tx(db):
        if db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            raise HTTPException(409, "Setup is already done. Please log in.")
        cur = db.execute(
            "INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, 'admin')",
            (body.username, body.full_name, hash_password(body.password)),
        )
        user = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
        audit(db, user, "create", "user", user["id"], f"Created admin account '{user['username']}' (first-run setup)")
        token = create_session(db, user["id"], "web")
    set_session_cookie(response, token)
    return me_payload(user, "web")


@app.post("/api/auth/login")
def login(body: LoginIn, response: Response, db: sqlite3.Connection = Depends(get_db)):
    user = check_login(db, body.username, body.password)
    with write_tx(db):
        token = create_session(db, user["id"], body.client)
    payload = me_payload(user, body.client)
    if body.client == "web":
        set_session_cookie(response, token)
    else:
        payload["token"] = token  # mobile app sends it back as "Authorization: Bearer <token>"
    return payload


@app.post("/api/auth/register", status_code=201)
def register(body: RegisterIn, db: sqlite3.Connection = Depends(get_db)):
    """A new worker asks for an account. It can't be used until an admin approves it."""
    try:
        with write_tx(db):
            if not db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                raise HTTPException(409, "The admin account hasn't been set up yet.")
            cur = db.execute(
                "INSERT INTO users (username, full_name, phone, password_hash, role, pending) "
                "VALUES (?, ?, ?, ?, 'worker', 1)",
                (body.username, body.full_name, body.phone, hash_password(body.password)),
            )
            # Logged without a user: the account isn't approved, and may be rejected (deleted).
            db.execute(
                "INSERT INTO audit_log (at, user_id, action, entity, entity_id, summary) "
                "VALUES (?, NULL, 'create', 'user', ?, ?)",
                (fmt(now()), cur.lastrowid,
                 f"Registration request: '{body.username}' ({body.full_name}, {body.phone})"),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"Username '{body.username}' is already taken")
    return {"status": "pending"}


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)):
    token = request_token(request)
    if token:
        with write_tx(db):
            delete_session(db, token)
    response.delete_cookie(SESSION_COOKIE, path="/")


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return me_payload(user, user["client"])


@app.post("/api/auth/password", status_code=204)
def change_own_password(
    body: ChangePasswordIn, request: Request,
    user: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db),
):
    stored = db.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()[0]
    if not verify_password(body.current_password, stored):
        raise HTTPException(400, "Current password is wrong")
    with write_tx(db):
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body.new_password), user["id"]))
        delete_user_sessions(db, user["id"], keep_token=request.state.token)
        audit(db, user, "update", "user", user["id"], "Changed own password")


# ======================= Users (admin) =======================

OPTIONAL_PHONE = Field(default="", max_length=20, pattern=r"^[0-9+\- ]*$")


class UserCreateIn(Stripped):
    username: str = USERNAME
    full_name: str = Field(min_length=1, max_length=100)
    phone: str = OPTIONAL_PHONE
    password: str = PASSWORD
    role: Literal["admin", "worker"] = "worker"


class UserUpdateIn(Stripped):
    full_name: str = Field(min_length=1, max_length=100)
    phone: str = OPTIONAL_PHONE
    role: Literal["admin", "worker"]
    active: bool


class PasswordResetIn(BaseModel):
    password: str = PASSWORD


@app.get("/api/users")
def list_users(_: User = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT id, username, full_name, phone, role, active, pending, created_at FROM users "
        "ORDER BY pending DESC, active DESC, full_name"
    ).fetchall()
    return [{**dict(r), "active": bool(r["active"]), "pending": bool(r["pending"])} for r in rows]


@app.post("/api/users", status_code=201)
def create_user(body: UserCreateIn, admin: User = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    try:
        with write_tx(db):
            cur = db.execute(
                "INSERT INTO users (username, full_name, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)",
                (body.username, body.full_name, body.phone, hash_password(body.password), body.role),
            )
            audit(db, admin, "create", "user", cur.lastrowid,
                  f"Created {body.role} account '{body.username}' ({body.full_name})")
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"Username '{body.username}' is already taken")
    return {"id": cur.lastrowid, "username": body.username, "full_name": body.full_name,
            "phone": body.phone, "role": body.role, "active": True, "pending": False}


def _pending_user(db: sqlite3.Connection, user_id: int) -> sqlite3.Row:
    u = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not u:
        raise HTTPException(404, "User not found")
    if not u["pending"]:
        raise HTTPException(400, "This account is not waiting for approval")
    return u


@app.post("/api/users/{user_id}/approve", status_code=204)
def approve_user(user_id: int, admin: User = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    with write_tx(db):
        u = _pending_user(db, user_id)
        db.execute("UPDATE users SET pending = 0 WHERE id = ?", (user_id,))
        audit(db, admin, "update", "user", user_id,
              f"Approved registration of '{u['username']}' ({u['full_name']}, {u['phone']})")


@app.post("/api/users/{user_id}/reject", status_code=204)
def reject_user(user_id: int, admin: User = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    """Rejected requests are removed, so the username can be used again."""
    with write_tx(db):
        u = _pending_user(db, user_id)
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        audit(db, admin, "delete", "user", user_id,
              f"Rejected registration of '{u['username']}' ({u['full_name']}, {u['phone']})")


@app.put("/api/users/{user_id}")
def update_user(user_id: int, body: UserUpdateIn, admin: User = Depends(require_admin),
                db: sqlite3.Connection = Depends(get_db)):
    with write_tx(db):
        before = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not before:
            raise HTTPException(404, "User not found")
        losing_admin = before["role"] == "admin" and before["active"] and (body.role != "admin" or not body.active)
        if losing_admin:
            others = db.execute(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?", (user_id,)
            ).fetchone()[0]
            if others == 0:
                raise HTTPException(400, "This is the last active admin. Make someone else admin first.")
        db.execute(
            "UPDATE users SET full_name = ?, phone = ?, role = ?, active = ? WHERE id = ?",
            (body.full_name, body.phone, body.role, int(body.active), user_id),
        )
        if not body.active:
            delete_user_sessions(db, user_id)
        after = {"full_name": body.full_name, "phone": body.phone, "role": body.role, "active": int(body.active)}
        audit(db, admin, "update", "user", user_id,
              f"Edited user '{before['username']}': "
              + describe_changes(dict(before), after,
                                 {"full_name": "name", "phone": "phone", "role": "role", "active": "active"}))
    return {"id": user_id, "username": before["username"], **after, "active": body.active,
            "pending": bool(before["pending"])}


@app.post("/api/users/{user_id}/password", status_code=204)
def reset_password(user_id: int, body: PasswordResetIn, request: Request,
                   admin: User = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    with write_tx(db):
        target = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise HTTPException(404, "User not found")
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body.password), user_id))
        delete_user_sessions(db, user_id, keep_token=request.state.token)
        audit(db, admin, "update", "user", user_id, f"Reset password for '{target['username']}'")


# ======================= Meta =======================

@app.get("/api/today")
def get_today(_: User = Depends(current_user)):
    return {"date": today()}


# ======================= Transporters =======================

class TransporterIn(Stripped):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(default="", max_length=30)


TRANSPORTER_FIELDS = {"code": "ID", "name": "name", "phone": "phone"}


@app.get("/api/transporters")
def list_transporters(_: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT id, code, name, phone FROM transporters ORDER BY name").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/transporters", status_code=201)
def create_transporter(body: TransporterIn, user: User = Depends(current_user),
                       db: sqlite3.Connection = Depends(get_db)):
    try:
        with write_tx(db):
            cur = db.execute(
                "INSERT INTO transporters (code, name, phone) VALUES (?, ?, ?)",
                (body.code, body.name, body.phone),
            )
            audit(db, user, "create", "transporter", cur.lastrowid,
                  f"Added transporter {body.code} — {body.name}", body.model_dump())
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"Transporter ID '{body.code}' already exists")
    return {"id": cur.lastrowid, **body.model_dump()}


@app.put("/api/transporters/{transporter_id}")
def update_transporter(transporter_id: int, body: TransporterIn, user: User = Depends(current_user),
                       db: sqlite3.Connection = Depends(get_db)):
    try:
        with write_tx(db):
            before = db.execute("SELECT * FROM transporters WHERE id = ?", (transporter_id,)).fetchone()
            if not before:
                raise HTTPException(404, "Transporter not found")
            db.execute(
                "UPDATE transporters SET code = ?, name = ?, phone = ? WHERE id = ?",
                (body.code, body.name, body.phone, transporter_id),
            )
            before = {k: before[k] for k in TRANSPORTER_FIELDS}
            after = body.model_dump()
            if before != after:
                audit(db, user, "update", "transporter", transporter_id,
                      f"Edited transporter {before['code']}: " + describe_changes(before, after, TRANSPORTER_FIELDS),
                      {"before": before, "after": after})
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"Transporter ID '{body.code}' already exists")
    return {"id": transporter_id, **body.model_dump()}


@app.delete("/api/transporters/{transporter_id}", status_code=204)
def delete_transporter(transporter_id: int, admin: User = Depends(require_admin),
                       db: sqlite3.Connection = Depends(get_db)):
    try:
        with write_tx(db):
            before = db.execute("SELECT * FROM transporters WHERE id = ?", (transporter_id,)).fetchone()
            if not before:
                raise HTTPException(404, "Transporter not found")
            db.execute("DELETE FROM transporters WHERE id = ?", (transporter_id,))
            audit(db, admin, "delete", "transporter", transporter_id,
                  f"Deleted transporter {before['code']} — {before['name']}",
                  {k: before[k] for k in TRANSPORTER_FIELDS})
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Cannot delete: this transporter has dispatch records")


# ======================= Shops =======================

class ShopIn(Stripped):
    name: str = Field(min_length=1, max_length=200)
    area: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=30)


SHOP_FIELDS = {"name": "name", "area": "area", "phone": "phone"}


def shop_text(name: str, area: str) -> str:
    return f"{name}, {area}" if area else name


def shop_public(r) -> dict:
    return {"id": r["id"], "name": r["name"], "area": r["area"], "phone": r["phone"],
            "sticker_layout": json.loads(r["sticker_layout"]) if r["sticker_layout"] else None}


@app.get("/api/shops")
def list_shops(_: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    return [shop_public(r) for r in db.execute("SELECT * FROM shops ORDER BY name, area")]


@app.post("/api/shops", status_code=201)
def create_shop(body: ShopIn, user: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    try:
        with write_tx(db):
            cur = db.execute(
                "INSERT INTO shops (name, area, phone) VALUES (?, ?, ?)",
                (body.name, body.area, body.phone),
            )
            audit(db, user, "create", "shop", cur.lastrowid,
                  f"Added shop {shop_text(body.name, body.area)}", body.model_dump())
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A shop with this name and area already exists")
    return {"id": cur.lastrowid, **body.model_dump()}


@app.put("/api/shops/{shop_id}")
def update_shop(shop_id: int, body: ShopIn, user: User = Depends(current_user),
                db: sqlite3.Connection = Depends(get_db)):
    try:
        with write_tx(db):
            before = db.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone()
            if not before:
                raise HTTPException(404, "Shop not found")
            db.execute(
                "UPDATE shops SET name = ?, area = ?, phone = ? WHERE id = ?",
                (body.name, body.area, body.phone, shop_id),
            )
            before = {k: before[k] for k in SHOP_FIELDS}
            after = body.model_dump()
            if before != after:
                audit(db, user, "update", "shop", shop_id,
                      f"Edited shop {shop_text(before['name'], before['area'])}: "
                      + describe_changes(before, after, SHOP_FIELDS),
                      {"before": before, "after": after})
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A shop with this name and area already exists")
    return {"id": shop_id, **body.model_dump()}


@app.delete("/api/shops/{shop_id}", status_code=204)
def delete_shop(shop_id: int, admin: User = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    try:
        with write_tx(db):
            before = db.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone()
            if not before:
                raise HTTPException(404, "Shop not found")
            db.execute("DELETE FROM shops WHERE id = ?", (shop_id,))
            audit(db, admin, "delete", "shop", shop_id,
                  f"Deleted shop {shop_text(before['name'], before['area'])}",
                  {k: before[k] for k in SHOP_FIELDS})
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Cannot delete: this shop has dispatch records")


# ======================= Dispatches =======================

class DispatchItemIn(Stripped):
    shop_id: int
    boxes: int = Field(default=0, ge=0, le=10000)
    carry_bags: int = Field(default=0, ge=0, le=10000)
    remarks: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def sends_something(self):
        if self.boxes == 0 and self.carry_bags == 0:
            raise ValueError("Each shop needs at least 1 box or 1 carry bag")
        return self


class DispatchIn(BaseModel):
    items: list[DispatchItemIn]
    expected_version: int | None = None  # version the client started editing from; None = new record
    auto_saved: bool = False  # saved automatically before an idle logout


def load_dispatches(db: sqlite3.Connection, where: str, params: tuple) -> list[dict]:
    rows = db.execute(
        f"""
        SELECT d.id, d.date, d.created_at, d.updated_at, d.version,
               t.id AS transporter_id, t.code AS transporter_code, t.name AS transporter_name,
               cu.full_name AS created_by_name, uu.full_name AS updated_by_name
        FROM dispatches d
        JOIN transporters t ON t.id = d.transporter_id
        LEFT JOIN users cu ON cu.id = d.created_by
        LEFT JOIN users uu ON uu.id = d.updated_by
        WHERE {where}
        ORDER BY d.date DESC, t.name
        """,
        params,
    ).fetchall()
    result = []
    for r in rows:
        items = db.execute(
            """
            SELECT i.shop_id, s.name AS shop_name, s.area AS shop_area, i.boxes, i.carry_bags, i.remarks
            FROM dispatch_items i JOIN shops s ON s.id = i.shop_id
            WHERE i.dispatch_id = ?
            ORDER BY i.id
            """,
            (r["id"],),
        ).fetchall()
        items = [dict(i) for i in items]
        result.append({
            **dict(r),
            "items": items,
            "total_boxes": sum(i["boxes"] for i in items),
            "total_bags": sum(i["carry_bags"] for i in items),
        })
    return result


@app.get("/api/dispatches")
def list_dispatches(
    date_from: str | None = None,
    date_to: str | None = None,
    transporter_id: int | None = None,
    user: User = Depends(current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    date_from = parse_date(date_from) if date_from else None
    date_to = parse_date(date_to) if date_to else None
    if not is_admin(user) and (date_from != today() or date_to != today()):
        raise HTTPException(403, "Workers can only view today's list")

    clauses, params = ["1 = 1"], []
    if date_from:
        clauses.append("d.date >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("d.date <= ?")
        params.append(date_to)
    if transporter_id is not None:
        clauses.append("d.transporter_id = ?")
        params.append(transporter_id)
    return load_dispatches(db, " AND ".join(clauses), tuple(params))


@app.get("/api/dispatches/today/{transporter_id}")
def get_today_dispatch(transporter_id: int, _: User = Depends(current_user),
                       db: sqlite3.Connection = Depends(get_db)):
    found = load_dispatches(db, "d.transporter_id = ? AND d.date = ?", (transporter_id, today()))
    return found[0] if found else None


EMPTY_LINE = {"boxes": 0, "carry_bags": 0, "remarks": ""}


def qty_text(boxes: int, bags: int) -> str:
    parts = [f"{boxes} box{'es' if boxes != 1 else ''}"] if boxes or not bags else []
    if bags:
        parts.append(f"{bags} bag{'s' if bags != 1 else ''}")
    return " + ".join(parts)


def describe_line_change(c: dict) -> str:
    if c["status"] == "added":
        text = f"added {c['shop']} ({qty_text(c['to'], c['bags_to'])})"
        return text + (f", remark '{c['remarks_to']}'" if c["remarks_to"] else "")
    if c["status"] == "removed":
        return f"removed {c['shop']} ({qty_text(c['from'], c['bags_from'])})"
    parts = []
    if c["from"] != c["to"]:
        parts.append(f"boxes {c['from']}→{c['to']}")
    if c["bags_from"] != c["bags_to"]:
        parts.append(f"bags {c['bags_from']}→{c['bags_to']}")
    if c["remarks_from"] != c["remarks_to"]:
        parts.append(f"remark '{c['remarks_from']}'→'{c['remarks_to']}'")
    return f"{c['shop']}: " + ", ".join(parts)


@app.put("/api/dispatches/today/{transporter_id}")
def save_today_dispatch(transporter_id: int, body: DispatchIn, user: User = Depends(current_user),
                        db: sqlite3.Connection = Depends(get_db)):
    """Create or replace today's single dispatch record for this transporter."""
    if not body.items:
        raise HTTPException(400, "Add at least one medical shop")
    shop_ids = [i.shop_id for i in body.items]
    if len(shop_ids) != len(set(shop_ids)):
        raise HTTPException(400, "The same medical shop is listed more than once")

    d = today()
    with write_tx(db):
        transporter = db.execute("SELECT code, name FROM transporters WHERE id = ?", (transporter_id,)).fetchone()
        if not transporter:
            raise HTTPException(404, "Transporter not found")
        placeholders = ",".join("?" * len(shop_ids))
        shops = {
            r["id"]: shop_text(r["name"], r["area"])
            for r in db.execute(f"SELECT id, name, area FROM shops WHERE id IN ({placeholders})", shop_ids)
        }
        if missing := set(shop_ids) - shops.keys():
            raise HTTPException(400, f"Unknown shop id(s): {sorted(missing)}")

        existing = db.execute(
            """
            SELECT d.id, d.version, d.updated_at, u.full_name AS updated_by_name
            FROM dispatches d LEFT JOIN users u ON u.id = d.updated_by
            WHERE d.transporter_id = ? AND d.date = ?
            """,
            (transporter_id, d),
        ).fetchone()

        # Refuse to overwrite a version this user hasn't seen.
        if existing and body.expected_version != existing["version"]:
            who = existing["updated_by_name"] or "someone"
            raise HTTPException(
                409, f"This list was changed by {who} at {existing['updated_at'][11:16]}. "
                     "Load the latest version and make your changes again.")
        if not existing and body.expected_version is not None:
            raise HTTPException(409, "This list was deleted by an admin. Load it again to start a new one.")

        old = {}
        if existing:
            old = {r["shop_id"]: {"boxes": r["boxes"], "carry_bags": r["carry_bags"], "remarks": r["remarks"]}
                   for r in db.execute("SELECT shop_id, boxes, carry_bags, remarks FROM dispatch_items "
                                       "WHERE dispatch_id = ? ORDER BY id", (existing["id"],))}
        new = {i.shop_id: {"boxes": i.boxes, "carry_bags": i.carry_bags, "remarks": i.remarks} for i in body.items}
        if existing and old == new:
            # Nothing changed: don't bump the version or log anything.
            return load_dispatches(db, "d.id = ?", (existing["id"],))[0]

        stamp = fmt(now())
        if existing:
            dispatch_id = existing["id"]
            db.execute(
                "UPDATE dispatches SET updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?",
                (stamp, user["id"], dispatch_id),
            )
            db.execute("DELETE FROM dispatch_items WHERE dispatch_id = ?", (dispatch_id,))
        else:
            dispatch_id = db.execute(
                """
                INSERT INTO dispatches (transporter_id, date, created_at, updated_at, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (transporter_id, d, stamp, stamp, user["id"], user["id"]),
            ).lastrowid
        db.executemany(
            "INSERT INTO dispatch_items (dispatch_id, shop_id, boxes, carry_bags, remarks) VALUES (?, ?, ?, ?, ?)",
            [(dispatch_id, i.shop_id, i.boxes, i.carry_bags, i.remarks) for i in body.items],
        )

        # Per-shop changes, for the activity log and box / bag credit.
        changes = []
        totals = {"boxes_added": 0, "boxes_removed": 0, "bags_added": 0, "bags_removed": 0}
        for sid in [*new, *(s for s in old if s not in new)]:
            before, after = old.get(sid, EMPTY_LINE), new.get(sid, EMPTY_LINE)
            if before == after:
                continue
            changes.append({
                "shop_id": sid, "shop": shops.get(sid) or _shop_name(db, sid),
                "status": "added" if sid not in old else "removed" if sid not in new else "changed",
                "from": before["boxes"], "to": after["boxes"],
                "bags_from": before["carry_bags"], "bags_to": after["carry_bags"],
                "remarks_from": before["remarks"], "remarks_to": after["remarks"],
            })
            totals["boxes_added"] += max(after["boxes"] - before["boxes"], 0)
            totals["boxes_removed"] += max(before["boxes"] - after["boxes"], 0)
            totals["bags_added"] += max(after["carry_bags"] - before["carry_bags"], 0)
            totals["bags_removed"] += max(before["carry_bags"] - after["carry_bags"], 0)

        label = f"{transporter['code']} list"
        if existing:
            summary = f"Edited {label}: " + "; ".join(describe_line_change(c) for c in changes)
        else:
            total_boxes = sum(v["boxes"] for v in new.values())
            total_bags = sum(v["carry_bags"] for v in new.values())
            summary = f"Created {label} ({len(new)} shops, {qty_text(total_boxes, total_bags)})"
        if body.auto_saved:
            summary += " [auto-saved before logout]"
        audit(db, user, "update" if existing else "create", "dispatch", dispatch_id, summary,
              {"transporter": f"{transporter['code']} — {transporter['name']}", "date": d, "changes": changes},
              auto_saved=body.auto_saved, **totals)

    return load_dispatches(db, "d.id = ?", (dispatch_id,))[0]


def _shop_name(db: sqlite3.Connection, shop_id: int) -> str:
    r = db.execute("SELECT name, area FROM shops WHERE id = ?", (shop_id,)).fetchone()
    return shop_text(r["name"], r["area"]) if r else f"shop #{shop_id}"


@app.delete("/api/dispatches/{dispatch_id}", status_code=204)
def delete_dispatch(dispatch_id: int, admin: User = Depends(require_admin),
                    db: sqlite3.Connection = Depends(get_db)):
    with write_tx(db):
        found = load_dispatches(db, "d.id = ?", (dispatch_id,))
        if not found:
            raise HTTPException(404, "Record not found")
        d = found[0]
        db.execute("DELETE FROM dispatches WHERE id = ?", (dispatch_id,))
        audit(db, admin, "delete", "dispatch", dispatch_id,
              f"Deleted {d['transporter_code']} list of {d['date']} "
              f"({len(d['items'])} shops, {qty_text(d['total_boxes'], d['total_bags'])})",
              {"transporter": f"{d['transporter_code']} — {d['transporter_name']}", "date": d["date"],
               "changes": [{"shop_id": i["shop_id"], "shop": shop_text(i["shop_name"], i["shop_area"]),
                            "status": "removed",
                            "from": i["boxes"], "to": 0, "bags_from": i["carry_bags"], "bags_to": 0,
                            "remarks_from": i["remarks"], "remarks_to": ""} for i in d["items"]]},
              boxes_removed=d["total_boxes"], bags_removed=d["total_bags"])


# ======================= Activity (admin) =======================

def _range(date_from: str | None, date_to: str | None) -> tuple[str, str]:
    """Inclusive date range -> [start, end) timestamps for audit_log.at."""
    t = date.fromisoformat(today())
    start = date.fromisoformat(parse_date(date_from)) if date_from else t - timedelta(days=6)
    end = date.fromisoformat(parse_date(date_to)) if date_to else t
    return f"{start} 00:00:00", f"{end + timedelta(days=1)} 00:00:00"


@app.get("/api/activity/summary")
def activity_summary(date_from: str | None = None, date_to: str | None = None,
                     _: User = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    start, end = _range(date_from, date_to)
    rows = db.execute(
        """
        SELECT u.id, u.username, u.full_name, u.role, u.active,
            COALESCE(SUM(a.entity = 'dispatch' AND a.action = 'create'), 0) AS lists_created,
            COALESCE(SUM(a.entity = 'dispatch' AND a.action = 'update'), 0) AS lists_edited,
            COALESCE(SUM(CASE WHEN a.entity = 'dispatch' THEN a.boxes_added END), 0) AS boxes_added,
            COALESCE(SUM(CASE WHEN a.entity = 'dispatch' THEN a.boxes_removed END), 0) AS boxes_removed,
            COALESCE(SUM(CASE WHEN a.entity = 'dispatch' THEN a.bags_added END), 0) AS bags_added,
            COALESCE(SUM(CASE WHEN a.entity = 'dispatch' THEN a.bags_removed END), 0) AS bags_removed,
            COALESCE(SUM(a.auto_saved), 0) AS auto_saves,
            COALESCE(SUM(a.entity = 'shop' AND a.action = 'create'), 0) AS shops_added,
            COALESCE(SUM(a.entity = 'shop' AND a.action = 'update'), 0) AS shops_edited,
            COALESCE(SUM(a.entity = 'transporter' AND a.action = 'create'), 0) AS transporters_added,
            COALESCE(SUM(a.entity = 'transporter' AND a.action = 'update'), 0) AS transporters_edited,
            COALESCE(SUM(a.action = 'delete'), 0) AS deletes,
            COUNT(a.id) AS total_actions,
            MAX(a.at) AS last_action_at
        FROM users u
        LEFT JOIN audit_log a ON a.user_id = u.id AND a.at >= ? AND a.at < ?
        WHERE u.pending = 0
        GROUP BY u.id
        ORDER BY total_actions DESC, u.full_name
        """,
        (start, end),
    ).fetchall()
    return [{**dict(r), "active": bool(r["active"]),
             "boxes_net": r["boxes_added"] - r["boxes_removed"],
             "bags_net": r["bags_added"] - r["bags_removed"]}
            for r in rows]


@app.get("/api/activity/log")
def activity_log(
    date_from: str | None = None,
    date_to: str | None = None,
    user_id: int | None = None,
    entity: Literal["dispatch", "transporter", "shop", "user", "sticker"] | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    clauses, params = ["a.at >= ?", "a.at < ?"], [start, end]
    if user_id is not None:
        clauses.append("a.user_id = ?")
        params.append(user_id)
    if entity:
        clauses.append("a.entity = ?")
        params.append(entity)
    rows = db.execute(
        f"""
        SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.summary, a.details,
               a.boxes_added, a.boxes_removed, a.bags_added, a.bags_removed, a.auto_saved,
               a.user_id, u.full_name AS user_name, u.username
        FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE {" AND ".join(clauses)}
        ORDER BY a.at DESC, a.id DESC
        LIMIT ? OFFSET ?
        """,
        (*params, limit + 1, offset),
    ).fetchall()
    items = [{**dict(r), "details": json.loads(r["details"]) if r["details"] else None,
              "auto_saved": bool(r["auto_saved"])} for r in rows[:limit]]
    return {"items": items, "has_more": len(rows) > limit}


# ======================= Glass-with-care stickers =======================
# The medical shop's name is printed after "To," on the pre-printed sticker.

FONTS = Literal["Arial", "Arial Black", "Calibri", "Verdana", "Tahoma", "Georgia", "Times New Roman", "Courier New"]


class StickerLayout(BaseModel):
    """Where and how the shop name is printed on the sticker (all in mm / pt)."""
    x_mm: float = Field(ge=0, le=500)
    y_mm: float = Field(ge=0, le=500)
    width_mm: float = Field(gt=0, le=500)
    height_mm: float = Field(gt=0, le=500)
    font_size_pt: float = Field(ge=4, le=200)
    font_family: FONTS = "Arial"
    bold: bool = True
    align: Literal["left", "center", "right"] = "center"
    shrink_to_fit: bool = True


# Starting point for the Kapila Pharma "GLASS WITH CARE" sticker. The size is an assumption
# (150 × 103 mm, same proportions as the photo) until the real sticker is measured; the medical
# shop's name goes in the blank area after "To,". Adjust both in Sticker setup / the layout editor.
DEFAULT_STICKER = {
    "width_mm": 150.0, "height_mm": 103.0, "paper": "sticker", "offset_x_mm": 0.0, "offset_y_mm": 0.0, "tray": "",
    "default_layout": StickerLayout(x_mm=28.5, y_mm=36, width_mm=109.5, height_mm=19.5, font_size_pt=32,
                                    align="left").model_dump(),
    "background": "", "updated_by_name": None, "updated_at": None,
}


def sticker_settings(db: sqlite3.Connection) -> dict:
    r = db.execute(
        "SELECT s.*, u.full_name AS updated_by_name FROM sticker_settings s "
        "LEFT JOIN users u ON u.id = s.updated_by WHERE s.id = 1"
    ).fetchone()
    if not r:
        return dict(DEFAULT_STICKER)
    out = {k: r[k] for k in ("width_mm", "height_mm", "paper", "offset_x_mm", "offset_y_mm", "tray",
                             "background", "updated_by_name", "updated_at")}
    out["default_layout"] = json.loads(r["default_layout"])
    return out


def _save_sticker_settings(db: sqlite3.Connection, user: User, s: dict) -> None:
    db.execute(
        """
        INSERT INTO sticker_settings (id, width_mm, height_mm, paper, offset_x_mm, offset_y_mm, tray,
                                      default_layout, background, updated_by, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET width_mm = excluded.width_mm, height_mm = excluded.height_mm,
            paper = excluded.paper, offset_x_mm = excluded.offset_x_mm, offset_y_mm = excluded.offset_y_mm,
            tray = excluded.tray, default_layout = excluded.default_layout, background = excluded.background,
            updated_by = excluded.updated_by, updated_at = excluded.updated_at
        """,
        (s["width_mm"], s["height_mm"], s["paper"], s["offset_x_mm"], s["offset_y_mm"], s["tray"],
         json.dumps(s["default_layout"]), s["background"], user["id"], fmt(now())),
    )


class ShopStickerLayoutIn(BaseModel):
    layout: StickerLayout | None  # None = go back to the standard layout


@app.put("/api/shops/{shop_id}/sticker-layout")
def set_shop_sticker_layout(shop_id: int, body: ShopStickerLayoutIn, user: User = Depends(current_user),
                            db: sqlite3.Connection = Depends(get_db)):
    with write_tx(db):
        shop = db.execute("SELECT name, area FROM shops WHERE id = ?", (shop_id,)).fetchone()
        if not shop:
            raise HTTPException(404, "Shop not found")
        layout = json.dumps(body.layout.model_dump()) if body.layout else None
        db.execute("UPDATE shops SET sticker_layout = ? WHERE id = ?", (layout, shop_id))
        label = shop_text(shop["name"], shop["area"])
        audit(db, user, "update", "sticker", shop_id,
              f"Saved a custom sticker layout for {label}" if body.layout
              else f"{label} now uses the standard sticker layout",
              body.layout.model_dump() if body.layout else None)
    return shop_public(db.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone())


class StickerSettingsIn(BaseModel):
    width_mm: float = Field(gt=10, le=500)
    height_mm: float = Field(gt=10, le=500)
    paper: Literal["sticker", "A4", "A5", "A6", "letter"]
    offset_x_mm: float = Field(ge=-100, le=500)
    offset_y_mm: float = Field(ge=-100, le=500)
    tray: str = Field(default="", max_length=100)
    default_layout: StickerLayout


@app.get("/api/stickers/settings")
def get_sticker_settings(_: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    return sticker_settings(db)


@app.put("/api/stickers/settings")
def save_sticker_settings(body: StickerSettingsIn, user: User = Depends(current_user),
                          db: sqlite3.Connection = Depends(get_db)):
    with write_tx(db):
        current = sticker_settings(db)
        new = {**current, **body.model_dump(), "default_layout": body.default_layout.model_dump()}
        _save_sticker_settings(db, user, new)
        fields = {"width_mm": "width", "height_mm": "height", "paper": "paper", "offset_x_mm": "shift right",
                  "offset_y_mm": "shift down", "tray": "tray"}
        changes = describe_changes(current, new, fields)
        if current["default_layout"] != new["default_layout"]:
            changes = "standard layout changed" + ("" if changes == "no changes" else f"; {changes}")
        audit(db, user, "update", "sticker", None, f"Sticker setup: {changes}",
              {k: new[k] for k in (*fields, "default_layout")})
    return sticker_settings(db)


class BackgroundIn(BaseModel):
    image: str = Field(default="", max_length=3_000_000)  # data URL; '' = back to the placeholder

    @field_validator("image")
    @classmethod
    def is_image(cls, v):
        if v and not v.startswith(("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")):
            raise ValueError("Upload a PNG, JPEG or WebP image")
        return v


@app.put("/api/stickers/background")
def save_sticker_background(body: BackgroundIn, user: User = Depends(current_user),
                            db: sqlite3.Connection = Depends(get_db)):
    with write_tx(db):
        s = {**sticker_settings(db), "background": body.image}
        _save_sticker_settings(db, user, s)
        audit(db, user, "update", "sticker", None,
              "Uploaded a sticker photo for the preview" if body.image else "Removed the sticker photo")
    return sticker_settings(db)


def _sticker_job(db: sqlite3.Connection, shop_id: int) -> tuple[sqlite3.Row, dict, dict]:
    shop = db.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone()
    if not shop:
        raise HTTPException(404, "Shop not found")
    sticker = sticker_settings(db)
    layout = json.loads(shop["sticker_layout"]) if shop["sticker_layout"] else sticker["default_layout"]
    snapshot = {k: sticker[k] for k in ("width_mm", "height_mm", "paper", "offset_x_mm", "offset_y_mm", "tray")}
    return shop, layout, snapshot


class PrintStickersIn(BaseModel):
    shop_id: int
    copies: int = Field(default=1, ge=1, le=200)


@app.post("/api/print/stickers", status_code=201)
def print_stickers(body: PrintStickersIn, user: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    shop, layout, sticker = _sticker_job(db, body.shop_id)
    title = f"Glass sticker: {shop_text(shop['name'], shop['area'])} × {body.copies}"
    # Only the shop name goes on the sticker (the title above includes the area to tell shops apart).
    return queue_print(db, user, title, {"kind": "stickers", "name": shop["name"], "layout": layout,
                                         "sticker": sticker, "copies": body.copies})


class StickerTestIn(BaseModel):
    shop_id: int


@app.post("/api/print/sticker-test", status_code=201)
def print_sticker_test(body: StickerTestIn, user: User = Depends(current_user),
                       db: sqlite3.Connection = Depends(get_db)):
    shop, layout, sticker = _sticker_job(db, body.shop_id)
    return queue_print(db, user, f"Sticker alignment test: {shop_text(shop['name'], shop['area'])}",
                       {"kind": "sticker_test", "name": shop["name"], "layout": layout, "sticker": sticker})


# ======================= Printing =======================
# Anyone can ask to print; the job waits in print_jobs until the print agent
# (print_agent.py, running on the PC with the printer) picks it up.

AGENT_TOKEN_PATH = Path(__file__).parent / "agent_token.txt"
AGENT_ONLINE_SECONDS = 15  # agent checks in every ~2 s; older than this = offline
STALE_PRINTING = timedelta(minutes=3)  # agent stopped mid-job


def agent_token() -> str:
    """Shared secret between the server and the print agent (same folder on the same PC)."""
    if not AGENT_TOKEN_PATH.exists():
        AGENT_TOKEN_PATH.write_text(secrets.token_urlsafe(32), encoding="utf-8")
    return AGENT_TOKEN_PATH.read_text(encoding="utf-8").strip()


def require_agent(request: Request) -> None:
    if not hmac.compare_digest(request.headers.get("x-agent-token", ""), agent_token()):
        raise HTTPException(401, "Bad print agent token")


PRINT_JOB_SELECT = """
    SELECT j.id, j.created_at, j.requested_by, u.full_name AS requested_by_name, j.title, j.status,
           j.error, j.printer, j.finished_at
    FROM print_jobs j LEFT JOIN users u ON u.id = j.requested_by
"""


def print_job_public(db: sqlite3.Connection, job_id: int) -> dict | None:
    r = db.execute(PRINT_JOB_SELECT + " WHERE j.id = ?", (job_id,)).fetchone()
    return dict(r) if r else None


STICKER_KINDS = ("stickers", "sticker_test")


def target_printer(db: sqlite3.Connection, kind: str | None) -> str:
    """Printer chosen for this kind of job right now ('' = Windows default)."""
    st = _printer_settings(db)
    return st["sticker_printer"] if kind in STICKER_KINDS else st["printer"]


def queue_print(db: sqlite3.Connection, user: User, title: str, payload: dict) -> dict:
    with write_tx(db):
        job_id = db.execute(
            "INSERT INTO print_jobs (created_at, requested_by, title, html, payload, target_printer) "
            "VALUES (?, ?, ?, '', ?, ?)",
            (fmt(now()), user["id"], title, json.dumps(payload), target_printer(db, payload.get("kind"))),
        ).lastrowid
    return print_job_public(db, job_id)


@app.post("/api/print/dispatch/{dispatch_id}", status_code=201)
def print_dispatch(dispatch_id: int, user: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    found = load_dispatches(db, "d.id = ?", (dispatch_id,))
    if not found:
        raise HTTPException(404, "List not found")
    d = found[0]
    if not is_admin(user) and d["date"] != today():
        raise HTTPException(403, "Workers can only print today's lists")
    title = f"{d['transporter_code']} list, {d['date'][8:10]}/{d['date'][5:7]}"
    return queue_print(db, user, title, {"kind": "dispatches", "dispatches": found})


class PrintDailyIn(BaseModel):
    date: str


@app.post("/api/print/daily", status_code=201)
def print_daily(body: PrintDailyIn, user: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    d = parse_date(body.date)
    if not is_admin(user) and d != today():
        raise HTTPException(403, "Workers can only print today's lists")
    found = load_dispatches(db, "d.date = ?", (d,))
    if not found:
        raise HTTPException(400, "There are no lists for this date")
    title = f"All lists, {d[8:10]}/{d[5:7]} ({len(found)} transporters)"
    return queue_print(db, user, title, {"kind": "dispatches", "dispatches": found})


@app.post("/api/print/test", status_code=201)
def print_test_page(user: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    return queue_print(db, user, "Test page", {"kind": "test"})


@app.get("/api/print/jobs")
def list_print_jobs(
    date_from: str | None = None,
    date_to: str | None = None,
    status: Literal["queued", "printing", "done", "failed", "cancelled"] | None = None,
    user_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    clauses, params = ["1 = 1"], []
    if date_from:
        clauses.append("j.created_at >= ?")
        params.append(f"{parse_date(date_from)} 00:00:00")
    if date_to:
        clauses.append("j.created_at < ?")
        params.append(f"{date.fromisoformat(parse_date(date_to)) + timedelta(days=1)} 00:00:00")
    if status:
        clauses.append("j.status = ?")
        params.append(status)
    if user_id is not None:
        clauses.append("j.requested_by = ?")
        params.append(user_id)
    rows = db.execute(
        PRINT_JOB_SELECT + f" WHERE {' AND '.join(clauses)} ORDER BY j.id DESC LIMIT ? OFFSET ?",
        (*params, limit + 1, offset),
    ).fetchall()
    return {"items": [dict(r) for r in rows[:limit]], "has_more": len(rows) > limit}


def _job_or_404(db: sqlite3.Connection, job_id: int) -> dict:
    job = print_job_public(db, job_id)
    if not job:
        raise HTTPException(404, "Print job not found")
    return job


@app.get("/api/print/jobs/{job_id}")
def get_print_job(job_id: int, _: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    return _job_or_404(db, job_id)


@app.post("/api/print/jobs/{job_id}/cancel")
def cancel_print_job(job_id: int, _: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    _job_or_404(db, job_id)
    with write_tx(db):
        cur = db.execute(
            "UPDATE print_jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'",
            (fmt(now()), job_id),
        )
    if cur.rowcount == 0:
        raise HTTPException(409, "Too late to cancel: the printer PC has already started printing it")
    return print_job_public(db, job_id)


@app.post("/api/print/jobs/{job_id}/reprint", status_code=201)
def reprint_job(job_id: int, user: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    """Print the same thing again (same content as the original job)."""
    r = db.execute("SELECT title, html, payload FROM print_jobs WHERE id = ?", (job_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Print job not found")
    title = r["title"] if r["title"].endswith("(again)") else f"{r['title']} (again)"
    kind = json.loads(r["payload"]).get("kind") if r["payload"] else None
    with write_tx(db):
        new_id = db.execute(
            "INSERT INTO print_jobs (created_at, requested_by, title, html, payload, target_printer) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (fmt(now()), user["id"], title, r["html"], r["payload"], target_printer(db, kind)),
        ).lastrowid
    return print_job_public(db, new_id)


def _printer_settings(db: sqlite3.Connection) -> dict:
    r = db.execute(
        "SELECT s.printer, s.updated_at, u.full_name AS updated_by_name, "
        "       s.sticker_printer, s.sticker_updated_at, su.full_name AS sticker_updated_by_name "
        "FROM print_settings s LEFT JOIN users u ON u.id = s.updated_by "
        "LEFT JOIN users su ON su.id = s.sticker_updated_by WHERE s.id = 1"
    ).fetchone()
    if r:
        return dict(r)
    return {"printer": "", "updated_at": None, "updated_by_name": None,
            "sticker_printer": "", "sticker_updated_at": None, "sticker_updated_by_name": None}


def _known_printers(r) -> list[dict]:
    """Printers the agent last reported: [{name, ok, message}]."""
    if not r:
        return []
    return [p if isinstance(p, dict) else {"name": p, "ok": True, "message": ""} for p in json.loads(r["printers"])]


@app.get("/api/print/status")
def print_status(_: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    r = db.execute("SELECT * FROM agent_status WHERE id = 1").fetchone()
    online = bool(r) and (now() - parse(r["last_seen"])).total_seconds() <= AGENT_ONLINE_SECONDS
    settings = _printer_settings(db)
    known = _known_printers(r)
    return {
        "agent_online": online,
        "printer": r["printer"] if r else "",  # printer the agent uses for lists
        "printer_ok": bool(r["printer_ok"]) if r else False,
        "message": r["message"] if r else "",
        "last_seen": r["last_seen"] if r else None,
        "printers": [p["name"] for p in known],
        "printer_states": {p["name"]: {"ok": p["ok"], "message": p["message"]} for p in known},
        "default_printer": r["default_printer"] if r else "",
        "selected_printer": settings["printer"],  # lists; '' = Windows default
        "selected_by": settings["updated_by_name"],
        "selected_at": settings["updated_at"],
        "sticker_printer": settings["sticker_printer"],  # stickers; '' = Windows default
        "sticker_selected_by": settings["sticker_updated_by_name"],
        "sticker_selected_at": settings["sticker_updated_at"],
    }


class PrinterChoice(BaseModel):
    printer: str = Field(default="", max_length=300)  # '' = Windows default printer
    use: Literal["lists", "stickers"] = "lists"  # which kind of printing this choice is for


@app.put("/api/print/settings")
def choose_printer(body: PrinterChoice, user: User = Depends(current_user), db: sqlite3.Connection = Depends(get_db)):
    if body.printer:
        r = db.execute("SELECT printers FROM agent_status WHERE id = 1").fetchone()
        if body.printer not in [p["name"] for p in _known_printers(r)]:
            raise HTTPException(400, f"Printer '{body.printer}' is not installed on the printer PC")
    cols = ("sticker_printer", "sticker_updated_by", "sticker_updated_at") if body.use == "stickers" \
        else ("printer", "updated_by", "updated_at")
    with write_tx(db):
        db.execute("INSERT OR IGNORE INTO print_settings (id) VALUES (1)")
        db.execute(f"UPDATE print_settings SET {cols[0]} = ?, {cols[1]} = ?, {cols[2]} = ? WHERE id = 1",
                   (body.printer, user["id"], fmt(now())))
    return _printer_settings(db)


class AgentPrinter(BaseModel):
    name: str
    ok: bool = True
    message: str = ""


class AgentCheckIn(BaseModel):
    printer: str = ""
    printer_ok: bool = True
    message: str = ""
    printers: list[AgentPrinter] | None = None  # sent when the agent re-checks all printers
    default_printer: str = ""


@app.post("/api/agent/claim", dependencies=[Depends(require_agent)])
def agent_claim(body: AgentCheckIn, db: sqlite3.Connection = Depends(get_db)):
    """The agent checks in (printer state) and takes the oldest waiting job, if any."""
    t = now()
    with write_tx(db):
        db.execute(
            """
            INSERT INTO agent_status (id, last_seen, printer, printer_ok, message) VALUES (1, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen, printer = excluded.printer,
                printer_ok = excluded.printer_ok, message = excluded.message
            """,
            (fmt(t), body.printer, int(body.printer_ok), body.message),
        )
        if body.printers is not None:
            db.execute(
                "UPDATE agent_status SET printers = ?, default_printer = ? WHERE id = 1",
                (json.dumps([p.model_dump() for p in body.printers]), body.default_printer),
            )
        # A job stuck in 'printing' means the agent stopped part-way. Don't reprint
        # automatically (it may have printed); let the person decide.
        db.execute(
            "UPDATE print_jobs SET status = 'failed', finished_at = ?, "
            "error = 'The printer PC stopped while printing this. Check the printer and print again if needed.' "
            "WHERE status = 'printing' AND claimed_at < ?",
            (fmt(t), fmt(t - STALE_PRINTING)),
        )
        job = db.execute(
            """
            SELECT j.id, j.title, j.html, j.payload, j.created_at, j.target_printer,
                   u.full_name AS requested_by_name
            FROM print_jobs j LEFT JOIN users u ON u.id = j.requested_by
            WHERE j.status = 'queued' ORDER BY j.id LIMIT 1
            """
        ).fetchone()
        if job:
            db.execute("UPDATE print_jobs SET status = 'printing', claimed_at = ? WHERE id = ?", (fmt(t), job["id"]))
        selected = _printer_settings(db)["printer"]

    out = None
    if job:
        page = job["html"]
        if job["payload"]:
            at = parse(job["created_at"]).strftime("%d/%m/%Y %H:%M")
            shown_printer = job["target_printer"] or "Windows default printer"
            page = render_job(json.loads(job["payload"]), shown_printer, job["requested_by_name"] or "?", at)
        options = job_print_options(json.loads(job["payload"])) if job["payload"] else {}
        # "printer": where to print this job ('' = the agent's default choice).
        out = {"id": job["id"], "title": job["title"], "html": page, "options": options,
               "printer": job["target_printer"]}
    return {"job": out, "printer": selected}


class AgentFinish(BaseModel):
    ok: bool
    error: str = ""
    printer: str = ""


@app.post("/api/agent/jobs/{job_id}/finish", status_code=204, dependencies=[Depends(require_agent)])
def agent_finish(job_id: int, body: AgentFinish, db: sqlite3.Connection = Depends(get_db)):
    with write_tx(db):
        db.execute(
            "UPDATE print_jobs SET status = ?, error = ?, printer = ?, finished_at = ? "
            "WHERE id = ? AND status = 'printing'",
            ("done" if body.ok else "failed", body.error[:500], body.printer, fmt(now()), job_id),
        )


# ======================= Android app download =======================
# The APK is built on this PC (mobile/scripts/build-apk.js) into downloads/. These are public
# so a new worker can install the app (and see the server address) before having an account.

DOWNLOADS_DIR = Path(__file__).parent.parent / "downloads"
APK_PATH = DOWNLOADS_DIR / "box-dispatch.apk"
APK_INFO_PATH = DOWNLOADS_DIR / "box-dispatch.json"


@app.get("/api/app/android/info")
def android_app_info():
    if not APK_PATH.is_file():
        return {"available": False}
    info = {}
    if APK_INFO_PATH.is_file():
        try:
            info = json.loads(APK_INFO_PATH.read_text(encoding="utf-8"))
        except ValueError:
            info = {}
    return {
        "available": True,
        "version": info.get("version", ""),
        "built_at": info.get("built_at", ""),
        "size_mb": round(APK_PATH.stat().st_size / 1_048_576, 1),
    }


@app.get("/api/app/android")
def download_android_app():
    if not APK_PATH.is_file():
        raise HTTPException(404, "The Android app hasn't been built yet")
    return FileResponse(APK_PATH, media_type="application/vnd.android.package-archive",
                        filename="BoxDispatch.apk")


def _lan_addresses() -> list[str]:
    """IPv4 addresses of this PC that phones on the shop Wi-Fi can reach."""
    found = []
    try:
        # Asks the OS which interface it would use to reach another network; nothing is sent.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    usable = []
    for ip in found:
        if ip.startswith(("127.", "169.254.", "0.")) or ip in usable:
            continue
        usable.append(ip)
    return usable


@app.get("/api/server-info")
def server_info(request: Request):
    port = request.url.port or 80
    return {"addresses": [f"{ip}:{port}" for ip in _lan_addresses()]}


# Serve the built React app (after `npm run build`) so one server runs everything.
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
