# Directive: No Silent Dead Ends — Every User Interaction Gets a Response

**IMPORTANT: Merge master first**

## Root Cause

`/start` goes silent for mid-onboarding users because of this code in `bot.ts`:

```typescript
// bot.ts:811
if (user?.onboarding_state && user.onboarding_state !== 'entry') return;
```

When user clicks `/start`:
1. `bot.command('start')` → `sendStartMenu()`
2. User exists + approval_status is 'pending' → `startOnboarding(ctx)`
3. Line 811 sees `onboarding_state` is set and not 'entry' → **silent return** — no message sent
4. The LLM brain never fires because `/start` is intercepted by the command handler before reaching the generic text handler

## Changes Required

### 1. Add `resumeOnboarding()` to `src/onboarding.ts`

**Add this export** after the existing `getReengageTemplateKey` function (around line 255):

```typescript
/**
 * Send a contextual resume prompt when user clicks /start mid-onboarding.
 * Uses the original step templates so the user knows exactly what to send.
 */
export async function resumeOnboarding(
    ctx: Context,
    telegramId: number,
): Promise<void> {
    const user = getUser(telegramId);
    const state = user?.onboarding_state ?? 'entry';

    // For input-awaiting states, re-send the step's prompt template
    if (state === 'awaiting_user_id' && getTemplateByKey('after_video_account')) {
        await sendTemplate(ctx, 'after_video_account');
        return;
    }
    if (state === 'awaiting_email' && getTemplateByKey('verify_success')) {
        await sendTemplate(ctx, 'verify_success');
        return;
    }
    if (state === 'awaiting_password' && getTemplateByKey('awaiting_password')) {
        await sendTemplate(ctx, 'awaiting_password');
        return;
    }

    // For branch/choice states, re-send the question with original buttons
    if (state === 'entry_branch_sent' && getTemplateByKey('entry_branch_question')) {
        await sendTemplate(ctx, 'entry_branch_question', makeKeyboard([[
            { text: "I'm new to trading",    callback_data: 'onboard:new' },
            { text: 'I have traded before',  callback_data: 'onboard:experienced' },
        ]]));
        return;
    }
    if (state === 'new_user_watch_video' && getTemplateByKey('new_trader_video')) {
        await sendTemplate(ctx, 'new_trader_video', makeKeyboard([[
            { text: "✅ I've watched it", callback_data: 'onboard:watched_video' },
        ]]));
        return;
    }
    if (state === 'returning_user_ask_account' && getTemplateByKey('experienced_branch')) {
        await sendTemplate(ctx, 'experienced_branch', makeKeyboard([[
            { text: '✅ I have one',      callback_data: 'onboard:have_account' },
            { text: '🆕 Need a new one', callback_data: 'onboard:need_account' },
        ]]));
        return;
    }

    // Fallback to re-engagement templates for any other state
    const reengageKey = getReengageTemplateKey(state);
    if (getTemplateByKey(reengageKey)) {
        await sendTemplate(ctx, reengageKey);
        return;
    }

    // Last resort — always respond
    const name = ctx.from?.first_name ?? 'there';
    await ctx.reply(`@${name} you're still in the setup process! Check the messages above and continue where you left off 👇`);
}
```

### 2. Update `startOnboarding()` in `src/bot.ts`

**Replace lines 809-812** (the `onboarding_state` guard):

**Current:**
```typescript
    // If user already has an onboarding state in progress, don't restart from scratch
    if (user?.onboarding_state && user.onboarding_state !== 'entry') return;
    await startNewOnboarding(ctx, telegramId);
```

**Replacement:**
```typescript
    // If user already has an onboarding state in progress, send a resume prompt
    if (user?.onboarding_state && user.onboarding_state !== 'entry') {
        await resumeOnboarding(ctx, telegramId);
        return;
    }
    await startNewOnboarding(ctx, telegramId);
```

### 3. Update imports in `src/bot.ts`

Find the onboarding imports line (~113-118) and add `resumeOnboarding`:

```typescript
import {
    startNewOnboarding, handleNewTrader, handleWatchedVideo,
    handleExperiencedTrader, handleHaveAccount, handleNeedAccount,
    handleUserIdVerified, handleUserIdFailed, handleEmailCollected,
    handleConnected, checkFundingSequence, getReengageTemplateKey,
    resumeOnboarding,
} from './onboarding.js';
```

## How It Works

| Scenario | Before | After |
|----------|--------|-------|
| User clicks /start mid-onboarding (awaiting_user_id) | Silent — bot does nothing | ✅ "Drop your IQ Option User ID 🆔" |
| User clicks /start mid-onboarding (entry_branch_sent) | Silent — bot does nothing | ✅ Branch question re-sent with buttons |
| User clicks /start mid-onboarding (new_user_watch_video) | Silent — bot does nothing | ✅ "I've watched it" button re-sent |
| User clicks /start mid-onboarding (returning_user_ask_account) | Silent — bot does nothing | ✅ "I have one" / "Need a new one" re-sent |
| User clicks /start mid-onboarding (awaiting_email) | Silent — bot does nothing | ✅ Enter your email prompt re-sent |
| User clicks /start mid-onboarding (awaiting_password) | Silent — bot does nothing | ✅ Enter your password prompt re-sent |
| User clicks /start mid-onboarding (unknown state) | Silent — bot does nothing | ✅ Re-engagement template or generic message |
| User sends text message during onboarding | LLM brain catches it | ✅ Same — no change needed |

## Verification

1. Create a test user who has `onboarding_state = 'awaiting_user_id'` in the DB
2. Send `/start` → must receive the User ID prompt message
3. Send `/start` with `onboarding_state = 'entry_branch_sent'` → must receive branch question with buttons
4. Send `/start` with `onboarding_state = 'awaiting_email'` → must receive email prompt
5. No `/start` click should ever result in silence for any onboarding state
