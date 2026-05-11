# Section 7: Per-User IQ Option Sessions (Multi-Account)

## Goal

Replace the single shared `IQ_SSID` with per-user IQ Option sessions.
Each Telegram user connects their own IQ account and trades from their own balance.

## Current Problem

`IQ_SSID` is hardcoded in `.env`. Every Telegram user who starts the bot
trades on the **same** IQ Option account — same balance, same trades, no
separation. Multiple users starting the bot share one session.

## Solution

### 1. Users table (SQLite)

Add `users` table to DB:

```sql
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    ssid TEXT NOT NULL,
    platform_id INTEGER NOT NULL DEFAULT 15,
    balance_type TEXT NOT NULL DEFAULT 'PRACTICE',  -- PRACTICE or REAL
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2. Connect flow: `/connect`

User sends `/connect <ssid>` to link their IQ Option account.

```
User: /connect 93d48bdced4e547b5d5cd604f8deda7p
Bot: Verifying credentials...
Bot: ✅ Connected! Balance: Practice $4,412.87
```

Verification: Create a temporary SDK connection, fetch balances, confirm
the SSID is valid. Show the user their balance to confirm correct account.

### 3. Route trades per-user

`/trade` wizard (and `/history`, `/balance`):

1. Look up user's SSID from `users` table
2. If not found → prompt to `/connect` first
3. Pass `ssid` to `executeTrade()` instead of `IQ_SSID`

`runMartingale()` takes `ssid` as a parameter instead of using global `IQ_SSID`.

### 4. Admin override

Admin (`/admin`) sees all connected users and their balances.
Admin can disconnect a user or view their activity.

### 5. Default fallback

If user isn't in DB yet, keep using global `IQ_SSID` from env so existing
users aren't broken. New users get prompted to connect.

## Files to Change

- `src/db.ts` — add `users` table, CRUD: `getUser()`, `saveUser()`, `deleteUser()`, `getAllUsers()`
- `src/bot.ts` — add `/connect` command, pass per-user SSID to trade pipeline
- `src/trade.ts` — `runMartingale()` / `executeTrade()` take SSID from caller

## Files to Create

None — all changes in existing files.

## Acceptance Criteria

1. `/connect <valid_ssid>` → saves user, shows balance
2. `/connect <invalid_ssid>` → "Invalid credentials"
3. User A connects SSID_1, User B connects SSID_2 — each trades own account
4. `/balance` shows User A's balance (not User B's)
5. Unconnected user → "Please /connect first"
6. Admin sees all connected users
7. Backward compatible — existing `.env` SSID used as fallback for unconnected users
