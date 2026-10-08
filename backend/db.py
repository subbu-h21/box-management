import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

# BOX_DB lets tests use a separate database file.
DB_PATH = Path(os.environ.get("BOX_DB") or Path(__file__).parent / "data.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name     TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'worker')),
    active        INTEGER NOT NULL DEFAULT 1,
    phone         TEXT NOT NULL DEFAULT '',
    pending       INTEGER NOT NULL DEFAULT 0,  -- self-registered, waiting for admin approval
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Login sessions. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client     TEXT NOT NULL CHECK (client IN ('web', 'mobile')),
    created_at TEXT NOT NULL,
    last_seen  TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transporters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS shops (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL COLLATE NOCASE,
    area       TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
    phone      TEXT NOT NULL DEFAULT '',
    sticker_layout TEXT,  -- JSON glass-sticker layout for this shop; NULL = use the standard layout
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (name, area)
);

-- One dispatch per transporter per day.
CREATE TABLE IF NOT EXISTS dispatches (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    transporter_id INTEGER NOT NULL REFERENCES transporters(id) ON DELETE RESTRICT,
    date           TEXT NOT NULL,  -- YYYY-MM-DD, server local date
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by     INTEGER REFERENCES users(id),
    updated_by     INTEGER REFERENCES users(id),
    version        INTEGER NOT NULL DEFAULT 1,  -- bumped on every save, guards against overwriting someone else's edit
    UNIQUE (transporter_id, date)
);

CREATE TABLE IF NOT EXISTS dispatch_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dispatch_id INTEGER NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
    shop_id     INTEGER NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    boxes       INTEGER NOT NULL DEFAULT 0 CHECK (boxes >= 0),
    carry_bags  INTEGER NOT NULL DEFAULT 0 CHECK (carry_bags >= 0),
    remarks     TEXT NOT NULL DEFAULT '',
    CHECK (boxes > 0 OR carry_bags > 0),  -- every row sends something
    UNIQUE (dispatch_id, shop_id)
);

-- Who changed what. boxes_added / boxes_removed are per-save changes, so
-- summing them per user gives "boxes contributed" (net = added - removed).
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL,
    user_id       INTEGER REFERENCES users(id),
    action        TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    entity        TEXT NOT NULL,  -- dispatch / transporter / shop / user / sticker
    entity_id     INTEGER,
    summary       TEXT NOT NULL,
    details       TEXT,  -- JSON
    boxes_added   INTEGER NOT NULL DEFAULT 0,
    boxes_removed INTEGER NOT NULL DEFAULT 0,
    bags_added    INTEGER NOT NULL DEFAULT 0,
    bags_removed  INTEGER NOT NULL DEFAULT 0,
    auto_saved    INTEGER NOT NULL DEFAULT 0
);

-- Single row: the glass-with-care sticker and how it sits in the printer.
CREATE TABLE IF NOT EXISTS sticker_settings (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    width_mm       REAL NOT NULL,
    height_mm      REAL NOT NULL,
    paper          TEXT NOT NULL,              -- 'sticker' (custom size) or A4 / A5 / A6 / letter
    offset_x_mm    REAL NOT NULL DEFAULT 0,    -- where the sticker sits on that paper / fine adjustment
    offset_y_mm    REAL NOT NULL DEFAULT 0,
    tray           TEXT NOT NULL DEFAULT '',   -- printer input tray ('' = printer decides)
    default_layout TEXT NOT NULL,              -- JSON layout used by shops without their own
    background     TEXT NOT NULL DEFAULT '',   -- data URL of a photo of the blank sticker (preview only)
    updated_by     INTEGER REFERENCES users(id),
    updated_at     TEXT
);

-- Print queue: anyone asks to print; the print agent on the PC with the printer prints it.
CREATE TABLE IF NOT EXISTS print_jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    requested_by INTEGER NOT NULL REFERENCES users(id),
    title        TEXT NOT NULL,
    html         TEXT NOT NULL DEFAULT '',  -- (older jobs) the finished page
    payload      TEXT NOT NULL DEFAULT '',  -- JSON: what to print, snapshot taken when Print was pressed
    status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'printing', 'done', 'failed', 'cancelled')),
    error        TEXT NOT NULL DEFAULT '',
    printer      TEXT NOT NULL DEFAULT '',  -- printer it was actually printed on
    target_printer TEXT NOT NULL DEFAULT '',  -- printer chosen when it was queued ('' = Windows default)
    claimed_at   TEXT,
    finished_at  TEXT
);

-- Single row: when the print agent last checked in, and its printer's state.
CREATE TABLE IF NOT EXISTS agent_status (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    last_seen  TEXT NOT NULL,
    printer    TEXT NOT NULL DEFAULT '',
    printer_ok INTEGER NOT NULL DEFAULT 1,
    message    TEXT NOT NULL DEFAULT '',
    printers   TEXT NOT NULL DEFAULT '[]',  -- JSON list of printers on that PC: [{name, ok, message}]
    default_printer TEXT NOT NULL DEFAULT ''
);

-- Single row: which printer to use ('' = Windows default printer), for lists and for stickers.
CREATE TABLE IF NOT EXISTS print_settings (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    printer    TEXT NOT NULL DEFAULT '',  -- dispatch lists and test pages
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT,
    sticker_printer    TEXT NOT NULL DEFAULT '',
    sticker_updated_by INTEGER REFERENCES users(id),
    sticker_updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dispatches_date ON dispatches(date);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_user_at ON audit_log(user_id, at);
"""

# Columns added after the first release; added to existing databases on startup.
MIGRATIONS = {
    "users": [
        ("phone", "TEXT NOT NULL DEFAULT ''"),
        ("pending", "INTEGER NOT NULL DEFAULT 0"),
    ],
    "shops": [
        ("sticker_layout", "TEXT"),
    ],
    "dispatches": [
        ("created_by", "INTEGER REFERENCES users(id)"),
        ("updated_by", "INTEGER REFERENCES users(id)"),
        ("version", "INTEGER NOT NULL DEFAULT 1"),
    ],
    "print_jobs": [
        ("payload", "TEXT NOT NULL DEFAULT ''"),
        ("target_printer", "TEXT NOT NULL DEFAULT ''"),
    ],
    "print_settings": [
        ("sticker_printer", "TEXT NOT NULL DEFAULT ''"),
        ("sticker_updated_by", "INTEGER REFERENCES users(id)"),
        ("sticker_updated_at", "TEXT"),
    ],
    "agent_status": [
        ("printers", "TEXT NOT NULL DEFAULT '[]'"),
        ("default_printer", "TEXT NOT NULL DEFAULT ''"),
    ],
    "audit_log": [
        ("bags_added", "INTEGER NOT NULL DEFAULT 0"),
        ("bags_removed", "INTEGER NOT NULL DEFAULT 0"),
    ],
}

# dispatch_items before carry bags / remarks had "boxes > 0" as a table constraint,
# which SQLite can't alter, so the table is rebuilt with the existing rows copied over.
REBUILD_DISPATCH_ITEMS = """
BEGIN;
CREATE TABLE dispatch_items_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dispatch_id INTEGER NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
    shop_id     INTEGER NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    boxes       INTEGER NOT NULL DEFAULT 0 CHECK (boxes >= 0),
    carry_bags  INTEGER NOT NULL DEFAULT 0 CHECK (carry_bags >= 0),
    remarks     TEXT NOT NULL DEFAULT '',
    CHECK (boxes > 0 OR carry_bags > 0),
    UNIQUE (dispatch_id, shop_id)
);
INSERT INTO dispatch_items_new (id, dispatch_id, shop_id, boxes)
    SELECT id, dispatch_id, shop_id, boxes FROM dispatch_items;
DROP TABLE dispatch_items;
ALTER TABLE dispatch_items_new RENAME TO dispatch_items;
COMMIT;
"""


# audit_log used to restrict "entity" to a fixed list. Rebuilt without it,
# copying every row, so new kinds of records can be logged.
REBUILD_AUDIT_LOG = """
BEGIN;
CREATE TABLE audit_log_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL,
    user_id       INTEGER REFERENCES users(id),
    action        TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    entity        TEXT NOT NULL,
    entity_id     INTEGER,
    summary       TEXT NOT NULL,
    details       TEXT,
    boxes_added   INTEGER NOT NULL DEFAULT 0,
    boxes_removed INTEGER NOT NULL DEFAULT 0,
    bags_added    INTEGER NOT NULL DEFAULT 0,
    bags_removed  INTEGER NOT NULL DEFAULT 0,
    auto_saved    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO audit_log_new (id, at, user_id, action, entity, entity_id, summary, details,
                           boxes_added, boxes_removed, bags_added, bags_removed, auto_saved)
    SELECT id, at, user_id, action, entity, entity_id, summary, details,
           boxes_added, boxes_removed, bags_added, bags_removed, auto_saved FROM audit_log;
DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;
COMMIT;
"""


def connect() -> sqlite3.Connection:
    # FastAPI may run a request's dependency setup, endpoint and teardown on different
    # worker threads. Each connection is still used by only one request at a time.
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")  # readers don't block the writer
        for table, columns in MIGRATIONS.items():
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            if not existing:
                continue  # table is new; SCHEMA creates it with all columns
            for name, decl in columns:
                if name not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
        item_cols = {r["name"] for r in conn.execute("PRAGMA table_info(dispatch_items)")}
        if item_cols and "carry_bags" not in item_cols:
            conn.executescript(REBUILD_DISPATCH_ITEMS)
        # Suppliers were a misunderstanding (stickers print the medical shop); only dummy data lived there.
        conn.execute("DROP TABLE IF EXISTS suppliers")
        audit_sql = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'").fetchone()
        if audit_sql and "entity IN" in audit_sql[0]:
            conn.executescript(REBUILD_AUDIT_LOG)
        conn.executescript(SCHEMA)


@contextmanager
def write_tx(conn: sqlite3.Connection):
    """Transaction that takes the write lock up front, so reads inside it
    (e.g. the 'before' state for the audit log) can't go stale."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
