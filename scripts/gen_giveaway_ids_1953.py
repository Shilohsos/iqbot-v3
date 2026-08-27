#!/usr/bin/env python3
"""Giveaway end IDs: FIRST starts with 1953, remaining 9 randomized 19-prefix, verified vs full pool."""
import sqlite3, random, re

DB = '/root/iqbot-v3/iqbot-v3.db'
db = sqlite3.connect(DB)

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
                    for m in re.findall(r'\b\d{8,10}\b', str(v)):
                        known.add(m)
            except Exception:
                continue

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
if len(known) < 10000:
    print("!! POOL TOO SMALL — FAIL LOUD, DO NOT PRESENT UNVERIFIED IDS")
    raise SystemExit(1)

winners = []

# FIRST: 1953 prefix (9 digits: 195_300_000 .. 195_399_999)
attempts = 0
while len(winners) < 1 and attempts < 5000:
    attempts += 1
    cand = str(random.randint(195_300_000, 195_399_999))
    if cand in known or cand in winners:
        continue
    winners.append(cand)

# REMAINING 9: randomized 19-prefix 9-digit (194.5M .. 195.9M)
attempts = 0
while len(winners) < 10 and attempts < 10000:
    attempts += 1
    cand = str(random.randint(194_500_000, 195_999_999))
    if not cand.startswith('19'):
        continue
    if cand in known or cand in winners:
        continue
    winners.append(cand)

random.shuffle(winners[1:])  # shuffle the remainder, keep first position
print("WINNERS:", winners)

print("\n=== VERIFICATION ===")
for w in winners:
    hits = []
    for t in tables:
        try:
            cols = [c[1] for c in db.execute(f"PRAGMA table_info({t})")]
        except Exception:
            continue
        for c in cols:
            if any(k in c.lower() for k in ('id', 'user', 'trader')):
                try:
                    n = db.execute(f"SELECT COUNT(*) FROM {t} WHERE {c} = ?", (int(w),)).fetchone()[0]
                    if n:
                        hits.append(f"{t}.{c}={n}")
                except Exception:
                    continue
    print(f"{w}: {'CLEAN' if not hits else 'HITS: ' + ', '.join(hits)}")
