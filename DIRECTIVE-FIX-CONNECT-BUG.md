# Directive: Fix /connect broken by stale onboardSessions

## Problem
When a user's SSID is cleared (either manually or by the auto-promote background check), and they use `/connect` to re-login, the email input is intercepted by a stale `onboardSessions` entry and rejected with "Please enter a valid numeric IQ Option User ID."

## Root Cause
`bot.command('connect')` at line 2964 clears `upgradeSessions` but does not clear `onboardSessions`. If any prior session (e.g. abandoned `/start` onboarding, bot restart) left an `onboardSessions` entry with step `user_id` or `create_user_id`, the text handler's onboarding wizard check (line 3554) catches the email input before reaching the connect wizard (line 3693).

The text handler checks are ordered:
1. Admin wizard (line 3088)
2. Upgrade token entry (line 3532 — guarded by `!connectSessions.get(chatId)`)
3. **Onboarding wizard** (line 3554 — NOT guarded, catches all)
4. Connect wizard (line 3693 — never reached)

## Fix
Add `onboardSessions.delete(chatId)` to the `/connect` handler at line 2964, before setting the connect session:

```typescript
bot.command('connect', async ctx => {
    upgradeSessions.delete(ctx.chat.id);
    onboardSessions.delete(ctx.chat.id);  // ← ADD THIS
    if (ctx.from!.id === getAdminId()) {
        connectSessions.set(ctx.chat.id, { step: 'admin_email' });
        await ctx.reply('👑 *Admin Trading Account*\n\nEnter your IQ Option email:', { parse_mode: 'Markdown' });
        return;
    }
    connectSessions.set(ctx.chat.id, { step: 'email' });
    await ctx.reply('📧 Enter your IQ Option email:');
});
```

## Files to Modify
- `src/bot.ts` — one line addition at line 2965

## Testing
1. Simulate: trigger onboarding wizard for any user, abandon mid-flow, then use `/connect`
2. Verify email input goes to connect wizard (password prompt) instead of onboarding wizard (numeric ID error)
3. Verify normal `/connect` flow still works end-to-end

## Notes
- Do not modify the ordering of handlers in the text message handler (too risky)
- This is the minimal safe fix — clearing stale state at the `/connect` entry point
