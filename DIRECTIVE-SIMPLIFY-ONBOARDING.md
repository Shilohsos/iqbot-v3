# DIRECTIVE: Simplify onboarding — eliminate redundant session maps

## Goal

Remove the 3 duplicate email/password collection paths and the brain pre-check override that ignores context. One state machine (`onboarding_state`), one text handler chain.

## Changes

### 1. Remove dead old onboarding wizard

**File: `src/bot.ts`** — Delete lines 4386–4523 (the entire `onboardSessions` wizard block).

This code is unreachable:
- `askAccountConnection()` (line 822) is defined but never called
- `hasAccountKeyboard()` in `menu.ts` is defined but never called
- `onboard:yes` / `onboard:no` callbacks have no trigger path
- No template uses these old callback IDs

Keep the callback action handlers for `onboard:yes`, `onboard:no`, and `onboard:autocreate` (lines 1160–1220) as redirect stubs so any user with a cached old keyboard doesn't get "unknown action":

```typescript
// Old callback stubs — redirect to new onboarding
bot.action('onboard:yes', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await startOnboarding(ctx);
});
bot.action('onboard:no', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await startOnboarding(ctx);
});
bot.action('onboard:autocreate', async ctx => {
    await ctx.answerCbQuery('Contact admin to create an account 👇💜', { show_alert: true }).catch(() => {});
});
```

### 2. Clean up dead menu functions

**File: `src/menu.ts`** — Delete `hasAccountKeyboard()` function (lines 91–98). It is never called.

**File: `src/ui/user.ts`** — Delete `onboardKeyboard()` function (lines 37–44). It is never called. Also remove the import from `bot.ts` line 94 if no longer used.

### 3. Merge standalone connect into onboarding state

**File: `src/bot.ts`** — In the `ui:connect` handler (line 1668–1672), add `setOnboardingState`:

```typescript
bot.action('ui:connect', async ctx => {
    await ctx.answerCbQuery();
    connectSessions.set(ctx.chat!.id, { step: 'email' });
    setOnboardingState(ctx.from!.id, 'awaiting_email');  // ADD THIS
    await ctx.reply('📧 Enter your IQ Option email:');
});
```

This ensures that when a user taps Reconnect/Connect, their `onboarding_state` is set to `awaiting_email` so the text handler at line 4317 catches their email input and routes through the proper email → password → login flow, instead of being caught by a stale `awaiting_user_id` state.

Also add `connectSessions.delete()` in the `awaiting_email` handler (line 4317) to clean up stale entries:

```typescript
if (onboardingState === 'awaiting_email') {
    touchOnboardingActivity(ctx.from!.id);
    connectSessions.delete(chatId);  // ADD THIS
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
    ...
```

The `connectSessions` wizard for regular users (lines 4562–4599, `conn.step === 'email'` and `conn.step === 'password'`) becomes unreachable once `ui:connect` sets `onboarding_state`. Keep the `admin_email` / `admin_password` paths (lines 4529–4561) — they're the admin trading account connect flow, separate from user onboarding.

### 4. Remove brain pre-check SSID override

**File: `src/classifier.ts`** — Remove lines 162–170 (the hardcoded pre-check that returns `reconnect` for any user without SSID).

This pre-check was designed to block the brain from processing messages from disconnected users. But it fires even when the user is mid-onboarding (no SSID yet = normal) or stuck on User ID verification. It should trust the `UserContext` that was already carefully constructed by the caller.

Without this pre-check, the LLM will actually read the context passed to it (including `onboarding_state`, `user_id_fail_count`, etc.) and route appropriately — e.g., User ID failures → account creation help, connected user wanting to trade → reconnect prompt.

## File Size Impact
- Old wizard deletion: ~ -100 lines
- Dead menu functions: ~ -15 lines
- Brain pre-check: ~ -9 lines
- Additions (state set + cleanup): ~ +10 lines
- **Net: ~ -114 lines of code**

## Testing
1. New user joins → onboarding flow works through all paths
2. User taps "Need a new one" → Create Account → User ID instructions → sends User ID → verified
3. User taps old `onboard:yes` from a cached keyboard → redirects to new onboarding
4. User fails User ID 2x → brain sees context → offers relevant help (not hardcoded reconnect)
5. User taps Reconnect → enters email → enters password → logged in successfully
6. Admin trading account connect still works via `connectSessions.admin_email`
