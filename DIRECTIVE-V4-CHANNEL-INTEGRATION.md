# DIRECTIVE: V4 Channel Integration — Auto-Approve + Welcome Funnel

## Context

The channel `-1002766084283` is a private channel where users join via an invite link on the landing page. Users request to join → bot detects them in the approval queue → auto-approves → sends welcome message funneling them into the bot.

**Meta Pixel is a separate independent build — not in this directive.**

## 1. Channel Setup Verification

**Pre-condition (already done):** Bot is admin on channel `-1002766084283` with permission to:
- Approve new members
- Send messages
- Read messages (for join request detection)

## 2. How Telegram Join Request Detection Works

Telegram Bot API sends `chat_join_request` updates when users click "Request to Join" on a private channel. Telegraf handles this via:

```typescript
bot.on('chat_join_request', async (ctx) => {
  // ctx.chatJoinRequest contains:
  // - from: the user who requested
  // - chat: the channel
  // - user_chat_id: DM chat ID for messaging the user
});
```

The bot must be configured to receive these updates. In Telegraf, this works automatically if the bot is a channel admin with "approve new members" permission.

## 3. Auto-Approve Flow

### New file: `src/channel.ts`

```typescript
import { Telegraf, Context } from 'telegraf';
import { insertFunnelEvent, getUser, upsertOnboardingUser } from './db.js';

const CHANNEL_ID = parseInt(process.env.CHANNEL_ID || '-1002766084283');

export function setupChannelHandlers(bot: Telegraf): void {
  // ── 1. Auto-Approve Join Requests ────────────────────────────────
  bot.on('chat_join_request', async (ctx) => {
    const req = (ctx as any).chatJoinRequest; // Telegraf types may vary
    if (!req) return;

    const chatId = req.chat?.id;
    const userId = req.from?.id;

    // Only auto-approve for OUR channel
    if (chatId !== CHANNEL_ID) return;

    try {
      // Approve the user
      await ctx.telegram.approveChatJoinRequest(chatId, userId);
      console.log(`[channel] auto-approved user ${userId}`);

      // Track funnel event
      insertFunnelEvent('channel_join_approved', JSON.stringify({ telegram_id: userId }));

      // Send welcome message WITHIN 2 SECONDS of approval
      await sendWelcomeMessage(ctx.telegram, userId);
    } catch (err) {
      console.error(`[channel] failed to approve user ${userId}:`, err);
    }
  });
}
```

### Welcome message — sent immediately after approval

```typescript
async function sendWelcomeMessage(telegram: any, userId: number): Promise<void> {
  const welcomeText = 
    `🎉 *Welcome to 10x Signals!*\n\n` +
    `You're now in the #1 IQ Option trading community.\n\n` +
    `The 10x bot places high-probability trades using real market analysis:\n` +
    `• RSI + EMA + MACD + Bollinger Bands\n` +
    `• Smart Recovery (martingale)\n` +
    `• Live & Demo trading\n\n` +
    `*Start trading in 60 seconds 👇*`;

  const keyboard = {
    inline_keyboard: [[
      { text: '🚀 Start Trading Now', callback_data: 'ui:trade' },
    ]],
  };

  try {
    await telegram.sendMessage(userId, welcomeText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    console.log(`[channel] welcome message sent to ${userId}`);
  } catch (err) {
    console.error(`[channel] failed to send welcome to ${userId}:`, err);
  }
}
```

## 4. Welcome Funnel — Handling Non-Registered Users

### The problem

When a user clicks "Start Trading Now" from the welcome message, they may not have used `/start` yet. If they haven't interacted with the bot before, `getUser()` returns undefined and the bot sends onboarding.

### The flow when CTA is clicked

```
User clicks "Start Trading Now" 
  → callback_data: 'ui:trade' handler fires
  → requireApproval(ctx) checks user
  → If user doesn't exist → startOnboarding(ctx)
  → User goes through: welcome → connect account → trade
```

**This already works** — the existing `ui:trade` handler runs `requireApproval()` which redirects to onboarding if the user isn't approved. No changes needed.

## 5. 20-Minute Follow-Up (Cron Job)

### Problem

If a user receives the welcome message but doesn't interact within 20 minutes, send a follow-up.

### Implementation: background check

```typescript
// Run every 5 minutes — check for unresponsive users
export function startWelcomeFollowUp(bot: Telegraf): void {
  setInterval(async () => {
    const pending = getRecentlyApprovedUsers(20); // approved in last 20 min
    for (const user of pending) {
      // Check if user has sent ANY message to the bot after approval
      const hasActivity = userHasActivity(user.telegram_id);
      if (!hasActivity) {
        // Send follow-up
        await bot.telegram.sendMessage(
          user.telegram_id,
          `👋 *Still there?*\n\nWe noticed you haven't started trading yet.\n\n` +
          `The bot is online and signals are firing right now.\n\n` +
          `Tap below to begin 👇`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '🔗 Connect IQ Option', callback_data: 'ui:trade' },
                { text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK },
              ]],
            },
          }
        );
      }
    }
  }, 5 * 60 * 1000);
}
```

### DB helper additions in `db.ts`

```typescript
export function getRecentlyApprovedUsers(minutes: number): UserRecord[] {
  return db.prepare(`
    SELECT * FROM users
    WHERE approval_status = 'approved'
      AND approved_at >= datetime('now', ? || ' minutes')
    ORDER BY approved_at DESC
  `).all(`-${minutes}`) as UserRecord[];
}

export function userHasActivity(telegramId: number): boolean {
  // Check if user sent any message (tracked via a messages table or sessions)
  // Simple approach: check last_used timestamp
  const user = getUser(telegramId);
  if (!user || !user.last_used) return false;
  const lastUsed = new Date(user.last_used).getTime();
  const approvedAt = user.approved_at ? new Date(user.approved_at).getTime() : 0;
  return lastUsed > approvedAt;
}
```

## 6. New `messages` table for tracking activity

Add to `db.ts`:

```sql
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  direction   TEXT    NOT NULL,  -- 'incoming' | 'outgoing'
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_tid ON messages(telegram_id, created_at);
```

Track every incoming message in the bot's text handler:

```typescript
// In bot.ts text handler, at the very top (after the '/' check):
insertMessage(ctx.from!.id, 'incoming');
```

Track outgoing messages when bot sends:

```typescript
export function insertMessage(telegramId: number, direction: 'incoming' | 'outgoing'): void {
  db.prepare('INSERT INTO messages (telegram_id, direction) VALUES (?, ?)').run(telegramId, direction);
}
```

This also enables the LLM system monitor (Phase 5) to check activity patterns.

## 7. Funnel Tracking

Add funnel events for the channel pipeline:

```typescript
// On join request received
insertFunnelEvent('channel_join_requested', JSON.stringify({ telegram_id: userId }));

// On auto-approval
insertFunnelEvent('channel_join_approved', JSON.stringify({ telegram_id: userId }));

// On welcome message sent
insertFunnelEvent('channel_welcome_sent', JSON.stringify({ telegram_id: userId }));

// On follow-up sent (20 min no activity)
insertFunnelEvent('channel_followup_sent', JSON.stringify({ telegram_id: userId }));
```

## 8. Files

| File | Action |
|------|--------|
| `src/channel.ts` | **NEW** — auto-approve handler + welcome funnel |
| `src/db.ts` | Add `messages` table, `getRecentlyApprovedUsers()`, `userHasActivity()`, `insertMessage()` |
| `src/bot.ts` | Wire `setupChannelHandlers(bot)`, add `insertMessage()` to text handler |
| `src/index.ts` | Call `startWelcomeFollowUp(bot)` |

## 9. .env Addition

```
CHANNEL_ID=-1002766084283
```

(Already added in Phase 3 directive, but re-confirm.)

---

**Deploy:** `npx tsc && pm2 restart iqbot-v3-bot`

**Test:**
1. User clicks invite link → appears in channel approval queue
2. Bot auto-approves within 2 seconds
3. Welcome message delivered to user DM
4. User clicks CTA → funneled to onboarding
5. No activity for 20 min → follow-up message sent
6. Funnel events logged in DB