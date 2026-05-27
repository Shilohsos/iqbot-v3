# Fix Markdown Parse Error in Create Account Flow

## Problem
`askCreateAccountUserId()` sends the affiliate link with `parse_mode: 'Markdown'`, but the URL contains underscores (`_`). Telegram interprets `_` as italic markers and fails with:

```
400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 138
```

This causes the `onboard:no` handler to crash silently — the button appears unresponsive.

## Fix
In `src/bot.ts`, modify `askCreateAccountUserId()` (around line 514) to escape underscores in the affiliate link, or better, wrap it as a proper Markdown link:

```typescript
async function askCreateAccountUserId(ctx: Context): Promise<void> {
    // Escape underscores in URL to prevent Markdown parse errors
    const escapedLink = AFFILIATE_LINK.replace(/_/g, '\\_');
    await ctx.reply(
        `👉 Create your IQ Option account\n` +
        `👉 Create your IQ Option Account: ${escapedLink}\n` +
        `Click Above 👆🏼👾\n\n` +
        `🔢 Once your account is created, enter your User ID here:\n\n` +
        `How to find it:\n` +
        `Open IQ Option → Profile → copy the numeric User ID 🆔\n\n` +
        `Then paste that here 👇👾`,
        { parse_mode: 'Markdown' }
    );
}
```

The `\\_` escaping tells Telegram the underscore is literal, not italic formatting.

## File to modify
- `src/bot.ts` — `askCreateAccountUserId()` function

## Verification
1. Start bot with `/start` as a new user
2. Tap "🆕 Create one free (takes 2 min)"
3. Message should send successfully with clickable link
4. No "can't parse entities" error in logs
