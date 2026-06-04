# Directive: Fix Giveaway Min Balance — NGN Currency Conversion

**IMPORTANT: Merge master first** — this directive builds on latest master.

## Problem

In `giveaway.ts` → `participate()`, the min_balance check compares the raw balance amount against `$minBalance` without currency conversion. For NGN users, `real.amount` is in Naira (e.g. ₦5,000), so the check `5000 < 10` always passes even when the user has far less than $10 equivalent.

The `convertToUsd()` function already exists in `tiers.ts` and is used by the `/balance` command — this same function should be used here.

## Changes Required

### `src/giveaway.ts`

**1. Add import** — add `convertToUsd` to the import from `./tiers.js`:

At the top of the file, after the existing imports from `./db.js`, `./index.js`, and `./tiers.js`:

Currently the import from `./tiers.js` is:
```typescript
import { normalizeTier } from './tiers.js';
```

Change to:
```typescript
import { normalizeTier, convertToUsd } from './tiers.js';
```

**2. Fix min_balance check** — in the `participate()` function, lines ~166-171, convert the balance amount to USD before comparing:

**Before:**
```typescript
const balances = (await sdk.balances()).getBalances();
const real = balances.find((b: { type: unknown }) => b.type === BalanceType.Real);
const amount = (real as { amount?: number } | undefined)?.amount ?? 0;
if (amount < minBalance) {
```

**After:**
```typescript
const balances = (await sdk.balances()).getBalances();
const real = balances.find((b: { type: unknown }) => b.type === BalanceType.Real);
const rawAmount = (real as { amount?: number; currency?: string } | undefined)?.amount ?? 0;
const currency = (real as { currency?: string } | undefined)?.currency ?? 'USD';
const amount = currency === 'USD'
    ? rawAmount
    : await convertToUsd(rawAmount, currency, sdk).catch(() => rawAmount);
if (amount < minBalance) {
```

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. In bot: a NGN user with ₦5,000 (~$3.50) trying to join a $10 min_balance giveaway should be **blocked**
3. A NGN user with ₦20,000 (~$14) should **pass** the check
4. USD users should behave exactly as before (no change in path)

## Migration

No data migration needed. Pure code change.
