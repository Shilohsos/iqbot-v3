# Section 3 Bug: Martingale crashes on SDK timeout

**Date:** 2026-05-10
**Reporter:** Wizard

---

## Symptom

Martingale sequence crashes the entire bot process when IQ Option connection hangs:

```
TimeoutError: Promise timed out after 90000 milliseconds
    at p-timeout/index.js:39
```

This kills the pm2 process. The pending trade and remaining rounds are lost.

---

## Root Cause

Two problems:

### 1. SDK timeout is uncaught

`executeTrade()` calls `ClientSdk.create()` which has an internal 90-second `p-timeout`. When IQ Option hangs (rate limiting, network blip), the SDK throws `TimeoutError` but it's not caught by the `try/catch` in the martingale loop because it propagates from the SDK's internal promise chain.

### 2. Fresh SDK connection per round

Each martingale round opens a new SDK connection:
```
Round 1: ClientSdk.create() → auth → trade → disconnect
Round 2: ClientSdk.create() → auth → trade → disconnect  ← HANGS HERE
```

IQ Option likely rate-limits or throttles rapid reconnects from the same SSID. Round 2's connection hangs.

---

## Fix

### Fix 1: Catch timeout in executeTrade()

Wrap the SDK calls with a try/catch for TimeoutError:

```typescript
try {
  const sdk = await ClientSdk.create(...);
  // ... trade ...
} catch (err) {
  if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
    return errorResult(trade, 'IQ Option connection timed out');
  }
  throw err;
}
```

### Fix 2: Reuse SDK connection across rounds

Pass an existing SDK instance into the martingale loop instead of creating new ones:

```typescript
// In the martingale loop, after Round 1:
const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), ...);
try {
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const result = await executeTradeWithSdk(sdk, roundTrade);
    // ... report ...
  }
} finally {
  await sdk.shutdown();
}
```

---

## Priority

Fix 1 is critical (crash → data loss). Fix 2 improves reliability.
