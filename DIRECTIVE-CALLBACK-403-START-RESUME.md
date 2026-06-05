# Directive: 403-Safe Callback Handlers with /start Resume

## IMPORTANT: Merge master first
```
git checkout master && git pull origin master
git checkout -b claude/callback-403-start-resume-UwN4O
```

---

**Problem:** When a user joins via channel, the bot sends onboarding (join request context allows it). But when the user taps a callback button, `ctx.reply()` in the handler fails with `403: Forbidden: bot can't initiate conversation with a user`. The button loading stops but no message appears.

**Fix:** Catch 403 in onboarding callback handlers. The state is already saved (DB write before send attempt). Show an alert telling the user to `/start`. When they do, `resumeOnboarding()` picks up from the correct state.

---

## Change 1: Update the `onboard:new` handler

**File:** `src/bot.ts`, around line 1205

**Current:**
```typescript
bot.action('onboard:new', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    await handleNewTrader(ctx, telegramId);
});
```

**New:**
```typescript
bot.action('onboard:new', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    try {
        await handleNewTrader(ctx, telegramId);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('403') || msg.includes("can't initiate conversation")) {
            // State is already updated by handleNewTrader — /start will resume
            await ctx.answerCbQuery(
                '✅ Got it! Send /start to continue ▶️',
                { show_alert: true }
            ).catch(() => {});
        }
    }
});
```

---

## Change 2: Update the `onboard:experienced` handler

**File:** `src/bot.ts`, around line 1213

**Current:**
```typescript
bot.action('onboard:experienced', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    await handleExperiencedTrader(ctx, telegramId);
});
```

**New:**
```typescript
bot.action('onboard:experienced', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    try {
        await handleExperiencedTrader(ctx, telegramId);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('403') || msg.includes("can't initiate conversation")) {
            await ctx.answerCbQuery(
                '✅ Got it! Send /start to continue ▶️',
                { show_alert: true }
            ).catch(() => {});
        }
    }
});
```

---

## Change 3: Update other onboarding callback handlers

Apply the same try/catch pattern to these handlers (same file):

- `onboard:watched_video` (line 1221)
- `onboard:have_account` (line 1229)
- `onboard:need_account` (line 1237)
- `onboard:yes` (line 1160)
- `onboard:no` (line 1177)
- `onboard:autocreate` (line 1189)

Each follows the same pattern: try the handler, catch 403, show alert to /start.

---

## Why this works

The key insight: `handleNewTrader` / `handleExperiencedTrader` call `setOnboardingState()` **before** `sendTemplate()`. The DB write always succeeds. So even when `sendTemplate()` fails with 403, the user's state is already at the correct next step.

When they send `/start`:
1. `sendStartMenu(ctx)` runs
2. User has no SSID → `startOnboarding(ctx)` is called
3. `startOnboarding` sees `onboarding_state != 'entry'` → calls `resumeOnboarding(ctx, telegramId)`
4. `resumeOnboarding` detects the state (e.g. `new_user_watch_video`) and sends the correct template

The `/start` message itself is a user-initiated message, so `ctx.reply()` in the handler is **not** blocked by privacy settings — the user literally messaged the bot.

---

## Verification

1. Build: `npx tsc --noEmit`
2. Restart: `pm2 restart iqbot-v3-bot --update-env`
3. Test as a fresh user who joined via channel:
   - Tap "I'm new to trading" → should see popup: "✅ Got it! Send /start to continue ▶️"
   - Send `/start` → should see `new_trader_video` template with "✅ I've watched it" button
   - Tap "✅ I've watched it" → should see User ID prompt
4. Verify existing users (who have messaged the bot before) still work normally — 403 is only caught when it happens, normal flow continues otherwise
