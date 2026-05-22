# DIRECTIVE: Fix Martingale Round Counting

## Problem

The martingale loop at line 580 of `src/bot.ts` counts the **initial trade as round 1** of the martingale. So "Medium (3 rounds)" = 1 initial + 2 recoveries = 3 trades total, not 3 recovery attempts.

The Smart Recovery setting should represent **the number of recovery rounds** (attempts after the initial loss), not total trades including the initial.

## Fix

**`src/bot.ts` line 580 — change loop bound:**

```typescript
// Before:
for (let round = 1; round <= effectiveRounds; round++) {

// After:
for (let round = 1; round <= effectiveRounds + 1; round++) {
```

This ensures `effectiveRounds` is the number of recovery attempts after the initial trade.

## Example behavior

| Setting | Recovery rounds | Trades | Scenario |
|---------|:---:|:---:|---------|
| 6 rounds (Full) | 6 | 7 | 1 initial + 6 double-ups |
| 3 rounds (Medium) | 3 | 4 | 1 initial + 3 double-ups |

## Acceptance Criteria

- [ ] "Medium (3 rounds)" runs 1 initial + 3 recovery trades = 4 max
- [ ] "Full (6 rounds)" runs 1 initial + 6 recovery trades = 7 max
- [ ] "Off" runs 1 trade only (initial, no recovery)
- [ ] `npx tsc` passes clean
- [ ] PM2 restart → bot starts clean
