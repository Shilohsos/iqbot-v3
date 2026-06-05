# DIRECTIVE: Stop channel join welcome message

## Problem

When a user joins the channel, the bot sends a welcome DM ("Welcome to 10x Special Bot... Tap the button below to start"). User wants no message sent at all.

## Change

**File: `src/channel.ts`**

Remove the `sendMessage` call after `approveChatJoinRequest`. The channel join handler should only:
1. Approve the join request
2. Fire Meta CompleteRegistration event
3. Stop — no welcome message

Delete lines 42-53 (the welcome sendMessage block). Keep the Meta event fire and the approval.

The function becomes:

```typescript
export function setupChannelHandlers(bot: Telegraf): void {
    bot.on('chat_join_request', async (ctx: any) => {
        const req = ctx.chatJoinRequest;
        if (!req) return;

        const chatId: number = req.chat?.id;
        const userId: number = req.from?.id;
        if (!chatId || !userId) return;

        if (chatId !== CHANNEL_ID) return;

        insertFunnelEvent('channel_join_requested', JSON.stringify({ telegram_id: userId }));

        try {
            await ctx.telegram.approveChatJoinRequest(chatId, userId);
            console.log(`[channel] auto-approved user ${userId}`);
            insertFunnelEvent('channel_join_approved', JSON.stringify({ telegram_id: userId }));

            // Fire Meta CompleteRegistration
            const lang: string = (req.from as any)?.language_code ?? '';
            const eventId = `cr_${userId}_${Date.now()}`;
            fetch(META_TRACK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_name: 'CompleteRegistration',
                    event_source_url: 'https://t.me/10xpremium',
                    event_id: eventId,
                    custom_data: { source: 'telegram_channel', telegram_id: userId, language_code: lang },
                    skip_ip: true,
                }),
            }).then(() => {
                console.log(`[meta] CompleteRegistration sent for user ${userId}`);
            }).catch((err: unknown) => {
                console.error(`[meta] failed to send join event for ${userId}:`, err);
            });
        } catch (err) {
            console.error(`[channel] failed to approve user ${userId}:`, err instanceof Error ? err.message : err);
        }
    });
}
```

Also remove the unused `insertFunnelEvent` for `channel_welcome_sent` and the `botUsername` variable since the welcome message is gone.
