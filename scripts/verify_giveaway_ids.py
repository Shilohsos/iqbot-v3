#!/usr/bin/env python3
"""Verify a provided ID set against the full DB (all tables, all id-like columns + text extraction)."""
import sqlite3, re, sys

DB = '/root/iqbot-v3/iqbot-v3.db'
ids = ['194583721','194841306','194267954','194719638','194356182','194925407','194638215','194172869','194804531','194493726']

db = sqlite3.connect(DB)
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]

# 1) exact column matches
print("=== EXACT COLUMN SCAN (all tables, id/user/trader-like columns) ===")
for w in ids:
    hits = []
    for t in tables:
        try:
            cols = [c[1] for c in db.execute(f"PRAGMA table_info({t})")]
        except Exception: continue
        for c in cols:
            if any(k in c.lower() for k in ('id','user','trader','winner','participant')):
                try:
                    n = db.execute(f"SELECT COUNT(*) FROM {t} WHERE {c} = ?", (int(w),)).fetchone()[0]
                    if n: hits.append(f"{t}.{c}={n}")
                except Exception: continue
    print(f"{w}: {'CLEAN' if not hits else 'HITS: ' + ', '.join(hits)}")

# 2) text extraction from message-like tables
print("\n=== TEXT SCAN (notifications_queue, giveaway_updates, messages) ===")
for w in ids:
    hits = []
    for t in ('notifications_queue','giveaway_updates','messages'):
        try:
            cols = [c[1] for c in db.execute(f"PRAGMA table_info({t})")]
        except Exception: continue
        text_cols = [c for c in cols if any(k in c.lower() for k in ('text','message','update','body','content'))]
        for c in text_cols:
            try:
                rows = db.execute(f"SELECT {c} FROM {t}").fetchall()
                for (v,) in rows:
                    if v is None: continue
                    if re.search(rf'\b{w}\b', str(v)):
                        hits.append(f"{t}.{c}")
                        break
            except Exception: continue
    print(f"{w}: {'CLEAN' if not hits else 'TEXT-HITS: ' + ', '.join(hits)}")

# 3) overlap with session-generated set
mine = ['194710530','194916456','194612354','194680753','194558151','194653355','194657506','194980377','194530725','194838203']
print("\n=== OVERLAP WITH SESSION SET ===")
overlap = set(ids) & set(mine)
print("overlap:", overlap if overlap else "NONE")

# 4) duplicates within the provided set
dups = [x for x in set(ids) if ids.count(x) > 1]
print("duplicates in set:", dups if dups else "NONE")

# 5) format check: 9 digits, 194xxx range
print("\n=== FORMAT ===")
for w in ids:
    ok_len = len(w) == 9
    ok_prefix = w.startswith('194')
    print(f"{w}: len={len(w)} 194-prefix={ok_prefix} {'OK' if ok_len and ok_prefix else 'FORMAT ISSUE'}")
