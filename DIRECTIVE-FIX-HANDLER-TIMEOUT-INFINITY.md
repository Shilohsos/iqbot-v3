# DIRECTIVE: Fix handlerTimeout — Use Infinity Not 0

## Problem

The previous directive set `handlerTimeout: 0` in the Telegraf constructor. In Telegraf v4 + p-timeout, **a value of 0 means timeout after 0ms** (immediately), not "disabled."

Evidence from the logs:
```
[bot.catch] callback_query: Promise timed out after 0 milliseconds
[bot.catch] callback_query: Promise timed out after 0 milliseconds
[bot.catch] callback_query: Promise timed out after 0 milliseconds
```

Every button click is killed instantly. The handler still runs and sends its response, but Telegraf's p-timeout fires at 0ms, throwing "Promise timed out after 0 milliseconds" which hits `bot.catch` and sends the "Request timed out" popup to the user.

## Fix

**One character change in `src/bot.ts`:**

**Before (line 50):**
```typescript
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 0 });
```

**After:**
```typescript
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity });
```

`p-timeout` treats `Infinity` as "no timeout" — the handler runs until it completes without being killed by Telegraf.

## Why this is safe

- The SDK connection already has 180s timeout via `Promise.race` 
- Trade rounds have `(timeframeSec + 90) × 1000 + 180_000` timeout via `withTimeout`
- Removing Telegraf's handler kill means OUR timeouts control when handlers die
- No more phantom "Request timed out" popups on every button

## Acceptance Criteria

- [ ] Logs show no `Promise timed out after 0 milliseconds` errors
- [ ] No "Request timed out" popups on normal button clicks
- [ ] Trade completes without timeout errors
- [ ] `npx tsc` passes clean
- [ ] PM2 restart → bot starts clean on `master`
