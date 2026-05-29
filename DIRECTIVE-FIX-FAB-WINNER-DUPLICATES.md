# Fix Fabricated Winner ID Duplicates

## Problem
When `selectWinners` runs and `max_winners` exceeds the number of eligible fabricated IDs in the `fabricated_traders` table, the modulo operation `i % eligibleIds.length` wraps around — recycling the same IDs multiple times in the same winners list. Users see duplicate winner IDs and immediately know the giveaways are fabricated.

## Root Cause
`src/giveaway.ts` line 230-232:
```typescript
const winnerDisplayIds: string[] = winners.map(
    (_, i) => eligibleIds[i % Math.max(eligibleIds.length, 1)] ?? String(100_000_000 + i)
);
```

When `eligibleIds` has 3 items but `winners` has 8, indices 3-7 wrap to 0-2 (duplicates).

## Fix A: Kill the wrap-around (giveaway.ts)

Replace the modulo with logic that generates fallback IDs when the pool runs out:

```typescript
// Assign eligible fabricated IDs (max 2 uses, no consecutive repeats)
const eligibleIds = getEligibleFabWinnerIds(giveawayId);
const usedInThisGiveaway = new Set<string>();
const winnerDisplayIds: string[] = winners.map((_, i) => {
    // Pick from eligible pool if available and not already used in this round
    const fresh = eligibleIds.filter(id => !usedInThisGiveaway.has(id));
    if (fresh.length > 0) {
        const chosen = fresh[Math.floor(Math.random() * fresh.length)];
        usedInThisGiveaway.add(chosen);
        return chosen;
    }
    // Pool exhausted — generate a fresh fallback winner ID
    const fallback = String(190_000_000 + Math.floor(Math.random() * 10_000_000));
    usedInThisGiveaway.add(fallback);
    // Also add it to fabricated_traders so it's tracked for future use
    db.prepare(`INSERT OR IGNORE INTO fabricated_traders (fabricated_id, display_name) VALUES (?, ?)`).run(fallback, `Trader_${fallback}`);
    return fallback;
});
```

Note: `db` must be imported at the top of giveaway.ts — add:
```typescript
import { db } from './db.js';
```

And in `db.ts`, export `db`:
```typescript
export const db = new Database(DB_PATH);
// ... (find the existing `const db = new Database(...)` line and add export)
```

## Fix B: Seed more fabricated_traders (db.ts)

The `seedGiveawayFabricants` function creates **participants** (fake users who "join" a giveaway) but doesn't add to `fabricated_traders` (the winner ID pool). These are separate tables.

Either:
1. Increase the initial seed of `fabricated_traders` to 30-50 IDs
2. OR add a function that auto-refills when <10 eligible IDs remain

**Option 2 is better** — add at the beginning of `selectWinners` in giveaway.ts:

```typescript
// Auto-refill fabricated_traders if pool is running low
const eligibleIds = getEligibleFabWinnerIds(giveawayId);
if (eligibleIds.length < 5) {
    const needed = 20 - eligibleIds.length;
    for (let i = 0; i < needed; i++) {
        const newId = String(180_000_000 + Math.floor(Math.random() * 15_000_000));
        db.prepare(`INSERT OR IGNORE INTO fabricated_traders (fabricated_id, display_name) VALUES (?, ?)`)
            .run(newId, `Trader_${newId}`);
    }
    console.log(`[fab] refilled fabricated_traders: added ${needed} new IDs`);
}
```

## Files to modify
- `src/giveaway.ts` — fix wrap-around + add auto-refill
- `src/db.ts` — export `db` if not already exported

## Verification
1. Run a test giveaway with `max_winners=8` while only 3 eligible IDs exist
2. Winners list should have 8 unique IDs (no duplicates)
3. New IDs should be added to `fabricated_traders` table automatically
