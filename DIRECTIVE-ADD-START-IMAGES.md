# Fix: Add images to /start welcome messages

---

## IMPORTANT: Merge master first

Before working, ensure you're on master with the latest merge.

---

## Problem

`sendStartMenu()` at `src/bot.ts` lines 700-711 sends two text messages without images. The database has photos stored in `sequence_media` for both:

| template_key | media_type | Purpose |
|---|---|---|
| `entry_welcome_1` | photo | Brand intro message |
| `entry_welcome_2` | photo | Connect account message |

These images need to be sent via `replyWithPhoto` before (or attached to) each text message.

---

## Fix

**File:** `src/bot.ts`
**Function:** `sendStartMenu` (starts ~line 684)
**Change:** Replace the two plain `ctx.reply()` calls with `ctx.replyWithPhoto()` followed by the text message.

For message 1 (brand intro), add the `entry_welcome_1` photo:

```typescript
// Send brand intro with image
await ctx.replyWithPhoto(ASSET('entry_welcome_1.png')).catch(() => {});
await ctx.reply(
    "I'm 10x Special Bot 💜\n\n" +
    "The smartest semi auto-trading bot for IQ Option OTC pairs.\n\n" +
    "I scan markets. I read signals. I place trades.\n" +
    "You sit back and watch the wins land."
);
```

Wait — the images are stored as Telegram `file_id`s in the `sequence_media` DB table, not as local assets. The `ASSET()` helper serves local files. For Telegram-stored images, the handler should:

1. Query `sequence_media` for `template_key = 'entry_welcome_1'` to get the `file_id`
2. Send with `ctx.replyWithPhoto(file_id)` using the stored Telegram file_id

Since adding a DB query inside `sendStartMenu()` adds complexity, a simpler approach: send the `file_id` directly as a constant. The file IDs are:

- `entry_welcome_1`: The file_id stored in DB
- `entry_welcome_2`: The file_id stored in DB

But these can change if re-uploaded. Better to query the DB.

Here's the recommended approach:

**Add a helper function** (near existing DB helpers) to fetch a sequence media file_id:

```typescript
function getSequenceMedia(key: string): string | undefined {
    const row = db.prepare('SELECT file_id FROM sequence_media WHERE template_key = ?').get(key) as { file_id: string } | undefined;
    return row?.file_id;
}
```

**Then update `sendStartMenu()`** to use it:

```typescript
// Message 1: Brand intro with image
const img1 = getSequenceMedia('entry_welcome_1');
if (img1) {
    await ctx.replyWithPhoto(img1).catch(() => {});
}
await ctx.reply(
    "I'm 10x Special Bot 💜\n\n" +
    "The smartest semi auto-trading bot for IQ Option OTC pairs.\n\n" +
    "I scan markets. I read signals. I place trades.\n" +
    "You sit back and watch the wins land."
);

// Message 2: Connect account with image
const img2 = getSequenceMedia('entry_welcome_2');
if (img2) {
    await ctx.replyWithPhoto(img2).catch(() => {});
}
await ctx.reply(
    "Connect your IQ Option account.\n\n" +
    "Free signup · 60 seconds · Linked instantly.\n" +
    "Bot trades on your account. Money stays yours.\n\n" +
    "Pick what fits 👇",
    {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ I have an IQ Option account', callback_data: 'onboard:yes' }],
                [{ text: '🆕 Create Account', callback_data: 'onboard:autocreate' }],
            ],
        },
    }
);
```

---

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. `/start` on a new/unknown user — both messages should show their paired images
3. The images should display before their corresponding text messages
4. If a `sequence_media` entry is missing, the text should still send (no crash)
