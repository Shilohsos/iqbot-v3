# Fix: Double Send on Giveaway Join + Upgrade Flow

## Issue 1: Double-send when joining giveaway

### Problem
The `participate()` function in `src/giveaway.ts` does TWO things on join:
1. Calls `queueParticipantUpdate()` which queues a "joined" notification for 30s-5min later
2. Returns a success message that's shown immediately via callback

User receives: immediate "You've joined!" + delayed "You're in!" — duplicate.

### Fix
In `src/giveaway.ts`, remove the `queueParticipantUpdate()` call for "joined" events (around lines 184-187). The immediate response is sufficient.

Delete these lines:
```typescript
queueParticipantUpdate(
    giveawayId, participantId, telegramId, 'joined',
    `✅ You're in! *${event.title}*\\n\\n${count} participants so far. Good luck! 🍀`,
);
```

## Issue 2: Old upgrade/token flow still showing in most places

### Problem
The `ui:upgrade` handler (line 1372 in `bot.ts`) is the central handler ALL upgrade buttons point to. It still shows the OLD token entry flow:

```
Enter your upgrade token below to unlock PRO tier.
Don't have a token? Tap the button below to contact support.
[👤 Contact Support] [🔙 Back]
```

Users see "contact support for a token" instead of the new funding flow.

But the timeframe/pair locked feature prompts (lines 1095-1130) were already updated to show:
```
[💰 Fund Account]
[🔓 Upgrade with Token]
```

### Fix
Replace the `ui:upgrade` handler content with the NEW funding-first flow:

```typescript
bot.action('ui:upgrade', async ctx => {
    await ctx.answerCbQuery();
    connectSessions.delete(ctx.chat!.id);
    upgradeSessions.add(ctx.chat!.id);
    const tier = normalizeTier(getUser(ctx.from!.id)?.tier);
    const nextTier = tier === 'DEMO' ? 'PRO' : 'MASTER';
    const cost = nextTier === 'PRO' ? '$10' : '$50';
    const fundUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
    const adminLink = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
    await ctx.reply(
        `💡 *Upgrade Your Tier*\n\n` +
        `Fund your account with at least *${cost}* to automatically unlock *${nextTier}* tier.\n\n` +
        `You'll be upgraded instantly once your balance reaches this threshold.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Fund Account', url: fundUrl }],
                    [{ text: '🔓 Upgrade with Token', callback_data: 'ui:upgrade_token' }],
                    [{ text: '👤 Contact Admin', url: adminLink }],
                    [{ text: '🔙 Back', callback_data: 'ui:start' }],
                ],
            },
        }
    );
});
```

Then add a new `ui:upgrade_token` handler for users who still want to use token entry:

```typescript
bot.action('ui:upgrade_token', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `🔑 *Upgrade with Token*\n\n` +
        `Enter your upgrade token below to unlock *PRO* tier. ⚡\n\n` +
        `Don't have a token? Tap the button below to contact support.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👤 Contact Support', url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' }],
                    [{ text: '🔙 Back', callback_data: 'ui:upgrade' }],
                ],
            },
        }
    );
});
```

This keeps the old token flow accessible but makes the funding flow primary.

### Files to modify
- `src/giveaway.ts` — remove `queueParticipantUpdate()` for "joined" events
- `src/bot.ts` — replace `ui:upgrade` handler + add `ui:upgrade_token` handler
- Import `normalizeTier` and `getUser` in `bot.ts` if not already available at that scope

### Verification
1. Join a giveaway → only 1 confirmation message received (no duplicate)
2. Tap "Upgrade to PRO" or any locked feature → shows funding flow with `[💰 Fund Account]` as primary button
3. "Upgrade with Token" still accessible as secondary option
