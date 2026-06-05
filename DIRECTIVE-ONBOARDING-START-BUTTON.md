# DIRECTIVE: Replace branch question buttons with single /start URL button

## Problem

When users join the Telegram channel, the bot sends onboarding via `sendNewOnboardingViaTelegram`. The branch question message has two callback buttons ("I'm new to trading" / "I've traded before"). Tapping these produces a 403 error ("bot can't initiate conversation") because the user never DM'd the bot directly — callback buttons only work in active DM conversations.

The 403 catch + popup approach was rejected. Instead:

**The branch question message in the channel should have ONLY a single "🚀 Start Bot" URL button.** No callback buttons. The user taps the URL button, it opens the bot DM with `/start onboard`, the bot shows the branch question there where callback buttons work properly.

## Changes Required

### 1. `src/onboarding.ts` — `sendNewOnboardingViaTelegram`

Replace the message that sends `entry_branch_question` template. Currently it renders the template with 2 callback buttons. Change it to:

- Send the **text** of `entry_branch_question` only (the question text)
- Add **ONE inline keyboard row** with a single URL button: `🚀 Start Bot → https://t.me/Shiloh10xbot?start=onboard`

**Do NOT** send the callback buttons (`onboard:new`, `onboard:experienced`).

```typescript
// In sendNewOnboardingViaTelegram, replace the branch question message:
const branchText = templates.get('entry_branch_question')?.message || 'Are you new to trading?';

ctx.telegram.sendMessage(chatId, branchText, {
  reply_markup: {
    inline_keyboard: [[
      { text: '🚀 Start Bot', url: 'https://t.me/Shiloh10xbot?start=onboard' }
    ]]
  }
});
```

### 2. `src/bot.ts` — /start handler with `onboard` payload

The bot already has a /start handler. Ensure that when `/start onboard` is received:

1. If user has an existing `onboarding_state` (from channel join), call `resumeOnboarding(ctx, userId)` which re-sends the branch question with working callback buttons.
2. If no existing state, start fresh onboarding with `startOnboarding(ctx, userId)`.

The `resumeOnboarding` function already exists and sends the branch question with the 2 callback buttons — this is correct because in DM context the callbacks WILL work.

### 3. `src/onboarding.ts` — 403 catch removal

The previously added 403 catches in `sendNewOnboardingViaTelegram` for the branch question callbacks are no longer needed since there are no callback buttons on this message. Remove them.

## Testing

1. Channel join → receive onboarding → reach branch question → see only "🚀 Start Bot" button
2. Tap "🚀 Start Bot" → opens bot DM with `/start onboard`
3. Bot shows "I'm new / I've traded before" with working callback buttons
4. Tapping either button works (no 403)
