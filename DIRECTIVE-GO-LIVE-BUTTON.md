# Go Live Broadcast Button

**IMPORTANT: Merge master first** — this branch may be behind.

## What to Build

Add a single admin callback button that broadcasts a "Go Live" message to all approved users, directing them to the Telegram channel.

### 1. Admin Button

In the admin keyboard (`src/ui/admin.ts`), add a button under the "Broadcasts" section:

```
🟢 Go Live
```

Callback data: `admin:golive`

### 2. Handler

In `src/bot.ts`, add handler for `admin:golive`:

```typescript
bot.action('admin:golive', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;

  const approved = db.prepare(`
    SELECT telegram_id FROM users WHERE status = 'approved'
  `).all() as { telegram_id: number }[];

  let sent = 0; let failed = 0;
  for (const u of approved) {
    try {
      await ctx.telegram.sendMessage(u.telegram_id,
        `🟣 *10x Shiloh is LIVE right now!*\n\n` +
        `I'm in the channel — come through if you want to see what I'm trading and ask questions in real-time.\n\n` +
        `👇 Join the live session now\n` +
        `https://t.me/tenxpremiumvip`,
        { parse_mode: 'Markdown' }
      );
      sent++;
    } catch {
      failed++;
    }
    // Rate limit safety — 30 messages/sec
    if (sent % 30 === 0) await new Promise(r => setTimeout(r, 1000));
  }

  // Also send to pending users
  const pending = db.prepare(`
    SELECT telegram_id FROM users WHERE status = 'pending'
  `).all() as { telegram_id: number }[];
  for (const u of pending) {
    try {
      await ctx.telegram.sendMessage(u.telegram_id,
        `🟣 *10x Shiloh is LIVE right now!*\n\n` +
        `Waiting for approval? No worries — you can still watch the live session.\n\n` +
        `👇 Join here\n` +
        `https://t.me/tenxpremiumvip`,
        { parse_mode: 'Markdown' }
      );
      sent++;
    } catch {
      failed++;
    }
    if (sent % 30 === 0) await new Promise(r => setTimeout(r, 1000));
  }

  await ctx.answerCbQuery(`Live broadcast sent to ${sent} users. ${failed} failed.`);
});
```

### 3. Send to test user if test mode is ON

Before the main loop, check test mode:

```typescript
const testUser = db.prepare(`SELECT value FROM config WHERE key = 'test_user'`).pluck().get() as string | undefined;
const testMode = db.prepare(`SELECT value FROM config WHERE key = 'test_mode'`).pluck().get();

if (testMode === 'on' && testUser) {
  await ctx.telegram.sendMessage(Number(testUser), 
    `🟣 *10x Shiloh is LIVE right now!*\n\n` +
    `👇 Join the live session\n` +
    `https://t.me/tenxpremiumvip`,
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCbQuery(`Test mode: sent to test user only.`);
  return;
}
```

### 4. Channel link

Channel: `https://t.me/tenxpremiumvip`

### 5. Build & Deploy

```bash
npm run build
pm2 restart iqbot-v3-bot --update-env
```
