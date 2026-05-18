# Issue: executeTrade() creates own WS connection — conflicts with SDK pool

## Problem

`src/trade.ts` line 112–125 has `executeTrade()` doing:
```typescript
sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
// ... trade ...
await sdk.shutdown();
```

This creates a **second** WebSocket connection for the same SSID while `sdkpool.ts` already holds a pooled connection (created by `getSdk()`). IQ Option invalidates one of the two connections → all subsequent calls through either connection fail with `"authentication is failed"`.

## Root Cause

- Balance checks use `getSdk()` from pool → connection #1 stays open
- Trade execution uses `ClientSdk.create()` → connection #2 for same user
- Two WS connections for one SSID → IQ Option kills one → authenticated state lost for both

## Fix Required

### File: `src/trade.ts`

**Current `executeTrade()` (lines 112-125):**
```typescript
export async function executeTrade(ssid: string, trade: TradeRequest): Promise<TradeResult> {
    let sdk: ClientSdk;
    try {
        sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
    } catch (err: unknown) {
        if (isTimeoutError(err)) return errorResult(trade, 'Connection timed out');
        throw err;
    }
    try {
        return await executeTradeWithSdk(sdk, trade);
    } finally {
        await sdk.shutdown();
    }
}
```

**Replace with:**
```typescript
import { getSdk, evictSdk } from './sdkpool.js';

export async function executeTrade(ssid: string, trade: TradeRequest): Promise<TradeResult> {
    let sdk: ClientSdk;
    try {
        sdk = await getSdk(ssid);
    } catch (err: unknown) {
        // Pool connection may be stale — evict and retry once
        evictSdk(ssid);
        try {
            sdk = await getSdk(ssid);
        } catch (retryErr: unknown) {
            if (isTimeoutError(retryErr)) return errorResult(trade, 'Connection timed out');
            throw retryErr;
        }
    }
    return executeTradeWithSdk(sdk, trade);
    // No sdk.shutdown() — the pool manages the lifecycle
}
```

Key changes:
1. Use `getSdk(ssid)` from pool instead of `ClientSdk.create()`
2. On failure, `evictSdk(ssid)` then retry once
3. Remove `sdk.shutdown()` — pool manages lifecycle
4. TimeoutError handling same as before

### File: `src/bot.ts`

**Line 577 already calls `executeTrade(ssid, roundTrade)` — no change needed.**

Remove `createSdk` from the import on line 5 since it's no longer used (after the change, nothing in `trade.ts` exports it either):
```typescript
// Remove createSdk from import:
import { executeTrade, executeTradeWithSdk, type TradeRequest, type TradeResult } from './trade.js';
```

## Verification

After deploying via git push + pm2 restart:
1. Place any trade — should succeed
2. Check balance in home menu — should show correct balance
3. Check VPS logs for `"authentication is failed"` errors — should be zero
4. Repeat 3 trades in succession — all should succeed

## Files to modify
- `src/trade.ts` — Rewrite `executeTrade()` to use `getSdk()` from pool
- `src/bot.ts` — Remove unused `createSdk` from import
