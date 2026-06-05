# Fix: Add pre-trade demo limit gate

## IMPORTANT: Merge master first

---

## Problem

When a demo user has already taken 10 trades today, clicking "Take a trade" → "Demo" still lets them place an 11th trade. The limit message only shows after the trade settles — too late.

## Fix

**File:** `src/bot.ts`

In the `mode:demo` handler (line 1195), check the daily demo count before advancing to the amount step:

```typescript
bot.action(/^mode:(demo|live)$/, async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'mode') return;
    const mode = ctx.match[1] as 'demo' | 'live';

    // Block demo trade if daily limit reached
    if (mode === 'demo') {
        const todayCount = getDailyDemoCount(ctx.from!.id);
        if (todayCount >= 10) {
            wizardSessions.delete(chatId);
            await showDemoLimitReached(ctx);
            return;
        }
    }

    state.mode = mode;
    state.step = 'amount';
    await ctx.reply('Enter amount', { reply_markup: amountKeyboard() });
});
```

That's it. `getDailyDemoCount` is already imported at the top of the file.

## Verification

- Demo user at 9/10 trades → clicks Demo → enters amount → trade 10 fires → limit shown after settle
- Demo user at 10/10 trades → clicks Demo → immediately shown limit reached → no trade possible
- Live trade is NOT affected
