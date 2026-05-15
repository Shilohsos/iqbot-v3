# Issue: Stale button recovery floods bot with concurrent sendStartMenu calls

## Problem
The previous fix for stale buttons (DIRECTIVE-BUTTON-UX-IMPROVEMENTS) introduced a critical performance bug:

### What happens
When a user clicks a stale callback button (or Telegram replays old callback queries after a restart), the `bot.catch()` handler calls `sendStartMenu(ctx)` for **every single stale click**.

This causes:
1. Multiple concurrent `sendStartMenu()` calls — each one may trigger balance fetches, onboarding images, DB queries
2. A self-inflicted DDOS — 20+ stale clicks at once = 20+ full menu rebuilds
3. The bot becomes unresponsive for ALL users while processing these
4. This is what caused the buttons to be slow this morning

### Evidence
Error log showing flood after restart:
```
[bot.catch] callback_query: 400: Bad Request: query is too old ...
[bot.catch] callback_query: 400: Bad Request: query is too old ...
... (30+ of these in seconds)
[bot.catch] callback_query: Promise timed out after 90000 milliseconds
```

The 90s timeout is the Telegraf default wrapping a handler that got stuck in the flood.

### My temp fix (commit 8822eb5)
I replaced the `sendStartMenu()` call with a silent dismiss:
```typescript
if (ctx.callbackQuery && msg.includes('query is too old')) {
    ctx.answerCbQuery().catch(() => {});
    return;
}
```

## Required proper fix from Claude
The silent dismiss works but the user deserves feedback that their action was received. Implement a proper solution:

### Option A (Recommended): Lightweight redirect
Instead of calling `sendStartMenu()` (heavy), send a simple inline message:
```typescript
if (ctx.callbackQuery && msg.includes('query is too old')) {
    await ctx.answerCbQuery('⏳ Expired');
    try {
        await ctx.editMessageText(
            '⏳ This session expired.\n\nSend /start to continue.',
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Start Over', callback_data: 'ui:start' }]] } }
        );
    } catch {}
    return;
}
```
This is lightweight — no DB calls, no balance fetches, no images. Just edits the stale message text.

### Option B: ui:start handler (if it exists)
Check if there's already a `ui:start` or similar handler that just shows the menu. Use that instead of `sendStartMenu()`.

### What NOT to do
- ❌ Do NOT call `sendStartMenu()` — it's heavy and triggers onboarding/balance fetch
- ❌ Do NOT send images or large payloads
- ❌ Do NOT answer with text that keeps the user waiting

## Files to modify
- `src/bot.ts` — `bot.catch()` handler around line 2133

## Verification
1. Click a stale button → should get "⏳ Expired" + message text updated
2. No flood of concurrent DB/IQ Option API calls in logs
3. Bot stays responsive for other users during stale clicks
4. No 90s timeout errors appear
