# DIRECTIVE: Fix Callback Handler Timeouts

## Problem

Every callback query handler is being killed by `handlerTimeout` after 10 seconds (730 occurrences in error log). Users tap buttons — especially amount selection, timeframe, and pair analysis — and the handler dies before completing. The user sees "⚠️ Error occurred" or nothing at all, and the bot appears to stop responding.

## Root Cause

`handlerTimeout` is set to 10,000ms (line 2313). This is too tight for handlers that:
1. Upload images via `replyWithPhoto()` (L5.png is 1.45MB — upload takes 1-3s)
2. Connect to IQ Option SDK fresh per operation (WS connect + auth + data fetch)
3. Do the new 4-indicator PRO analysis (MACD + Bollinger Bands on top of RSI/EMA)

When many users interact simultaneously, the single-threaded event loop slows down further, making the 10s limit even more likely to be hit.

## Changes Required

### 1. `src/bot.ts` — Increase handlerTimeout

**Line 2313:** Change `10_000` to `30_000`.

```typescript
// Before:
(bot as any).options.handlerTimeout = 10_000;

// After:
(bot as any).options.handlerTimeout = 30_000;
```

30 seconds gives enough headroom for: image upload (~3s) + SDK connection (~5-8s) + 4-indicator analysis (~1s) + message edits (~1s) + margin for concurrent users.

### 2. `src/bot.ts` — Add answerCbQuery Guard in bot.catch

**Around lines 2289-2290:** The current `bot.catch` tries `ctx.answerCbQuery('⚠️ Error occurred. Try again.')` when a callback query times out. This sends an error toast to the user. However, the user's real problem is their trade flow was interrupted.

After the error toast, send a follow-up that lets them restart cleanly:

```typescript
// Replace lines 2289-2293 with:
if (ctx.callbackQuery) {
    await ctx.answerCbQuery('⚠️ Error occurred. Try again.').catch(() => {});
    if (msg.includes('timed out')) {
        await ctx.reply(
            '⏳ *Request timed out*\\n\\nThis can happen under heavy load. Please try again.\\n\\nSend /start to restart.',
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 Start Over', callback_data: 'ui:start' }]] } }
        ).catch(() => {});
    }
} else {
    ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
}
```

This gives the user a clear next step instead of leaving them stuck.

### 3. `src/bot.ts` — Ensure answerCbQuery is the VERY FIRST call in all handlers

All callback handlers already call `await ctx.answerCbQuery()` early. Double-check that none are doing DB reads or other synchronous work before the answerCbQuery call. Specifically check:

- `bot.action(/^amt:(.+)$/, ...)` (line 780) — ✅ calls answerCbQuery on line 784 before any heavy work
- `bot.action(/^tf:(\d+)$/, ...)` (line 810) — ✅ calls answerCbQuery on line 814
- `bot.action(/^pair:(.+)$/, ...)` (line 861) — ✅ calls answerCbQuery on line 853... wait, no. Let me check the order in the pair handler more carefully.

Actually — the pair handler (line 861) does NOT call answerCbQuery until AFTER `wizardSessions.get()`. If `wizardSessions.get()` is slow (Map lookup — fine, it's O(1)), no issue. But the order is:
```
line 862: const chatId = ctx.chat!.id;
line 863: const state = wizardSessions.get(chatId);
line 864: if (!state || state.step !== 'pair') { await ctx.answerCbQuery('Session expired — start over.'); return; }
line 865: await ctx.answerCbQuery();
```

This is fine — quick Map lookups before answerCbQuery.

The main fix is just #1 (increase timeout) and #2 (better timeout message).

### 4. Optional: Add `console.time()` logging to trace slow handlers

Add a middleware that logs handler execution time for debugging future timeout issues:

```typescript
// After bot.use() username saver at line 53, add:
bot.use(async (ctx, next) => {
    if (ctx.callbackQuery) {
        const start = Date.now();
        const label = ctx.callbackQuery.data?.substring(0, 20) || 'unknown';
        await next();
        const elapsed = Date.now() - start;
        if (elapsed > 3000) console.log(`[slow] callback ${label}: ${elapsed}ms`);
    } else {
        await next();
    }
});
```

This is optional but useful for monitoring. Place it right after the existing `bot.use()` at line 57.

## Acceptance Criteria

- [ ] Users can complete the full trade flow (amount → timeframe → pair → analysis → execution) without timing out
- [ ] bot-error.log shows zero or near-zero `callback_query timed out` entries
- [ ] If a timeout does occur, user sees a clear "Request timed out" message with a "Start Over" button
- [ ] `npx tsc --noEmit false` passes
- [ ] PM2 restart → bot comes up clean
