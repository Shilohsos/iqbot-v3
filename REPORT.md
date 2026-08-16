# REPORT — Affiliate verification: full-history check (window-orphan fix)

**Branch:** `claude/affiliate-verification-full-history` (from `d203021`)
**Files changed:** `src/affiliate.ts`, `src/db.ts` (+ this REPORT.md)

> This replaces the previous REPORT.md (the 4117 fix), per the directive's
> "REPORT.md at branch root" convention. That report is preserved in history at
> commit `db0fb86` — say the word if you'd rather keep both files side by side.

---

## 1. What was broken

`checkAffiliate()` read only the last `AFFILIATE_SCAN_LIMIT` (1000) channel
messages and then fell back to `lead_events`, which records **deposits only**. A
user who registered but had not yet deposited, whose registration had scrolled
past 1000 messages, was therefore unverifiable — permanently, and by design of
the old logic rather than by accident. That is user `195190255` (telegram
`8381978441`): registered ~00:05, failed 5 times across the day.

The window is a moving target, so this silently orphans *every* legitimate
registration as the channel advances — the two other users the same evening are
the same failure, not a coincidence.

## 2. What changed

`checkAffiliate()` now consults four layers, cheapest first, and returns on the
first hit:

| # | Layer | Cost | Covers |
|---|---|---|---|
| 0 | **Local archive** (`affiliate_messages`) | no network | anything seen once before — permanently |
| 1 | **Telegram server-side search** | 1 round-trip | the channel's **entire** history, any age |
| 2 | **Resumable backfill** | paginated | search unavailable / rate-limited |
| 3 | **`lead_events`** | local | depositors (unchanged) |

**Layer 1** replaces the window: `getMessages(channelId, { search: userIdStr, limit: 10 })`
is a server-side search across all history, so registration age stops mattering.
Every hit is written to the archive, so it never costs a round-trip twice.

**Layer 2** paginates backwards in 200-message pages, persisting every message.
Two properties make this safe under the 15s cap:

- **Budget-bounded.** The whole call shares one 15s deadline. Pagination stops
  when less than 2s remains; the user never waits longer than the pre-existing cap.
- **Resumable, so partial work is not wasted.** The cursor is derived from the
  archive itself (`MIN(channel_msg_id)`), so a run cut short by the budget resumes
  exactly where it stopped on the next verification. The archive converges to the
  full history across calls without any single user ever waiting on it.

A module-level guard prevents two concurrent verifications from paginating the
same range in parallel.

**Robust matching:** IDs are extracted with `\b(19\d{7})\b` in addition to
`includes()`, so `ID: 195190255`, `user_id:195190255,` and punctuation-wrapped
payloads are caught and — critically — *extractable* for the archive index.

### Schema (`src/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS affiliate_messages (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_msg_id INTEGER NOT NULL,
    iq_user_id     TEXT    NOT NULL DEFAULT '',
    raw_text       TEXT    NOT NULL DEFAULT '',
    msg_date       TEXT,
    UNIQUE(channel_msg_id, iq_user_id)
);
-- + indexes on iq_user_id and channel_msg_id
```

Two deliberate choices beyond the directive's sketch:

- `UNIQUE(channel_msg_id, iq_user_id)` — without it `INSERT OR IGNORE` has nothing
  to ignore *on*, so re-scanning would duplicate every row.
- `iq_user_id` defaults to `''` rather than NULL for messages carrying no ID.
  SQLite treats NULLs as distinct in a UNIQUE index, so NULL would defeat the
  dedupe; `''` also lets those rows mark how far back the archive reaches, which
  is what makes the backfill cursor work.

A message listing several IDs yields one row per ID.

**Unchanged, as required:** the approval flow, `approveUser`, the 3-tier
fail-count escalation, admin notifications, `lead_events` itself, the GramJS
singleton, and the 15s timeout discipline.

## 3. How to verify

**Automated:** 14/14 assertions against the compiled module with a mocked channel
of 5,000 messages where the target registration sits 3,500 deep — i.e. far outside
the old 1000-message window:

- search verifies the orphaned registration in **3ms**, no pagination;
- the second check hits the archive with **zero network calls**;
- with search forced unavailable, backfill verifies via **18 pages / 3,600 msgs in 244ms**;
- punctuation-wrapped `user_id:195190255,` verifies;
- an ID genuinely *not* on the channel is still **rejected** (no false positives);
- the `lead_events` depositor path still works and keeps its `[history]` shape.

`npx tsc --noEmit` is byte-identical to the pre-change baseline (zero new errors);
`node --check` clean on the compiled module.

**Log signatures after deploy** — the miss → paginate → hit sequence:

```
[affiliate] search HIT for 195190255 (msg 1500)              ← layer 1, the common case
[affiliate] search MISS for <id> — paginating channel history ← falling to layer 2
[affiliate] backfill HIT for <id> after 3600 msgs (18 pages)  ← layer 2 succeeded
[affiliate] backfill budget spent after N msgs (P pages) — archive advanced, resuming next call
[affiliate] backfill reached the start of channel history after N msgs
[affiliate] NOT FOUND for <id> after search + backfill + lead_events  ← genuine miss
```

**Manual check on the live user:** `checkAffiliate(195190255)` should now return
`found: true`. Confirm the archive is filling with:

```sql
SELECT COUNT(*) FROM affiliate_messages;
SELECT * FROM affiliate_messages WHERE iq_user_id = '195190255';
```

## 4. Follow-up risks

1. **The `raw_text LIKE '%id%'` backstop is a table scan.** It runs only after the
   indexed exact-match misses — i.e. on genuinely-new or unknown IDs. Cheap at
   today's archive size; if the archive grows into the hundreds of thousands of
   rows and verification latency becomes visible, the fix is an FTS index or
   dropping the LIKE (the regex extraction already covers the known formats).
2. **The `19`-prefix assumption.** `\b(19\d{7})\b` matches the observed ID format.
   If IQ Option ever issues IDs outside that prefix, extraction misses them —
   though layer 1's `includes()` search and the LIKE backstop would still verify
   them, so the failure mode is a slower check, not a false rejection.
3. **First backfill on a large channel spans several verifications.** By design:
   each call advances the archive within its budget. Nothing is lost, but the very
   first users after deploy may fall through to layer 3 while the archive is still
   filling. Layer 1 covers them in the meantime, so this only bites if server-side
   search is also unavailable.
4. **Backfill archives the whole channel, including non-registration messages.**
   That is intentional (it is what makes the cursor resumable), but the table will
   grow to roughly one row per channel message. Bounded by channel size, not by
   user count.
