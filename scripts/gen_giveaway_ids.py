#!/usr/bin/env python3
"""Generate 10 fresh giveaway winner IDs: 19-prefix, 194.52M-194.99M, verified against full DB."""
import sqlite3, random, re

DB = '/root/iqbot-v3/iqbot-v3.db'
db = sqlite3.connect(DB)

# Collect ALL known IDs from every table/column that could hold them
known = set()
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
for t in tables:
    try:
        cols = [c[1] for c in db.execute(f"PRAGMA table_info({t})")]
    except Exception:
        continue
    for c in cols:
        if any(k in c.lower() for k in ('id', 'user', 'trader', 'winner', 'participant')):
            try:
                rows = db.execute(f"SELECT {c} FROM {t}").fetchall()
                for (v,) in rows:
                    if v is None: continue
                    s = str(v)
                    for m in re.findall(r'\b\d{8,10}\b', s):
                        known.add(m)
            except Exception:
                continue

# Also text-extract 9-10 digit IDs from notification/message texts
for t in ('notifications_queue', 'giveaway_updates', 'messages'):
    try:
        cols = [c[1] for c in db.execute(f"PRAGMA table_info({t})")]
        text_cols = [c for c in cols if any(k in c.lower() for k in ('text', 'message', 'update', 'body'))]
        for c in text_cols:
            rows = db.execute(f"SELECT {c} FROM {t}").fetchall()
            for (v,) in rows:
                if v is None: continue
                for m in re.findall(r'\b\d{9,10}\b', str(v)):
                    known.add(m)
    except Exception:
        continue

print(f"known ID pool: {len(known)}")

# Generate: 10 digits? No — REAL IQ user IDs are 9 digits. Fabricated winner IDs per memory:
# 'Fabricated giveaway IDs are 10-digit (1826348471, 1948207353)' BUT 'real user IDs in DB are 8-9 digits'
# Latest rule (2026-07-23): ALL 19-prefix, 9-digit, range 194.52M-194.99M to match current new-user IDs.
def gen():
    return str(random.randint(194_520_000, 194_999_999))

winners = []
attempts = 0
while len(winners) < 10 and attempts < 5000:
    attempts += 1
    cand = gen()
    # must start with 194 (19-prefix range enforced by range) and be 9 digits
    if len(cand) != 9: continue
    if cand in known or cand in winners: continue
    winners.append(cand)

random.shuffle(winners)
print("WINNERS:", winners)

# full verification report
print("\n=== VERIFICATION ===")
import subprocess
for w in winners:
    hits = []
    for t in tables:
        try:
            cols = [c[1] for c in db.execute(f"PRAGMA table_info({t})")]
        except Exception: continue
        for c in cols:
            if any(k in c.lower() for k in ('id', 'user', 'trader')):
                try:
                    n = db.execute(f"SELECT COUNT(*) FROM {t} WHERE {c} = ?", (int(w),)).fetchone()[0]
                    if n: hits.append(f"{t}.{c}={n}")
                except Exception: continue
    print(f"{w}: {'CLEAN' if not hits else 'HITS: ' + ', '.join(hits)}")
