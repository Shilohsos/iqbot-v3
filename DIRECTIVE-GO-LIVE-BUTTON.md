# DIRECTIVE: Add Go Live Admin Button

## Problem
When the admin goes live on Telegram, there's no quick broadcast button to notify all users.

## Fix: Add "🔴 Go Live" admin button + broadcast handler

### 1. Add button to adminKeyboard in src/ui/admin.ts

Find the adminKeyboard rows and add before any existing broadcast/action buttons:

```typescript
// Go Live
{ text: '🔴 Go Live', callback_data: 'admin:golive' },
```

Add it to the first row alongside existing action buttons (e.g. alongside Broadcasts or as a standalone row).

### 2. Add handler in src/bot.ts

```typescript
// ─── Go Live broadcast ────────────────────────────────────────────────────────

bot.action('admin:golive', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from!.id !== getAdminId()) return;
    const channelLink = process.env.CHANNEL_INVITE_LINK ?? 'https://t.me/Shiloh10xVIP';
    const msg = `🔴 *I'M GOING LIVE NOW!* 🔴\n\n` +
        `Come join me live in the Telegram channel — I'm breaking down trades, answering questions, and showing you exactly how 10x Bot works in real time.\n\n` +
        `👇 Tap below to join`;
    const chatIds = getAllChatIds();
    let sent = 0;
    for (const chatId of chatIds) {
        try {
            await bot.telegram.sendMessage(chatId, msg, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔴 Join Live', url: channelLink }]] }
            });
            sent++;
            await new Promise(r => setTimeout(r, 50));
        } catch {}
    }
    await ctx.reply(`✅ Go Live broadcast sent to ${sent} users.`);
});
```

### 3. Export getAllChatIds from db.ts

Add to `src/db.ts`:

```typescript
export function getAllChatIds(): number[] {
    return db.prepare('SELECT telegram_id FROM users WHERE approval_status = ?').all('approved')
        .map((r: any) => r.telegram_id);
}
```

### 4. Add CHANNEL_INVITE_LINK to .env

Placeholder for the channel invite link. Set to actual invite link before enabling.

## Verification
- Admin sees "🔴 Go Live" button in admin menu
- Tapping it sends broadcast to all approved users with "Join Live" button
- Count confirms how many users received it
