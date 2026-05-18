# Issue: Trade execution creates separate SDK connection — conflicts with pool

## Problem
When a user places a trade, `executeTrade()` in `src/trade.ts` (line 112-125) creates a **brand new** `ClientSdk.create()` WebSocket connection, executes the trade, then calls `sdk.shutdown()`. Meanwhile, `sdkpool.ts` may already hold a pooled connection for the same SSID.

This causes:
1. **Two concurrent WebSocket connections** for the same IQ Option user → authentication conflicts
2. The old connection (or the new one) gets invalidated
3. Error: `"Analysis failed: authentication is failed"` when the trade tries to use the invalidated SDK
4. Balance fetch returning empty because the pooled SDK connection was also invalidated

## Evidence
- User reports: "Analysis failed: authentication is failed"
- Balance line missing from home menu
- Happens after the SDK pool was introduced

## Required Fix

### Option A (Recommended): Add `executeTradeWithPooledSdk()` to trade.ts

Add a new export function that uses the pool instead of creating a new connection:

```typescript
import { getSdk, evictSdk } from './sdkpool.js';

/**
 * One-shot trade using the pooled SDK connection.
 * Does NOT shutdown the SDK — the pool manages lifecycle.
 * If the pooled connection has gone stale, evict and retry once.
 */
export async function executeTradePooled(ssid: string, trade: TradeRequest): Promise<TradeResult> {
    let sdk: ClientSdk;
    try {
        sdk = await getSdk(ssid);
    } catch {
        // Connection might be stale — evict and retry
        evictSdk(ssid);
        sdk = await getSdk(ssid);
    }
    return executeTradeWithSdk(sdk, trade);
}
```

### Option B: Make `executeTrade()` use the pool

Modify the existing `executeTrade()`:
```typescript
export async function executeTrade(ssid: string, trade: TradeRequest): Promise<TradeResult> {
    let sdk: ClientSdk;
    try {
        sdk = await getSdk(ssid);
    } catch {
        evictSdk(ssid);
        sdk = await getSdk(ssid);
    }
    return executeTradeWithSdk(sdk, trade);
    // No sdk.shutdown() — pool manages lifecycle
}
```

### Update bot.ts to use the pooled version

In `src/bot.ts` line 577:
```typescript
// Change from:
result = await runSdkOp(() => withTimeout(executeTrade(ssid, roundTrade), roundTimeoutMs, 'trade'));
// To:
result = await runSdkOp(() => withTimeout(executeTradePooled(ssid, roundTrade), roundTimeoutMs, 'trade'));
```

## Files to modify
- `src/trade.ts` — Add `executeTradePooled()` or modify `executeTrade()` to use `getSdk()`
- `src/bot.ts` — Swap import and call to use pooled version
