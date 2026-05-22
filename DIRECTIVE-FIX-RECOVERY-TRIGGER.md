# Fix Recovery Trigger for Martingale Round Counting

## Context
Previous directive (DIRECTIVE-MARTINGALE-ROUND-COUNT.md) fixed the loop bound at line 580 (`round <= effectiveRounds + 1`) so "3 rounds" iterates through 4 total trades (1 initial + 3 recovery attempts). However, the recovery doubling trigger at line 680 still uses `round < effectiveRounds`, which only doubles for rounds 1 and 2 (when effectiveRounds=3).

**Result without this fix:** $10→$20→$40→$40 (last recovery doesn't double).  
**Expected result:** $10→$20→$40→$80 (full martingale, all 3 recoveries double).

## Changes Required

**IMPORTANT: Merge master first** to get the previous martingale fix.

### 1. `src/bot.ts` — Line 680

Change:
```typescript
        if (round < effectiveRounds) {
```
To:
```typescript
        if (round <= effectiveRounds) {
```

This makes the recovery doubling trigger fire for rounds 1 through `effectiveRounds` (e.g., rounds 1,2,3 for effectiveRounds=3).

### Trace at effectiveRounds=3 (after fix)

| Round | Stake | Lose? | Recovery trigger (round ≤ 3) | Next stake |
|-------|-------|-------|------------------------------|------------|
| 1     | $10   | ✅    | round=1 ≤ 3 → true           | $20        |
| 2     | $20   | ✅    | round=2 ≤ 3 → true           | $40        |
| 3     | $40   | ✅    | round=3 ≤ 3 → true           | $80        |
| 4     | $80   | ✅    | false → falls through        | "Lost this one 💔" |

Result: 1 initial + 3 full recovery attempts. ✅
