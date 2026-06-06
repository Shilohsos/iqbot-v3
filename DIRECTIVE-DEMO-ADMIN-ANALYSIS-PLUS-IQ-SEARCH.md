# Directive: IQ User ID Search + Demo Gets Admin Analysis

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

---

## Fix 1: Find Users by IQ Option User ID

**File:** `src/bot.ts` — around line 3854

When admin enters a number, currently only searches `telegram_id`. Also search `iq_user_id`:

```typescript
if (as.step === 'find_users') {
    const byId = parseInt(text, 10);
    let found;
    if (!isNaN(byId)) {
        const byTelegram = getUser(byId);
        const byIq = findUsersByIqUserId(byId);
        found = [];
        if (byTelegram) found.push(byTelegram);
        if (byIq) {
            for (const u of byIq) {
                if (!found.find(f => f.telegram_id === u.telegram_id)) found.push(u);
            }
        }
    } else {
        const cleanText = text.replace(/^@/, '').trim();
        found = findUsersByUsername(cleanText);
    }
```

**Add function in `src/db.ts`:**

```typescript
export function findUsersByIqUserId(iqUserId: number): UserRecord[] {
    return db.prepare(
        'SELECT * FROM users WHERE iq_user_id = ? ORDER BY last_used DESC LIMIT 10'
    ).all(iqUserId) as UserRecord[];
}
```

---

## Fix 2: Demo Gets Admin-Level Analysis

**File:** `src/bot.ts`

Currently admin gets `runAdminAnalysis()` (70 candles, 6 indicators, weighted voting). Change the gate so DEMO users also get this analysis:

```typescript
// Current (around line 1457):
if (isAdmin) {
    const adminResult = await adminAnalyze(sdk, pair);
    analysis = { direction: adminResult.direction, confidence: adminResult.confidence, reason: adminResult.reason };
} else {
    const analysisTier = normalizeTier(getUser(ctx.from!.id)?.tier);
    try {
        analysis = await analyzePairWithSdk(sdk, pair, timeframe, analysisTier);
    } catch (err: unknown) {
        // ...
    }
}

// Change to:
const analysisTier = normalizeTier(getUser(ctx.from!.id)?.tier);
if (isAdmin || analysisTier === 'DEMO') {
    // Admin AND Demo get the sharp 70-candle, 6-indicator analysis
    const candlesFacade = await sdk.candles();
    const blitzOptions = await sdk.blitzOptions();
    const norm = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');
    const normalizedPair = norm(pair);
    const active = blitzOptions.getActives().find(
        a => norm(a.ticker) === normalizedPair || norm(a.localizationKey) === normalizedPair
    );
    if (!active) throw new Error(`Unknown pair: ${pair}`);
    const history = await candlesFacade.getCandles(active.id, timeframe, { count: 200 }) as AdminCandle[];
    if (history.length < 30) throw new Error('Not enough data');
    analysis = runAdminAnalysis(history);
} else {
    // PRO/MASTER use standard analysis
    try {
        analysis = await analyzePairWithSdk(sdk, pair, timeframe, analysisTier);
    } catch (err: unknown) {
        // ... existing error handling
    }
}
```

## Verification

1. Admin searches `183456789` → finds user with matching `iq_user_id` (if any in DB)
2. Admin searches `@Amara6442` → still works via username search
3. DEMO user takes a trade → gets 70-candle, 6-indicator analysis (same engine as admin)
4. PRO/MASTER user takes a trade → gets standard analysis (unchanged)
