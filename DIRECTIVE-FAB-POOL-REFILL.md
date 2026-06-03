# DIRECTIVE: Fix Fabricated Pool Auto-Refill Threshold + Pre-Seed

## Problem
When `selectWinners` runs, the eligible fabricated trader pool can be too small for the current giveaway's `max_winners`. The refill threshold at `eligibleIds.length < 5` doesn't account for giveaways that need 8 winners. Additionally, fallback IDs generated on exhaustion use prefix `190` which is inconsistent with the rest of the pool (prefixes like `182`, `185`, `181`, `192`, `183`, `189`, `186`).

## Fix 1: Dynamic Refill Threshold (giveaway.ts line 231)

Change:
```typescript
if (eligibleIds.length < 5) {
```

To:
```typescript
const neededMinimum = Math.max(5, event.max_winners);
if (eligibleIds.length < neededMinimum) {
```

The refill always adds `20 - eligibleIds.length` new IDs. This threshold now ensures the pool is never smaller than `max_winners` before selection begins.

## Fix 2: Consistent Fallback ID Prefix (giveaway.ts line 252)

The fallback ID when pool is exhausted should use the same prefix range as the rest of the pool, not a `190` prefix that looks different.

Change:
```typescript
const fallback = String(190_000_000 + Math.floor(Math.random() * 10_000_000));
```

To use the same prefix generation as `seedFabricatedTraders`:
```typescript
const prefixes = ['182', '185', '181', '192', '183', '189', '186', '184', '188', '187'];
const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
const fallback = prefix + suffix;
```

## Fix 3: Pre-Seed 15 More Fabricated Traders (db.ts after schema)

In the `seedFabricatedTraders()` function or as a one-time migration in `db.ts`, add 15 more entries to the `fabricated_traders` table. Use the same prefix-based ID generation (`seedFabricatedTraders` logic at line 1373-1417) to ensure IDs look authentic and don't collide with existing users or each other.

Prefixes to use from real IQ Option user ID starts: `182`, `185`, `181`, `192`, `183`, `189`, `186`, `184`, `188`, `187`.

## Verification
- Auto-refill fires when remaining IDs < max(5, event.max_winners)
- Fallback IDs look consistent with the existing pool
- 25+ total fabricated_traders in the DB after seeding
