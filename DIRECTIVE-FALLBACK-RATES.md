# Directive: Fix NGN→USD Auto-Promotion — Add Fallback Exchange Rates

**IMPORTANT: Merge master first**

## Problem

Users with large NGN real balances are never auto-promoted from DEMO. The `convertToUsd()` function calls the SDK's `currencies.getCurrency('NGN')`, and if it fails (unsupported currency, network error, etc.), returns `0` — making it look like they have $0. They stay DEMO forever despite having ₦1.4M+ in real funds.

**Current behavior:**
```
Real ₦1,426,750 → convertToUsd fails → returns $0 → stays DEMO
```

**Expected:**
```
Real ₦1,426,750 → rate ~0.00067 → ~$951 → auto-promotes to MASTER
```

## Changes Required

### Update `convertToUsd()` in `src/tiers.ts`

**Current code (lines 87-106):**
```typescript
export async function convertToUsd(amount: number, currency: string, sdk: ClientSdk): Promise<number> {
    if (currency === 'USD') return amount;

    const cached = rateCache.get(currency);
    if (cached && cached.expires > Date.now()) {
        return amount * cached.rate;
    }

    try {
        const currencies = await sdk.currencies();
        const c = await currencies.getCurrency(currency);
        const rate = c.rateUsd;
        if (!rate || rate <= 0) return amount;
        rateCache.set(currency, { rate, expires: Date.now() + 3_600_000 });
        return amount * rate;
    } catch {
        logger.warn('tiers', `currency conversion failed for ${currency}, returning 0 to prevent false promotion`);
        return 0;
    }
}
```

**Replacement code:**
```typescript
// Hardcoded fallback rates for currencies the SDK may not support
// Used when the SDK currencies API fails (Network, NGN, etc.)
// Updated periodically — approximate rates are fine for tier promotion thresholds
const FALLBACK_RATES: Record<string, number> = {
    NGN: 0.00067,   // ~₦1,500 = $1 (Nigerian Naira)
    KES: 0.0077,    // ~KES 130 = $1 (Kenyan Shilling)
    GHS: 0.069,     // ~GHS 14.5 = $1 (Ghanaian Cedi)
    ZAR: 0.054,     // ~ZAR 18.5 = $1 (South African Rand)
    INR: 0.012,     // ~INR 83 = $1 (Indian Rupee)
    IDR: 0.000062,  // ~IDR 16,000 = $1 (Indonesian Rupiah)
    BRL: 0.19,      // ~BRL 5.3 = $1 (Brazilian Real)
};

export async function convertToUsd(amount: number, currency: string, sdk: ClientSdk): Promise<number> {
    if (currency === 'USD') return amount;

    const cached = rateCache.get(currency);
    if (cached && cached.expires > Date.now()) {
        return amount * cached.rate;
    }

    // Try SDK first
    try {
        const currencies = await sdk.currencies();
        const c = await currencies.getCurrency(currency);
        const rate = c.rateUsd;
        if (rate && rate > 0) {
            rateCache.set(currency, { rate, expires: Date.now() + 3_600_000 });
            return amount * rate;
        }
    } catch {
        // SDK failed — fall through to hardcoded rates
        logger.warn('tiers', `currency conversion via SDK failed for ${currency}, trying fallback`);
    }

    // Fallback: use hardcoded rate
    const fallbackRate = FALLBACK_RATES[currency.toUpperCase()];
    if (fallbackRate && fallbackRate > 0) {
        logger.info('tiers', `using fallback rate for ${currency}: ${fallbackRate}`);
        return amount * fallbackRate;
    }

    // Last resort: log and return 0 (no false promotions)
    logger.warn('tiers', `no conversion rate available for ${currency}, returning 0`);
    return 0;
}
```

## How It Works

| Scenario | Before | After |
|----------|--------|-------|
| SDK supports NGN, returns rate 0.00067 | ✅ ~$951 → MASTER | ✅ Same |
| SDK fails for NGN | ❌ Returns $0 → stays DEMO forever | ✅ Falls back to rate 0.00067 → ~$951 → MASTER |
| Unknown currency (e.g. VND) | ❌ Returns $0 | ✅ $0 (no fallback available) |
| USD | ✅ Returns raw amount | ✅ Same |

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Create a test user with NGN real balance > ₦15,000 ($10+)
3. Trigger `/start` → must auto-promote to at least PRO
4. Create a test user with NGN real balance > ₦75,000 ($50+)
5. Trigger `/start` → must auto-promote to MASTER
6. User with USD balance → unchanged behavior
