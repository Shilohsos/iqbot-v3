# Fix: Show Affiliate Link Visibly in Account Creation Prompt

## Problem
In the `askCreateAccountUserId()` function, the affiliate link is hidden inside a markdown link:
```
👉 [Create your IQ Option Account](${AFFILIATE_LINK})
```
Users cannot see or copy the actual URL — they only see the anchor text. Some users want to see the link to verify it or copy it manually.

## Fix
Change the message to show the affiliate link as plain text so it's visible, copyable, and automatically tappable by Telegram (which auto-detects URLs).

In `/root/iqbot-v3/src/bot.ts`, modify `askCreateAccountUserId()` (around line 714):

Replace:
```typescript
await ctx.reply(
    `👉 Create your IQ Option account\\n` +
    `👉 [Create your IQ Option Account](${AFFILIATE_LINK})\\n` +
    `Click Above 👆🏼👾\\n\\n` +
    `🔢 Once your account is created, enter your User ID here:\\n\\n` +
    `How to find it:\\n` +
    `Open IQ Option → Profile → copy the numeric User ID 🆔\\n\\n` +
    `Then paste that here 👇👾`,
    { parse_mode: 'Markdown' }
);
```

With:
```typescript
await ctx.reply(
    `👉 Create your IQ Option account\\n` +
    `👉 Create your IQ Option Account: ${AFFILIATE_LINK}\\n` +
    `Click Above 👆🏼👾\\n\\n` +
    `🔢 Once your account is created, enter your User ID here:\\n\\n` +
    `How to find it:\\n` +
    `Open IQ Option → Profile → copy the numeric User ID 🆔\\n\\n` +
    `Then paste that here 👇👾`,
    { parse_mode: 'Markdown' }
);
```

## Why this works
- Telegram auto-detects URLs starting with `http`/`https` and makes them tappable
- Users can long-press to copy the full URL
- The link remains functional while becoming visible
- No change to parsing mode needed — we keep it for any other markdown in the message

## Files to modify
- `src/bot.ts` — function `askCreateAccountUserId`

## Verification
1. User clicks "🆕 Create one free (takes 2 min)" button
2. Bot replies with the message showing the full affiliate link visibly
3. Link is tappable and copyable
4. Flow continues normally when user enters their User ID
