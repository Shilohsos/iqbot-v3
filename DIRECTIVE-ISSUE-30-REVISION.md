# Fix Instructions for Claude — Issue 30 Revision

## IMPORTANT: Merge master first

Before making any changes, merge the latest master into your working branch:

```bash
git fetch origin
git merge origin/master
```

This will give you `DIRECTIVE-ISSUE-30.md` which contains the complete spec. Read it fully before touching any code.

## What The Directive Actually Requires

### Bug 1: `bot.catch()` must answerCbQuery

Your fix added `bot.catch()` but it does NOT call `answerCbQuery()` for callback_query errors. When a callback query handler crashes before reaching `answerCbQuery`, Telegram keeps the "Loading..." spinner for 30 seconds until its own timeout fires. The user sees nothing happen.

**Fix:** Check `ctx.callbackQuery` and answer it to stop the spinner:

```typescript
bot.catch((err: unknown, ctx) => {
    console.error(`[bot.catch] ${ctx.updateType}:`, err);
    if (ctx.callbackQuery) {
        ctx.answerCbQuery('⚠️ Error occurred. Try again.').catch(() => {});
    } else {
        ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
    }
});
```

### Bug 2: Empty catch blocks — missing ctx.reply() fallback

You wrapped `editMessageText` in try/catch on upsell handlers but left the catch block empty:

```typescript
try { await ctx.editMessageText('✅ Switched to Live mode!...'); } catch {}
```

When the original message was auto-deleted (1-hour cleanup), the user clicks the button and gets ZERO feedback — no error, no response, nothing. The directive requires a `ctx.reply()` fallback to tell the user the action still completed.

**Fix:** Add fallback reply in catch blocks where the message carries important info:

```typescript
try { await ctx.editMessageText('✅ Switched to Live mode!...'); }
catch { await ctx.reply('✅ Switched to Live mode!...'); }
```

### Bug 3: pair: handler blocking — NOT addressed

The pair handler still calls `answerCbQuery()` on line 771, then runs `analyzePair()` (90s timeout) and `runMartingale()`. This was the main source of timeout errors in the logs:

```
[unhandledRejection] TimeoutError: Promise timed out after 90000 milliseconds
```

**Fix required:** After `answerCbQuery()`, instead of running heavy IQ SDK calls inline, send progress messages first:

```
ctx.answerCbQuery() → reply "Analyzing markets..." → run analyzePair/trade → edit that message with result
```

### Bug 4 (new): Admin panel handlers not checked

Search ALL `bot.action()` handlers in `src/bot.ts` for `editMessageText` and `editMessageReplyMarkup` — the admin panel has many that also need try/catch wrappers.

### Bug 5: Do NOT delete the directive file

Your branch removed DIRECTIVE-ISSUE-30.md. Keep it; the directive file is the source of truth.
