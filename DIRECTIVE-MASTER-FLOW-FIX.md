# Master Fix: Onboarding Flow Bugs

**IMPORTANT: Merge master first** — this branch may not include latest master.

This directive supersedes `DIRECTIVE-FIX-CONNECT-BUTTON.md`.

---

## Bug #1 — "Connect IQ Option" Button Wrong Callback

**File:** `src/channel.ts`, line 108

The "Connect IQ Option" button in the re-engagement follow-up message opens the trade menu instead of the connect flow.

**Current:**
```ts
{ text: '🔗 Connect IQ Option', callback_data: 'ui:trade' },
```

**Fix:** Change to `'ui:connect'`:
```ts
{ text: '🔗 Connect IQ Option', callback_data: 'ui:connect' },
```

---

## Bug #2 — Re-engagement Never Fires for Video-Step Users

**File:** `src/onboarding.ts`, line 238

The `REENGAGE_MAP` looks for state key `'new_trader_video_sent'`, but `handleNewTrader()` at line 109 sets the onboarding state to `'new_user_watch_video'`. These don't match, so when a user gets stuck on the "I'm new → watch video" step, the re-engagement loop falls through to the default (`reengage_entry_stuck`) instead of sending the video-specific re-engagement message.

**Current:**
```ts
'new_trader_video_sent': 'reengage_video_stuck',
```

**Fix:** Change the key to match the actual state set by `handleNewTrader`:
```ts
'new_user_watch_video': 'reengage_video_stuck',
```

---

## Bug #3 — `verify_fail_3` Template Never Used

**File:** `src/bot.ts`, around line 4056

When password login fails 2+ times, the code sends a hardcoded message instead of using the existing `verify_fail_3` template from the database (which has a "Contact Support" button).

**Current (line 4059-4062):**
```ts
await ctx.reply(
    'Having trouble connecting? Contact admin for help 👇💜',
    { reply_markup: { inline_keyboard: [[{ text: '👾 Contact admin', url: ADMIN_CONTACT_LINK }]] } }
);
```

**Fix:** Replace with template-based send:
```ts
const t = getTemplateByKey('verify_fail_3');
if (t) {
    const markup = t.button_text && t.button_url
        ? { reply_markup: { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] } }
        : undefined;
    await ctx.reply(t.message || 'Having trouble connecting? Contact admin for help 👇💜', markup);
} else {
    await ctx.reply(
        'Having trouble connecting? Contact admin for help 👇💜',
        { reply_markup: { inline_keyboard: [[{ text: '👾 Contact admin', url: ADMIN_CONTACT_LINK }]] } }
    );
}
```

Also add the import if `getTemplateByKey` isn't already imported at the top of `bot.ts`:
```ts
import { getTemplateByKey } from './db.js';
```

*(Check — `getTemplateByKey` may already be imported. Remove the duplicate import if it exists.)*

---

## Bug #4 — `funding_user_result_video` Never Selected

**File:** `src/onboarding.ts`, line 199-202

The `FUNDING_TEMPLATES` array has 6 entries but a 7th template `funding_user_result_video` exists in the database and is never randomly selected for the funding sequence.

**Current:**
```ts
const FUNDING_TEMPLATES = [
    'funding_win_screenshot', 'funding_lifestyle_video', 'funding_testimonial',
    'funding_payout_proof',  'funding_lifestyle_photo', 'funding_user_result',
];
```

**Fix:** Add the missing template:
```ts
const FUNDING_TEMPLATES = [
    'funding_win_screenshot', 'funding_lifestyle_video', 'funding_testimonial',
    'funding_payout_proof',  'funding_lifestyle_photo', 'funding_user_result',
    'funding_user_result_video',
];
```

---

## Files Changed

1. `src/channel.ts` — line 108, one callback_data value
2. `src/onboarding.ts` — line 238, state key; line 201, add template
3. `src/bot.ts` — line ~4056-4062, use template instead of hardcoded message
