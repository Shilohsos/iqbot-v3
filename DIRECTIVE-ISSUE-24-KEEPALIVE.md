# Issue #24 — Auto-keepalive (no more stale connections)

## Problem

After several hours of inactivity, the bot stops responding to Telegram commands. A manual PM2 restart fixes it because `dropPendingUpdates: true` re-establishes the connection.

The bot should **never** need a manual restart to stay responsive.

## Solution: Periodic keepalive ping

Add a `setInterval` in `bot.ts` that sends a lightweight Telegram API call every **10 minutes** to keep the polling connection alive. This prevents Telegram from dropping the connection during idle periods.

### Implementation

Near the bot launch section (bottom of bot.ts), after `bot.launch()`:

```typescript
// Keep the Telegram polling connection alive — prevents stale connections
// after hours of inactivity
setInterval(async () => {
    try {
        await bot.telegram.getMe();
    } catch (err) {
        console.error('[keepalive] getMe failed:', err instanceof Error ? err.message : err);
    }
}, 600_000); // every 10 minutes
```

`bot.telegram.getMe()` is the lightest possible API call — it just returns the bot's own info. No network overhead, no chat spam, no side effects. Just enough to keep the polling socket alive.

### Why this works

Telegram's Bot API long-polling (`getUpdates`) maintains a TCP connection. After long idle periods, the network layer or Telegram's server may silently drop this connection. The keepalive ping ensures a regular API call goes through, keeping the connection fresh.

### Alternative considered

A cron job that restarts the bot periodically would also work but is less elegant — causes unnecessary downtime and resets in-memory session state.

## Files

- `src/bot.ts` — add the keepalive interval after `bot.launch()`
