# Directive: Tier Demotion + MASTER Re-evaluation

**IMPORTANT: Merge master first** — your feature branch may not have the latest funnel tracking hotfixes.

## Problem

Two bugs causing incorrect tier assignments:

1. **No demotion logic** — `autoPromoteTier()` returns `null` for any user already at MASTER, regardless of current balance. Users who withdraw to $0 stay MASTER forever.

2. **Periodic check skips MASTER** — The 30-minute balance check at `bot.ts:4976` explicitly filters out MASTER users (`.filter(u => u.tier !== 'MASTER')`), so they're never re-evaluated.

## Fixes

### 1. `src/tiers.ts` — Add demotion to `autoPromoteTier`

**Current code (lines 129-140):**
```typescript
export function autoPromoteTier(telegramId: number, realBalance: number, currentTier: string): string | null {
    // User is already MASTER — no promotion needed
    if (currentTier === 'MASTER') return null;

    // $50+ → MASTER (if not already)
    if (realBalance >= 50) return 'MASTER';

    // $10+ → PRO (only if currently DEMO)
    if (realBalance >= 10 && currentTier === 'DEMO') return 'PRO';

    return null;
}
```

**Fix:** Remove the early return for MASTER, add demotion thresholds for both MASTER and PRO:

```typescript
export function autoPromoteTier(telegramId: number, realBalance: number, currentTier: string): string | null {
    // Determine what the tier SHOULD be based ONLY on balance
    let targetTier: string;
    if (realBalance >= 50) {
        targetTier = 'MASTER';
    } else if (realBalance >= 10) {
        targetTier = 'PRO';
    } else {
        targetTier = 'DEMO';
    }

    // No change needed
    if (targetTier === currentTier) return null;

    // Only promote upwards (DEMO→PRO, DEMO→MASTER, PRO→MASTER) if active
    // Allow demotion (MASTER→PRO, MASTER→DEMO, PRO→DEMO) if balance dropped
    return targetTier;
}
```

This handles both promotion AND demotion with a single comparison.

### 2. `src/bot.ts` — Include MASTER in periodic re-evaluation

**Current code (line 4974-4976):**
```typescript
const candidates = getAllUserIds()
    .map(id => getUser(id))
    .filter((u): u is NonNullable<typeof u> => !!(u?.ssid) && u.tier !== 'MASTER');
```

**Fix:** Remove the `u.tier !== 'MASTER'` filter to include MASTER users:

```typescript
const candidates = getAllUserIds()
    .map(id => getUser(id))
    .filter((u): u is NonNullable<typeof u> => !!(u?.ssid));
```

Also add a funnel event for demotion (like the existing `'user_funded'` event on promotion):

```typescript
if (newTier && newTier !== user.tier) {
    const oldTier = user.tier;
    setUserTier(user.telegram_id, newTier);
    if (oldTier === 'DEMO') insertFunnelEvent('user_funded', JSON.stringify({ telegram_id: user.telegram_id }));
    if (newTier === 'DEMO' && oldTier !== 'DEMO') insertFunnelEvent('user_unfunded', JSON.stringify({ telegram_id: user.telegram_id }));
    logger.info('bot', `[periodic] tier changed ${user.telegram_id} ${oldTier} → ${newTier} ($${usdAmount.toFixed(2)})`);
}
```

## Deploy Checklist

| Step | Status |
|------|--------|
| 1. Merge master into feature branch | ☐ |
| 2. Apply `src/tiers.ts` change | ☐ |
| 3. Apply `src/bot.ts` change | ☐ |
| 4. `npm run build` | ☐ |
| 5. `pm2 restart iqbot-v3-bot --update-env` | ☐ |
| 6. Push to origin | ☐ |
| 7. Verify: non-funded users show DEMO, funded show correct tier | ☐ |
