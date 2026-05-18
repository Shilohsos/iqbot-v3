# Issue: analyzePair() creates own SDK connection — conflicts with pool

## Problem

`src/analysis.ts` line 10 calls `createSdk(ssid)` which creates a fresh `ClientSdk` WebSocket connection, while the SDK pool (`sdkpool.ts`) may already hold a connection for the same SSID (created by `/start` balance fetch, etc.).

This causes **2 concurrent WS connections for the same IQ Option user** → IQ Option invalidates one → `"authentication is failed"`.

## Flow of failure

1. User opens bot → `/start` → `getSdk(ssid)` from pool → connection #1 stays open
2. User clicks "Take a trade" → analyzes pair → `analyzePair(ssid, ...)` → `createSdk(ssid)` → connection #2
3. IQ Option sees 2 connections for same SSID → kills one
4. If connection #2 is killed → `analyzePair` throws: `"authentication is failed"`

## Fix Required

### File: `src/analysis.ts`

**Current (lines 9-43):**
```typescript
import { createSdk } from './trade.js';

export async function analyzePair(ssid: string, pair: string, timeframeSec: number): Promise<AnalysisResult> {
    const sdk = await createSdk(ssid);
    try {
        // ... analysis using sdk.turboOptions(), sdk.candles() ...
    } finally {
        await sdk.shutdown();
    }
}
```

**Replace with:**
```typescript
import { getSdk, evictSdk } from './sdkpool.js';

export async function analyzePair(ssid: string, pair: string, timeframeSec: number): Promise<AnalysisResult> {
    let sdk: ClientSdk;
    try {
        sdk = await getSdk(ssid);
    } catch {
        evictSdk(ssid);
        sdk = await getSdk(ssid);
    }
    try {
        // ... same analysis logic - no changes needed here ...
    } finally {
        // Do NOT shutdown — pool manages lifecycle
    }
}
```

Key changes:
1. `import { getSdk, evictSdk } from './sdkpool.js'` instead of `import { createSdk } from './trade.js'`
2. Use `getSdk(ssid)` from pool (with stale connection retry)
3. **Remove `sdk.shutdown()`** — pool manages lifecycle

### File: `src/bot.ts`

No changes needed — `bot.ts` already imports `analyzePair` from `analysis.ts` and calls it the same way.

## Verification

After deploying:
1. Place any trade — analysis should succeed every time
2. Check balance in home menu after trade
3. No "authentication is failed" errors in logs
4. Repeat 5+ trades in succession — all succeed
