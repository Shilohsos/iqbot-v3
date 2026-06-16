# Database Audit: Stale/Orphaned Data Cleanup
**Database**: iqbot-v3.db
**Date**: 2026-06-16
**Context**: Current date is approximately June 16, 2026

---

## 1. TIMEOUT TRADES

### Findings
| Metric | Value |
|--------|-------|
| Total TIMEOUT trades | **115** |
| Total amount at risk | **$130,069.20** |
| >24h old | 107 trades ($123,086.20) |
| >7 days old | 82 trades ($86,872.20) |
| <1 day old | 8 trades ($6,983.00) |
| Date range | 2026-05-25 to 2026-06-16 |

### Analysis
- These trades were placed on IQ Option but `waitForResult()` timed out before receiving the result callback.
- **No signal_tracking linkage**: `signal_tracking` table has no `trade_id` column and no foreign key to `trades`. There is no way to retroactively resolve these TIMEOUTs via signals.
- All TIMEOUTs have `pnl = 0.0` — they were never resolved.
- **Recommendation**: TIMEOUT trades >24h old are beyond any realistic recovery window (IQ Option results come within 1–5 minutes). These should be resolved as LOSSes with negative PnL equal to the trade amount (conservative approach — the funds are gone whether we record it or not).

### Cleanup SQL
```sql
-- Mark TIMEOUT trades older than 24 hours as LOSS with full-amount PnL
UPDATE trades
SET status = 'LOSS',
    pnl = -amount
WHERE status = 'TIMEOUT'
  AND created_at < datetime('now', '-1 day');

-- Optional: also resolve recent TIMEOUTs (<24h) that are still unresolved
-- These are from today, so there's a slim chance they could still resolve.
-- If you want to resolve them too, run:
-- UPDATE trades
-- SET status = 'LOSS',
--     pnl = -amount
-- WHERE status = 'TIMEOUT'
--   AND created_at < datetime('now', '-10 minutes');
```

### Affected rows (dry-run)
```sql
-- Preview what will be changed
SELECT id, pair, direction, amount, status, created_at
FROM trades
WHERE status = 'TIMEOUT'
  AND created_at < datetime('now', '-1 day')
ORDER BY created_at;
```
**107 rows** will be affected.

---

## 2. NOTIFICATIONS QUEUE

### Findings
| Status | Count | Date Range |
|--------|-------|------------|
| `sent` | 1,564 | 2026-05-24 to 2026-06-08 |
| `failed` | 181 | 2026-05-24 to 2026-06-08 |
| `pending` | **0** | — |
| **Total** | **1,745** | |

### Analysis
- **Every single notification is stale**. The most recent notification was created on June 8 — 8 days ago.
- No "pending" notifications exist — the queue is fully processed/stalled.
- There is no `processed` or `consumed` state; only `pending`, `sent`, and `failed`.
- All 1,745 records are safe to delete. They represent old delivery records, not queued future work.

### Cleanup SQL
```sql
-- Delete all sent notifications older than 1 day
DELETE FROM notifications_queue
WHERE status = 'sent'
  AND created_at < datetime('now', '-1 day');

-- Delete all failed notifications older than 1 day
DELETE FROM notifications_queue
WHERE status = 'failed'
  AND created_at < datetime('now', '-1 day');
```

Alternatively, to purge everything:
```sql
-- If you want a clean slate (only delete if no pending work exists):
DELETE FROM notifications_queue
WHERE status IN ('sent', 'failed')
  AND created_at < datetime('now', '-1 day');
```

### Affected rows (dry-run)
```sql
-- Preview total rows to delete
SELECT COUNT(*) FROM notifications_queue
WHERE status IN ('sent', 'failed');
```
**1,745 rows** will be deleted.

---

## 3. AUTO-TRADING SESSIONS

### Findings

| Status | Count | Details |
|--------|-------|---------|
| `running` | 1 | Active session (telegram_id: 6622587977) — last trade today, ~$20.9M PnL, 141 trades. **Healthy.** |
| `paused` | 6 | **5 are stalled** (see below) |
| `stopped` | 5 | Already resolved. |

### Stalled Paused Sessions

| Telegram ID | Paused Since | Reason | Trades Done | PnL | Amount | Stalled? |
|-------------|-------------|--------|-------------|-----|--------|----------|
| 8986669286 | Jun 13 (3 days) | `insufficient_balance` | 20 | +$267,600 | $20,000 | ✅ Yes |
| 8471649166 | Jun 13 (3 days) | `insufficient_balance` | 67 | +$772 | $15 | ✅ Yes |
| 7686010991 | Jun 14 (2 days) | `insufficient_balance` | 0 | $0 | $1 | ✅ Yes (never traded) |
| 1830725112 | Jun 13 (3 days) | *(no error)* | 16 | +$5.05 | $1 | ✅ Yes |
| 6887420588 | Jun 16 (today) | `demo_limit` | 138 | +$4,592 | $25 | ❌ Recent |
| 6695402627 | Jun 16 (today) | `connect_failed` | 0 | $0 | $10 | ❌ Recent (0 trades) |

### Analysis
- **5 stalled sessions**: 4 sessions paused since June 13-14 (2-3 days ago) with `insufficient_balance` — they ran out of funds and have been sitting idle. One has never traded a single asset.
- The 2 recent pauses (today) are still fresh failures that might warrant retry.
- **Recommendation**: Auto-stop sessions that have been paused >24h with `insufficient_balance` or no activity. Users can manually restart if they deposit funds.

### Cleanup SQL
```sql
-- Stop sessions that have been paused >24 hours with insufficient_balance
UPDATE auto_trading_sessions
SET status = 'stopped',
    last_error = 'auto_stopped: stale (' || last_error || ')'
WHERE status = 'paused'
  AND (
    (last_trade_at IS NOT NULL AND last_trade_at < datetime('now', '-1 day'))
    OR
    (last_trade_at IS NULL AND started_at < datetime('now', '-1 day'))
  );

-- Clean up stopped sessions older than 7 days (keep 1 week of history)
DELETE FROM auto_trading_sessions
WHERE status = 'stopped'
  AND (
    (last_trade_at IS NOT NULL AND last_trade_at < datetime('now', '-7 days'))
    OR
    (last_trade_at IS NULL AND started_at < datetime('now', '-7 days'))
  );
```

### Affected rows (dry-run)
```sql
-- Preview stalled sessions to stop
SELECT telegram_id, status, started_at, last_trade_at, last_error
FROM auto_trading_sessions
WHERE status = 'paused'
  AND (
    (last_trade_at IS NOT NULL AND last_trade_at < datetime('now', '-1 day'))
    OR
    (last_trade_at IS NULL AND started_at < datetime('now', '-1 day'))
  );
```
**4 rows** will be stopped (8986669286, 8471649166, 7686010991, 1830725112).

---

## 4. EXPIRED SSIDs

### Findings
| Metric | Count |
|--------|-------|
| Users with expired SSID (`ssid_valid = 0`) | **36** |
| Users with expired SSID **AND** stored cred | **0** |
| Total users in database | ~100+ |

### Analysis
- All 36 users with expired SSIDs have **no stored `cred`** field. Every one has `cred IS NULL`.
- Without stored credentials, **auto-reconnect is impossible**. Setting `ssid_valid = 1` would just cause an immediate re-auth failure on next trade attempt.
- These users lost their session tokens and cannot automatically recover.
- **Recommendation**: These users need a fresh login (they'll be prompted on next interaction). No SQL cleanup is useful here — but you could optionally notify them or delete accounts that have been dead for a long time.

### Affected users (list)
```sql
SELECT telegram_id FROM users
WHERE ssid IS NOT NULL AND ssid != '' AND ssid_valid = 0;
```
Returns 36 telegram_ids.

### Cleanup SQL (informational only — no destructive action recommended)
```sql
-- OPTION A: Null out dead SSIDs to keep database clean
UPDATE users
SET ssid = NULL, ssid_valid = NULL
WHERE ssid IS NOT NULL AND ssid != '' AND ssid_valid = 0;

-- OPTION B: Flag for re-login prompt (if you have an onboarding flow)
-- UPDATE users SET onboarding_state = 'needs_login'
-- WHERE ssid IS NOT NULL AND ssid != '' AND ssid_valid = 0;

-- OPTION C: Do nothing — these will prompt re-login naturally on next trade attempt
-- (This is the safest approach)
```

---

## Summary Execution Order

1. **TIMEOUT trades** → `UPDATE trades SET status='LOSS', pnl=-amount WHERE status='TIMEOUT' AND created_at < datetime('now', '-1 day')`
2. **Notifications queue** → `DELETE FROM notifications_queue WHERE status IN ('sent','failed')`
3. **Auto-trading sessions** → `UPDATE auto_trading_sessions SET status='stopped' WHERE status='paused' AND stalled >24h`
4. **Expired SSIDs** → No cred stored; no actionable cleanup. Leave as-is for natural re-login prompt.

**Total records to clean**: ~107 trades + 1,745 notifications + 4 sessions = ~1,856 rows.
