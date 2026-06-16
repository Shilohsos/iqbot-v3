# DIRECTIVE — SYSTEMIC SESSION EXPIRY FIX

## IMPORTANT: Merge master first

Your feature branch may not include the latest master commits. Run:
```
git checkout <your-branch>
git merge origin/master
```
Resolve any conflicts before implementing below.

---

## Problem

When a user's IQ Option SSID expires mid-session, the bot shows `🔐 Your session expired. Reconnect to continue trading.` but does NOT retry the operation after auto-reconnecting. The fix must be applied to **every** code path that uses the SDK, because the expiry can happen at ANY point.

I already fixed the root `isAuthExpiredError` keyword mismatch (master commit `d028338`). Now every path that calls SDK methods needs to:
1. Catch auth errors
2. Call `autoReconnect(uid)` or `adminAutoReconnect()`
3. **Retry the SDK operation** with the fresh SSID
4. Only fail to the user if reconnect + retry both fail

## Files to modify

Only **`src/bot.ts`** and **`src/auto-trading.ts`** need changes.

---

## Fix 1: AI Trading trade execution (`bot.ts`, the `gale:` handler)

The `gale:` handler at line ~1741 connects to SDK, analyzes, then calls `runMartingale()` at line ~1904. I already fixed the SDK connect + analysis phases with retry loops. But the **trade execution** (`runMartingale()`) is NOT covered:

```typescript
// Lines ~1904-1908 — runMartingale is called but its .catch() only logs errors
const tradePromise = runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe,
    (mode ?? 'live') as 'demo' | 'live', martingaleRounds, preTradeMessageIds, sdk, useCur)
    .catch(err => {
        logger.error('trade', `Unhandled trade error: ${err instanceof Error ? err.message : String(err)}`);
    });
```

If the SDK's WebSocket dropped between analysis and execution, `runMartingale()` will fail with "authentication is failed" and the error is just logged — user sees nothing (or a generic failure).

**Fix:** Wrap the trade execution in a retry loop (max 2 attempts). On auth error, recreate the SDK with a fresh SSID and retry `runMartingale()`.

Replace lines ~1900-1918:
```typescript
// Fire trade in background — retry once on auth expiry
let mgAttempts = 0;
let tradePromise: Promise<void>;
while (mgAttempts < 2) {
    mgAttempts++;
    try {
        const newSsid = isAdmin ? getAdminSsid() : getSsidForUser(ctx.from!.id);
        if (!newSsid) throw new Error('No SSID');
        const freshSdk = mgAttempts === 1 ? sdk : (isAdmin ? await createSdk(newSsid) : await sdkPool.get(ctx.from!.id, newSsid));
        tradePromise = runMartingale(ctx, newSsid, pair, analysis.direction, amount, timeframe,
            (mode ?? 'live') as 'demo' | 'live', martingaleRounds, preTradeMessageIds, freshSdk, useCur)
            .catch(err => {
                if (isAuthExpiredError(err) && mgAttempts < 2) throw err; // retry
                logger.error('trade', `Unhandled trade error: ${err instanceof Error ? err.message : String(err)}`);
            });
        tradeStarted = true;
        if (isAdmin) {
            tradePromise.finally(() => freshSdk.shutdown().catch(() => {}));
        } else {
            tradePromise.finally(() => sdkPool.release(ctx.from!.id));
        }
        break; // success
    } catch (err) {
        if (mgAttempts >= 2 || !isAuthExpiredError(err)) throw err;
        // Auth error — try reconnect
        const ok = isAdmin ? await adminAutoReconnect() : (ctx.from?.id ? await autoReconnect(ctx.from.id) : false);
        if (!ok) throw err;
        // Reconnected — loop back and retry with fresh SDK
    }
}
```

IMPORTANT: The `runMartingale` function uses the `sdk` object passed to it. After reconnect, create a FRESH SDK (don't reuse the stale one). The `sdkPool.get()` will use the new SSID saved by `autoReconnect`.

---

## Fix 2: Auto Trading analysis + execution (`src/auto-trading.ts`)

The `AutoRunner.loop()` method calls SDK methods for balance checks, positions, and analysis. The existing `reconnect(ssid)` method is called on auth error but it only reconnects the SAME SDK — it doesn't get a fresh SSID and create a new SDK.

**Fix for `auto-trading.ts`:**

### 2a. Fix the `reconnect()` method

Current (lines ~350-360):
```typescript
async reconnect(ssid: string): Promise<boolean> {
    try { await this.sdk.shutdown(); } catch {}
    try {
        this.sdk = await createSdk(ssid);
        return true;
    } catch { return false; }
}
```

Fix: After reconnect, if the SSID is still stale, try `autoReconnect()` to get a fresh SSID, then create a new SDK:
```typescript
async reconnect(ssid: string): Promise<boolean> {
    try { await this.sdk.shutdown(); } catch {}
    // First try reconnecting with the same SSID
    try {
        this.sdk = await createSdk(ssid);
        return true;
    } catch {
        // SSID expired — try auto-reconnect with stored cred
        if (await autoReconnect(this.chatId)) {
            const freshSsid = getSsidForUser(this.chatId);
            if (freshSsid) {
                try {
                    this.sdk = await createSdk(freshSsid);
                    return true;
                } catch {}
            }
        }
        return false;
    }
}
```

### 2b. Fix the analysis catch block (lines ~380-390)

Current:
```typescript
if (/auth|ssid|unauthor|401/i.test(msg) && !(await this.reconnect(ssid))) {
    setAutoSessionStatus(this.chatId, 'paused', 'reconnect_failed');
    await this.notify('🚀 Auto Trading paused — your session expired. Reconnect and resume.', true);
    break;
}
```

Fix: After reconnect succeeds, RETRY the analysis (don't break):
```typescript
if (isAuthExpiredError(err)) {
    if (await this.reconnect(ssid)) {
        // Reconnected! Retry the analysis
        a = await analyzePairWithSdk(this.sdk, asset, this.timeframe, analysisTier, analysisCandles);
        direction = a.direction;
        continue; // go back to the analysis decision loop
    }
    setAutoSessionStatus(this.chatId, 'paused', 'reconnect_failed');
    await this.notify('🚀 Auto Trading paused — your session expired. Reconnect and resume.', true);
    break;
}
```

Note: The analysis code is inside a `for` loop over assets. After reconnect succeeds, `continue` goes to the next iteration. You may need to restructure the loop so that `continue` re-attempts the SAME asset rather than skipping to the next one. The safest approach: break the asset loop, restart from the same index after reconnect.

### 2c. Fix the trade execution in auto-trading

The `executeRound()` or `runMartingaleCore()` call inside the auto-trading loop also needs auth error handling. Find where `runMartingaleCore` is called and wrap it with the same retry pattern.

---

## Fix 3: `refreshFundedBalanceFromLive()` (`bot.ts`, ~line 855)

This function is called to check if a user has funded their account. It uses the SDK to fetch balances. If the SSID is expired, it silently fails and treats the user as unfunded.

Current:
```typescript
async function refreshFundedBalanceFromLive(uid: number): Promise<void> {
    let ssid = getSsidForUser(uid);
    if (!ssid) return;
    const fetchAndSync = async (sid: string): Promise<void> => {
        const sdk = await sdkPool.get(uid, sid);
        try {
            const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
            ...
        } finally { sdkPool.release(uid); }
    };
    ...
}
```

Fix: If `sdk.balances()` throws an auth error, try `autoReconnect(uid)` and retry `fetchAndSync` with the fresh SSID. If reconnect fails, just return (graceful degradation — don't block the user).

---

## Fix 4: Giveaway balance checks

Search for all `sdk.balances()` or `sdkPool.get()` calls in giveaway-related code. Apply the same auto-reconnect + retry pattern.

Files: `src/giveaway.ts` and any other files that call SDK methods.

---

## Fix 5: Any remaining SDK call in `bot.ts`

Do a codebase-wide grep for `sdkPool.get\|createSdk\|\\.balances()\|\\.candles()\|\\.turboOptions()\|analyzePairWithSdk\|runMartingale` and audit each call site for auth error handling. Every path that can throw "authentication is failed" needs:
1. Catch auth error (use `isAuthExpiredError()`)
2. Call `autoReconnect(uid)` or `adminAutoReconnect()`
3. Retry the operation with fresh SSID
4. If retry also fails, use `handlePossibleAuthExpiry()` to show the reconnect message

---

## Testing

After implementing all fixes:
1. Run `npx tsc` — must compile with zero errors
2. Run `npm run build` — must succeed
3. If possible, test the full AI Trading flow from start to trade execution
4. Check auto-trading sessions resume correctly after reconnect

---

## Summary of changes needed

| # | Location | Current behavior | Fix |
|---|----------|-----------------|-----|
| 1 | `bot.ts` `gale:` handler, trade execution | `runMartingale()` catches errors silently | Retry loop with fresh SDK after auth reconnect |
| 2 | `auto-trading.ts` `reconnect()` | Only reconnects same SDK with stale SSID | Try `autoReconnect()` to get fresh SSID |
| 3 | `auto-trading.ts` analysis catch | Breaks on auth error instead of retrying | Retry analysis after reconnect |
| 4 | `auto-trading.ts` trade execution | May silently fail on auth error | Add auth retry |
| 5 | `bot.ts` `refreshFundedBalanceFromLive()` | Skips on auth error, treats user as unfunded | Retry with fresh SSID after reconnect |
| 6 | `giveaway.ts` balance checks | No auth error handling | Add reconnect + retry |
| 7 | All SDK calls | Various missing auth handling | Audit + fix every call site |
