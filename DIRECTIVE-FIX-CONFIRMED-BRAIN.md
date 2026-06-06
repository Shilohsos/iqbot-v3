# Wire brain into /confirmed flow's User ID step

## IMPORTANT: Merge master first

```bash
git checkout master && git pull origin master && git checkout -b claude/fix-confirmed-brain
```

## Problem

The `/confirmed` flow's `confirmed_user_id` step at `src/bot.ts:4493` only validates `{6,12}$/`. When the input fails validation (e.g. "I want to trade", "How"), it repeats the same hardcoded error. The LLM brain is never called, so the user gets stuck in an infinite error loop.

The **regular onboarding flow** (line 4345) already handles this correctly — it routes to `getBrainFlow` when the input isn't a valid User ID. The `/confirmed` flow needs the same treatment.

## Fix

**File:** `src/bot.ts` — around line 4493

**Current code:**
```typescript
        if (conn.step === 'confirmed_user_id') {
            const userId = text.trim();
            if (!/^\d{6,12}$/.test(userId)) {
                await ctx.reply('❌ Please send a valid IQ Option User ID (numbers only).');
                return;
            }
            conn.iqUserId = userId;
            ...
```

**Replace with:**
```typescript
        if (conn.step === 'confirmed_user_id') {
            const userId = text.trim();
            if (!/^\d{6,12}$/.test(userId)) {
                // Route to brain so it can understand the user is stuck
                const failCount = incrementUserIdFailCount(ctx.from!.id);
                const brainUser = getUser(ctx.from!.id);
                const brainCtx: UserContext = {
                    onboarding_state: 'awaiting_user_id',
                    ssid_valid: null,
                    has_ssid: false,
                    demo_trade_count: null,
                    tier: brainUser?.tier ?? 'DEMO',
                    is_activated: false,
                    user_id_fail_count: failCount,
                };
                const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(
                    () => ({ flow: 'help_contact', message: '', shouldReply: true })
                );
                if (brainResult.shouldReply && brainResult.flow && brainResult.flow !== 'flow_sleep' && brainResult.flow !== 'flow_done') {
                    const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
                    const replyText = brainResult.message || btn.text;
                    const replyMarkup = typeof btn.action === 'string'
                        ? { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] }
                        : { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
                    await ctx.reply(replyText, { reply_markup: replyMarkup });
                }
                return;
            }
            conn.iqUserId = userId;
            ...
```

This uses the exact same pattern as the regular onboarding flow at line 4345-4368, including `incrementUserIdFailCount` so the brain knows how many times the user has failed.

## Verification

1. Send `/confirmed` to the bot
2. Send "I want to trade" or "How" instead of a User ID
3. The brain should now respond with a helpful message instead of the same validation error
4. Check PM2 logs for `[brain]` entries to see the classification
