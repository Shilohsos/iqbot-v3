# Issue: Currency-aware UI — amount buttons, tier text, and custom amount prompt

## Problem
The bot hardcodes `$` throughout the UI, even after detecting the user's currency. Users with NGN (Nigerian Naira) accounts see:
- Amount buttons showing `$10`, `$25`, `$50`, `$100` instead of `₦10`, `₦25`, etc.
- Tier keyboard showing `$20+ capital` / `$100+ capital`
- Custom amount prompt not mentioning the correct currency
- Demo max validation checking `$20` hardcoded

## Required fix

### Step 1: Add currency to DB schema and UserRecord

In `src/db.ts`:
- Add `currency?: string | null;` to `UserRecord` interface (line 268)
- Add a migration or ALTER TABLE to add the column:
  ```typescript
  db.exec("ALTER TABLE users ADD COLUMN currency TEXT DEFAULT 'USD'");
  ```
  Wrap in try/catch to handle "already exists" error
- Add export function:
  ```typescript
  export function saveUserCurrency(telegramId: number, currency: string): void {
      db.prepare('UPDATE users SET currency = ? WHERE telegram_id = ?').run(currency, telegramId);
  }
  ```

### Step 2: Store currency when balance is fetched

In `src/bot.ts`, wherever balances are fetched and displayed, save the currency:
- In `sendStartMenu` (around line 406-418) — after fetching balances, if `real` exists with a currency:
  ```typescript
  if (real?.currency && real.currency !== 'USD') {
      saveUserCurrency(telegramId, real.currency);
  }
  ```
- Same in `/balance` command and login handlers

### Step 3: Make amountKeyboard() currency-aware

In `src/menu.ts`:
```typescript
const CURRENCY_SYMBOLS: Record<string, string> = {
    USD: '$', NGN: '₦', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$',
};
export function amountKeyboard(currency = 'USD'): IKMarkup {
    const sym = CURRENCY_SYMBOLS[currency] || currency;
    return {
        inline_keyboard: [
            [
                { text: `${sym}10`, callback_data: 'amt:10' },
                { text: `${sym}25`, callback_data: 'amt:25' },
                { text: `${sym}50`, callback_data: 'amt:50' },
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

### Step 4: Pass currency when calling amountKeyboard()

In `src/bot.ts`:
- In the `mode:` handler (line ~749), get user's currency and pass it:
  ```typescript
  const userCurrency = user?.currency || 'USD';
  await ctx.reply('Enter amount', { reply_markup: amountKeyboard(userCurrency) });
  ```
- Also in the custom amount prompt, mention the currency:
  ```typescript
  if (val === 'custom') {
      state.step = 'custom_amount';
      const cur = user?.currency || 'USD';
      try { await ctx.editMessageText(`✏️ Enter your custom amount (e.g. 75 ${cur}):`); } catch {}
  }
  ```

### Step 5: Demo max validation should use the user's currency

In the `amt:` handler (line ~786):
```typescript
if (state.mode === 'demo' && amt > 20) {
    await ctx.reply('❌ Demo max is $20 or equivalent.');
    return;
}
```
The demo limit is a feature of the platform, not currency-dependent — but the error message should be neutral. Just change to: `'❌ Demo maximum is $20 or equivalent.'`

### Step 6: (Optional) Tier keyboard currency

The `tierKeyboard()` in menu.ts also has `$20+ capital` / `$100+ capital` — these could also be made currency-aware but it's lower priority since it's shown during onboarding before the user has connected their account.

## Files to modify
- `src/db.ts` — Add `currency` field + migration + `saveUserCurrency()`
- `src/menu.ts` — Make `amountKeyboard()` accept optional currency param
- `src/bot.ts` — Save currency on balance fetch, pass currency to amountKeyboard(), update custom amount prompt

## Testing
1. Connect a USD account — buttons show `$10`, `$25`, etc.
2. Connect a NGN account — buttons show `₦10`, `₦25`, etc.
3. Change accounts — currency updates correctly
4. Demo mode max validation still works
5. Custom amount prompt shows correct currency
