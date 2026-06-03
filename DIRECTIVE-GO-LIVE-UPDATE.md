# Go Live Message Update

## IMPORTANT: Merge master first

## Changes needed in `/src/bot.ts`

### 1. Update the channel link constant

Replace all occurrences of:
```
https://t.me/tenxpremiumvip
```
with:
```
https://t.me/+rPvBi_BnG5s5Zjg0
```

### 2. Update `LIVE_MSG_APPROVED` (lines ~3116-3120)

Replace the entire const with:
```typescript
    const LIVE_MSG_APPROVED =
        `🟣 *10x Shiloh is LIVE right now!*\n\n` +
        `I'm trading live with 10x AI 💜\n\n` +
        `👇 Tap below to join`;
```

### 3. Update `LIVE_MSG_PENDING` (lines ~3122-3126)

Replace the entire const with:
```typescript
    const LIVE_MSG_PENDING =
        `🟣 *10x Shiloh is LIVE right now!*\n\n` +
        `I'm trading live with 10x AI 💜\n\n` +
        `👇 Tap below to join`;
```

### 4. Add inline keyboard to sendMessage calls

For the approved users sendMessage (line ~3143), add `reply_markup`:
```typescript
await bot.telegram.sendMessage(u.telegram_id, LIVE_MSG_APPROVED, {
    parse_mode: 'MarkdownV2',
    reply_markup: {
        inline_keyboard: [[
            { text: '🔴 Join Live', url: 'https://t.me/+rPvBi_BnG5s5Zjg0' }
        ]]
    }
});
```

For the pending users sendMessage (line ~3149), add the same `reply_markup`.

### 5. Test mode (line ~3131)

Also update the test mode sendMessage to include the same `reply_markup`:
```typescript
await bot.telegram.sendMessage(testUserId, LIVE_MSG_APPROVED, {
    parse_mode: 'MarkdownV2',
    reply_markup: {
        inline_keyboard: [[
            { text: '🔴 Join Live', url: 'https://t.me/+rPvBi_BnG5s5Zjg0' }
        ]]
    }
}).catch(() => {});
```
