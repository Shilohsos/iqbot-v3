# DIRECTIVE: Broadcast Rotation + Locked Feature UI + Upgrade Prompts

## Issue 1: Auto-Broadcast Only Sends One Message

### Root Cause
`messageIndex` (auto-broadcast.ts line 17) is in-memory only — resets to 0 on every restart. Always picks message #1.

### Fix
Persist `messageIndex` in DB:
```sql
CREATE TABLE IF NOT EXISTS broadcast_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```
```ts
function getNextMessageIndex(): number {
    const row = db.prepare("SELECT value FROM broadcast_state WHERE key = 'message_index'").get();
    return row ? parseInt(row.value, 10) : 0;
}
function saveMessageIndex(idx: number): void {
    db.prepare("INSERT OR REPLACE INTO broadcast_state (key, value) VALUES ('message_index', ?)").run(String(idx));
}
```

In `fireBroadcast()`:
```ts
messageIndex = getNextMessageIndex(); // load from DB
const msg = messages[messageIndex % messages.length];
messageIndex++;
saveMessageIndex(messageIndex); // persist after use
```

---

## Issue 2: Broadcast Target — Send to Everyone

### Current
Only sends to `inactive` traders (no trade in 2+ hours). Skips active traders.

### Fix
Change target to ALL users:
```ts
const allUsers = getAllUserIds().filter(id => id > 0);
targets = allUsers;
```
Or at minimum, remove the inactive filter and send to ALL approved users every cycle. The 50ms delay handles rate limiting.

---

## Issue 3: Show All Features — Locked With Upgrade Prompt

### Philosophy
Every feature is VISIBLE to all users. Lower-tier users see the full interface but get an upgrade prompt when trying locked features. This creates aspiration — they see what they're missing.

### Timeframes
Show ALL timeframes (30s, 1m, 5m) to everyone. When clicking a locked one:

```
Demo user clicks 30s or 1m:
⚡ 30s timeframes require PRO tier.
Upgrade now for $10 — unlock faster trades, more pairs, and giveaways.

[ 🔓 Upgrade to PRO — $10 ]

---

Pro user clicks 30s:
⚡ 30s timeframes require MASTER tier.
Upgrade now for $50 — unlock ultra-fast trades, max martingale, and priority signals.

[ 🔓 Upgrade to MASTER — $50 ]
```

### Implementation
```ts
function timeframeKeyboard(tier?: string): IKMarkup {
    // Show ALL timeframes regardless of tier
    const allTfs = [30, 60, 300];
    const allowed = getTierConfig(tier).allowedTimeframes;
    const row: Btn[] = allTfs.map(s => {
        const label = labels[s];
        if (allowed.includes(s)) {
            return { text: label, callback_data: `tf:${s}` };
        }
        return { text: `🔒 ${label}`, callback_data: `upgrade:tf:${s}` };
    });
    // ...
}
```

Handle upgrade callbacks:
```ts
bot.action(/^upgrade:tf:(\d+)$/, async ctx => {
    const user = getUser(ctx.from!.id);
    const tier = normalizeTier(user?.tier);
    const nextTier = tier === 'DEMO' ? 'PRO' : 'MASTER';
    const cost = nextTier === 'PRO' ? '$10' : '$50';
    await ctx.reply(
        `⚡ ${ctx.match[1]}s timeframes require *${nextTier}* tier.\n\n` +
        `Upgrade now for ${cost}.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `🔓 Upgrade to ${nextTier} — ${cost}`, callback_data: 'ui:upgrade' }],
                    [{ text: '🔙 Back', callback_data: 'wizard:cancel' }],
                ],
            },
        }
    );
});
```

### Apply Same Pattern To
- **Pairs** — show all pairs, lock extras with upgrade prompt
- **Martingale rounds** — show all options (3, 6, 7), lock higher ones
- **Giveaway participation** — show "Participate" button, when clicked show upgrade prompt
- **Leaderboard** — always accessible, show upgrade badge for PRO/MASTER perks
- **Smart Recovery** — show toggle, lock advanced options

### Upgrade Costs (configurable via env)
```
PRO:   $10  (one-time token)
MASTER: $50 (one-time token)
```

Add to tiers.ts or .env:
```
PRO_UPGRADE_COST=10
MASTER_UPGRADE_COST=50
```
