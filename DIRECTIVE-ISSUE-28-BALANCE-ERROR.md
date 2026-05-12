# Issue #28 — Friendly insufficient balance error message

## Problem

When a user tries to trade without sufficient balance, they see a raw API error:

```
⚠️ Stopped: request is failed with status 4112 and message:
Cannot purchase an option: your investment amount is smaller
than the allowed minimum.
```

This is cryptic and unhelpful.

## Expected behavior

Instead of the raw error, show a friendly message with a deposit link button:

```
You do not have an active balance

Fund your account now with as little as $10 to start trading
```

With a button: **[💳 Fund Account](https://iqoption.com/pwa/payments/deposit)**

## Implementation

In the `runMartingale` function, when a trade results in an error, check if the error message contains keywords like "4112", "investment amount", "smaller than the allowed minimum", or "insufficient balance". If so, show the friendly message instead.

### Current code (bot.ts, runMartingale — around line 328-331)

```typescript
if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
    await ctx.reply(`⚠️ Stopped: ${result.error ?? result.status}`);
    return;
}
```

### Fix

```typescript
if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
    const errMsg = result.error ?? '';
    const isBalanceError = /4112|investment amount|smaller.*minimum|insufficient.*balance/i.test(errMsg);
    
    if (isBalanceError) {
        await ctx.reply(
            '🚫 *You do not have an active balance*\\n\\n'
            + 'Fund your account now with as little as $10 to start trading.',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '💳 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit' }
                    ]]
                }
            }
        );
    } else {
        await ctx.reply(`⚠️ Stopped: ${errMsg}`);
    }
    return;
}
```

Also check for the same error pattern in the `executeTradeWithSdk` function in `trade.ts` and convert it to a cleaner error string there, so the martingale loop receives a more readable error message.

### Additional: Also show "New Opportunity" button after the balance error

The error should also include the **"New Opportunity"** button (like Issue #22 added for win/loss results), so the user can immediately retry:

```typescript
{
    parse_mode: 'Markdown',
    reply_markup: {
        inline_keyboard: [
            [{ text: '💳 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit' }],
            [{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }],
        ]
    }
}
```

## Files

- `src/bot.ts` — error handler in runMartingale
- `src/trade.ts` — optionally clean up the raw error from the SDK
