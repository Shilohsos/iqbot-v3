# Directive: Fix Demo Amount Currency — NGN Users Can't Trade Demo

**IMPORTANT: Merge master first** — this directive builds on latest master.

## Problem

The amount keyboard shows the user's currency symbol (`₦` for NGN users) but the amounts are always treated as USD internally. The demo limit check (`amount > 20`) compares the raw number to $20 without conversion, so NGN users are blocked on `₦25`, `₦50`, `₦100` because 25, 50, 100 > 20 — even though those are only ~$0.02-$0.07.

This means NGN demo users can ONLY use the `₦10` button — everything else returns "Demo max is $20 or equivalent."

## Root Cause

`src/menu.ts` line 15-30: `amountKeyboard()` uses the user's stored currency symbol but the callback values (`amt:10`, `amt:25`, etc.) are raw numbers treated as USD everywhere downstream (trade execution, limit checks).

## Changes Required

### 1. `src/menu.ts` — `amountKeyboard()`

Remove the `currency` parameter. Always hardcode `$` as the symbol. The bot only trades in USD internally, so showing `₦` is misleading.

**Before:**
```typescript
export function amountKeyboard(currency = 'USD'): IKMarkup {
    const sym = CURRENCY_SYMBOLS[currency] || currency;
    return {
        inline_keyboard: [
            [
                { text: `${sym}10`,  callback_data: 'amt:10' },
                { text: `${sym}25`,  callback_data: 'amt:25' },
                { text: `${sym}50`,  callback_data: 'amt:50' },
                { text: `${sym}100`, callback_data: 'amt:100' },
            ],
            [
                { text: '✏️ Custom', callback_data: 'amt:custom' },
                { text: '❌ Cancel', callback_data: 'wizard:cancel' },
            ],
        ],
    };
}
```

**After:**
```typescript
export function amountKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '$10',  callback_data: 'amt:10' },
                { text: '$25',  callback_data: 'amt:25' },
                { text: '$50',  callback_data: 'amt:50' },
                { text: '$100', callback_data: 'amt:100' },
            ],
            [
                { text: '✏️ Custom', callback_data: 'amt:custom' },
                { text: '❌ Cancel', callback_data: 'wizard:cancel' },
            ],
        ],
    };
}
```

### 2. `src/bot.ts` — Update all callers of `amountKeyboard`

**Line 1230:** Change:
```typescript
const modeUser = getUser(ctx.from!.id);
await ctx.reply('Enter amount', { reply_markup: amountKeyboard(modeUser?.currency ?? 'USD') });
```
To:
```typescript
await ctx.reply('Enter amount', { reply_markup: amountKeyboard() });
```

**Line 1547:** Change:
```typescript
await ctx.reply('💰 Enter amount for Live trade:', { reply_markup: amountKeyboard(upsellLiveUser?.currency ?? 'USD') });
```
To:
```typescript
await ctx.reply('💰 Enter amount for Live trade:', { reply_markup: amountKeyboard() });
```

**Line 1557:** Change:
```typescript
await ctx.reply('💰 Enter amount for Demo trade:', { reply_markup: amountKeyboard(upsellDemoUser?.currency ?? 'USD') });
```
To:
```typescript
await ctx.reply('💰 Enter amount for Demo trade:', { reply_markup: amountKeyboard() });
```

**Line 1818:** Change:
```typescript
await ctx.reply('Enter trade amount (USD):', { reply_markup: amountKeyboard('USD') });
```
To:
```typescript
await ctx.reply('Enter trade amount (USD):', { reply_markup: amountKeyboard() });
```

### 3. `src/bot.ts` — import cleanup

Remove `amountKeyboard` from the destructured imports at the top of bot.ts if `amountKeyboard` is now the only import from menu.ts used — but keep it since `amountKeyboard` is still imported. No change needed to imports since `amountKeyboard` is still used.

### 4. `typings` / `menu.ts` — Remove unused `currency` parameter (type-safe)

If `CURRENCY_SYMBOLS` becomes unused in `menu.ts` after this change, remove its import too.

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Run `node dist/menu.js` — amountKeyboard returns static `$` buttons
3. In bot: Verify a NGN user clicking "Trade Demo" sees `$10`, `$25`, `$50`, `$100` buttons
4. Verify `$25` on demo does NOT return "Demo max is $20" (25 > 20 is correct — $25 IS over $20)

## Migration

No data migration needed. This is a pure UI/code change. No DB changes.
