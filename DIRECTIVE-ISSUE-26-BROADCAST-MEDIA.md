# Issue #26 — Broadcast: support images and videos

## Feature request

When sending a broadcast, the admin should be able to include **images** and **videos** alongside the text message.

## Flow

Current flow after typing message:
1. Bot asks for link button (optional) ✅
2. Bot asks for auto-delete timer ✅

New flow:
1. Bot asks for broadcast **text message**
2. Bot asks: "Include an image or video? (send a file or tap Skip)"
3. Admin sends image/video OR types "skip"
4. Bot asks: "Include a link button?"
5. Bot asks for auto-delete timer
6. Broadcast sent with text + optional media + optional link button

## Implementation

### broadcast_message step
After admin types the broadcast text, instead of immediately asking for link/timer, ask for media first:

```typescript
adminSessions.set(chatId, { 
    ...as, 
    step: 'broadcast_media', 
    broadcastMessage: text, 
    broadcastTarget: target 
});
await ctx.reply('📎 Send an image or video to include, or type "skip" to continue without media:');
```

### broadcast_media step (text handler)
```typescript
if (as.step === 'broadcast_media') {
    if (text.toLowerCase() === 'skip') {
        // No media — proceed to link prompt
        adminSessions.set(chatId, { ...as, step: 'broadcast_link' });
        await ctx.reply('Include a link button? (send URL or type "no"):');
    } else {
        await ctx.reply('❌ Please send an image or video file, or type "skip".');
    }
    return;
}
```

### broadcast_media step (photo/video handler)
Add a `bot.on('photo', ...)` and `bot.on('video', ...)` handler that catches media sent by the admin during the `broadcast_media` step:

```typescript
bot.on('photo', async ctx => {
    const chatId = ctx.chat.id;
    if (ctx.from?.id !== getAdminId()) return;
    const as = adminSessions.get(chatId);
    if (!as || as.step !== 'broadcast_media') return;
    
    const photo = ctx.message.photo.pop()!; // largest size
    adminSessions.set(chatId, { ...as, step: 'broadcast_link', broadcastMedia: { type: 'photo', fileId: photo.file_id } });
    await ctx.reply('📎 Media received! Include a link button? (send URL or type "no"):');
});

bot.on('video', async ctx => {
    const chatId = ctx.chat.id;
    if (ctx.from?.id !== getAdminId()) return;
    const as = adminSessions.get(chatId);
    if (!as || as.step !== 'broadcast_media') return;
    
    adminSessions.set(chatId, { ...as, step: 'broadcast_link', broadcastMedia: { type: 'video', fileId: ctx.message.video.file_id } });
    await ctx.reply('📎 Media received! Include a link button? (send URL or type "no"):');
});
```

### Sending the broadcast with media
In the `bcast_timer` handler, when sending to each user:

```typescript
for (const uid of targetIds) {
    try {
        let m;
        if (pending.media?.type === 'photo') {
            m = await bot.telegram.sendPhoto(uid, pending.media.fileId, { 
                caption: pending.message, 
                ...(pending.linkButton ? { reply_markup: { inline_keyboard: [[pending.linkButton]] } } : {}) 
            });
        } else if (pending.media?.type === 'video') {
            m = await bot.telegram.sendVideo(uid, pending.media.fileId, { 
                caption: pending.message, 
                ...(pending.linkButton ? { reply_markup: { inline_keyboard: [[pending.linkButton]] } } : {}) 
            });
        } else {
            m = await bot.telegram.sendMessage(uid, pending.message, {
                ...(pending.linkButton ? { reply_markup: { inline_keyboard: [[pending.linkButton]] } } : {})
            });
        }
        sentMsgIds.push({ telegramId: uid, msgId: m.message_id });
    } catch {}
}
```

### pendingBroadcasts type update
```typescript
interface BroadcastPending {
    message: string;
    targetIds: number[];
    linkButton?: { text: string; url: string };
    media?: { type: 'photo' | 'video'; fileId: string };
}
```

## Files

- `src/bot.ts` — new text handler step (`broadcast_media`, `broadcast_link`), new photo/video handlers, updated `bcast_timer` sender
- `src/ui/admin.ts` — no changes needed (keyboards unchanged)
