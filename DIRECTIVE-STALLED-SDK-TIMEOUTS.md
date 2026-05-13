# Issue: Bot freezes for all users when one handler stalls on IQ Option SDK call

## Problem
When any handler makes an IQ Option SDK call (`ClientSdk.create()`, `balances()`, `executeTrade()`, `loginAndCaptureSsid()`) that hangs or takes too long, the entire bot stops responding to all users for up to 90 seconds (Telegraf's default timeout).

## Evidence
- Error log shows: `TimeoutError: Promise timed out after 90000 milliseconds`
- During that 90s window, every `/start` from every user appears dead
- This is a recurring issue — the IQ Option WebSocket connection can stall on slow network or when the SDK gets into a bad state

## Current State
- Only `sendStartMenu()` has a 5s timeout (via `Promise.race` on the balance fetch)
- Trade execution, login, and all other SDK calls have **zero timeout protection**
- One slow/stalled SDK call = whole bot frozen for 90s

## Required Fix
Add a reusable timeout wrapper and apply it to every IQ Option SDK call in the bot.

### Step 1: Add `withTimeout` helper near the top of `src/bot.ts` (after `escapeMd` at line 59)

```typescript
function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`SDK timeout${label ? `: ${label}` : ''}`)), ms)
        ),
    ]);
}
```

### Step 2: Apply timeouts to every SDK call

**A. `sendStartMenu` (line ~394-409)** — Already has timeout, replace with `withTimeout`:
- Balance fetch → `withTimeout(fetchBalance(), 5000, 'balance')`
- Remove the existing `Promise.race` implementation

**B. Trade execution in the `pair:` handler (around line 840+)** — calls `executeTrade()` which internally calls `createSdk()`:
- Add timeout around the trade call: `withTimeout(executeTrade(...), 15000, 'trade')`
- 15s should be enough for a complete trade round (connect + execute + wait for result)

**C. `loginAndCaptureSsid` (line 333-348)** — SDK login call:
- Timeout the SDK creation + login: `withTimeout(ClientSdk.create(...), 10000, 'login')`

**D. `balance` command handler (line 1107-1127)** — Balance fetch:
- `withTimeout(sdk.balances(), 5000, 'balance')`

**E. `/pairs` command (line 1627+)** — Active instruments fetch:
- Add timeout, 10s should be sufficient

**F. Any other `ClientSdk.create()`, `sdk.balances()`, `sdk.shutdown()` calls**

### Step 3: Graceful fallback on timeout
When the timeout fires, the handler should:
1. Log the timeout with context
2. Reply to the user with a friendly message (e.g., "⚠️ IQ Option is taking too long. Try again.")
3. NOT leave the user in a broken state (no stale wizard sessions, no hanging buttons)

### Test scenarios
- Normal operation: everything works as before
- Network block: kill the WebSocket connection → bot should respond "connection timeout" within 5-15s instead of freezing for 90s
- Multiple users trading simultaneously: one user's stalled trade shouldn't affect another user's /start

## Files to modify
- `src/bot.ts` — add helper, wrap all SDK calls
- `src/trade.ts` — check if `executeTrade` also needs timeouts on internal SDK calls
