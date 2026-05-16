# Giveaway System — Fabricated Winner Generator

## Overview
Admin tool to generate fabricated giveaway winners based on real IQ Option User ID patterns. Winners are announced as broadcasts and users are prompted to contact admin if their ID matches.

## Database

### New table: `giveaway_log`
```sql
CREATE TABLE IF NOT EXISTS giveaway_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_run TEXT NOT NULL,   -- UUID for this batch
    generated_id TEXT NOT NULL UNIQUE, -- the fabricated IQ User ID
    pattern TEXT NOT NULL,        -- first 3 digits used
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_giveaway_log_generated_id ON giveaway_log(generated_id);
```

### New DB functions in `src/db.ts`
```typescript
export function saveGeneratedGiveawayId(giveawayRun: string, generatedId: string, pattern: string): void;
export function isGeneratedIdUsed(generatedId: string): boolean;
// Returns all IQ User IDs of users who placed trades in last N hours
export function getTradersIqUserIds(hours: number): number[];
// Returns all Telegram user IDs in target group
export function getGiveawayTargetIds(target: 'all' | '24h'): number[];
```

## Admin Entry Points
1. New **"🎁 Giveaway"** button on admin keyboard (`src/ui/admin.ts`)
2. Slash command: `/giveaway`

## Wizard Flow (3-step)

### Step 1 — Number of winners
Admin enters number → validated as positive integer. Store in admin session.

### Step 2 — Prize pool amount
Admin enters amount (e.g., `500`) → stored. Bot calculates `prize / winners` per person.

### Step 3 — Broadcast target
Two options:
- **All users** → `'all'`
- **Traders last 24h** → `'24h'`

After selection → trigger generation + broadcast.

## ID Generation Logic (CRITICAL — follow exactly)

1. **Get seed patterns:** Query `users` table for `iq_user_id` of users who have traded in last 48 hours. Extract first 3 digits of each. Deduplicate to get unique patterns.

2. **Generate N fabricated IDs:**
   - For each winner (1 to N):
     a. Pick a **random first-3-digit pattern** from the pool (can vary per winner)
     b. Generate remaining digits randomly so total length matches real IQ IDs (~9 digits total)
     c. **Collision check:** The full generated ID must NOT exist in:
        - `users.iq_user_id` (cannot match any real user)
        - `giveaway_log.generated_id` (cannot repeat any past giveaway ID ever)
     d. If collision → regenerate until unique
     e. Save to `giveaway_log` with a batch UUID

3. **IMPORTANT uniqueness rule:** An ID can only be used ONCE across ALL giveaways. The `giveaway_log` table's `UNIQUE` constraint on `generated_id` enforces this at DB level. Every new giveaway must check against all past ones.

## Broadcast Message Format

Send with inline "Contact Admin" button:

```
🎉 *GIVEAWAY WINNERS*

Prize Pool: $X
Winners: N
Each wins: $Y

🏆 *Winner IDs:*
182456789
182123456
511789012

If your IQ Option User ID matches any of the above, click below to contact the admin.
```

The message must include an inline keyboard button:
```typescript
{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }
```

Where `ADMIN_CONTACT_LINK` is from the existing env variable or defaults to `https://t.me/shiloh_is_10xing`.

## Files to modify
- `src/db.ts` — Add `giveaway_log` table creation + `saveGeneratedGiveawayId()`, `isGeneratedIdUsed()`, `getTradersIqUserIds()`, `getGiveawayTargetIds()`
- `src/ui/admin.ts` — Add "🎁 Giveaway" button to `adminKeyboard()`
- `src/bot.ts` — Add:
  - `bot.command('giveaway', ...)` — triggers wizard
  - `bot.action('admin:giveaway', ...)` — same as command
  - Admin session step handling for the 3-step wizard
  - ID generation logic
  - Broadcast dispatch with Contact Admin button
  - `ADMIN_CONTACT_LINK` constant (use existing from env or default)

## Testing
1. Admin clicks "🎁 Giveaway" → sees step 1 prompt
2. Enters "3" → step 2 asks for prize pool
3. Enters "500" → step 3 asks broadcast target
4. Selects target → IDs generated + broadcast sent
5. Verify no generated ID matches any real user
6. Run giveaway again → verify no duplicate IDs across giveaways
7. Broadcast message shows IDs, prize breakdown, and Contact Admin button
