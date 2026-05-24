# Patch: Show identifiers for all marathon leaderboard entries

## Problem
The marathon leaderboard only shows names for fabricated entries (`display_name`) and ` ← you` for the viewing user. Other real users in positions 6-10 appear as just `"X trades"` with no identifier — looks broken/empty.

**Current display:**
```
🥇 182***123 — 42 trades     ← fabricated (has display_name)
🥈 511***789 — 38 trades     ← fabricated
🥉 447***456 — 31 trades     ← fabricated
4. 329***234 — 27 trades     ← fabricated
5. 613***890 — 22 trades     ← fabricated
6. 18 trades ← you           ← current user only
7. 15 trades                 ← ❌ blank, no identifier
8. 12 trades                 ← ❌ blank
9. 8 trades                  ← ❌ blank
10. 5 trades                 ← ❌ blank
```

## Fix
In `getMarathonLeaderboard` (giveaway.ts) or the display handler (bot.ts:2368-2375), add a masked user identifier for real participants.

**Option A: Add masked `telegram_id` display** (simpler)
In the display loop, when it's a real user (no `display_name`) and not the current user:
```ts
if (!e.display_name) {
    const masked = `User #${String(e.telegram_id).slice(0, 3)}***`;
    return `${medal} ${masked} — ${e.trade_count} trade${e.trade_count !== 1 ? 's' : ''}`;
}
```

**Option B: Include masked ID in `getMarathonLeaderboard` result** (cleaner)
Modify `getMarathonLeaderboard` to generate a `display_name` for all entries:
- Fabricated: use their existing `display_name`
- Real users: generate `"User #XXX***"` from their telegram_id

Then the display code simplifies to always show display_name.

**Result after fix:**
```
🥇 182***123 — 42 trades
🥈 511***789 — 38 trades
🥉 447***456 — 31 trades
4. 329***234 — 27 trades
5. 613***890 — 22 trades
6. 18 trades ← you
7. User #683*** — 15 trades
8. User #717*** — 12 trades
9. User #173*** — 8 trades
10. User #666*** — 5 trades
```

## Scope
One function: either `getMarathonLeaderboard` in `giveaway.ts` or the display handler in `bot.ts`.
