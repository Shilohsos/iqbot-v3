# Directive: Fix Admin Analysis & Broadcast Targeting

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

---

## Fix 1: Admin Never Skips Trades (Remove Skip Gate)

**Files:** `src/admin-analysis.ts`, `src/bot.ts`

**Problem:** Admin analysis skips trades when TFs are neutral or split with low confidence. When Master goes live, users see the admin account skipping while their own trades fire — looks suspicious.

**Fix:** Remove ALL skip logic from admin analysis. Admin always executes like regular users, but with superior analysis (6 indicators × 3 TFs).

### Changes in `src/admin-analysis.ts`:

**1. Make `analyzeTimeframe()` never return neutral:**
At the end of `analyzeTimeframe()` (~line 155), change the neutral condition to use a tiebreaker:

```typescript
// Before:
const direction: 'call' | 'put' | 'neutral' = bullVotes > bearVotes ? 'call' : bearVotes > bullVotes ? 'put' : 'neutral';

// After:
const direction: 'call' | 'put' = bullVotes >= bearVotes ? 'call' : 'put';
```

When votes are tied, default to 'call' (bullish bias as tiebreaker). This ensures `analyzeTimeframe` always returns a definitive direction.

Also update the return type: `AdminTfResult.direction` should be `'call' | 'put'` (remove `'neutral'`).

**2. Remove skip logic in `adminAnalyze()`:**
Replace the entire skip section (~lines 182-203) with:

```typescript
// All 3 TFs analyzed — pick the highest-confidence TF as primary
const tfs = [tf5m, tf1m, tf30s] as AdminTfResult[];
const sorted = [...tfs].sort((a, b) => b.confidence - a.confidence);
const primary = sorted[0];

// Count how many TFs agree with the primary direction
const agreeing = tfs.filter(tf => tf.direction === primary.direction).length;
const avgConfidence = Math.round(tfs.reduce((s, tf) => s + tf.confidence, 0) / tfs.length);

return {
    direction: primary.direction,
    confidence: Math.max(avgConfidence, 65),
    reason: `✅ ${primary.direction === 'call' ? 'BULLISH' : 'BEARISH'} (${avgConfidence}%) | ${agreeing}/3 TFs agree`,
    tf5m, tf1m, tf30s,
    skipped: false,
};
```

**3. Remove `'neutral'` from `AdminTfResult` interface:**
Line 7 — change `direction: 'call' | 'put' | 'neutral'` to `direction: 'call' | 'put'`.

Also remove `skipped: boolean` and `skipReason?: string` from `AdminAnalysisResult` if they're no longer used by any caller.

### Changes in `src/bot.ts`:

Remove the skip-handling block at lines 1458-1469. Replace with:

```typescript
if (isAdmin) {
    const adminResult = await adminAnalyze(sdk, pair);
    analysis = { direction: adminResult.direction, confidence: adminResult.confidence, reason: adminResult.reason };
} else {
```

No more skipped check or early return for admin.

---

## Fix 2: Exclude Admin from Auto-Broadcasts

**File:** `src/db.ts`

**Problem:** `getBroadcastTargetIds()` at line 811 sends auto-broadcasts to all PRO/MASTER users including the admin's own Telegram ID (1615652240). Admin receives its own promotional messages.

**Fix:** Add admin exclusion:

```typescript
export function getBroadcastTargetIds(): number[] {
    const adminId = parseInt(process.env.ADMIN_USER_ID ?? '1615652240', 10);
    return (db.prepare(
        "SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != '' AND tier IN ('PRO','MASTER') AND telegram_id != ?"
    ).all(adminId) as { telegram_id: number }[]).map(r => r.telegram_id);
}
```

---

## Verification

1. Admin clicks Take a trade → bot analyzes 3 TFs, always returns a direction, never says "No clear signal"
2. Admin trades execute identically to users (no skip, no suspicious behavior)
3. Admin does NOT receive auto-broadcast promotional messages in their DM
