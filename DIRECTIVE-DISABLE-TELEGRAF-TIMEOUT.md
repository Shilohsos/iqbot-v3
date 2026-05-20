# DIRECTIVE: Disable Telegraf Internal handlerTimeout (90s default kills slow SDK connects)

## Problem

Telegraf has a built-in handler timeout that defaults to **90,000ms (90 seconds)**. Our SDK connections to IQ Option take **60–194 seconds**. When a callback handler takes longer than 90s, Telegraf kills it and throws:

```
Promise timed out after 90000 milliseconds
```

This error hits `bot.catch` which checks `msg.includes('timed out')` — the match triggers the "Request timed out" popup sent to the user. But the trade itself **continues executing** on IQ Option's side because the SDK connection was already in progress.

Evidence from error logs:
```
[bot.catch] callback_query: Promise timed out after 90000 milliseconds
[bot.catch] callback_query: Promise timed out after 90000 milliseconds
[bot.catch] callback_query: Promise timed out after 90000 milliseconds
```

## Fix

One line change in `src/bot.ts`:

**Before (line 50):**
```typescript
const bot = new Telegraf(BOT_TOKEN);
```

**After:**
```typescript
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 0 });
```

Setting `handlerTimeout: 0` disables Telegraf's internal timeout entirely. The handler runs until it completes, throws, or our own `withTimeout` (180s) or SDK connection timeout (180s) fires — which is the correct behavior.

## Why this is safe

- The SDK connection already has a 180s timeout via `Promise.race` (bot.ts line 904, trade.ts line 117)
- The trade round has a timeout of `(timeframeSec + 90) × 1000 + 180_000` via `withTimeout` (bot.ts line 546)
- Disabling Telegraf's 90s timeout means OUR timeouts control when handlers die, not Telegraf's
- The trade continuing after timeout was the real problem — now the handler stays alive until the SDK call actually resolves or our own timeout fires

## Acceptance Criteria

- [ ] `Promise timed out after 90000 milliseconds` no longer appears in error logs
- [ ] No "Request timed out" popups during martingale trades
- [ ] Trade completes normally without timeout errors
- [ ] `npx tsc` passes clean
- [ ] PM2 restart → bot starts clean on `master`
