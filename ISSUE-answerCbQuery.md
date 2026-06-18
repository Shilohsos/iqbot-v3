# answerCbQuery — Systemic Protection Needed

## Problem

`answerCbQuery()` throws `400: Bad Request: query is too old` when a callback query expires before the bot processes it. When it throws uncaught, the **entire handler crashes** — the user sees the button stuck in loading state and never gets the reply.

This happens because broadcast dispatch (sending to 50+ users sequentially) blocks update processing for up to 137 seconds. Callback queries from users pile up and expire.

## Current State

139 `answerCbQuery()` calls in `src/bot.ts`. About half are protected with `.catch(() => {})`, half are bare `await ctx.answerCbQuery()` and will crash the handler on expiry.

## Fix

Wrap EVERY bare `answerCbQuery()` call with `.catch(() => {})`:

```typescript
// Before (crashes handler on expiry):
await ctx.answerCbQuery();

// After (survives expiry, handler continues):
await ctx.answerCbQuery().catch(() => {});
```

OR better: add a one-line helper and use it everywhere:

```typescript
const ack = (ctx: Context) => ctx.answerCbQuery().catch(() => {});

// Then replace all bare calls:
await ack(ctx);
```

Either approach works — consistency is what matters.

## Already Fixed

- `ui:upgrade` — fixed in dist/bot.js directly (June 18)
- All handlers that already use `.catch(() => {})` are fine

## Files to Change

- `src/bot.ts` — all bare `answerCbQuery()` calls
- `src/auto-trading.ts` — check for any bare calls
- Any other handler files
