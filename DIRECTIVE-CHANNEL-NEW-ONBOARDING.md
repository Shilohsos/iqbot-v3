# Directive: Fix Channel Join Onboarding — Use New Template-Based Flow

**IMPORTANT: Merge master first**

## Problem

The channel join handler in `src/channel.ts` uses a **hardcoded old onboarding flow** (L1.png, L3.png, `onboardKeyboard()` with "I have an account" / "Create one free" buttons). The `/start` path uses the new template-based flow (`startNewOnboarding` in `onboarding.ts` with `entry_welcome_1`, `entry_welcome_2`, `entry_branch_question` and "I'm new to trading" / "I have traded before" buttons).

Channel join users get the old flow. They should get the same template-based flow as `/start`.

## Changes Required

### `src/onboarding.ts` — Add a Telegram-only version of onboarding

Add a new exported function `sendNewOnboardingViaTelegram()` that sends the same template-based flow using a bare Telegram object (no Context needed):

```typescript
/**
 * Send the new template-based onboarding flow using a bare Telegram object.
 * Used by the channel join handler which doesn't have a Context.
 */
export async function sendNewOnboardingViaTelegram(
    telegram: Telegraf['telegram'],
    userId: number,
    firstName: string,
): Promise<void> {
    if (getConfig('features_paused') === '1') return;
    
    const sendTemplateTelegram = async (key: string, extraKeyboard?: { inline_keyboard: Btn[][] }) => {
        const t = getTemplateByKey(key);
        if (!t) return;
        const msg = resolveUsernameTemplate(t.message, firstName);
        const markup = extraKeyboard ?? (
            t.button_text && t.button_url
                ? { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] }
                : undefined
        );
        
        // Look up sequence_media
        let mediaFileId: string | undefined;
        let mediaType = 'photo';
        const seq = getSequenceMedia(key);
        if (seq) { mediaFileId = seq.file_id; mediaType = seq.media_type; }
        
        if (mediaFileId && mediaType === 'video') {
            await telegram.sendVideo(userId, mediaFileId, { caption: msg, ...(markup ? { reply_markup: markup } : {}) });
        } else if (mediaFileId) {
            await telegram.sendPhoto(userId, mediaFileId, { caption: msg, ...(markup ? { reply_markup: markup } : {}) });
        } else {
            await telegram.sendMessage(userId, msg, { ...(markup ? { reply_markup: markup } : {}) });
        }
    };
    
    setOnboardingState(userId, 'entry_branch_sent');
    
    // Message 1 — entry_welcome_1 with media
    await sendTemplateTelegram('entry_welcome_1');
    await delay(5_000);
    
    // Message 2 — entry_welcome_2 with media
    await sendTemplateTelegram('entry_welcome_2');
    await delay(5_000);
    
    // Branch question with buttons
    const t3 = getTemplateByKey('entry_branch_question');
    const branchMsg = t3 ? resolveUsernameTemplate(t3.message, firstName) : 'Are you new to trading?';
    await telegram.sendMessage(userId, branchMsg, {
        reply_markup: {
            inline_keyboard: [[
                { text: "I'm new to trading",    callback_data: 'onboard:new' },
                { text: 'I have traded before',  callback_data: 'onboard:experienced' },
            ]],
        },
    });
    
    console.log(`[channel] new onboarding sent to ${userId}`);
}
```

You will also need to add these to the function signatures at the top of onboarding.ts:
- `getSequenceMedia` from `./db.js` (likely already imported but check)
- `resolveUsernameTemplate` (same)
- `Btn` type for the keyboard

Add the import for `Telegraf` type at the top:
```typescript
import { Telegraf } from 'telegraf';
```

### `src/channel.ts` — Replace old onboarding with new

**Before** (the entire `sendOnboarding` function, lines 58-83):
```typescript
async function sendOnboarding(telegram: Telegraf['telegram'], userId: number): Promise<void> {
    try {
        // L1 — Welcome brand intro
        try { await telegram.sendPhoto(userId, { source: `${ASSETS_DIR}/L1.png` }); } catch {}
        await telegram.sendMessage(userId,
            `I'm 10x Special Bot.\n\n` +
            `The smartest semi auto-trading bot for IQ Option OTC pairs.\n\n` +
            `I scan markets. I read signals. I place trades.\n` +
            `You sit back and watch the wins land.`
        );

        // L3 — Link Your Account
        try { await telegram.sendPhoto(userId, { source: `${ASSETS_DIR}/L3.png` }); } catch {}
        await telegram.sendMessage(userId,
            `Connect your IQ Option account.\n\n` +
            `Free signup · 60 seconds · Linked instantly.\n` +
            `Bot trades on your account. Money stays yours.\n\n` +
            `Pick what fits 👇`,
            { reply_markup: onboardKeyboard() }
        );

        console.log(`[channel] onboarding sent to ${userId}`);
        insertFunnelEvent('channel_welcome_sent', JSON.stringify({ telegram_id: userId }));
    } catch (err) {
        console.error(`[channel] failed to send onboarding to ${userId}:`, err instanceof Error ? err.message : err);
    }
}
```

**After:**
```typescript
async function sendOnboarding(telegram: Telegraf['telegram'], userId: number): Promise<void> {
    try {
        const firstName = 'there'; // fallback — we don't have the full user object here
        await sendNewOnboardingViaTelegram(telegram, userId, firstName);
        insertFunnelEvent('channel_welcome_sent', JSON.stringify({ telegram_id: userId }));
    } catch (err) {
        console.error(`[channel] failed to send onboarding to ${userId}:`, err instanceof Error ? err.message : err);
    }
}
```

Also remove the now-unused imports from channel.ts: `onboardKeyboard` from `'./ui/user.js'` and `ASSETS_DIR`.

### Import updates

In `src/channel.ts`, change the import from:
```typescript
import { onboardKeyboard } from './ui/user.js';
```
to:
```typescript
import { sendNewOnboardingViaTelegram } from './onboarding.js';
```

Remove `ASSETS_DIR` since it's no longer used in channel.ts.

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Join the Telegram channel with a fresh account → should receive the same template-based onboarding as /start (entry_welcome_1 with image, entry_welcome_2 with image, branch question with "I'm new" / "I have traded before" buttons)
3. Clicking "I'm new" → should proceed through the new template-based flow
4. Clicking "I have traded before" → same

## Migration

No DB changes needed. Templates and sequence_media already exist from the earlier seed.
