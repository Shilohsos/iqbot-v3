# DIRECTIVE: Verify Martingale Recovery Chain Fixes

**Date:** 2026-06-21  
**Repo:** iqbot-v3  
**Branch:** master  
**Context:** User 6956546116 experienced multiple martingale recovery chain deaths during manual AI trading. Three root causes were identified and fixed in `bot.ts`'s `runMartingale()` function.

---

## Issues Found (User 6956546116)

All issues occurred in the **manual AI trading** path (`bot.ts` → `runMartingale()`), NOT auto-trading.

### 1. TIMEOUT killed recovery chain
**Symptom:** "Trade could not be placed. Try again." message, no more recovery rounds.
**Root cause:** `if (result.status === 'ERROR' || result.status === 'TIMEOUT')` called `showTradeError()` then `return` — immediately exiting the martingale loop.
**Fix:** Treat TIMEOUT/ERROR as a LOSS. Update log line, deduct PnL, fall through to the LOSS continuation path which doubles the stake and continues the recovery.

### 2. TIE killed recovery chain
**Symptom:** "+₦0 added to your balance" message, chain stops. OTC Blitz trades frequently tie when price doesn't move enough in 5 minutes.
**Root cause:** `if (result.status === 'WIN' || result.status === 'TIE')` grouped TIE with WIN, calling `return` and ending the chain.
**Fix:** Split TIE into its own handler. Show "⚪ tied" in the log, fall through to recovery continuation. Stake doubles, recovery continues.

### 3. WebSocket death after timeout
**Symptom:** After a TIMEOUT, all subsequent recovery rounds fail with "WebSocket is closing; new requests are rejected." User loses all stakes with no chance to recover.
**Root cause:** The SDK WebSocket dies during/after a timeout, but the code never rebuilds the connection between rounds.
**Fix:** Added WebSocket error detection in two places:
- **Thrown exception path** (catch block): If error message matches `/WebSocket.*clos|ws.*clos|socket.*clos/i`, rebuild SDK via `sdkPool.get()` or `createSdk()`, assign synthetic TradeResult, fall through to recovery.
- **Returned ERROR path** (normal result handling): Same detection, same SDK rebuild, fall through.

### 4. Recovery chain abandoned mid-sequence
**Symptom:** Users see "SMART RECOVERY ACTIVATED" but no follow-up trade. Chain silently dies.
**Root cause:** Any non-WIN, non-LOSS status (TIMEOUT, ERROR, TIE) called `return` immediately.
**Fix:** All three are now treated as LOSS-equivalent and fall through to the recovery continuation. Only WIN returns early.

---

## Verification Checklist

Please verify the following in `src/bot.ts` → `runMartingale()`:

- ✅ **TIMEOUT path** — Does NOT call `showTradeError()` or `return`. Treats as LOSS.
- ✅ **ERROR path** — Does NOT call `showTradeError()` or `return`. Treats as LOSS.
- ✅ **TIE path** — Separated from WIN. Shows "⚪ tied", falls through. Does NOT return.
- ✅ **WIN path** — Still returns. Unchanged.
- ✅ **WebSocket death (thrown exception)** — Detects WS closure, rebuilds SDK, assigns synthetic result, falls through.
- ✅ **WebSocket death (returned ERROR)** — Detects WS closure in error message, rebuilds SDK, falls through.
- ✅ **authRetried gate** — WebSocket rebuild respects `authRetried` flag; only rebuilds once per run.
- ✅ **TradeResult initialization** — `let result: TradeResult = { ... }` initialized with default values to satisfy TS definite assignment.
- ✅ **No duplicate updateLeaderboardAuto** — Old duplicate call removed.

---

## Additional Context

- User 6956546116 has ₦158,029 NGN real balance (~$103 USD). Their auto-trading session is stopped.
- The manual AI trades that exposed these bugs happened between 09:53-11:04 UTC, before fixes were deployed at ~12:20 UTC.
- No new trades from this user since fixes went live.
- GLK Drain is active globally for all non-privileged live users (4:1 ratio, admin analysis + opposite direction).

---

## Files Modified

- `src/bot.ts` — `runMartingale()` function (lines ~1410-1570)
- `dist/bot.js` — compiled output
