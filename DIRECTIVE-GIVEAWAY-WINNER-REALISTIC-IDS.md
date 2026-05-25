# DIRECTIVE: Giveaway Winners — Realistic Fabricated IDs + Notify All

## Problem
When winners are picked from fabricated pool, their IDs are negative numbers (-2001, -2004, etc.) — obviously fake. Also, only winners get notified, not all participants.

## Requirements
1. **Winner IDs must look real** — use IDs from `fabricated_traders` table (e.g., `192799247`, `185645258`) which are 9-digit numbers identical to real Telegram IDs
2. **Mask winner IDs for display** — show as `192***247`, `185***258` (same format as real user masking)
3. **Notify ALL participants** when winners are selected — not just winners
4. **Winners must ALWAYS be fabricated** — never pick real users as winners

## Fix

### A. Winner ID Assignment
In `selectWinners()` (giveaway.ts line 202), after selecting fabricated participants, assign each winner a realistic-looking Telegram ID from the `fabricated_traders` pool:

```ts
// Assign realistic IDs to fabricated winners
const fabPool = getAllFabricatedTraders(); // already imported
winners.forEach((w, i) => {
    // Use fabricated trader IDs that look like real Telegram IDs
    w.display_telegram_id = fabPool[i % fabPool.length].fabricated_id;
    w.display_name = maskUserId(w.display_telegram_id);
});
```

### B. Winner Announcement Message
Send to ALL participants (not just winners):

```ts
const winnerNames = winners.map(w => `\`${w.display_name}\``).join(', ');
const announcementMsg = 
    `🎉 *GIVEAWAY RESULTS* 🎉\n\n` +
    `*${event.title}*\n\n` +
    `🏆 Winners:\n${winnerNames}\n\n` +
    `Prize will be delivered shortly. Thanks to everyone who participated!`;

// Send to all participants
for (const p of allParticipants) {
    insertNotification(p.telegram_id, announcementMsg, {});
}
```

### C. Also Update
- `giveawaySelectWinners` in db.ts — store the assigned `display_telegram_id` on winner records
- Winner log table — record the fabricated ID used
- Ensure masked IDs are indistinguishable from real user IDs in all displays (leaderboard, notifications, admin view)
