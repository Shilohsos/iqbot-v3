# DIRECTIVE: Restore account choice at /start

## Goal

Replace the bare "Send your User ID" welcome with a branded intro + account connection choice. Keep all the simplified architecture (no video, no branch questions, no re-engagement).

## New /start flow

**Message 1** (sent immediately):
```
I'm 10x Special Bot 💜

The smartest semi auto-trading bot for IQ Option OTC pairs.

I scan markets. I read signals. I place trades.
You sit back and watch the wins land.
```

**Message 2** (sent after Message 1):
```
Connect your IQ Option account.

Free signup · 60 seconds · Linked instantly.
Bot trades on your account. Money stays yours.

Pick what fits 👇
```
[✅ I have an IQ Option account] [🆕 Create Account]

**If "I have one" →** User ID prompt → verify → email → password → connected
**If "Create Account" →** affiliate link → come back → User ID prompt → verify → email → password → connected

## Changes

### 1. Replace /start handler

**File: `src/bot.ts`** — around line 695

Replace the current welcome block in `sendStartMenu` for new/pending/manual users:

```typescript
if (!user || user.approval_status === 'pending' || user.approval_status === 'manual') {
    setOnboardingState(ctx.from!.id, 'entry');
    await ctx.reply(
        "I'm 10x Special Bot 💜\n\n" +
        "The smartest semi auto-trading bot for IQ Option OTC pairs.\n\n" +
        "I scan markets. I read signals. I place trades.\n" +
        "You sit back and watch the wins land."
    );
    await ctx.reply(
        "Connect your IQ Option account.\n\n" +
        "Free signup · 60 seconds · Linked instantly.\n" +
        "Bot trades on your account. Money stays yours.\n\n" +
        "Pick what fits 👇",
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ I have an IQ Option account', callback_data: 'onboard:yes' },
                    { text: '🆕 Create Account', url: AFFILIATE_LINK },
                ]]
            }
        }
    );
    return;
}
```

### 2. Make `onboard:yes` handler work again (not a stub)

**File: `src/bot.ts`** — replace the current stub at line ~1135

```typescript
bot.action('onboard:yes', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    setOnboardingState(ctx.from!.id, 'awaiting_user_id');
    const msg = "Bet. Let's link it up.\n\nDrop your IQ Option User ID 👇";
    await ctx.reply(msg);
});
```

Keep `onboard:no` as a stub (it redirects to the URL button which already handles account creation). Or remove `onboard:no` handler entirely since the Create Account button is now a URL button, not a callback.

### 3. Keep `onboard:autocreate` stub

No change — it already shows "Contact admin" alert.

## What stays removed

- Welcome sequences (entry_welcome_1, entry_welcome_2)
- Branch questions (entry_branch_question, new vs experienced)
- Video step (new_trader_video, watched_video)
- Re-engagement loop
- Channel welcome DM
- Brain SSID pre-check
- All 3 duplicate flows (already merged into one)

## Testing

1. User sends /start → sees intro message → sees account connection choice
2. Taps "I have one" → User ID prompt → verify → email → password → connected
3. Taps "Create Account" → affiliate link → comes back → sends User ID → verify → email → password → connected
4. Old cached callbacks (`onboard:new`, `onboard:experienced`, etc.) → still redirect to /start
