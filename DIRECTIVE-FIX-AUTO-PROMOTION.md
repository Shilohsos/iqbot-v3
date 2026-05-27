# Fix: Auto-Promotion Not Firing for Many Users

## Problem
Auto-tier promotion (balance ≥$10 → PRO, ≥$50 → MASTER) only fires during:
1. Trade execution
2. `/balance` command

But NOT on `/start`, and NOT periodically. Users who fund their account then open the bot via `/start` stay DEMO until they trade or know to type `/balance`.

## Fix Required

### 1. Add balance check + auto-promotion to `/start`
In `src/bot.ts`, modify `sendStartMenu()` (around line 574) to fetch balance and auto-promote for approved users who have an SSID.

After the user tier setup (around line 604), add:

```typescript
// Auto-promote based on live balance on /start
if (user.ssid) {
    try {
        const sdk = await sdkPool.get(telegramId, user.ssid);
        try {
            const balances = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
            const real = balances.find((b: { type: unknown }) => b.type === BalanceType.Real);
            if (real && real.amount > 0) {
                const currency = real.currency ?? 'USD';
                const usdAmount = await convertToUsd(real.amount, currency, sdk);
                const newTier = autoPromoteTier(telegramId, usdAmount, user.tier ?? 'DEMO');
                if (newTier && newTier !== user.tier) {
                    const oldTier = user.tier;
                    setUserTier(telegramId, newTier);
                    user.tier = newTier;
                    logger.info('bot', `auto-promoted user ${telegramId} from ${oldTier} to ${newTier} on /start (${currency} ${real.amount.toFixed(2)} ≈ $${usdAmount.toFixed(2)})`);
                }
            }
        } finally {
            sdkPool.release(telegramId);
        }
    } catch {
        // Balance fetch failed on /start — non-blocking
    }
}
```

### 2. Add periodic auto-promotion check (every 30min)
In `src/bot.ts`, after the existing background intervals (around line 3793), add:

```typescript
// Periodically check and auto-promote users who have SSIDs
backgroundIntervals.push(setInterval(async () => {
    try {
        const users = getAllUserIds().map(id => getUser(id)).filter(u => u && u.ssid && u.tier !== 'MASTER');
        for (const user of users) {
            try {
                const sdk = await sdkPool.get(user.telegram_id, user.ssid);
                try {
                    const balances = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
                    const real = balances.find((b: { type: unknown }) => b.type === BalanceType.Real);
                    if (real && real.amount > 0) {
                        const currency = real.currency ?? 'USD';
                        const usdAmount = await convertToUsd(real.amount, currency, sdk);
                        const newTier = autoPromoteTier(user.telegram_id, usdAmount, user.tier ?? 'DEMO');
                        if (newTier && newTier !== user.tier) {
                            const oldTier = user.tier;
                            setUserTier(user.telegram_id, newTier);
                            logger.info('bot', `auto-promoted user ${user.telegram_id} from ${oldTier} to ${newTier} via periodic check (${currency} ${real.amount.toFixed(2)} ≈ $${usdAmount.toFixed(2)})`);
                        }
                    }
                } finally {
                    sdkPool.release(user.telegram_id);
                }
            } catch {
                // Individual user check failed — skip
            }
            await new Promise(r => setTimeout(r, 500)); // Rate limit: 2 SDK calls/sec
        }
    } catch (err) {
        logger.error('bot', `periodic auto-promote error: ${err instanceof Error ? err.message : err}`);
    }
}, 30 * 60_000));
```

### 3. Import additions
Ensure these are imported at the top of `bot.ts` (most already are):
- `autoPromoteTier`, `convertToUsd` from `'./tiers.js'` ✅ (line 7)
- `sdkPool` from `'./sdk-pool.js'` ✅  
- `BalanceType` from `'./index.js'` ✅
- `withTimeout` from `'./utils.js'` ✅
- `setUserTier` from `'./db.js'` ✅
- `getAllUserIds`, `getUser` from `'./db.js'` ✅
- `logger` from `'./logger.js'` ✅

## Files to modify
- `src/bot.ts` — add balance check to `sendStartMenu` + add periodic interval

## Verification
1. User funds account to $10+
2. User types /start → bot fetches balance → auto-upgrades to PRO
3. User waits 30min → periodic check runs → any newly funded users get upgraded
4. Check logs for `[auto-promoted user ...]` messages
