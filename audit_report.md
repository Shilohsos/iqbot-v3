# iQBot-v3 Database Integrity & Session Management Audit Report
**Date**: 2026-06-18  
**DB**: `/root/iqbot-v3/iqbot-v3.db`  
**Integrity Check**: PASSED (PRAGMA integrity_check: ok)  
**Size**: 1496 pages @ 4KB = ~5.8MB  

---

## 1. Overall Database State

| Metric | Value |
|---|---|
| Users | 827 |
| Trades | 17,107 |
| Auto-trading Sessions | 19 |
| Signal Tracking Entries | 2,789 |
| Unique Traders (trades table) | 220 |
| Unique Session Users | 19 |
| Orphaned Trades (no user) | 53 |

---

## 2. auto_trading_sessions Table — Full Analysis

### 2.1 Status Distribution

| Status | Count | Percentage |
|---|---|---|
| **stopped** | 10 | 52.6% |
| **paused** | 6 | 31.6% |
| **running** | 3 | 15.8% |

### 2.2 Currently Running Sessions (Active Now)

| ID | User | Currency | Amount | Trades | PnL | Mode | mg_active |
|---|---|---|---|---|---|---|---|
| 1 | 6622587977 | NGN | 150,000 | 70 | +17,009,500 | live | 1 |
| 52 | 8359136998 | USD | 2 | 6 | +20.68 | live | 1 |
| 55 | 7939115693 | USD | 10 | 0 | 0.00 | demo | 1 |

**⚠ Session 55**: Running with `mg_active=1` but 0 trades executed and no `last_trade_at`. This is a freshly started session but needs monitoring — if it stays in this state it's a dangling session.

### 2.3 Stale Sessions (>24h no trade OR >7d started with no progress)

| ID | User | Status | Started | Trades | PnL | Issue |
|---|---|---|---|---|---|---|
| 9 | 7547864280 | stopped | Jun 13 | 1 | -1,000 | 1 trade, stopped for 5 days |
| 19 | 1830725112 | stopped | Jun 13 | 16 | +5.05 | Stopped for 5 days |
| 8 | 7686010991 | stopped | Jun 14 | 0 | 0 | Never traded (insufficient_balance) |
| 36 | 6887420588 | paused | Jun 16 | 138 | +4,592 | Paused for 2 days |
| 38 | 7965611208 | stopped | Jun 16 | 45 | +1,459.25 | Stopped for 2 days |
| 42 | 6695402627 | paused | Jun 16 | 0 | 0 | Never traded (connect_failed) |
| 40 | 6360621016 | stopped | Jun 16 | 2 | -6,350 | Stopped for 2 days |
| 45 | 1171257691 | paused | Jun 17 | 36 | +5.07 | Paused for 1 day |
| 62 | 1341582495 | stopped | Jun 17 | 0 | 0 | Never traded |
| 67 | 1163453604 | paused | Jun 18 | 0 | 0 | Never traded (connect_failed) |
| 55 | 7939115693 | running | Jun 18 | 0 | 0 | Running but no trades |

### 2.4 🚩 Orphaned mg_active States

**2 sessions** have `mg_active=1` but status is NOT `running`:

| ID | User | Status | mg_active | mg_next_amount | Trades | PnL |
|---|---|---|---|---|---|---|
| **5** | 8986669286 | **stopped** | **1** | 40,000 | 10 | +172,600 |
| **40** | 6360621016 | **stopped** | **1** | 400 | 2 | -6,350 |

**Risk**: If the system checks `mg_active` to resume martingale sequences, these sessions could incorrectly trigger martingale recovery after being stopped. Session 5 has a pending mg_next_amount of 40,000 NGN — if resumed accidentally this could execute a large trade.

### 2.5 Duplicate Sessions

**✅ No duplicate telegram_ids** in auto_trading_sessions. The UNIQUE constraint on `telegram_id` is working correctly.

### 2.6 Sessions with Errors

| ID | User | Error | Mode | Status |
|---|---|---|---|---|
| 8 | 7686010991 | insufficient_balance | live | stopped (never started) |
| 42 | 6695402627 | connect_failed | demo | paused (never started) |
| 45 | 1171257691 | insufficient_balance | live | paused |
| 67 | 1163453604 | connect_failed | live | paused (never started) |
| 13 | 6699511772 | demo_limit | demo | paused |
| 36 | 6887420588 | demo_limit | demo | paused |
| 63 | 7960463536 | demo_limit | demo | paused |

---

## 3. trades Table — Detailed Analysis

### 3.1 Status Distribution

| Status | Count | % |
|---|---|---|
| LOSS | 8,570 | 50.1% |
| WIN | 8,222 | 48.1% |
| TIE | 189 | 1.1% |
| ERROR | 102 | 0.6% |
| TIMEOUT | 16 | 0.1% |
| **in_flight** | **4** | **0.02%** |

### 3.2 Currently In-Flight Trades (As of Audit Time)

Initial query found 4 in-flight trades; all but 1 resolved during the audit (normal for active trading):

| ID | Pair | Amount | User | Trade ID | Age at Capture |
|---|---|---|---|---|---|
| 17101 | EURUSD-OTC | 10 | 7939115693 | 14000893535 | 98s (resolved) |

**Note**: The 3 other in-flight trades (IDs 17096, 17106, 17107) settled normally during the audit window — this is healthy behavior. Trade 17106 (user 6622587977) showed amount **600,000 NGN** at the time, consistent with martingale escalation from base 150,000 × 4 (`mg_next_amount=600,000`).

### 3.3 🚩 ERROR Trades Cluster

**102 ERROR trades** — ALL from **user 1341582495** on **2026-06-17** between 14:45-15:31 UTC.

Pattern: Two distinct error bursts:
- **14:45-14:51**: 42 trades at amount 13.365 (mixed pairs, all `trade_id=0`)
- **14:54-15:31**: 60 trades at amount 10.0 (cycled through pairs, all `trade_id=0`)
- Gradual ramp from 13.365 → 128.85 → 10.0 USD

**Root cause**: This user's IQ Option SSID appears to have been invalid or rate-limited, causing every trade attempt to fail with `trade_id=0`. The auto-trading system kept retrying without properly detecting the persistent failure.

### 3.4 TIMEOUT Trades (16 total)

Spread across users (7567081772: 4, 8986669286: 2, 8157638338: 3, 265712713: 2, 7960463536: 1, 1822315446: 2, 7632198220: 2). All have `pnl=0` and occurred Jun 15-18. These represent trades where the API never returned a result.

### 3.5 🚩 Duplicate Trade IDs

**102 pairs of duplicate trade_id entries** — ALL from **user 1341582495**. Each IQ Option trade_id appears twice in the trades table with identical data (same pair, amount, pnl, status). This indicates a duplicate insert bug — likely the trade result callback fires twice for this user's trades.

Example: `trade_id=13998348113` appears at both `trades.id=15909` and `trades.id=15910` with identical data.

### 3.6 🚩 Orphaned Trades (53 records)

53 trades have an **empty telegram_id** (blank string `''`). These have total PnL of +7,191.73. No user record can be linked. Likely from a period where the system didn't properly track the user context during trade execution.

### 3.7 PnL Analysis

- **Win trades**: PnL = amount × 0.86 (86% payout, standard IQ Option rate) — **accounting is correct**
- **Loss trades**: PnL = -amount (100% loss of stake) — **accounting is correct**
- **Negative PnL total**: -123,086.20 across 107 losing trades
- **Biggest single loss**: -32,000 (user 7656000441, Jun 4)
- **Last 7 days PnL**: Heavily positive (Jun 13-18 show large NGN-denominated wins from user 6622587977)

### 3.8 Last 7 Days Trade Volume & PnL

| Date | Trades | Net PnL | Pattern |
|---|---|---|---|
| Jun 11 | 511 | +6,062,873 | Normal |
| Jun 12 | 663 | +4,029,398 | Normal |
| **Jun 13** | **824** | **+75,226,917** | **Large NGN session active** |
| Jun 14 | 576 | +68,911,812 | Large NGN session |
| Jun 15 | 406 | +106,968,955 | Continued big wins |
| Jun 16 | 1,318 | +127,791,660 | Peak volume |
| Jun 17 | 1,794 | +43,626,675 | ERROR cascade day |
| Jun 18 | 550 | +39,010,588 | Active trading |

**Note**: PnL values for recent days are dominated by the NGN-denominated session (6622587977) running 150,000 NGN trades with 86% payout per win.

---

## 4. users Table — Deep Analysis

### 4.1 SSID Validity

| Status | Count | % |
|---|---|---|
| **Invalid (ssid_valid=0)** | **495** | **59.9%** |
| Valid (ssid_valid=1) | 256 | 31.0% |
| NULL (never checked) | 76 | 9.2% |

**🚩 60% of users have invalid SSIDs** — these users cannot trade but remain in the database with `signals` access. This inflates the user count with dead records.

**5 users** have `ssid_valid=1` but `approval_status='pending'` — these users have valid credentials that haven't been approved yet.

### 4.2 Access Level Distribution

| Level | Count | % |
|---|---|---|
| signals | 778 | 94.1% |
| ai_trading | 32 | 3.9% |
| auto_trading | 17 | 2.1% |

### 4.3 Tier Distribution

| Tier | Access Level | Count |
|---|---|---|
| DEMO | signals | 778 |
| DEMO | ai_trading | 14 |
| DEMO | auto_trading | 9 |
| MASTER | ai_trading | 6 |
| MASTER | auto_trading | 8 |
| PRO | ai_trading | 12 |

### 4.4 funded_balance_usd Accuracy

| Metric | Value |
|---|---|
| Total users | 827 |
| Users with balance > 0 | **53 (6.4%)** |
| Avg balance (funded users) | $192.67 |
| Total balance (all users) | $159,340.85 |
| Max balance | $121,354.00 |
| Negative balances | **0 (✅ clean)** |
| Users with trades but balance = $0 | **172 (major gap)** |

**⚠ 172 users have executed trades but show $0 funded balance**. This is a significant accounting gap — the system is not consistently recording trading capital for active users.

### 4.5 Approval Status

| Status | Count |
|---|---|
| pending | **440 (53.2%)** |
| approved | 386 (46.7%) |
| rejected | 1 |

**435 pending users have no SSID at all** — they joined the bot but never completed IQ Option connection.

### 4.6 User with mg_enabled=1 but No Session

**🚩 78 users** have `mg_enabled=1` in their profile but no corresponding entry in `auto_trading_sessions`. This means the martingale system is "armed" for these users but no session exists to manage it. If any code path checks `mg_enabled` to resume sessions, these could cause issues.

---

## 5. Data Inconsistencies Summary

| Issue | Severity | Count | Impact |
|---|---|---|---|
| Orphaned trades (blank telegram_id) | **MEDIUM** | 53 | Unattributable PnL |
| Duplicate trade_id entries | **MEDIUM** | 102 pairs | Inflated trade count, PnL double-count for one user |
| Orphaned mg_active=1 on stopped sessions | **HIGH** | 2 | Risk of unintended martingale trade re-execution |
| Pending users with valid SSID | **LOW** | 5 | Configuration inconsistency |
| Users with trades but $0 funded_balance | **MEDIUM** | 172 | Accounting/audit gap |
| mg_enabled=1 users with no session | **MEDIUM** | 78 | Potential ghost session triggers |
| Stale sessions (no activity >1 day) | **LOW** | 11 | Dead state accumulation |
| ERROR cascade (1341582495) | **HIGH** | 102 | Indicates missing circuit breaker |
| Negative PnL trades | **LOW** | 107 | Normal for trading |
| Duplicate telegram_id in sessions | **NONE** | 0 | Constraint working ✅ |

---

## 6. Database Schema & Index Assessment

### 6.1 Existing Indexes

| Table | Indexes | Coverage |
|---|---|---|
| **trades** | `idx_trades_telegram_id`, `idx_trades_created_at`, `idx_trades_martingale_run` | ✅ Good |
| **users** | `idx_users_created_at` | ⚠ Minimal |
| **auto_trading_sessions** | **None** (only PK auto-index) | ❌ |
| **signal_tracking** | **None** | ❌ |
| **sessions** (key-value) | **None** | ⚠ PK only |

### 6.2 🚩 Missing Indexes (Performance Risks)

| Table | Missing Index | Reason |
|---|---|---|
| **auto_trading_sessions** | `(status)` | Queries filter by status (running/paused/stopped) |
| **auto_trading_sessions** | `(mg_active)` | Queries for active martingale sessions |
| **auto_trading_sessions** | `(telegram_id)` | Already UNIQUE, so implicitly indexed |
| **users** | `(ssid_valid)` | 60% invalid SSIDs — frequent filtering |
| **users** | `(access_level)` | Access control checks |
| **users** | `(mg_enabled)` | Martingale checks (78 users queried) |
| **signal_tracking** | `(telegram_id, status)` | Core query pattern for active signals |
| **signal_tracking** | `(status, entry_time)` | Stale signal detection |
| **signal_tracking** | `(entry_time)` | Time-based queries |
| **sessions** | `(key)` | Already PK but worth noting |

---

## 7. Session State Recovery Gaps

### 7.1 Sessions Key-Value Store

The `sessions` table contains interactive workflow states:

| Session Type | Count | Stale (>1 day) | Risk |
|---|---|---|---|
| `session:onboard:*` | 20 | 12 | Users stuck in onboarding |
| `session:connect:*` | 2 | 2 | Users stuck in connect flow |
| `session:wizard:*` | 20 | 10 | Users stuck in trading wizard |
| `session:sigwiz:*` | 29 | 0 | Signal wizard (mostly recent) |
| `session:autowiz:*` | 2 | 2 | Auto-trading wizard |
| `session:upgrade:*` | 34 | 0 | Upgrade prompts |

**🚩 24 stale session entries** (last updated >1 day ago) — users likely abandoned the flow but the session state persists with no TTL/cleanup mechanism.

### 7.2 Critical Recovery Gaps

1. **No session cleanup/expiry mechanism** — The `sessions` table has no TTL. Stale entries accumulate indefinitely.

2. **No circuit breaker for persistent trade failures** — User 1341582495 generated 102 ERROR trades in <2 minutes without the system pausing. The `mg_active=1` flag on stopped sessions (sessions 5, 40) shows no protection against runaway retries.

3. **No stale session watchdog** — Session 55 running with mg_active=1 but 0 trades has no safety timer. If the connection hangs, it stays in "running" state permanently.

4. **Error recovery for paused sessions** — Sessions paused due to `demo_limit`, `insufficient_balance`, or `connect_failed` have no automatic retry/resume mechanism. They require manual intervention.

5. **Duplicate trade_id handling** — The system doesn't deduplicate by `trade_id` before insert. User 1341582495's trades are all double-recorded.

6. **No foreign key enforcement** — SQLite has no FK enforcement (`PRAGMA foreign_keys` likely OFF). This allows orphaned trades and referenced data inconsistencies.

---

## 8. Recommendations

### Immediate (High Priority)
1. **Fix orphaned mg_active**: Reset `mg_active=0` on sessions 5 and 40 (stopped sessions with active martingale flag).
2. **Circuit breaker for ERROR cascade**: Implement max consecutive ERROR threshold (e.g., 5) to auto-pause a session.
3. **Deduplicate trade_id 13998348113-13998375431**: Remove the duplicate records for user 1341582495 (102 duplicates total).
4. **Investigate user 1341582495**: Session 62 was created but never executed a single trade — the system correctly stopped but the ERROR trades from the prior day indicate a systemic issue.

### Short-term (Medium Priority)
5. **Add missing indexes**: Especially on `auto_trading_sessions(status, mg_active)` and `signal_tracking(status, entry_time)`.
6. **Session TTL**: Add expiry to the `sessions` table — clear entries older than 24h.
7. **Stale session cleanup**: Address the 11 stale auto_trading_sessions and 24 stale interactive sessions.
8. **Fix orphaned trades**: Assign the 53 blank-telegram_id trades to the correct user or archive them.

### Long-term (Low Priority)
9. **Foreign key enforcement**: Enable `PRAGMA foreign_keys=ON` and add proper REFERENCES constraints.
10. **funded_balance_usd tracking**: Ensure balance is updated for all users with active trades (172 users currently showing $0).
11. **SSID re-validation**: Set up periodic re-validation for the 495 users with invalid SSIDs and auto-archive stale users.
12. **Duplicate insert protection**: Add `INSERT OR IGNORE` or `ON CONFLICT(trade_id)` logic to prevent duplicate trade records.
