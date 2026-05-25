# DIRECTIVE: Pick Winners — Add Confirmation Step

## Problem
Clicking "🏆 Pick Winners" on giveaway detail immediately selects winners, sends notifications, and marks the giveaway completed — no confirmation, no review, no undo. One misclick and it's done.

## Fix
Add a **two-step confirmation flow** to `bot.action(/^giveaway_winners:(\d+)$/, ...)` (line 2300):

### Step 1: Confirmation prompt
Instead of immediately picking winners, show a confirmation dialog:
```ts
bot.action(/^giveaway_winners:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const giveawayId = parseInt(ctx.match[1], 10);
    const event = getGiveawayEvent(giveawayId);
    if (!event) { await ctx.reply('❌ Giveaway not found.'); return; }
    
    // Show confirmation with winner count
    await ctx.reply(
        `🏆 *Pick Winners?*\n\n` +
        `Giveaway: *${event.title}*\n` +
        `Max winners: ${event.max_winners}\n` +
        `Participants: check before confirming\n\n` +
        `This will select up to ${event.max_winners} winners and notify them.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `✅ Confirm — Pick ${event.max_winners} Winners`, callback_data: `giveaway_winners_confirm:${giveawayId}` }],
                    [{ text: '🔙 Cancel', callback_data: `giveaway_view:${giveawayId}` }],
                ],
            },
        }
    );
});
```

### Step 2: Actual pick
```ts
bot.action(/^giveaway_winners_confirm:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('🏆 Selecting winners…');
    const giveawayId = parseInt(ctx.match[1], 10);
    const winners = giveawaySelectWinners(giveawayId);
    // ... existing confirmation message
});
```

## Also
- Show participant count in the confirmation dialog so admin knows the pool size
- If 0 eligible participants, show error BEFORE confirmation (keep current check)
- Keep existing "Winner notifications queued" message after confirmation
