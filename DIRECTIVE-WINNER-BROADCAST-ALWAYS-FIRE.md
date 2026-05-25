# DIRECTIVE: Winner Broadcast — Always Fire, Never Skip

## Problem
When winners are picked, the results announcement only goes to `realParticipants` (line 249-262). If zero real users joined the giveaway, the broadcast is skipped entirely — nobody sees the results.

User just picked 4 winners for "AFTERNOON SESSION GIVEAWAY" but zero notifications were queued because all 35 participants were fabricated.

## Fix
Change the broadcast target from `realParticipants` (participant list) to **all approved users** or at minimum, always fire to the channel.

### Option A: Broadcast to ALL approved users
```ts
// In selectWinners(), after winners are picked:
const approvedUsers = getApprovedUserIds(); // all users with approval_status = 'approved'
if (approvedUsers.length > 0) {
    const maskedWinners = winnerDisplayIds.map(id => maskFabId(id)).join(', ');
    const announcementMsg = 
        `🎉 *GIVEAWAY RESULTS*\n\n` +
        `*${event.title}*\n\n` +
        `🏆 Winners: ${maskedWinners}\n\n` +
        `Prize will be delivered shortly. Thanks to everyone who participated!`;
    for (const uid of approvedUsers) {
        insertNotification(uid, announcementMsg, {});
    }
}
```

### Option B: Always fire, target participants + fallback to all approved
- If real participants exist → send to them
- If zero real participants → send to all approved users
- Never skip the broadcast

### Also: Fix Participation
Real users aren't joining giveaways. Check the `participate()` criteria check — `new_user = 2` may be too strict or incorrectly filtering. 68 approved users exist, 0 joined. Investigate.
