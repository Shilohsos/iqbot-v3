# Issue 43 — Remove dropPendingUpdates to prevent message loss on restart

**Problem:** `bot.launch({ dropPendingUpdates: true })` at line 2085 of `src/bot.ts` discards ALL Telegram updates sent while the bot was offline. Legitimate user messages (like `/start`, passwords, emails) are permanently lost every time the bot restarts.

Old callback queries ("query is too old and response timeout expired") are already handled gracefully by `bot.catch()` at line 2075 — they log an error and reply with "⚠️ Error occurred. Try again." This is acceptable behavior for stale callbacks.

**Fix in `src/bot.ts`:**

Change line 2085 from:
```typescript
bot.launch({ dropPendingUpdates: true });
```
to:
```typescript
bot.launch();
```

This ensures user messages sent during downtime (restarts, deploys, crashes) are processed when the bot comes back online. The trade-off is harmless — old callback queries fail with a Telegram error that's already caught by `bot.catch()`.
