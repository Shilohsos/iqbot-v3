# DIRECTIVE: Currency-Aware Tier Promotion

## Problem
`autoPromoteTier()` in `src/tiers.ts` compares raw `real.amount` against USD thresholds ($10 Pro, $50 Master), but IQ Option accounts can be in any currency (EUR, GBP, JPY, BRL, NGN, ZAR, etc.). 

**Current broken behavior:**
- €45 (~$50) → stays DEMO (should promote to Pro)
- ¥5000 (~$33) → promotes to MASTER (should stay Demo)  
- ₦15,000 (~$10) → promotes to MASTER (should stay Demo)

## What Exists
1. SDK `Balance` object has `currency: string` (ISO 4217 code, e.g. `"EUR"`)
2. `saveUserCurrency()` already stores it to DB — but it's never used for tier checks
3. SDK has `getCurrency(currencyCode: string): Promise<Currency>` — returns conversion data including USD rates
4. The call sites pass only `real.amount`:
   - `src/bot.ts` line 538: `autoPromoteTier(telegramId, real.amount, user.tier ?? 'DEMO')`
   - `src/bot.ts` line 1443: `autoPromoteTier(uid, real.amount, user.tier ?? 'DEMO')`

## Required Changes

### 1. Currency conversion utility (`src/tiers.ts`)
```typescript
// Cache rates for 1 hour to avoid spamming SDK
const rateCache = new Map<string, { rate: number; expires: number }>();

export async function convertToUsd(amount: number, currency: string, sdk: Sdk): Promise<number> {
    if (currency === 'USD') return amount;
    
    const cached = rateCache.get(currency);
    if (cached && cached.expires > Date.now()) {
        return amount * cached.rate;
    }
    
    try {
        const c = await sdk.getCurrency(currency);
        // Use the conversion rate from SDK's Currency object
        const rate = c.currencyConversion ?? 1;
        rateCache.set(currency, { rate, expires: Date.now() + 3600000 }); // 1h cache
        return amount * rate;
    } catch {
        // Fallback: if conversion fails, treat as USD to avoid wrong promotions
        logger.warn('tiers', `currency conversion failed for ${currency}, treating as USD`);
        return amount;
    }
}
```

### 2. Update `autoPromoteTier` function signature
Change from synchronous to accept pre-converted USD amount, OR make it async to convert internally. **Recommendation: keep it simple — have callers convert before calling.**

Do NOT make `autoPromoteTier` async — keep the tier logic pure/sync. Instead, callers must:
1. Get `real.amount` and `real.currency`  
2. Convert to USD using `convertToUsd()`
3. Pass USD amount to `autoPromoteTier()`

### 3. Update call sites
Both call sites in `src/bot.ts` (lines ~531-545 and ~1435-1443) need to:
```typescript
const real = all.find(b => b.type === BalanceType.Real);
if (real && user.tier !== 'MASTER') {
    const usdAmount = await convertToUsd(real.amount, real.currency ?? 'USD', sdk!);
    const newTier = autoPromoteTier(telegramId, usdAmount, user.tier ?? 'DEMO');
    // ... rest of promotion logic unchanged
}
```

### 4. Log actual currency in promotion messages
Current log line 543:
```
logger.info('bot', `auto-promoted user ${telegramId} from ${oldTier} to ${newTier} (balance: $${real.amount.toFixed(2)})`);
```
Update to include original currency:
```
logger.info('bot', `auto-promoted user ${telegramId} from ${oldTier} to ${newTier} (balance: ${real.currency} ${real.amount.toFixed(2)} ≈ $${usdAmount.toFixed(2)})`);
```

## Important
- **Never promote if conversion fails** — the fallback `return amount` in `convertToUsd` is safe because it only down-rates (treats as USD), won't falsely promote someone with 5000 JPY
- **Rate cache TTL: 1 hour** — avoids SDK spam on every /start
- **Currency is always ISO 4217** from the SDK, but handle `undefined`/`null` gracefully by defaulting to `'USD'`

## Files to Modify
- `src/tiers.ts` — add `convertToUsd()`, `rateCache`, import `logger`
- `src/bot.ts` — both promotion call sites: convert before passing to `autoPromoteTier()`
