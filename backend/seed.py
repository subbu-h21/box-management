"""Fill the database with dummy data for trying out the app.

Usage (from backend/):
    .venv\\Scripts\\python seed.py           # only if the database is empty
    .venv\\Scripts\\python seed.py --reset   # wipe ALL existing data first
"""
import json
import random
import sys
from datetime import date, datetime, time, timedelta

from auth import hash_password
from db import DB_PATH, connect, init_db

TRANSPORTERS = [
    ("T-01", "Sri Balaji Transport", "9845012345"),
    ("T-02", "Ravi Roadlines", "9880123456"),
    ("T-03", "Kaveri Logistics", "9741234567"),
    ("T-04", "Ganesh Parcel Service", "9902345678"),
    ("T-05", "Sai Express Cargo", "9611345678"),
    ("T-06", "Lakshmi Goods Carriers", "9538456789"),
]

SHOPS = [
    ("Apollo Medicals", "Jayanagar"),
    ("Sri Sai Pharma", "BTM Layout"),
    ("City Medical Stores", "Malleshwaram"),
    ("Lifeline Chemists", "Rajajinagar"),
    ("Sanjeevini Medicals", "Basavanagudi"),
    ("MedPlus Pharmacy", "Koramangala"),
    ("Shree Ganesh Medicals", "Hebbal"),
    ("Arogya Pharma", "Yelahanka"),
    ("Janata Medical Hall", "Tumkur"),
    ("Venkateshwara Medicals", "Tumkur"),
    ("Health First Chemists", "Hosur"),
    ("Kamadhenu Medicals", "Mandya"),
    ("Mysore Medical Agency", "Mysuru"),
    ("Navjeevan Pharmacy", "Mysuru"),
    ("Sri Raghavendra Medicals", "Ramanagara"),
    ("Care & Cure Pharma", "Whitefield"),
    ("Swastik Medical Stores", "Electronic City"),
    ("Annapurna Medicals", "Kolar"),
    ("Mahaveer Pharma", "Chikkaballapur"),
    ("Om Shakti Medicals", "Hoskote"),
    ("Wellness Medicos", "Indiranagar"),
    ("Sree Durga Medicals", "Channapatna"),
    ("Prakash Medical Hall", "Davanagere"),
    ("New Life Pharmacy", "Shivamogga"),
]

# (username, full name, role, password). Change these passwords for real use.
USERS = [
    ("admin", "Owner", "admin", "admin123"),
    ("ravi", "Ravi Kumar", "worker", "worker123"),
    ("suresh", "Suresh N", "worker", "worker123"),
    ("meena", "Meena R", "worker", "worker123"),
]

REMARKS = ["Fragile - handle with care", "Cold chain item inside", "Collect payment on delivery",
           "Deliver before 11 am", "Shop closed on Thursday afternoon"]

DAYS_BACK = 14


def main() -> None:
    reset = "--reset" in sys.argv
    if reset:
        for suffix in ("", "-wal", "-shm"):
            DB_PATH.with_name(DB_PATH.name + suffix).unlink(missing_ok=True)
    init_db()

    rng = random.Random(42)
    with connect() as db:
        if db.execute(
            "SELECT (SELECT COUNT(*) FROM transporters) + (SELECT COUNT(*) FROM shops) + (SELECT COUNT(*) FROM users)"
        ).fetchone()[0]:
            sys.exit("Database already has data. Run with --reset to wipe it and reseed.")

        db.executemany(
            "INSERT INTO users (username, full_name, role, password_hash) VALUES (?, ?, ?, ?)",
            [(u, n, r, hash_password(p)) for u, n, r, p in USERS],
        )
        worker_ids = [r[0] for r in db.execute("SELECT id FROM users WHERE role = 'worker' ORDER BY id")]
        db.executemany("INSERT INTO transporters (code, name, phone) VALUES (?, ?, ?)", TRANSPORTERS)
        db.executemany("INSERT INTO shops (name, area) VALUES (?, ?)", SHOPS)
        transporters = {r[0]: r[1] for r in db.execute("SELECT id, code FROM transporters ORDER BY id")}
        shop_names = {r[0]: f"{r[1]}, {r[2]}" for r in db.execute("SELECT id, name, area FROM shops ORDER BY id")}
        transporter_ids, shop_ids = list(transporters), list(shop_names)

        def log(at, user_id, action, dispatch_id, summary, changes, added=0, removed=0, bags=0):
            db.execute(
                """INSERT INTO audit_log (at, user_id, action, entity, entity_id, summary, details,
                                          boxes_added, boxes_removed, bags_added)
                   VALUES (?, ?, ?, 'dispatch', ?, ?, ?, ?, ?, ?)""",
                (at, user_id, action, dispatch_id, summary, json.dumps({"changes": changes}), added, removed, bags),
            )

        # Each transporter mostly serves its own group of shops, like real routes.
        routes = {t: shop_ids[i::len(transporter_ids)] for i, t in enumerate(transporter_ids)}

        today = date.today()
        now = datetime.now().replace(second=0, microsecond=0)
        n_dispatches = n_items = n_edits = 0
        for back in range(DAYS_BACK, -1, -1):
            day = today - timedelta(days=back)
            if day.weekday() == 6:  # no dispatch on Sundays
                continue
            # Today: only half the transporters are done, so the entry screen still has fresh ones to try.
            active = transporter_ids[: len(transporter_ids) // 2] if back == 0 else transporter_ids
            for t in active:
                if back and rng.random() < 0.15:  # occasionally a transporter doesn't go out
                    continue
                route = routes[t]
                shops = rng.sample(route, rng.randint(2, len(route)))
                if rng.random() < 0.2:  # sometimes picks up a shop off its usual route
                    shops.append(rng.choice([s for s in shop_ids if s not in shops]))
                items = {s: rng.randint(1, 12) for s in shops}
                bags = {s: rng.choice([0, 0, 0, 1, 2]) for s in shops}
                remarks = {s: rng.choice(REMARKS) if rng.random() < 0.15 else "" for s in shops}

                creator = rng.choice(worker_ids)
                created = min(datetime.combine(day, time(rng.randint(9, 16), rng.randint(0, 59))), now)
                cur = db.execute(
                    """INSERT INTO dispatches (transporter_id, date, created_at, updated_at, created_by, updated_by)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (t, day.isoformat(), str(created), str(created), creator, creator),
                )
                dispatch_id = cur.lastrowid
                total, total_bags = sum(items.values()), sum(bags.values())
                log(str(created), creator, "create", dispatch_id,
                    f"Created {transporters[t]} list ({len(items)} shops, {total} boxes"
                    + (f" + {total_bags} bags)" if total_bags else ")"),
                    [{"shop_id": s, "shop": shop_names[s], "status": "added", "from": 0, "to": b,
                      "bags_from": 0, "bags_to": bags[s], "remarks_from": "", "remarks_to": remarks[s]}
                     for s, b in items.items()],
                    added=total, bags=total_bags)

                # Sometimes another worker corrects a box count later.
                if rng.random() < 0.25:
                    editor = rng.choice(worker_ids)
                    s = rng.choice(shops)
                    old = items[s]
                    items[s] = max(1, old + rng.choice([-2, -1, 1, 2, 3]))
                    edited = min(created + timedelta(minutes=rng.randint(5, 90)), now)
                    db.execute(
                        "UPDATE dispatches SET updated_at = ?, updated_by = ?, version = 2 WHERE id = ?",
                        (str(edited), editor, dispatch_id),
                    )
                    log(str(edited), editor, "update", dispatch_id,
                        f"Edited {transporters[t]} list: {shop_names[s]}: boxes {old}→{items[s]}",
                        [{"shop_id": s, "shop": shop_names[s], "status": "changed", "from": old, "to": items[s],
                          "bags_from": bags[s], "bags_to": bags[s], "remarks_from": remarks[s], "remarks_to": remarks[s]}],
                        added=max(items[s] - old, 0), removed=max(old - items[s], 0))
                    n_edits += 1

                db.executemany(
                    "INSERT INTO dispatch_items (dispatch_id, shop_id, boxes, carry_bags, remarks) VALUES (?, ?, ?, ?, ?)",
                    [(dispatch_id, s, b, bags[s], remarks[s]) for s, b in items.items()],
                )
                n_dispatches += 1
                n_items += len(items)

    print(
        f"Seeded {len(USERS)} users, {len(TRANSPORTERS)} transporters, {len(SHOPS)} shops, "
        f"{n_dispatches} dispatch records ({n_items} shop entries, {n_edits} edits) over the last {DAYS_BACK} days."
    )
    print("Logins:")
    for u, n, r, p in USERS:
        print(f"  {r:<7} {u:<8} / {p}")


if __name__ == "__main__":
    main()
