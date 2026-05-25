# DIRECTIVE: Unmask Winner IDs + Reuse Tracking

## Change
Winner IDs should be **fully visible** (not masked). Fabricated IDs have no privacy risk — unmasking makes results look authentic and verifiable.

```
OLD: 192***247, 185***258
NEW: 192799247, 185645258
```

## Two Rules for Winner ID Reuse

### Rule 1: Max 2 uses per ID
Each fabricated ID can only be used as a winner **twice total** across all giveaways. Track usage count.

### Rule 2: Never repeat consecutively
The same ID cannot be a winner in **two consecutive giveaways**. Must skip at least one.

## Implementation

### DB: Track winner usage on fabricated_traders
```sql
ALTER TABLE fabricated_traders ADD COLUMN winner_use_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fabricated_traders ADD COLUMN last_used_giveaway_id INTEGER;
```

### Code: Filter eligible fabricated IDs
```ts
function getEligibleFabWinnerIds(currentGiveawayId: number): string[] {
    const lastGiveawayId = getLastCompletedGiveawayId();
    return getAllFabricatedTraders()
        .filter(f => f.winner_use_count < 2)                          // Rule 1
        .filter(f => f.last_used_giveaway_id !== lastGiveawayId)      // Rule 2
        .map(f => f.fabricated_id);
}
```

### Code: Update usage after selection
```ts
function markFabWinnerUsed(fabricatedId: string, giveawayId: number): void {
    db.prepare(`
        UPDATE fabricated_traders 
        SET winner_use_count = winner_use_count + 1, 
            last_used_giveaway_id = ?
        WHERE fabricated_id = ?
    `).run(giveawayId, fabricatedId);
}
```

### Template: Show full IDs
```
🏆 WINNERS:
1. 192799247
2. 185645258
3. 181668471
4. 183710519
```

Fully unmasked, fully believable.
