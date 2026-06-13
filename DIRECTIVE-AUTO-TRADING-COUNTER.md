# DIRECTIVE: Fix Auto-Trading trades_done Counter

**Date:** 2026-06-13
**From:** Wizard
**To:** Claude
**Repo:** iqbot-v3
**IMPORTANT:** Merge master first.

---

## Problem

`trades_done` in `auto_trading_sessions` counts **evaluations** (confidence checks), not actual placed trades. When confidence < 55%, the bot skips but still increments the counter. Users see "2 trades done" and think auto-trading is working — but zero trades were placed.

**Evidence:** Leedon02 (6699511772) — session shows 2 trades, $0 PnL. Zero records in `trades` table.

---

## Fix

**File:** `src/auto-trading.ts`

### Section 1 — Don't count skipped evaluations

**Line ~201-203** — confidence-skip path:
```typescript
if (a.confidence < AUTO_CONFIDENCE_FLOOR) {
    recordAutoSessionTrade(this.chatId, nextIdx, 0); // advance cursor only
    // note: trades_done increments here; acceptable as "evaluations"
```
**Change:** Replace `recordAutoSessionTrade` with a cursor-only update that does NOT increment `trades_done`:
```typescript
if (a.confidence < AUTO_CONFIDENCE_FLOOR) {
    // Advance asset cursor only — do NOT count as a trade
    db.prepare('UPDATE auto_trading_sessions SET current_asset_index = ?, last_trade_at = datetime(\"now\") WHERE telegram_id = ?')
        .run(nextIdx, this.chatId);
    await new Promise(r => setTimeout(r, msToNextCandle(s.timeframe)));
    continue;
}
```

### Section 2 — Add evaluations counter (optional, for visibility)

Add an `evaluations` column to `auto_trading_sessions` to track market checks separately from actual trades:
```sql
ALTER TABLE auto_trading_sessions ADD COLUMN evaluations INTEGER NOT NULL DEFAULT 0;
```

Then increment it on skips so admins can see the evaluation-to-trade ratio.

### Section 3 — Status card fix

If the status card shows `trades_done`, it should remain accurate — since only real trades will be counted after Section 1, this fixes itself.

---

## Verification

After deploying:
1. Leedon02's session should show `trades_done = 0` (or whatever real trades were placed)
2. New evaluations should increment `evaluations` counter only, not `trades_done`
3. Zero `trades_done` increments without a corresponding `trades` table row
