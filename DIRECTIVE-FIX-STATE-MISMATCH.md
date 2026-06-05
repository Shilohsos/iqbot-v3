# DIRECTIVE: Fix onboarding state mismatch + gate brain

## Problems Found

1. **State mismatch on /start**
   - `sendStartMenu` sets `onboarding_state = 'entry'` for new users.
   - The text handler only checks for `awaiting_user_id`, `awaiting_email`, `awaiting_password`.
   - Users who send a User ID after seeing the intro are not caught by the User ID handler.

2. **LLM brain fires during setup**
   - Brain runs for any text not caught by earlier handlers.
   - Users with `entry` or old states (`entry_branch_sent`, etc.) hit the brain instead of the clean flow.

3. **Stale states exist in DB**
   - 24 users still have legacy states with no handlers.

## Changes

### 1. Fix `/start` to set `awaiting_user_id` directly

**File: `src/bot.ts`** — in `sendStartMenu`, replace the new-user block (~line 699):

```typescript
if (!user || user.approval_status === 'pending' || user.approval_status === 'manual') {
    setOnboardingState(ctx.from!.id, 'awaiting_user_id');   // ← changed from 'entry'
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

### 2. Gate the LLM brain to connected users only

**File: `src/bot.ts`** — in the text handler, wrap the brain call with a state check.

Replace the current brain section with:

```typescript
// ─── LLM brain — only for connected users ────────────────────────────────
const user = getUser(ctx.from!.id);
const state = user?.onboarding_state;

const isSetupState = state && ['entry', 'awaiting_user_id', 'awaiting_email', 'awaiting_password', 'new_account_created'].includes(state);

if (!isSetupState) {
    const brainWiz = wizardSessions.get(chatId);
    if (!brainWiz) {
        const brainCtx: UserContext = {
            onboarding_state: state ?? null,
            ssid_valid: user?.ssid_valid ?? null,
            has_ssid: !!user?.ssid,
            demo_trade_count: user ? getDemoTradeCount(user.telegram_id) : null,
            tier: user?.tier ?? 'DEMO',
        };
        const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(() => ({ flow: 'go_home', message: '', shouldReply: true }));
        if (brainResult.shouldReply) {
            const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.go_home;
            const replyText = brainResult.message || btn.text;
            const replyMarkup = typeof btn.action === 'string'
                ? { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] }
                : { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
            await ctx.reply(replyText, { reply_markup: replyMarkup });
        }
        return;
    }
}
```

This ensures the brain only activates for users who have finished onboarding (`connected` or no state).

### 3. (Optional) Clean up old states in DB

Run once via admin command or manually:

```sql
UPDATE users 
SET onboarding_state = 'awaiting_user_id' 
WHERE onboarding_state IN ('entry_branch_sent', 'new_user_watch_video', 'returning_user_ask_account', 'entry');
```

Or leave them — they will age out as users reconnect.

## Result

- New users land directly in `awaiting_user_id` state.
- Sending a User ID is always caught, whether they tap the button or type directly.
- Brain only responds to connected users.
- Old states are either migrated or ignored.

Send to Claude.