# DIRECTIVE: Switch to Telegram Bot API Local Server (Eliminates Long-Poll 50s Delay)

## Problem

Telegraf uses long-polling with a **50-second server-side timeout** for `getUpdates`. When a user sends a message just after a poll cycle starts, their message waits up to 50 seconds before the bot fetches it. This causes `/start` to feel like it's "taking a solid minute" after being away.

This is NOT a code bug — it's an architectural property of long-polling. The handler runs in <10ms, but the message delivery is delayed by the polling cycle.

**Measured polling parameters (Telegraf 4.16.3, `src/core/network/polling.ts`):**
- `timeout: 50` — Telegram holds the connection for 50 seconds
- Average delivery latency: ~25s (half of timeout)
- Worst case: ~50s

## Solution

Run **Telegram's official Bot API server** (`telegram-bot-api`) as a Docker container alongside the Node.js process. The bot connects to it via HTTP on localhost — **no polling, no 50s delay, instant message delivery.**

### Architecture Change

```
BEFORE:
  User → Telegram Servers → (long-poll 50s) → Bot
  
AFTER:
  User → Telegram Servers → Bot API Server (localhost:8081) → (HTTP, instant) → Bot
```

The Bot API server acts as a local proxy that receives updates via webhook from Telegram and forwards them to your bot over HTTP. No SSL certificate needed — it runs in Docker on localhost.

## Changes Required

### 1. Start Telegram Bot API Docker Container

```bash
docker run -d \
  --name telegram-bot-api \
  --restart unless-stopped \
  -e TELEGRAM_API_ID=<your_api_id> \
  -e TELEGRAM_API_HASH=<your_api_hash> \
  -p 127.0.0.1:8081:8081 \
  -v /root/telegram-bot-api:/var/lib/telegram-bot-api \
  aiogram/telegram-bot-api:latest
```

**Note:** This requires an API ID and Hash from https://my.telegram.org/apps. The Telegram Bot API server is an official Telegram project that processes Bot API requests locally.

If Docker-based Bot API server is not feasible, see alternative below.

### 2. Update bot configuration

In `.env` file, add:
```
TELEGRAM_API_URL=http://127.0.0.1:8081
```

### 3. Update `src/bot.ts` — Switch Telegraf to use local API + webhook

```typescript
// Line 50 - Change from:
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity });

// To:
const apiUrl = process.env.TELEGRAM_API_URL;
const bot = new Telegraf(
    apiUrl ? `${apiUrl}/bot${BOT_TOKEN}` : BOT_TOKEN,
    { handlerTimeout: Infinity }
);
```

And replace `bot.launch()` with webhook mode:

```typescript
// Lines 2362-2363 - Change from:
cleanStaleSessions();
bot.launch();

// To:
cleanStaleSessions();
if (process.env.TELEGRAM_API_URL) {
    // Local Bot API server — webhook mode
    bot.launch({
        webhook: { domain: 'localhost', path: '/webhook', port: 8443 },
        allowedUpdates: ['message', 'callback_query', 'my_chat_member'],
    });
    console.log('[iqbot-v3] running with local Bot API (webhook)');
} else {
    bot.launch();
    console.log('[iqbot-v3] running with long polling');
}
```

### 4. Update package.json scripts to wait for Bot API

If using Bot API server, add a health check:
```bash
# Before starting bot, wait for Bot API to be ready:
while ! curl -s http://127.0.0.1:8081/ > /dev/null; do sleep 1; done
```

## Files to modify

1. `.env` — add `TELEGRAM_API_URL=http://127.0.0.1:8081`
2. `src/bot.ts` — constructor URL + webhook launch
3. Docker container setup (one-time)

## Alternative: Caddy Webhook (if local Bot API is not desired)

If running the Bot API Docker container isn't preferred, use **Caddy** (already installed) to terminate SSL and proxy webhook:

```typescript
// bot.ts — launch with webhook:
bot.launch({
    webhook: {
        domain: 'bot.yourdomain.com',
        path: '/webhook',
        port: 8443,
    },
    allowedUpdates: ['message', 'callback_query', 'my_chat_member'],
});
```

Caddy config (`/etc/caddy/Caddyfile`):
```
bot.yourdomain.com {
    reverse_proxy localhost:8443
}
```

Then set webhook URL:
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://bot.yourdomain.com/webhook"
```

## Why This Fixes the UX

| Metric | Long-polling (current) | Webhook / Bot API |
|--------|----------------------|-------------------|
| Message → bot receives | Up to **50 seconds** | **<100ms** |
| /start → menu visible | 50s + <10ms handler | **<200ms** total |
| Any button response | ~25s average + handler | **<200ms** + handler |
| Trade button → feedback | 50s + 64-194s SDK | 200ms + 0-5s pool |
| CPU overhead | ~1% polling | ~0% idle |

With the SDK pool (already deployed) + webhook (this fix), both major bottlenecks are eliminated:
- SDK wait: 64-194s → 0-5s (pool)
- Poll delay: 0-50s → <200ms (webhook)

## Acceptance Criteria

- [ ] Docker container `telegram-bot-api` is running
- [ ] Bot connects to local API (`TELEGRAM_API_URL`)
- [ ] Bot launches with webhook mode (no polling)
- [ ] `/start` returns menu in <1s (measurable)
- [ ] All existing handlers still work (callback queries, commands)
- [ ] PM2 restart → bot comes up clean
