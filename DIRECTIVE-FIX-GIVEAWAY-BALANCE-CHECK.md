# Fix: Giveaway min_balance check — correct fund URL + no silent fallthrough

**IMPORTANT: Merge master first**

## Bug

The `min_balance` criteria in giveaway participation has two issues:

1. **Wrong URL**: The Fund Account button links to `process.env.AFFILIATE_LINK` (signup page) instead of the IQ Option deposit page
2. **Silent catch**: Lines 177-179 catch all errors from the SDK balance fetch and silently allow participation, defeating the balance check

## Fix

**File:** `src/giveaway.ts` — lines 154-179

**Current:**
```typescript
    if (event.criteria_type === 'min_balance' && user.ssid) {
        const minBalance = parseFloat(event.criteria_value ?? '0');
        try {
            const sdk = await sdkPool.get(telegramId, user.ssid);
            try {
                const balances = (await sdk.balances()).getBalances();
                const real = balances.find((b: { type: unknown }) => b.type === BalanceType.Real);
                const amount = (real as { amount?: number } | undefined)?.amount ?? 0;
                if (amount < minBalance) {
                    return {
                        success: false,
                        message: `❌ Insufficient balance. You need at least $${minBalance} in your real account to participate.`,
                        replyMarkup: {
                            inline_keyboard: [[{
                                text: '💰 Fund Account',
                                url: process.env.AFFILIATE_LINK ?? 'https://iqbroker.com',
                            }]],
                        },
                    };
                }
            } finally {
                sdkPool.release(telegramId);
            }
        } catch {
            // Balance check failed — allow participation
        }
    }
```

**Replace with:**
```typescript
    if (event.criteria_type === 'min_balance') {
        const minBalance = parseFloat(event.criteria_value ?? '0');
        if (!user.ssid) {
            return {
                success: false,
                message: `❌ You need to connect your IQ Option account before participating.\n\nTap /connect to get started.`,
                replyMarkup: {
                    inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'ui:connect' }]],
                },
            };
        }
        try {
            const sdk = await sdkPool.get(telegramId, user.ssid);
            try {
                const balances = (await sdk.balances()).getBalances();
                const real = balances.find((b: { type: unknown }) => b.type === BalanceType.Real);
                const amount = (real as { amount?: number } | undefined)?.amount ?? 0;
                if (amount < minBalance) {
                    return {
                        success: false,
                        message: `❌ You need at least $${minBalance} in your real account to participate.\n\nFund your account and try again 👇`,
                        replyMarkup: {
                            inline_keyboard: [[{
                                text: '💰 Fund Account',
                                url: 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786',
                            }]],
                        },
                    };
                }
            } finally {
                sdkPool.release(telegramId);
            }
        } catch {
            return {
                success: false,
                message: `❌ Could not verify your balance. Please try again later or contact admin.`,
                replyMarkup: {
                    inline_keyboard: [[{ text: '👾 Contact Admin', url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' }]],
                },
            };
        }
    }
```

## Changes Summary

| Issue | Fix |
|-------|-----|
| Fund button → affiliate signup link | Changed to `https://iqoption.com/pwa/payments/deposit?payment_method_id=6786` (bank transfer) |
| No SSID → silently skips check | Returns error with Connect Account button |
| SDK error → silently allows participation | Returns error with Contact Admin button |

## Verification

1. Create a giveaway with `criteria_type = 'min_balance'` and `criteria_value = '10'`
2. User with $0 live balance clicks Participate → sees "You need at least $10" with Fund button
3. User with no SSID clicks Participate → sees "Connect your account" message
4. SDK balance fetch fails → sees "Could not verify your balance" with admin contact
5. User with $25 live balance → joins successfully
