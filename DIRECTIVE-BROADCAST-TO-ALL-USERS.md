# DIRECTIVE: Winner Broadcast — Send to ALL Users, Not Just Approved

## Problem
Claude changed target from `realParticipants` → `getApprovedUsersWithTier()` (line 249). Better, but still only hits approved users. Demo users, pending users, rejected users — the exact people who need FOMO — are excluded.

## User's Intent
Broadcast winner results to **EVERYONE** in the database. Demo, Pro, Master, approved, pending, rejected — all of them. When they see "192***247 won $200!" they'll want to upgrade and participate next time. The broadcast IS the marketing.

## Fix
Replace `getApprovedUsersWithTier()` with `getAllUsers()`:

### New DB function (src/db.ts):
```ts
export function getAllUsers(): Array<{ telegram_id: number }> {
    return db.prepare(
        "SELECT telegram_id FROM users WHERE telegram_id > 0"
    ).all() as Array<{ telegram_id: number }>;
}
```

### Update giveaway.ts line 249:
```ts
// OLD:
const approvedUsers = getApprovedUsersWithTier();

// NEW:
const allUsers = getAllUsers();
```

### Also update the FOMO message
Make it more provocative for non-participants:
```ts
const announcementMsg =
    `🎉 *GIVEAWAY RESULTS*\n\n` +
    `*${event.title}*\n\n` +
    `🏆 Winners: ${maskedWinners}${prizeText}\n\n` +
    `Missed out? Don't let it happen again. Upgrade to PRO and join the next one! 🔥`;
```

## Why
- DEMO users see winners → want to upgrade to participate
- Pending users see activity → want to get approved
- Rejected users see what they're missing → contact support
- It's all FOMO. Every single user in the DB should see this.
