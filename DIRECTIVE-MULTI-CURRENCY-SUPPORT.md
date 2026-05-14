# Issue: Multi-currency support (NGN accounts show "No balance")

## Problem
When a user has an IQ Option account in NGN (Nigerian Naira) instead of USD, the bot says "No real balance found" and refuses to trade. Two root causes:

### 1. Balance type mismatch in trade.ts (line 49-52)
```typescript
const selectedBalance = balances.getBalances().find(b =>
    b.type === (wantLive ? BalanceType.Real : BalanceType.Demo)
);
if (!selectedBalance) return errorResult(trade, wantLive ? 'No real balance found' : 'No demo balance found');
```
NGN accounts may report their balance with a different typeId that the SDK converts to `undefined` (the `convertBalanceType` method at index.ts:1452 only maps typeId=1→Real and typeId=4→Demo). So `b.type` is `undefined` and the find fails.

### 2. Hardcoded $ currency in bot.ts
All balance display lines hardcode `$`:
- `sendStartMenu` line 410: `` `Practice $${demo.amount.toFixed(2)}` ``
- `sendStartMenu` line 411: `` `Real $${real.amount.toFixed(2)}` ``
- `/balance` command lines 1117-1118: same pattern
- Login confirmation lines 2035-2036: same pattern

The `Balance` class has a working `currency` field (`this.currency = msg.currency`) that contains values like "USD", "NGN", "EUR" etc. — but it's never used.

## Required fix

### In `src/trade.ts` (line 49-51) — Balance selection
Replace the strict type-only match with a fallback strategy:

```typescript
let selectedBalance = balances.getBalances().find(b =>
    b.type === (wantLive ? BalanceType.Real : BalanceType.Demo)
);
// Fallback: if no exact type match, try any balance with the same 'live' intent
if (!selectedBalance) {
    // For live, take any real balance by type (even if type is undefined in SDK enum)
    if (wantLive) {
        selectedBalance = balances.getBalances().find(b => b.type === undefined || b.type === BalanceType.Real);
    } else {
        selectedBalance = balances.getBalances().find(b => b.type === undefined || b.type === BalanceType.Demo);
    }
}
if (!selectedBalance) return errorResult(trade, 'No balance found');
```

### In `src/bot.ts` — Currency-aware display
Create a helper function that returns the correct currency symbol:

```typescript
const CURRENCY_SYMBOLS: Record<string, string> = {
    'USD': '$',
    'NGN': '₦',
    'EUR': '€',
    'GBP': '£',
    'JPY': '¥',
    'AUD': 'A$',
    'CAD': 'C$',
};
function fmtBalance(balance: { amount: number; currency?: string }): string {
    const sym = (balance.currency && CURRENCY_SYMBOLS[balance.currency]) || balance.currency || '$';
    return `${sym}${balance.amount.toFixed(2)}`;
}
```

Then replace ALL occurrences of:
- `` `Practice $${demo.amount.toFixed(2)}` `` → `` `Practice ${fmtBalance(demo)}` ``
- `` `Real $${real.amount.toFixed(2)}` `` → `` `Real ${fmtBalance(real)}` ``
- Same pattern in `/balance` command and login confirmation

## Files to modify
- `src/bot.ts` — Add `fmtBalance` helper, update all 6 balance display lines (sendStartMenu, /balance, login ×2)
- `src/trade.ts` — Add balance fallback for undefined type, also apply fmtBalance to any error messages showing balance info

## Testing
1. Connect a USD account — should still show `Real $500.00`
2. Connect a NGN account — should show `Real ₦500.00` instead of "No balance found"
3. Trade on NGN account — should execute successfully
4. Demo balance should still show correctly
