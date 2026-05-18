# Dynamic Auto-Updating Leaderboard — Fabricated Traders

## Goal
Replace the static leaderboard with a dynamic system that shows fabricated traders alongside real ones. Fabricated IDs have randomized PnL that updates every 1–10 hours. The leaderboard feels alive and authentic.

## Database

### New table: `fabricated_traders`
```sql
CREATE TABLE IF NOT EXISTS fabricated_traders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fabricated_id TEXT NOT NULL UNIQUE,      -- the fake IQ User ID (9 digits)
    display_name TEXT NOT NULL,               -- masked: "182***456"
    current_pnl REAL NOT NULL DEFAULT 0,     -- current PnL
    next_update_at TEXT,                      -- ISO datetime of next PnL change
    update_interval INTEGER NOT NULL DEFAULT 3600, -- interval in seconds (1h = 3600, 10h = 36000)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fab_next_update ON fabricated_traders(next_update_at);
```

### New DB functions in `src/db.ts`
```typescript
// Seed: generate 10 fabricated IDs from real trader patterns (same algo as giveaway)
// Assigns random PnL ($10–$5,000) and random update interval (1–10h)
export function seedFabricatedTraders(): void;

// Check if any fabricated trader needs a PnL update
// Returns rows where next_update_at < now
export function getFabricatedTradersDueForUpdate(): FabricatedTrader[];

// Update a fabricated trader's PnL (increase 80%, decrease 20%) + set new next_update_at
export function updateFabricatedPnl(id: number, newPnl: number, nextUpdateAt: string): void;

// Get all fabricated traders sorted by PnL desc
export function getAllFabricatedTraders(): FabricatedTrader[];

// Get real trader PnL from trades table (last 48h)
export function getRealTraderLeaderboard(): Array<{ telegram_id: number; username: string; total_pnl: number }>;

// Count current fabricated traders
export function countFabricatedTraders(): number;
```

## Behavior

### On bot start
1. Call `countFabricatedTraders()`
2. If zero → call `seedFabricatedTraders()` to create 10 entries
3. Start the update checker interval

### Every midnight (cron-style check)
Don't regenerate — fabricated IDs persist across days. Only seed if the table is empty.

### Daily reset at midnight (12am)
At midnight every day:
- Fabricated **IDs persist** (same IDs stay day after day — they don't get regenerated)
- But **PnL resets** — all fabricated traders' `current_pnl` goes back to 0
- After reset, the update checker picks up and starts assigning random PnL again (as if a new trading day started)
- This keeps the leaderboard fresh daily while maintaining consistent "traders"

### Update checker (runs every 60 seconds via setInterval)
1. `getFabricatedTradersDueForUpdate()` — finds entries where `next_update_at < datetime('now')`
2. For each:
   a. **80% chance** → PnL increases by random $50–$500
   b. **20% chance** → PnL decreases by random $50–$500
   c. PnL never goes below $0
   d. Set new `next_update_at` = now + new random interval (1–10 hours)
   e. Call `updateFabricatedPnl()`

### ID Generation (same algorithm as giveaway)
- Query `users` table for `iq_user_id` from traders active in last 48h
- Extract first 3 digits from each
- For each of 10 IDs:
  - Pick a random first-3-digit pattern
  - Generate remaining 6 digits randomly
  - Check collision: must not exist in `users.iq_user_id`, `giveaway_log`, or `fabricated_traders.fabricated_id`
  - If collision → regenerate
- Assign random PnL between $10 and $5,000

### Display Name
Show as masked: `182***456` (first 3 digits + `***` + last 3 digits)

### Leaderboard Merge (when user views `/leaderboard`)
1. Get all fabricated traders (`getAllFabricatedTraders()`)
2. Get real trader PnL from last 48h (`getRealTraderLeaderboard()`)
3. Combine both lists
4. Sort by PnL descending
5. Return top 10
6. If a real trader breaks into top 10, they replace the lowest fabricated entry

### Persistence
- All data in SQLite — survives restarts
- On restart, the update checker picks up from saved `next_update_at` timestamps
- No data loss on reboot

## Files to modify
- `src/db.ts` — Add `fabricated_traders` table creation + all DB functions
- `src/bot.ts` — Add:
  - At startup: check + seed fabricated traders, start update interval
  - Update checker: every 60s check for due updates
  - Modify `/leaderboard` handler to merge real + fabricated data
- `src/ui/user.js` — Update leaderboard display format if needed

## Example Leaderboard Output
```
🏆 *Leaderboard*

1. 182***456 — +$3,750.00
2. 511***789 — +$2,840.00
3. 182***123 — +$1,200.00
4. 447***890 —   $890.00
5. RealTrader —   $675.00
6. 182***567 —   $340.00
```

## User-Facing Notes
- No indication that IDs are fabricated
- Real traders' usernames shown if available, otherwise their masked ID
- Fabricated IDs always show as masked (`182***456`) with no username
