# Issue 35: Tier system overhaul — Newbie vs Pro distinctions

## Overview
All accounts are created as **NEWBIE** by default. Users upgrade to **PRO** via token. This issue implements all tier-based restrictions.

---

## Part A: Default tier → NEWBIE

### DB schema (src/db.ts)
Change default tier from `'DEMO'` to `'NEWBIE'`:

```sql
tier TEXT NOT NULL DEFAULT 'NEWBIE'
```

In the migration function (line 83-84), also change:
```typescript
db.exec("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'NEWBIE'");
```

**Do NOT** drop the DEMO tier from the tierKeyboard/tier selection — existing users on DEMO tier should still work. Just make NEWBIE the default for all new signups.

---

## Part B: Upgrade button — remove admin contact link

### File: src/bot.ts — `ui:upgrade` handler (lines 899-908)

Current:
```typescript
`Don't have a token? Contact the admin: ${ADMIN_CONTACT_LINK}`
```

Replace with:
```typescript
`Don't have a token? Contact support to get your token.`
```

Remove the `ADMIN_CONTACT_LINK` usage from the upgrade handler only (keep it elsewhere if used).

Also in the token validation error message (line 1781):
```typescript
await ctx.reply(`❌ ${result.error}. Try again or contact the admin.`);
```
Replace with:
```typescript
await ctx.reply(`❌ ${result.error}. Contact support to get a valid token.`);
```

---

## Part C: Concurrent trades by tier

### File: src/bot.ts

**Newbie**: max 1 concurrent trade
**Pro**: max 3 concurrent trades

Need to change `activeTradeSessions` from a `Set<number>` to a count map:
```typescript
const activeTradeSessions = new Map<number, number>(); // userId → active trade count
```

Before starting a trade in `runMartingale` (or before the pair: handler calls runMartingale), check:

```typescript
const user = getUser(ctx.from!.id);
const tier = (user?.tier ?? 'NEWBIE').toUpperCase();
const maxConcurrent = tier === 'PRO' ? 3 : 1;
const currentCount = activeTradeSessions.get(ctx.from!.id) ?? 0;
if (currentCount >= maxConcurrent) {
    await ctx.reply(`⚠️ You already have ${currentCount} active trade(s). ${tier === 'NEWBIE' ? 'Newbie allows 1 trade at a time. Upgrade to PRO for up to 3 concurrent trades.' : 'Max 3 concurrent trades reached. Wait for one to finish.'}`);
    return;
}
```

In `runMartingale`:
- Change `activeTradeSessions.add(userId)` → `activeTradeSessions.set(userId, (activeTradeSessions.get(userId) ?? 0) + 1)`
- Change `activeTradeSessions.delete(userId)` → decrement the count or delete if 0

Also update the broadcast `pendingDeliveries` check (line 223) from `.has(uid)` to check `.get(uid) > 0` or similar.

---

## Part D: Available assets by tier

### File: src/menu.ts — `pairKeyboard()` function

Newbie: only 3 pairs — `EURUSD-OTC`, `GBPUSD-OTC`, `AUDUSD-OTC`
Pro: all 8 OTC_PAIRS

Change `pairKeyboard` to accept an optional `tier` parameter:
```typescript
export function pairKeyboard(page = 0, tier?: string): IKMarkup {
    const isNewbie = tier?.toUpperCase() === 'NEWBIE';
    const available = isNewbie
        ? ['EURUSD-OTC', 'GBPUSD-OTC', 'AUDUSD-OTC']
        : OTC_PAIRS;
    // ... use `available` instead of `OTC_PAIRS`
}
```

### File: src/bot.ts — `tf:` handler (line ~742)

When showing pair selection keyboard, pass the user's tier:
```typescript
const user = getUser(chatId);
const userTier = user?.tier ?? 'NEWBIE';
await ctx.editMessageText(..., { reply_markup: pairKeyboard(0, userTier) });
```

Same for the `page:` handler (line ~753):
```typescript
await ctx.editMessageReplyMarkup(pairKeyboard(page, userTier));
```

---

## Part E: Martingale rounds by tier

### File: src/bot.ts

Newbie: always 6 rounds (current MAX_ROUNDS)
Pro: configurable — can set gale on/off or reduce to 3 rounds

Add a per-user martingale setting:
```typescript
// Store per user
const userMartingaleSettings = new Map<number, { enabled: boolean; maxRounds: number }>();
```

Default for all: `{ enabled: true, maxRounds: 6 }`
Pro users can toggle via admin command or a settings UI.

For now, implement the baseline:
- Newbie: `runMartingale` uses `MAX_ROUNDS = 6` (unchanged)
- Pro: Add a simple setting command or toggle. Start with `MAX_ROUNDS = 6` for Pro as default but with a `rounds` parameter:

```typescript
// In runMartingale signature add: martingaleRounds?: number
const effectiveRounds = martingaleRounds ?? MAX_ROUNDS;
for (let round = 1; round <= effectiveRounds; round++) { ... }
```

---

## Part F: Leaderboard by tier

### File: src/db.ts — `updateLeaderboardAuto()` (line 464)

Check user's tier before adding to leaderboard:
```typescript
export function updateLeaderboardAuto(telegramId: number, pnl: number): void {
    if (pnl <= 0) return;
    // Only PRO users get auto-added to leaderboard
    const user = db.prepare('SELECT tier FROM users WHERE telegram_id = ?').get(telegramId) as { tier: string } | undefined;
    if (!user || user.tier?.toUpperCase() !== 'PRO') return;
    // ... rest of the function unchanged
}
```

### File: src/bot.ts — `ui:leaderboard` handler (line 910)

All users can VIEW the leaderboard — no change needed for display.

---

## Acceptance Criteria
- [ ] New users created with tier = 'NEWBIE' (not 'DEMO')
- [ ] Upgrade button shows "Contact support to get your token" instead of admin link
- [ ] Newbie can only run 1 concurrent trade; Pro can run up to 3
- [ ] Newbie sees only 3 pairs (EURUSD-OTC, GBPUSD-OTC, AUDUSD-OTC); Pro sees all 8
- [ ] Newbie always uses 6-round martingale; Pro has configurable rounds
- [ ] Only Pro users appear on the leaderboard; all users can view it
- [ ] Existing DEMO tier users still work unchanged
