# Directive: Signals Overhaul — Verify & Fix

## IMPORTANT: Merge master first
Before implementing, run: `git merge origin/master` to ensure you have the latest code.

---

## Overview
This session built a complete signals overhaul with wizard-based flow, premium analysis gating, result tracking, and martingale progression. **The signal tracking has a date-format bug that prevents it from working.**

## Files changed
- `src/analysis.ts` — Added `entryPrice` to `AnalysisResult` interface + return values
- `src/bot.ts` — Signals wizard (pair→timeframe→analysis), premium gating, animation, prep countdown, signal tracking background loop
- `src/db.ts` — `SignalTrackRecord` interface, 7 new signal tracking functions
- `src/menu.ts` — `signalPairKeyboard()`, `signalTimeframeKeyboard()`

## What was built

### 1. Signals wizard (ui:signals → spair: → stf:)
- `ui:signals` handler: checks daily limit → checks SSID → shows `signalPairKeyboard()`
- `spair:` handler: stores selected pair → shows `signalTimeframeKeyboard()`
- `spage:` handler: pagination for pair keyboard
- `stf:` handler: runs analysis → tracks signal → shows card → starts prep countdown
- `signals:cancel` handler: cleans up session

### 2. Analysis animation (stf: handler entry)
Three sequential messages with 1s delays:
1. "📡 Analyzing market data…"
2. "🔍 Scanning live prices for signals…"  
3. "📊 Calculating optimal entry…"

### 3. Premium analysis gating
- `funded` (balance > $0): first 5 daily signals use MASTER analysis (200 candles), rest use DEMO (35 candles)
- `!funded` (demo): all 30 signals use MASTER analysis
- Premium signals show "★ PREMIUM ★" badge on the card

### 4. 1-minute preparation countdown (fire-and-forget)
After the signal card, a prep message counts down from 1:00 (edits every 10s). After 60s, shows "✅ Signal Active!" with entry time and direction. Uses `void (async () => { ... })()` to avoid blocking the handler.

### 5. Signal result tracking
- `signal_tracking` DB table (created via sqlite3 CLI, NOT in db.ts migration — add it there)
- Tracking record inserted after every signal analysis (pair, direction, timeframe, entry_time, expiry_time, entry_price, round=0, max_rounds=3)
- Background interval (every 5s) that:
  - Queries `getExpiredActiveSignals()` — records where expiry_time <= now and status='active'
  - Creates an SDK with admin SSID (`process.env.IQ_SSID`)
  - For each expired signal: gets candle data, compares open/close to determine win/loss
  - Updates DB result + notifies user via Telegram
- Win notification: "🟢 SIGNAL WON! … Ready for your next signal!"
- Loss notification: "🔴 SIGNAL LOST. … Next → Level X martingale" or "All rounds exhausted"

## KNOWN BUG: Date format mismatch (CRITICAL)
`expiry_time` and `entry_time` are stored as ISO 8601 strings (`new Date().toISOString()` → `2026-06-12T08:30:08.674Z`). But `getExpiredActiveSignals()` queries use:

```sql
SELECT * FROM signal_tracking WHERE status = 'active' AND expiry_time <= datetime('now')
```

SQLite's `datetime('now')` returns `2026-06-12 08:30:08` (no T, no Z). Because `T` (0x54) > ` ` (0x20), ISO dates always sort AFTER SQLite dates, so no records are ever found as expired.

**Fix:** Convert `expiry_time` to SQLite format: `now.toISOString().replace('T', ' ').replace('Z', '')` or use a custom format like `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`.

## Other fixes needed

### 6. Cancel previous active tracking on new signal
When a user generates a new signal, cancel any existing `active` tracking for that user first. Currently multiple active records pile up for the same user.

### 7. Add signal_tracking table to db.ts migration
The table was created manually via sqlite3 CLI. Add a proper `CREATE TABLE IF NOT EXISTS signal_tracking (...)` block in `db.ts` around line 196 so it auto-creates on startup.

### 8. Admin SDK efficiency 
The background loop creates a new SDK connection every 5 seconds, does 1-2 candle fetches, then destroys it. Either:
- Use `sdkPool` (matching the pool pattern used elsewhere) instead of raw `createSdk`
- Or extend the interval to 30s and batch-check more records
- Or cache/reuse the admin SDK across ticks

### 9. Martingale progression on loss
Currently on loss, the notification says "Next → Level X" but doesn't auto-create the next tracking record. When a signal loses and rounds remain, the bot should either:
- Auto-create the next round's tracking record (same pair/direction, next expiry, incremented round)
- Or guide the user to generate a new signal and tag it as the next martingale level

### 10. Edge cases to handle
- User deletes/blocks bot → sendMessage fails silently (already handled with try/catch)
- SDK creation fails → skip that tick (already handled)
- Multiple signals at the exact same expiry → process all (already handled)
- No admin SSID configured → skip silently (already handled)
- Candle data less than 2 candles → mark as 'lost' with 'no_data' reason (already handled)
- Unknown pair (active not found) → mark as 'lost' with 'unknown_pair' reason (already handled)

---

## Verification checklist
- [ ] `stf:` handlers compile without errors
- [ ] Date format fixed — expired signals are properly detected
- [ ] Background loop fires and notifies users
- [ ] New signal cancels old active tracking for same user
- [ ] signal_tracking table auto-created in db.ts migration
- [ ] Premium gating works correctly (funded vs unfunded)
- [ ] Analysis animation shows 3 steps
- [ ] Prep countdown runs fire-and-forget (handler returns < 5s)
