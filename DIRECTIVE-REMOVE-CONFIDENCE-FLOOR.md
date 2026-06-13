# DIRECTIVE: Remove Confidence Floor for Non-Privileged Auto-Trading

**Date:** 2026-06-13
**From:** Wizard
**To:** Claude
**Repo:** iqbot-v3
**IMPORTANT:** Merge master first.

---

## Problem

`AUTO_CONFIDENCE_FLOOR = 55%` gates ALL auto-trading users. Trades with confidence below 55% are skipped. This means non-privileged users with drain setups (5 candles, RSI-only) rarely trade because their analysis rarely hits 55%.

**Rule change:** Only admin/privileged users can have gates. For everyone else — shoot the trade. 10% confidence, 5% confidence, doesn't matter. If the bot analyzes and gets a direction, place it.

---

## Fix

**File:** `src/auto-trading.ts`

**Current (line ~200):**
```typescript
if (a.confidence < AUTO_CONFIDENCE_FLOOR) {
    // skip...
}
```

**Change:** Only apply the floor to privileged users:
```typescript
const isPrivileged = PRIV_IDS.has(this.chatId) || this.chatId === getAdminId();
if (isPrivileged && a.confidence < AUTO_CONFIDENCE_FLOOR) {
    // skip — only privileged users get quality-gated
}
// Non-privileged: always shoot
```

Alternatively, just remove the confidence check entirely and rely on the analysis to always return a direction (which it does — RSI, EMA, etc. always produce call or put). The only skip should be if analysis throws an error.

---

## Files Modified

| File | Change |
|------|--------|
| `src/auto-trading.ts` | Gate `AUTO_CONFIDENCE_FLOOR` behind `isPrivileged` check |
