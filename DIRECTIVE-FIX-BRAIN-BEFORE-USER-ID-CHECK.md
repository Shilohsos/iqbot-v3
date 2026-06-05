# DIRECTIVE-FIX-BRAIN-BEFORE-USER-ID-CHECK.md

## Problem

When a user enters `awaiting_user_id` state (by tapping "Trade Now" or via the onboarding flow), ALL text messages are treated as User ID input — including "Hi", "How do I do that", "Hello". The brain never fires because the `awaiting_user_id` handler at `src/bot.ts` line 4194 catches everything first.

This creates a trap: user asks a question → bot says "Please enter a valid IQ Option User ID" → user gets frustrated.

## Fix

In the `awaiting_user_id` handler, before treating the text as a User ID, check if the input looks like a User ID:
- Numeric
- 5+ digits

If it doesn't look like a User ID, delegate to the brain instead.

## Implementation

### `src/bot.ts` — `awaiting_user_id` handler (around line 4194)

**Current code:**
```typescript
if (onboardingState === 'awaiting_user_id') {
    touchOnboardingActivity(ctx.from!.id);
    const iqUserId = parseInt(text, 10);
    if (isNaN(iqUserId) || String(iqUserId).length < 5) {
        await ctx.reply('Please enter a valid IQ Option User ID (numeric).');
        return;
    }
    // ... verification logic ...
    return;
}
```

**New code:**
```typescript
if (onboardingState === 'awaiting_user_id') {
    touchOnboardingActivity(ctx.from!.id);
    
    // Check if input looks like a User ID (numeric, 5+ digits)
    const isUserId = /^\d{5,}$/.test(text.trim());
    
    if (!isUserId) {
        // Not a User ID — let the brain handle it
        const user = getUser(ctx.from!.id);
        const isActivated = user?.ssid_valid === 1 && !!user?.ssid;
        const brainCtx: UserContext = {
            onboarding_state: 'awaiting_user_id',
            ssid_valid: user?.ssid_valid ?? null,
            has_ssid: !!user?.ssid,
            demo_trade_count: user ? getDemoTradeCount(user.telegram_id) : null,
            tier: user?.tier ?? 'DEMO',
            is_activated: isActivated,
            user_id_fail_count: getUserIdFailCount(ctx.from!.id) ?? 0,
        };
        const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(
            () => ({ flow: 'help_contact', message: '', shouldReply: true })
        );
        if (brainResult.shouldReply && brainResult.flow) {
            const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
            const replyText = brainResult.message || btn.text;
            const replyMarkup = typeof btn.action === 'string'
                ? { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] }
                : { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
            await ctx.reply(replyText, { reply_markup: replyMarkup });
        }
        return;
    }
    
    const iqUserId = parseInt(text, 10);
    // ... rest of existing verification logic unchanged ...
```

**Import needed:** Add `getBrainFlow` and `UserContext` to the imports if not already available at the top of the file. They should already be imported (check line 113).

**Also add `getUserIdFailCount` if it doesn't exist in db.ts:**
```typescript
export function getUserIdFailCount(telegramId: number): number {
    const row = db.prepare('SELECT user_id_fail_count FROM onboarding_tracking WHERE telegram_id = ?').get(telegramId) as { user_id_fail_count: number } | undefined;
    return row?.user_id_fail_count ?? 0;
}
```

This should already exist — if not, add it.

## Deploy

1. `npm run build`
2. `pm2 restart iqbot-v3-bot --update-env`
3. Test: set a user to `awaiting_user_id`, send "Hi" → brain should respond instead of showing User ID error
