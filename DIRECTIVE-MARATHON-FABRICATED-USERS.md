# Patch: Add fabricated users to marathon leaderboard

## Problem
The marathon leaderboard only shows real users who clicked "Join Marathon". When a marathon starts, the leaderboard looks empty (0 participants) — no urgency, no social proof. Users see nothing and don't feel compelled to join.

The normal PnL leaderboard already has 10 fabricated traders that auto-update. The marathon needs the same treatment.

## Solution

### 1. New DB table: `marathon_fabricated`
Create a table to track fake marathon participants per event:

```sql
CREATE TABLE IF NOT EXISTS marathon_fabricated (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id     INTEGER NOT NULL REFERENCES giveaway_events(id),
    display_name    TEXT    NOT NULL,
    trade_count     INTEGER NOT NULL DEFAULT 0,
    next_update_at  TEXT,
    update_interval INTEGER NOT NULL DEFAULT 3600,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mf_giveaway_id ON marathon_fabricated(giveaway_id);
CREATE INDEX IF NOT EXISTS idx_mf_next_update ON marathon_fabricated(next_update_at);
```

### 2. Seed function
When a marathon is activated (`activateMarathon` in `giveaway.ts`), also seed 5-8 fabricated participants for that `giveaway_id`. Use the same name masking pattern as the PnL leaderboard (e.g. `"182***123"`). Give them random starting trade counts (1-15).

### 3. Periodic trade count updates
Add a `setInterval` (every 60s, same as the PnL fabricator) that:
- Finds fabricated entries where `next_update_at <= datetime('now')`
- Randomly increases trade_count by 1-5 (80% of the time) or leaves it (20%)
- Sets a new `next_update_at` 1-6 hours in the future

### 4. Merge into marathon leaderboard
Modify `getMarathonLeaderboard` in `giveaway.ts` to return real AND fabricated participants merged, sorted by `trade_count DESC`. Use a union query:

```ts
export function getMarathonLeaderboard(giveawayId: number): Array<{ telegram_id: number | null; display_name: string | null; trade_count: number; rank: number }> {
    const rows = db.prepare(`
        SELECT telegram_id, NULL AS display_name, trade_count FROM giveaway_participants
        WHERE giveaway_id = ? AND eligible = 1
        UNION ALL
        SELECT NULL AS telegram_id, display_name, trade_count FROM marathon_fabricated
        WHERE giveaway_id = ?
        ORDER BY trade_count DESC
    `).all(giveawayId, giveawayId);
    return (rows as any[]).map((r, i) => ({
        telegram_id: r.telegram_id,
        display_name: r.display_name,
        trade_count: r.trade_count ?? 0,
        rank: i + 1,
    }));
}
```

### 5. Update display in `bot.ts`
In the marathon leaderboard handler (around line 2367), modify the display so fabricated entries show their `display_name` instead of " ← you":

```ts
const lines = board.slice(0, 10).map(e => {
    const medal = medals[e.rank - 1] ?? `${e.rank}.`;
    if (e.display_name) {
        return `${medal} ${e.display_name} — ${e.trade_count} trade${e.trade_count !== 1 ? 's' : ''}`;
    }
    const you = e.telegram_id === telegramId ? ' ← you' : '';
    return `${medal} ${e.trade_count} trade${e.trade_count !== 1 ? 's' : ''}${you}`;
});
```

### 6. Per-marathon reset
When a marathon ends, delete all `marathon_fabricated` entries for that `giveaway_id`.

### 7. Start the interval
In `bot.ts` alongside the existing PnL fabricator interval (line 3300), add a new interval for marathon fabricators.

## Verification
- Create a marathon → 5-8 fabricated users appear in the leaderboard immediately
- Fabricated trade counts slowly increase over hours/days
- Real user entries show " ← you" correctly, fabricated entries show display names
- When marathon ends, fabricated entries are cleaned up
- Participant count shown in messages includes fabricated entries
