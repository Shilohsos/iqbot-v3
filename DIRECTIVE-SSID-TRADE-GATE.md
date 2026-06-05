# Directive: Check SSID Validity Before Showing Trade Options

**IMPORTANT: Merge master first**

## Problem

The bot shows "Trade Live / Trade Demo" buttons regardless of SSID validity. User clicks → SDK fails → "Could not connect to IQ Option." → buttons remain → user clicks again → infinite fail loop.

## Root Cause

Two entry points to the trade menu never check SSID validity:

1. **`bot.action('ui:trade')`** (line 1589) — shows trade options after `requireApproval` but without checking if user's SSID is valid
2. **`bot.command('trade')`** (line 1844) — same issue for non-admin users

The existing SSID check (line 1828-1834) only handles the admin case and only checks `!ssid` (existence), not `ssid_valid` (whether it's expired).

## Changes Required

### 1. Add SSID validity check to `bot.action('ui:trade')` in `src/bot.ts`

**Current code (lines 1589-1596):**
```typescript
bot.action('ui:trade', async ctx => {
    await ctx.answerCbQuery();
    if (!await requireApproval(ctx)) return;
    const state: WizardState = { step: 'mode' };
    try { const m = await ctx.replyWithPhoto(ASSET('L4.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(ctx.chat!.id, state);
    await ctx.reply('Trade live | Trade Demo', { reply_markup: tradeModeKeyboard() });
});
```

**Replacement code:**
```typescript
bot.action('ui:trade', async ctx => {
    await ctx.answerCbQuery();
    if (!await requireApproval(ctx)) return;

    // Check SSID validity before showing trade options
    const user = getUser(ctx.from!.id);
    if (user?.ssid && user.ssid_valid === 0) {
        await ctx.reply(
            '🔌 Your IQ Option session expired. Reconnect to continue trading 👇',
            { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
        );
        return;
    }

    const state: WizardState = { step: 'mode' };
    try { const m = await ctx.replyWithPhoto(ASSET('L4.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(ctx.chat!.id, state);
    await ctx.reply('Trade live | Trade Demo', { reply_markup: tradeModeKeyboard() });
});
```

### 2. Add SSID validity check to `bot.command('trade')` in `src/bot.ts`

**Current code (lines 1826-1844):**
```typescript
bot.command('trade', async ctx => {
    if (ctx.from!.id === getAdminId()) {
        const ssid = getAdminSsid();
        if (!ssid) {
            await ctx.reply(
                '⚠️ No IQ Option account connected.\nUse /connect to link your trading account.',
                { reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'admin:trade_connect' }]] } }
            );
            return;
        }
        wizardSessions.set(ctx.chat.id, { step: 'amount', mode: 'live' });
        await ctx.reply('Enter trade amount (USD):', { reply_markup: amountKeyboard() });
        return;
    }
    if (!await requireApproval(ctx)) return;
    const state: WizardState = { step: 'mode' };
    try { const m = await ctx.replyWithPhoto(ASSET('L4.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(ctx.chat.id, state);
    await ctx.reply('Trade live | Trade Demo', { reply_markup: tradeModeKeyboard() });
});
```

**Replacement code:**
```typescript
bot.command('trade', async ctx => {
    const telegramId = ctx.from!.id;
    if (telegramId === getAdminId()) {
        const ssid = getAdminSsid();
        if (!ssid) {
            await ctx.reply(
                '⚠️ No IQ Option account connected.\nUse /connect to link your trading account.',
                { reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'admin:trade_connect' }]] } }
            );
            return;
        }
        wizardSessions.set(ctx.chat.id, { step: 'amount', mode: 'live' });
        await ctx.reply('Enter trade amount (USD):', { reply_markup: amountKeyboard() });
        return;
    }
    if (!await requireApproval(ctx)) return;

    // Check SSID validity before showing trade options
    const user = getUser(telegramId);
    if (user?.ssid && user.ssid_valid === 0) {
        await ctx.reply(
            '🔌 Your IQ Option session expired. Reconnect to continue trading 👇',
            { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
        );
        return;
    }

    const state: WizardState = { step: 'mode' };
    try { const m = await ctx.replyWithPhoto(ASSET('L4.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(ctx.chat.id, state);
    await ctx.reply('Trade live | Trade Demo', { reply_markup: tradeModeKeyboard() });
});
```

## Edge Cases Covered

| Scenario | Behavior |
|----------|----------|
| User has valid SSID | Shows Trade Live / Trade Demo as before |
| User has expired SSID (ssid_valid=0) | Shows reconnect prompt with button |
| User has no SSID at all (null) | Falls through — shows trade options (handled by wizard error later) |
| Admin with no SSID | Shows existing "No account connected" message |
| Admin with valid SSID | Shows existing direct amount entry |
| User clicks /trade after expiry | Shows reconnect, not trade buttons |

## Verification

1. Find a user in DB with `ssid NOT NULL AND ssid_valid = 0`
2. Click "Start Trading" → must see reconnect prompt, not trade buttons
3. Click `/trade` as same user → must see reconnect prompt
4. User with valid SSID → must see trade options as before (no regression)
5. `npx tsc --noEmit` — must pass with zero errors
