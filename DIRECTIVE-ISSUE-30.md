# Issue 30: Button "Loading..." hangs — callback_query handlers crash silently

## Severity
High — affects ALL users, ALL buttons (onboarding, trade wizard, upsell, leaderboard, admin)

## Symptom
User clicks any inline button → "Loading..." appears → 15-30 seconds → loading disappears → nothing happened. No error message, no state change, no response. The button click was silently consumed.

## Root Causes (3 bugs)

### Bug 1: No global error boundary (`bot.catch()`)
**File:** `src/bot.ts`

There is **no** `bot.catch()` handler anywhere. When any `bot.action()` handler throws before calling `ctx.answerCbQuery()`, Telegraf swallows the exception silently. The user sees:

1. Tap button → Telegram sends callback_query → handler crashes before answerCbQuery
2. Telegram's "Loading..." waits ~30s for answerCbQuery — never gets it
3. Loading disappears → user sees nothing happened

The log shows:
```
Unhandled error while processing { update_id: ..., callback_query: { data: 'pair:AUDUSD-OTC', ... } }
```

**Fix:** Add `bot.catch()` that calls `ctx.answerCbQuery('⚠️ Error occurred')` for callback_query errors.

### Bug 2: `editMessageText` throws when message was deleted
**File:** `src/bot.ts`, lines 810-818

```typescript
bot.action('upsell:live', async ctx => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('✅ Switched to Live mode!...');  // throws if message deleted
});
bot.action('upsell:demo', async ctx => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('🪫 Continuing on Demo...');  // throws if message deleted
});
```

The bot has **1-hour auto-delete** of trade session messages. If a user clicks "Switch to live" after the upsell message was auto-deleted, `editMessageText` throws "message to edit not found". The handler crashes with no user feedback.

**Fix:** Wrap `editMessageText` in try/catch, fallback to `ctx.reply()`.

**Search all handlers** for `editMessageText` and `editMessageCaption` — add try/catch to every one. Same pattern applies to admin panel handlers and any handler that edits an old message that might have been deleted.

### Bug 3: `answerCbQuery` called before long-running operations in `pair:` handler
**File:** `src/bot.ts`, lines 763-806

```typescript
bot.action(/^pair:(.+)$/, async ctx => {
    await ctx.answerCbQuery();  // <-- called here (line 771)
    // ... then runs analyzePair (90s timeout) then runMartingale ...
    analysis = await analyzePair(ssid, pair, timeframe);  // can take 90s
    await runMartingale(ctx, ssid, pair, analysis.direction, ...);
});
```

`answerCbQuery` is sent immediately, then the handler goes into a potentially 90-second IQ SDK analysis. If analysis times out, the error IS caught (line 787) — but the spinner already stopped 90 seconds ago. The user doesn't see the connection between their button tap and the result.

Additionally, while the handler is blocked on `analyzePair` (up to 90s), the bot cannot process ANY other updates from that chat because JavaScript is single-threaded. The handler should NOT block on long-running operations inside a callback_query handler.

**Fix:** Either:
- (a) Defer the heavy work: `answerCbQuery()` → send "Analyzing..." message → run analysis in background → edit the message with results, OR
- (b) Use `Promise.race` with a reasonable timeout and report progress via message edits

### Additional issue found in logs: `TimeoutError: Promise timed out after 90000 milliseconds`
**Source:** IQ SDK operations in `analyzePair` or `runMartingale`

The 90-second timeout is from the `p-timeout` library wrapping IQ SDK calls. This blocks the handler entirely. Users tapping repeatedly during this window create backpressure.

## Acceptance Criteria
- [ ] `bot.catch()` added: catches all handler errors, calls `answerCbQuery('⚠️ Error')` for callback queries
- [ ] All `editMessageText` calls wrapped in try/catch with `ctx.reply()` fallback
- [ ] `pair:` handler defers heavy work after `answerCbQuery` — sends progress messages
- [ ] No more "Loading..." silently disappearing without result
- [ ] Test: delete the message then click its button → user gets a reply, not silence
- [ ] Test: trigger timeout in analyzePair → user sees error, not dead loading
