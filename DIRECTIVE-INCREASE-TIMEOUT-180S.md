# DIRECTIVE: Increase SDK Connection Timeout to 180 Seconds

## Problem

Trades now execute with the shared SDK (1 connection per session ✅). But the 120s timeout on SDK creation is too tight — some connections take up to 194 seconds. When the timeout fires, the bot shows:

"Request timed out. This can happen under heavy load."

The screenshot shows 3 martingale rounds completed successfully, followed by a timeout error — likely from `sdk.shutdown()` in the `finally` block or from a timing issue where 120s wasn't enough for the initial connect.

## Root Cause

Observed SDK connection times: **60–194 seconds**. The 120s timeout at these locations cuts off legitimate connections that are simply slow:

- `src/bot.ts` line 904: SDK creation — `Promise.race` with 120_000ms
- `src/analysis.ts` line 18: analysis SDK creation — `Promise.race` with 120_000ms
- `src/trade.ts` line 117: trade SDK creation — `Promise.race` with 120_000ms

## Fix

Change all 3 occurrences of `120_000` to `180_000`.

### `src/bot.ts` line 904:
```typescript
// Before:
setTimeout(() => reject(new Error('Connection timed out')), 120_000)
// After:
setTimeout(() => reject(new Error('Connection timed out')), 180_000)
```

### `src/analysis.ts` line 18:
```typescript
// Before:
setTimeout(() => reject(new Error('Analysis SDK connection timed out')), 120_000)
// After:
setTimeout(() => reject(new Error('Analysis SDK connection timed out')), 180_000)
```

### `src/trade.ts` line 117:
```typescript
// Before:
setTimeout(() => reject(new Error('Connection timed out')), 120_000)
// After:
setTimeout(() => reject(new Error('Connection timed out')), 180_000)
```

Also update the trade round timeout in `src/bot.ts` runMartingale:
```typescript
// Before (line ~1090):
const roundTimeoutMs = (timeframeSec + 90) * 1000 + 120_000;
// After:
const roundTimeoutMs = (timeframeSec + 90) * 1000 + 180_000;
```

## Files to modify

1. `src/bot.ts` — 2 changes (SDK connection timeout + round timeout)
2. `src/analysis.ts` — 1 change (analysis SDK timeout)
3. `src/trade.ts` — 1 change (trade SDK timeout)

## Acceptance Criteria

- [ ] All 4 timeouts changed from 120s to 180s
- [ ] `npx tsc` passes clean
- [ ] PM2 restart → bot starts clean
- [ ] SDK connections no longer time out at 120s (now at 180s)
