# DIRECTIVE: Fix onboarding flow for "Need a new account" branch

## Problem Summary

Three bugs in the "Need a new account" / User ID verification / Reconnect chain:

1. **Missing User ID instructions after Create Account** — `experienced_need_new` template has a Create Account button but no step-by-step guide on how to find and send their User ID afterward. State is immediately set to `awaiting_user_id`, so any text the user types gets rejected as "not a valid User ID."

2. **`ui:connect` doesn't clear `onboarding_state`** — When User ID fails twice, the brain routes to reconnect. The `ui:connect` callback sets `connectSessions` but does NOT change `onboarding_state`. User's state remains `awaiting_user_id`. When they type their email, the `awaiting_user_id` text handler (line 4282) catches it first and says "Please enter a valid IQ Option User ID" — the connect flow at line 4526 never runs.

3. **User ID `193122330` fails `checkAffiliate`** — The affiliate API returns `found: false` for this User ID. This is a separate data issue but the flow should handle it more gracefully.

## Changes Required

### Fix 1: Two-step flow for "Need a new account"

**File: `src/onboarding.ts`**

Change `handleNeedAccount` (line 148-151) to use a new state instead of jumping directly to `awaiting_user_id`:

```typescript
/** Handler for onboard:need_account */
export async function handleNeedAccount(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'new_account_created');  // NEW state
    await sendTemplate(ctx, 'experienced_need_new');
}
```

Then add a text handler for `new_account_created` state in `src/bot.ts` BEFORE the existing `awaiting_user_id` check (insert at line 4281, before the existing `if (onboardingState === 'awaiting_user_id')` block):

```typescript
// ── New: handle "Need a new account" → user created account → now guide them on User ID ──
if (onboardingState === 'new_account_created') {
    touchOnboardingActivity(ctx.from!.id);
    // User came back after creating account — guide them to send their User ID
    setOnboardingState(ctx.from!.id, 'awaiting_user_id');
    const name = firstName(ctx);
    const t = getTemplateByKey('after_video_account');
    const msg = t ? resolveUsername(t.message, name) : `Let's get this money ${name}. 💜\n\nDrop your IQ Option User ID below 👇`;
    await ctx.reply(msg);
    return;
}
```

Also update `resumeOnboarding` in `src/onboarding.ts` (around line 270) to handle the new state:

```typescript
if (state === 'new_account_created') {
    await sendTemplate(ctx, 'experienced_need_new');
    return;
}
```

**File: Template DB seed**

Update the `experienced_need_new` template message to make it clear the user should come back after creating the account (the message text should NOT include User ID instructions since the next step handles that):

```
No problem @username. 💜

Tap the button below to create your free IQ Option account. I'll wait right here 👇
```

The existing Create Account button stays.

### Fix 2: `ui:connect` must set `onboarding_state` to `awaiting_email`

**File: `src/bot.ts`**

Change the `ui:connect` handler (line 1668-1672):

```typescript
bot.action('ui:connect', async ctx => {
    await ctx.answerCbQuery();
    connectSessions.set(ctx.chat!.id, { step: 'email' });
    setOnboardingState(ctx.from!.id, 'awaiting_email');  // ADD THIS
    await ctx.reply('📧 Enter your IQ Option email:');
});
```

This ensures that when a user taps Reconnect/Connect, their `onboarding_state` is set to `awaiting_email` so the text handler at line 4317 catches their email input and routes it through the proper email → password → login flow. Without this, the stale `awaiting_user_id` state catches the email and blocks the flow.

Also ensure the `awaiting_email` handler (line 4317-4324) cleans up any stale `connectSessions` entry to avoid double-processing:

```typescript
if (onboardingState === 'awaiting_email') {
    touchOnboardingActivity(ctx.from!.id);
    connectSessions.delete(chatId);  // ADD THIS — clean up stale connect session
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
    if (!emailOk) { await ctx.reply('That doesn\'t look like a valid email address. Try again 👇'); return; }
    onboardSessions.set(chatId, { step: 'connect_email', email: text.trim() });
    await handleEmailCollected(ctx, ctx.from!.id);
    return;
}
```

### Fix 3: Better handling of User ID that fails checkAffiliate

**File: Template DB seed**

Update `verify_fail_2` template to offer more direct help:

```
Still not matching @username. Did you create your account through the link we provided?

1️⃣ Tap the Create Account button below
2️⃣ Use the same email you signed up with
3️⃣ Send your new User ID here 👇
```

With a Create Account button attached.

## Testing

1. User clicks "Need a new one" → sees Create Account button with "I'll wait right here" text
2. User creates account, comes back, types anything → sees User ID step-by-step instructions
3. User sends their User ID → verification flow works
4. If verification fails 2x → brain routes to reconnect → user taps Reconnect → enters email → enters password → connected successfully
5. No "Please enter a valid IQ Option User ID" when typing email after tapping Reconnect
