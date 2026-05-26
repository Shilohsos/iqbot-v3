# Auto-Activate Scheduled Giveaways & Promo Codes

## Problem
Scheduled giveaways and promo codes (with `starts_at` set) are created in `giveaway_events` with `status='pending'` but **never auto-activate** when their start time arrives. There is no background interval checking for due entries.

Example: Promo code #3 "150% BONUS CODE" with `starts_at = 2026-05-26 04:18:18` stayed pending permanently. Admin had to manually trigger activation 4+ hours late.

## Fix Required

### 1. Add DB function `getPendingGiveawaysDue()`
In `src/db.ts`, add a new exported function:

```typescript
export function getPendingGiveawaysDue(): GiveawayEvent[] {
    return db.prepare(`
        SELECT * FROM giveaway_events
        WHERE status = 'pending'
          AND event_type IN ('giveaway', 'promo_code', 'marathon')
          AND starts_at IS NOT NULL
          AND starts_at <= datetime('now')
        ORDER BY starts_at ASC
    `).all() as GiveawayEvent[];
}
```

### 2. Add auto-activation interval in `src/bot.ts`
After the existing `tickPromoFabrication()` interval (line ~3793), add:

```typescript
backgroundIntervals.push(setInterval(async () => {
    try {
        const due = getPendingGiveawaysDue();
        for (const event of due) {
            console.log(`[scheduler] activating ${event.event_type} #${event.id} "${event.title}" (was due at ${event.starts_at})`);
            if (event.event_type === 'giveaway') {
                await activateGiveaway(event.id);
            } else if (event.event_type === 'promo_code') {
                await activatePromoCode(event.id);
            } else if (event.event_type === 'marathon') {
                await activateMarathon(event.id);
            }
        }
        if (due.length > 0) {
            console.log(`[scheduler] activated ${due.length} pending event(s)`);
        }
    } catch (err) {
        console.error('[scheduler] auto-activate error:', err instanceof Error ? err.message : err);
    }
}, 60_000));
```

### 3. Import `getPendingGiveawaysDue`
Add `getPendingGiveawaysDue` to the import from `'./db.js'` at the top of `bot.ts`.

### 4. Rehydrate on startup (bonus)
Also call this check once at startup (after `rehydrateScheduledBroadcasts();` around line 3717) to catch any that were due during downtime:

```typescript
// Immediately activate any overdue scheduled giveaways
(async () => {
    const due = getPendingGiveawaysDue();
    for (const event of due) {
        console.log(`[scheduler] startup activation: ${event.event_type} #${event.id} "${event.title}" (was due at ${event.starts_at})`);
        if (event.event_type === 'giveaway') {
            await activateGiveaway(event.id);
        } else if (event.event_type === 'promo_code') {
            await activatePromoCode(event.id);
        } else if (event.event_type === 'marathon') {
            await activateMarathon(event.id);
        }
    }
    if (due.length > 0) console.log(`[scheduler] startup: activated ${due.length} overdue event(s)`);
})();
```

## Files to modify
- `src/db.ts` — add `getPendingGiveawaysDue` function
- `src/bot.ts` — add import + interval + startup activation

## Verification
1. Create a promo code scheduled 2 minutes in the future
2. Wait 2 minutes + 1 interval tick
3. Check `giveaway_events` status changed to 'active' and notifications were queued
