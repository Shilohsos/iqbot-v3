# Issue CRITICAL: Bot performance — 90s timeouts, frozen buttons, slow /start

## Problem Summary
The bot consistently experiences 90-second handler timeouts, button freezes, and slow /start responses. This has been reported repeatedly despite individual patches. The root causes are architectural.

## Root Causes (all must be fixed)

### 1. NEW SDK Connection on EVERY action (primary cause)
Every handler that touches IQ Option creates a **fresh WebSocket connection**:
- `/start` → `ClientSdk.create()` → balance fetch → `sdk.shutdown()`
- `/balance` → `ClientSdk.create()` → balance fetch → `sdk.shutdown()`
- Trade execution → `ClientSdk.create()` → trade → `sdk.shutdown()`
- Login → `ClientSdk.create()` → login → `sdk.shutdown()`

Each WebSocket handshake takes 1-5 seconds. If multiple users hit these simultaneously, connections pile up and block the event loop.

**Fix:** Implement a persistent SDK connection pool per user. Keep one SDK connection alive per SSID and reuse it across requests. Only reconnect on failure.

```typescript
const sdkPool = new Map<string, { sdk: ClientSdk; lastUsed: number }>();
const SDK_POOL_TTL = 5 * 60 * 1000; // 5 min idle timeout

async function getSdk(ssid: string): Promise<ClientSdk> {
    const existing = sdkPool.get(ssid);
    if (existing && Date.now() - existing.lastUsed < SDK_POOL_TTL) {
        existing.lastUsed = Date.now();
        return existing.sdk;
    }
    // Close old one if exists
    if (existing) try { await existing.sdk.shutdown(); } catch {}
    // Create new
    const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
    sdkPool.set(ssid, { sdk, lastUsed: Date.now() });
    return sdk;
}

// Cleanup stale connections periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of sdkPool) {
        if (now - entry.lastUsed > SDK_POOL_TTL) {
            entry.sdk.shutdown().catch(() => {});
            sdkPool.delete(key);
        }
    }
}, 60_000);
```

Replace ALL `ClientSdk.create()` calls with `getSdk(ssid)`.

### 2. Telegraf's 90s default handler timeout
Telegraf wraps every handler with a 90-second timeout (via p-timeout). If ANY handler takes longer, the entire bot appears frozen to that user.

**Fix:** Add `bot.handlerTimeout(10_000)` or set `bot.launch({ handlerTimeout: 10_000 })` so no single handler blocks for more than 10 seconds. Timeouts should be caught and return immediately.

### 3. /start fetches balance on EVERY call (even with 60s cache)
The balance cache is only 60s TTL. A user hitting /start twice in 2 minutes makes TWO SDK connections.

**Fix:** 
- Increase balance cache TTL to 5 minutes
- Show the menu INSTANTLY from cached data, then update balance in background if stale
- If no cache available, show menu WITHOUT balance and fetch balance asynchronously
- Pattern:
  ```typescript
  // Show menu immediately
  const lines = [/* menu without balance */];
  const msg = await ctx.reply(lines.join('\n'), { reply_markup: startKeyboard() });
  
  // Fetch balance in background
  setTimeout(async () => {
      try { /* fetch balance */; await ctx.telegram.editMessageText(/* updated with balance */); } catch {}
  }, 0);
  ```

### 4. Currency detection not propagating properly
The `saveUserCurrency()` might not be called in all code paths. Users see wrong currency on their account.

**Fix:** Save currency in ALL places where balance is fetched:
- `sendStartMenu()` — after balance fetch
- `/balance` command — after balance fetch
- `loginAndCaptureSsid()` — during login flow
- `/connect` command — during reconnect flow
- Add a `saveCurrency()` call that runs on every successful balance read

### 5. Memory growth over time
The `sdkPool` (once added), `balanceCache`, `sessionStats`, and other Maps grow unbounded. If the bot runs for days, memory increases.

**Fix:** Add cleanup intervals for all persistent Maps.

### 6. GramJS affiliate checker has no timeout
`checkAffiliate()` (in `src/affiliate.ts`) connects to Telegram MTProto via GramJS and fetches up to 1000 messages from the affiliate channel. This has **zero timeout protection**:
- `getClient()` → `client.connect()` can hang if MTProto is unreachable
- `client.getMessages(channelId, { limit: 1000 })` — fetching 1000 messages is slow
- If GramJS hangs, the onboarding handler blocks for 90s (Telegraf default)

**Fix in src/affiliate.ts:**
- Add a 15-second timeout around `client.connect()` and `client.getMessages()`
- Reduce the default scan limit from 1000 to 200 messages (still enough to find recent users)
- Wrap `checkAffiliate()` in `withTimeout()` at the call site in bot.ts (around line 1983):
  ```typescript
  const result = await withTimeout(checkAffiliate(iqUserId), 15_000, 'affiliate')
      .catch(() => ({ found: false } as AffiliateResult));
  ```
- If GramJS times out or errors, fall through to `setManualApproval()` silently (don't block the user)

### 7. Concurrent request limiting
Too many handlers running concurrently (e.g., 20 stale button callbacks) overwhelm the event loop.

**Fix:** Add a simple concurrency limiter for IQ Option SDK operations:
```typescript
const MAX_CONCURRENT_SDK = 5;
let activeSdkOps = 0;
const sdkQueue: Array<() => void> = [];

async function runSdkOp<T>(fn: () => Promise<T>): Promise<T> {
    if (activeSdkOps >= MAX_CONCURRENT_SDK) {
        await new Promise<void>(resolve => sdkQueue.push(resolve));
    }
    activeSdkOps++;
    try { return await fn(); }
    finally {
        activeSdkOps--;
        sdkQueue.shift()?.();
    }
}
```

This prevents SDK operation pileup when many users hit the bot simultaneously.

## Files to modify
- `src/bot.ts` — Add SDK pool, handler timeout, background balance fetch, currency save in all paths, withTimeout on affiliate call, concurrency limiter
- `src/trade.ts` — Use pooled SDK connection instead of creating new one
- `src/affiliate.ts` — Add timeouts to GramJS connect and getMessages, reduce scan limit
- All SDK connection points — replace `ClientSdk.create()` with `getSdk(ssid)`

## Testing
1. Click 10 buttons rapidly — all should respond instantly (not queue up)
2. /start 5 times in a row — instant response every time (no balance fetch delay)
3. Let bot run 24 hours — no 90s timeouts, no memory leak
4. USD and NGN accounts both show correct currency
5. Stale buttons → "⏳ Expired" message, bot stays responsive
