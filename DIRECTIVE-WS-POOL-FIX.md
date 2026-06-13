# DIRECTIVE: WebSocket Pool Health & Error Surface Cleanup

**Date:** 2026-06-13
**From:** Wizard (deep audit)
**To:** Claude
**Repo:** iqbot-v3
**IMPORTANT:** Merge master first before starting.

---

## Audit Summary

Deep check across 7 days of logs + full source sweep found **113 WebSocket errors** across 3 distinct root causes. These affect ALL users of the SDK pool — every `sdkPool.get()` call is at risk.

---

## Section 1 — SDK Pool Health Check (ROOT CAUSE)

**File:** `src/sdk-pool.ts`

**Problem:** `get()` only validates SSID match and age < 10 min. It NEVER checks if the WebSocket is actually open. A connection can degrade within seconds — `isClosing` flag set, `readyState` changed — and the pool will still hand it out.

**Evidence:**
- SDK line 8077: `if (this.isClosing || this.disconnecting)` throws `"WebSocket is closing; new requests are rejected"`
- SDK line 8082: `if (!this.connection || this.connection.readyState !== WebSocket.OPEN)` throws `"WebSocket connection is not open"`
- Pool `get()` — no health check before returning cached SDK

**Fix:**

1. Add a `isHealthy(entry: PoolEntry): boolean` method that checks:
   - The SDK's underlying WebSocket connection exists
   - `readyState === WebSocket.OPEN` (value 1)
   - The SDK is not in closing/disconnecting state
   - If unhealthy: evict the entry + create fresh SDK

2. Call this check in `get()` BEFORE returning the cached entry:
   ```
   if (existing && !stale) {
       if (!this.isHealthy(existing)) {
           await this.shutdown(userId);  // evict dead entry
           // fall through to create new SDK
       } else {
           existing.inUse = true;
           ...
       }
   }
   ```

3. **Critical:** The SDK's internal WebSocket and `isClosing`/`disconnecting` flags may not be directly accessible from outside the SDK class. If the `ClientSdk` class does not expose `connection.readyState` or the internal flags:
   - Add a public `isConnectionOpen(): boolean` method to the SDK class in `src/index.ts`
   - OR: Use a try/catch health-probe pattern — attempt a lightweight API call (e.g. `sdk.currentTime()`) with a 3-second timeout. If it throws with "WebSocket is closing" or "not open", mark unhealthy.

4. Reduce `MAX_AGE_MS` from 10 minutes to 5 minutes to match the existing WebSocket idle timeout behavior.

---

## Section 2 — friendlyError Adoption (USER-FACING)

**File:** `src/bot.ts`

**Problem:** Three error surfaces show raw SDK internals to users instead of friendly messages. The `friendlyError()` function in `src/errors.ts` already maps `'WebSocket'` to `"Lost connection to IQ Option. Your account is safe — try again."` and has 17 other mappings — but it's not called from the trade error paths.

**Surfaces to fix:**

### 2a. Trade catch — line ~1182
Current:
```ts
: await ctx.reply(`Stopped: ${errMsg}`, { ... });
```
Fix: Replace `errMsg` with `friendlyError(err, 'Trade could not be placed. Try again.')`

### 2b. Trade result ERROR/TIMEOUT — line ~1273
Current:
```ts
: await ctx.reply(`Stopped: ${errMsg}`, { ... });
```
Fix: Replace `errMsg` with `friendlyError(new Error(errMsg), 'Trade could not be placed. Try again.')`

### 2c. Balance fetch — line ~2775
Current:
```ts
: `Balance fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`
```
Fix: Replace with `friendlyError(err, 'Could not check your balance. Try again.')`

### 2d. Auto-trading analysis — auto-trading.ts ~194
Current: Checks for auth/ssid/unauthorized but falls through silently for WebSocket errors.
Fix: Add WebSocket detection — if error message contains "WebSocket", call `friendlyError()` and notify user once, then retry with backoff instead of silent retry.

### 2e. Auto-trading trade — auto-trading.ts ~211
Current: Logs only, silent retry. User never knows trade didn't fire.
Fix: On WebSocket errors specifically, notify user ONCE with friendly message, then continue retrying. Do not spam — use a `lastWsNotify` timestamp per session.

---

## Section 3 — Unhandled Rejections

**File:** `src/index.ts` (SDK internals)

**Problem:** The SDK's `forceCloseConnection` (line ~6581) throws `"WebSocket connection closed unexpectedly"` as unhandled rejections. 113 instances in 7 days. These crash through silently with no recovery path.

**Fix:** In the SDK's `WsApiClient`, wrap the `forceCloseConnection` call in a try/catch that:
- Catches the error
- Emits/logs it cleanly (not as unhandled rejection)
- If there's a reconnect/retry mechanism, triggers it

If the SDK is vendor code that shouldn't be modified heavily, add a global `unhandledRejection` handler in `bot.ts` that filters WebSocket errors and logs them without crashing:
```ts
process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (msg.includes('WebSocket')) {
        console.error('[ws] unhandled WebSocket rejection:', msg);
        return; // don't crash
    }
    throw reason; // let other rejections crash as normal
});
```

---

## Section 4 — bot.catch MarkdownV2 Errors (BONUS)

**File:** `src/bot.ts` — bot.catch handler

**Problem:** error.log.1 shows recurring `"Can't find end of the entity starting at byte offset"` — these are MarkdownV2 parse errors. The previous fix used template literal `\\-` but there may be other unescaped chars (`.`, `!`, `(`, `)`) in dynamic message content.

**Evidence from error.log.1:**
- 9 instances of `"Can't find end of the entity"` — all for ChatID 1615652240 (admin)
- Also `[notifyAdmin] send failed: 400: Bad Request: can't parse entities`

**Fix:** Audit the `notifyAdmin` function and any user-facing messages built with `parse_mode: 'MarkdownV2'` that include dynamic content (user IDs, names, amounts). Either:
- Switch to `parse_mode: 'Markdown'` (legacy, more lenient) for messages with dynamic content
- OR: Add an `escapeMarkdownV2()` helper that escapes all special chars (`_ * [ ] ( ) ~ > # + - = | { } . !`) before interpolating dynamic values

---

## Verification

1. After implementing Section 1: restart bot, monitor logs for 5 minutes, confirm zero `"WebSocket is closing"` or `"not open"` errors reach users
2. After Section 2: trigger a trade with an intentionally stale connection — confirm friendly message shown, not raw SDK error
3. After Section 3: confirm `unhandledRejection` WebSocket errors are caught and logged cleanly
4. After Section 4: confirm zero MarkdownV2 parse errors in error.log for 1 hour

---

## Priority Order

1. **Section 1** — Pool health check (stops the bleeding)
2. **Section 2** — friendlyError adoption (cleans up what users see)
3. **Section 3** — Unhandled rejections (background noise)
4. **Section 4** — MarkdownV2 fixes (admin noise)

---

## Files Modified

| File | Section | Change |
|------|---------|--------|
| `src/sdk-pool.ts` | 1 | Add `isHealthy()`, call in `get()`, reduce MAX_AGE |
| `src/index.ts` | 1, 3 | Expose connection state OR add health probe; wrap forceCloseConnection |
| `src/bot.ts` | 2a, 2b, 2c, 3, 4 | friendlyError at 3 surfaces; unhandledRejection handler; MarkdownV2 audit |
| `src/auto-trading.ts` | 2d, 2e | friendlyError for analysis + trade WS errors |
| `src/errors.ts` | 2 | Add `'is closing'` and `'not open'` as explicit friendlyError keys (belt-and-suspenders) |
