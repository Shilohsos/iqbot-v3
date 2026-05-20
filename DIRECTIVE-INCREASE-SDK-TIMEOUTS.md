# DIRECTIVE: Increase SDK Timeouts — Connections Taking 60-194s

## Problem

IQ Option SDK WebSocket connections (`createSdk()`) are taking 60-194 seconds to establish. Multiple `withTimeout` wrappers around SDK operations are too tight, causing handlers to fail mid-trade even though the underlying operation would eventually succeed.

**Slow handler log evidence (live):**
```
[slow] callback pair:EURUSD-OTC: 194219ms
[slow] callback pair:EURUSD-OTC: 61681ms
[slow] callback pair:EURUSD-OTC: 61827ms
[slow] callback pair:GBPUSD-OTC: 63202ms
```

## Changes Required

### 1. `src/bot.ts` — Increase `withTimeout` for SDK operations

**Balance fetch (line 442, 1152-1153):** 3s and 5s are too tight for slow connections.
```typescript
// Line 442: Change 3_000 → 30_000
sdk = await withTimeout(createSdk(ssid!), 30_000, 'balance');
// Line 443: Change 3_000 → 15_000
const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();

// Line 1152: Change 5_000 → 30_000
_sdk = await withTimeout(createSdk(ssid), 30_000, 'balance');
// Line 1153: Change 5_000 → 15_000
const all = (await withTimeout(_sdk.balances(), 15_000, 'balance')).getBalances();
```

**Pairs debug (line 1779-1780):** 10s is too tight.
```typescript
// Line 1779: Change 10_000 → 60_000
_sdk = await withTimeout(createSdk(ssid), 60_000, 'pairs');
// Line 1780: Change 10_000 → 60_000
const actives = (await withTimeout(_sdk.turboOptions(), 60_000, 'pairs')).getActives();
```

**Trade execution round (line 545):** The `roundTimeoutMs` formula `(timeframeSec + 90) * 1000` is for the trade result wait. The SDK connection time is ON TOP of that. Add a 120s buffer for SDK connection.
```typescript
// Line 545 — Change from:
const roundTimeoutMs = (timeframeSec + 90) * 1000;
// To:
const SDK_CONNECTION_BUFFER = 120_000; // 120s extra for slow SDK connections
const roundTimeoutMs = (timeframeSec + 90) * 1000 + SDK_CONNECTION_BUFFER;
```

### 2. `src/analysis.ts` — Add timeout to `createSdk` call

The `analyzePair` function has NO timeout on its `createSdk` call — it can hang indefinitely. Add a `withTimeout` wrapper.

Import `createSdk` in `analysis.ts` from `./trade.js`. Then wrap:

```typescript
// Before line 10 (const sdk = await createSdk(ssid);), add:
const CONNECTION_TIMEOUT = 120_000;

// Change line 10 from:
const sdk = await createSdk(ssid);
// To:
const sdk = await Promise.race([
    createSdk(ssid),
    new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Analysis SDK connection timed out')), CONNECTION_TIMEOUT)
    ),
]);
```

Note: `analysis.ts` doesn't import `withTimeout` from `bot.ts`. Either extract `withTimeout` into a shared module, or inline the `Promise.race` pattern as shown above. Simplest is to inline — just add the `Promise.race` with `setTimeout`.

### 3. `src/trade.ts` — Increase SDK connection resilience

The `executeTrade` function creates its own SDK at line 114. If `createSdk` hangs here, the entire trade round is blocked. The `withTimeout` at `bot.ts:587` wraps the full execution, but the timeout budget is tight.

Add a local connection timeout in `executeTrade`:

```typescript
// In trade.ts, around line 111-114, change from:
let sdk: ClientSdk;
try {
    sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
} catch (err: unknown) {
    if (isTimeoutError(err)) return errorResult(trade, 'Connection timed out');
    throw err;
}

// To:
let sdk: ClientSdk;
try {
    sdk = await Promise.race([
        ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST }),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Connection timed out')), 120_000)
        ),
    ]);
} catch (err: unknown) {
    if (isTimeoutError(err)) return errorResult(trade, 'Connection timed out');
    throw err;
}
```

## Summary of Timeout Changes

| Location | Current | New | Context |
|----------|---------|-----|---------|
| bot.ts:442 balance SDK | 3s | 30s | Balance fetch on /start |
| bot.ts:443 balance fetch | 3s | 15s | Balance fetch on /start |
| bot.ts:1152 balance SDK | 5s | 30s | Balance fetch in menu |
| bot.ts:1153 balance fetch | 5s | 15s | Balance fetch in menu |
| bot.ts:1779 pairs SDK | 10s | 60s | /pairs debug command |
| bot.ts:1780 pairs fetch | 10s | 60s | /pairs debug command |
| bot.ts:545 trade round | (tf+90)s | (tf+90)+120s | Trade execution |
| analysis.ts createSdk | None | 120s | Pair analysis |
| trade.ts createSdk | None | 120s | Trade execution |

## Acceptance Criteria

- [ ] Balance shows on /start (SDK connects within 30s)
- [ ] Pair analysis completes (SDK connects within 120s)
- [ ] Trade execution completes (SDK + trade result within (tf+90)+120s)
- [ ] bot-out.log shows slow handler durations under the new timeouts
- [ ] Zero "SDK timeout" errors in bot-error.log
- [ ] `npx tsc --noEmit false` passes
- [ ] PM2 restart → bot comes up clean
