# DIRECTIVE: Fix Onboarding to Use sendTemplate (Enable Media/Images)

## Problem
`startNewOnboarding()` in `src/onboarding.ts` sends messages 1-3 using direct `ctx.reply()`, which does NOT check `templates.media_file_id` or `sequence_media`. So images stored in the Media Library for `entry_welcome_1`, `entry_welcome_2`, and `entry_branch_question` are never shown to users.

## Fix: Use sendTemplate instead of ctx.reply

In `src/onboarding.ts`, replace direct `ctx.reply()` calls with `sendTemplate()` for messages 1-3.

### Current code (lines 83-101):
```typescript
// Message 1
const t1 = getTemplateByKey('entry_welcome_1');
if (t1) await ctx.reply(resolveUsername(t1.message, name));
await delay(5_000);

// Message 2
const t2 = getTemplateByKey('entry_welcome_2');
if (t2) await ctx.reply(resolveUsername(t2.message, name));
await delay(5_000);

// Branch question
setOnboardingState(telegramId, 'entry_branch_sent');
const t3 = getTemplateByKey('entry_branch_question');
const branchMsg = t3 ? resolveUsername(t3.message, name) : 'Are you new to trading?';
await ctx.reply(branchMsg, {
    reply_markup: makeKeyboard([[
        { text: "I'm new to trading",    callback_data: 'onboard:new' },
        { text: 'I have traded before',  callback_data: 'onboard:experienced' },
    ]]),
});
```

### Replace with:
```typescript
// Message 1 — includes media from sequence_media or template
if (getTemplateByKey('entry_welcome_1')) {
    await sendTemplate(ctx, 'entry_welcome_1');
}
await delay(5_000);

// Message 2 — includes media
if (getTemplateByKey('entry_welcome_2')) {
    await sendTemplate(ctx, 'entry_welcome_2');
}
await delay(5_000);

// Branch question — text only, no media (buttons needed)
setOnboardingState(telegramId, 'entry_branch_sent');
const t3 = getTemplateByKey('entry_branch_question');
const branchMsg = t3 ? resolveUsername(t3.message, firstName(ctx)) : 'Are you new to trading?';
await ctx.reply(branchMsg, {
    reply_markup: makeKeyboard([[
        { text: "I'm new to trading",    callback_data: 'onboard:new' },
        { text: 'I have traded before',  callback_data: 'onboard:experienced' },
    ]]),
});
```

## Verification
- Send /start as a new user
- Welcome message (msg 1) should include the image stored in sequence_media for `entry_welcome_1`
- What bot does (msg 2) should include the image stored for `entry_welcome_2`
- Branch question (msg 3) remains text-only with buttons (no change)
