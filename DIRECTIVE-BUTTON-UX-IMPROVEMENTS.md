# Issue: Button UX — loading spinner, slow /start, stale buttons

## Problem 1: Button loading spinner hangs visible

Many action handlers call `await ctx.answerCbQuery()` AFTER doing heavy backend work (DB reads, SDK calls, etc.). This means Telegram shows the "loading circle" on the button until all the work is done.

**User wants:** Every button press should trigger `answerCbQuery()` on the **very first line** of the handler, so the spinner disappears instantly and processing happens unseen in the background.

**Handlers that need fixing** (call answerCbQuery too late or at the wrong point):

| Handler | Current line | Problem |
|---------|-------------|---------|
| `tier:` (line 713) | answerCbQuery at 721 | Does DB writes first |
| `amt:` (line 771) | answerCbQuery at 796 | Does session logic first |
| `tf:` (line 799) | answerCbQuery at 805 | Does state changes first |
| `page:` (line 826) | answerCbQuery at 834 | Does logic first |
| `pair:` (line 838) | answerCbQuery at 850 | Deletes session first |

**Fix for all:** Move `await ctx.answerCbQuery()` to be the first executable line of every `bot.action()` handler, before any variable declaration or logic. Some handlers already do this correctly (e.g., `onboard:yes`, `mode:`, `admin:today`) — use those as the pattern.

## Problem 2: Stale button clicks crash silently

When a user clicks a callback button after ~60 seconds, Telegram returns `400: query is too old and response timeout expired or query ID is invalid`. Currently `bot.catch()` just replies "⚠️ Error occurred. Try again."

**User wants:** When a stale button is detected, the bot should automatically send a fresh main menu (like `/start` would) so the user can continue from a clean state.

**Fix:** In the `bot.catch()` handler (around line 2117), detect stale query errors and send the start menu:

```typescript
bot.catch((err: unknown, ctx: Context) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bot.catch] ${ctx.updateType}:`, msg);
    
    // Stale callback query → send fresh menu
    if (ctx.callbackQuery && msg.includes('query is too old')) {
        ctx.answerCbQuery('⏳ Session expired. Reloading...').catch(() => {});
        sendStartMenu(ctx).catch(() => {});
        return;
    }
    
    if (ctx.callbackQuery) {
        ctx.answerCbQuery('⚠️ Error occurred. Try again.').catch(() => {});
    } else {
        ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
    }
});
```

## Problem 3: /start takes too long for new/approved users

Sometimes /start takes up to a minute to respond. The 5-second timeout on balance fetch is in place, but the issue may be:

- **Onboarding path** — `startOnboarding()` tries to send images (`L1.png` etc.) — if the image file doesn't exist or is large, sending could block
- **Approved users** — the balance fetch with `ClientSdk.create()` still takes time even with the 5s timeout

**Investigate:** Check if the L1-L13 asset images exist on disk. If missing, `replyWithPhoto` with `catch {}` should still be fast, but verify.

**Possible fix:** If no balance is cached and fetching fails/times out, immediately fall back to showing the menu without a balance line rather than waiting the full 5s for the timeout.

## Files to modify
- `src/bot.ts`:
  - All `bot.action()` handlers — move `answerCbQuery()` to first line
  - `bot.catch()` — add stale button recovery (send start menu)
  - Consider reducing balance fetch timeout from 5s to 3s
