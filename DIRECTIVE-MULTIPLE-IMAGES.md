# Support Multiple Images in Compose/Broadcast

## Current State
Compose only accepts a single image (`composeImageFileId: string`). The delivery sends one `sendPhoto()` call.

## Required Changes

### 1. Change session state to array
In `src/bot.ts`, change the `AdminSessionState` interface:
```typescript
composeImageFileId?: never;        // REMOVE this line
composeImageFileIds?: string[];    // ADD this line
```

### 2. Update image handler — accept multiple photos
Replace the current single-photo handler (around line 3020-3023) to accumulate an array:

```typescript
if (as.step === 'compose_image' && as.composeContent) {
    const existing = as.composeImageFileIds ?? [];
    // Telegram sends photo array — take the largest
    const fileId = ctx.message.photo.at(-1)!.file_id;
    if (!existing.includes(fileId)) {
        existing.push(fileId);
    }
    adminSessions.set(chatId, { ...as, composeImageFileIds: existing, step: 'compose_image' });
    const count = existing.length;
    await ctx.reply(
        `✅ Image ${count} attached${count > 1 ? ` (${count} total)` : ''}.\n` +
        `Send more images or type *done* to continue, or *skip* for no images.`,
        { parse_mode: 'Markdown' }
    );
    return;
}
```

### 3. Update text handler for "done"
In the text handler where "skip" is handled (around line 3444-3450), add "done" as another option:

```typescript
if (as.step === 'compose_image' && as.composeContent) {
    const lower = text.toLowerCase();
    if (lower === 'skip' || lower === 'done') {
        adminSessions.set(chatId, { ...as, composeImageFileIds: lower === 'skip' ? [] : (as.composeImageFileIds ?? []), step: 'compose_cta' });
        await ctx.reply('Add a CTA button?', { parse_mode: 'Markdown', reply_markup: composeButtonKeyboard() });
    } else {
        await ctx.reply('❌ Send photos or type *skip* / *done*:', { parse_mode: 'Markdown' });
    }
    return;
}
```

### 4. Update delivery logic — send media group for 2+ images
In the compose delivery handler (around line 2815-2835), change the media sending logic:

```typescript
const imageFileIds = as.composeImageFileIds ?? [];

// ── Send to bot users ──
if (target === 'bot' || target === 'both') {
    const allIds = getAllUserIds();
    for (const uid of allIds) {
        try {
            if (imageFileIds.length > 1) {
                // Media group — send photos first, then CTA message separately
                const media = imageFileIds.map((fid, i) => ({
                    type: 'photo' as const,
                    media: fid,
                    caption: i === 0 ? content : undefined,
                    parse_mode: 'Markdown' as const,
                }));
                await bot.telegram.sendMediaGroup(uid, media);
                // Send CTA as separate message (media groups don't support inline keyboards)
                await bot.telegram.sendMessage(uid, '📌', { reply_markup: replyMarkup });
            } else if (imageFileIds.length === 1) {
                await bot.telegram.sendPhoto(uid, imageFileIds[0], { caption: content, reply_markup: replyMarkup });
            } else {
                await bot.telegram.sendMessage(uid, content, { reply_markup: replyMarkup });
            }
            botSent++;
        } catch { botFailed++; }
        await new Promise(r => setTimeout(r, 40));
    }
}

// ── Send to channel ──
if (target === 'channel' || target === 'both') {
    try {
        if (imageFileIds.length > 1) {
            const media = imageFileIds.map((fid, i) => ({
                type: 'photo' as const,
                media: fid,
                caption: i === 0 ? content : undefined,
                parse_mode: 'Markdown' as const,
            }));
            await bot.telegram.sendMediaGroup(CHANNEL_ID, media);
            channelOk = true;
        } else if (imageFileIds.length === 1) {
            await bot.telegram.sendPhoto(CHANNEL_ID, imageFileIds[0], { caption: content });
            channelOk = true;
        } else {
            await bot.telegram.sendMessage(CHANNEL_ID, content);
            channelOk = true;
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        channelError = msg;
        console.error('[compose] channel send failed:', msg);
    }
}
```

### 5. Update `insertBroadcastMessage` call
Where the broadcast message is logged (around line 2808), pass the first image or empty:
```typescript
insertBroadcastMessage('approved', content, as.composeTopic, imageFileIds[0] ?? null);
```

## Files to modify
- `src/bot.ts` — interface, image handler, text handler, delivery logic

## Verification
1. Start compose → write content → approve → send 3 photos → type "done" → add CTA → deliver
2. Users should see 3 photos as an album + CTA message below
3. Channel should also receive the album
4. Single photo works as before (sendPhoto with caption)
5. No photos works as before (sendMessage)
