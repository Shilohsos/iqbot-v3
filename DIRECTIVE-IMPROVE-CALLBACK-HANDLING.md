# Improve Callback Query Error Handling

## Problem
Users report that onboarding buttons ("I have an IQ Option account", "Create one free") sometimes don't respond when clicked. Error logs show:
- `[bot.catch] callback_query: 400: Bad Request: query is too old and response timeout expired or query ID is invalid`
- `[bot.catch] callback_query: 403: Forbidden: bot can't initiate conversation with a user`

While some error handling exists for "query is too old", it could be improved to provide better user experience and handle more edge cases.

## Fix Required

### 1. Enhance the existing bot.catch handler
In `src/bot.ts`, improve the `bot.catch` error handler (around line 3503) to better handle callback query errors:

```typescript
bot.catch((err, ctx) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bot.catch] ${ctx.updateType}:`, msg);
    
    // Handle expired query IDs
    if (ctx.callbackQuery && msg.includes('query is too old')) {
        ctx.answerCbQuery('⏳ This button expired. Send /start to get a fresh menu.').catch(() => { });
        ctx.editMessageText('⏳ This session expired.\\n\\nSend /start to continue.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Start Over', callback_data: 'ui:start' }]] }
        }).catch(() => { });
        return;
    }
    
    // Handle 403 Forbidden (user blocked bot)
    if (ctx.callbackQuery && msg.includes('Forbidden: bot can\\'t initiate conversation')) {
        // Silently ignore - user blocked bot, nothing we can do
        return;
    }
    
    // Handle network timeouts
    if (ctx.callbackQuery && msg.includes('timeout')) {
        ctx.answerCbQuery('⏳ Request timed out. Please try again.').catch(() => { });
        return;
    }
    
    // Handle other callback query errors
    if (ctx.callbackQuery) {
        ctx.answerCbQuery('❌ Something went wrong. Please try again or send /start.').catch(() => { });
        // Don't edit message as we don't know what state it's in
        return;
    }
    
    // Fallback for non-callback errors
    try {
        await ctx.reply('⚠️ An unexpected error occurred. Please send /start to restart the bot.', { parse_mode: 'Markdown' });
    } catch {
        // If we can't even reply, give up
    }
});
```

### 2. Add callback query validation middleware
Add a helper function to validate callback queries before processing them:

```typescript
function isValidCallbackQuery(ctx: Context): boolean {
    if (!ctx.callbackQuery) return false;
    if (!ctx.callbackQuery.id) return false;
    if (!ctx.chat?.id) return false;
    // Additional validation could be added here
    return true;
}
```

Then wrap handlers that rely on callback data with this check:

```typescript
bot.action('onboard:yes', async ctx => {
    if (!isValidCallbackQuery(ctx)) {
        await ctx.answerCbQuery('⏳ This request is no longer valid. Send /start to begin again.').catch(() => { });
        return;
    }
    // ... existing handler code
});
```

Apply this pattern to all critical callback handlers, especially onboarding and upgrade flows.

### 3. Improve logging for debugging
Add more specific logging to help diagnose issues:
```typescript
// In bot.catch, add more context
console.error(`[bot.catch] Update: ${ctx.updateType}, ChatID: ${ctx.chat?.id}, UserID: ${ctx.from?.id}, Message: ${msg}`);
```

## Files to modify
- `src/bot.ts` — enhance bot.catch handler + add validation helper + apply to critical handlers

## Verification
1. Test with expired callback queries (simulate by delaying click)
2. Verify proper error messages are shown to users
3. Check that 403 Forbidden errors are handled silently (no spam)
4. Confirm normal operation still works
