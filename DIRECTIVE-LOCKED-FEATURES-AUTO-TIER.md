# DIRECTIVE: Locked Feature Prompt + Auto Tier Detection

## Flow
When a user clicks a locked feature, show:

### Demo → PRO prompt (for locked 30s, 1m, extra pairs, giveaways)
```
🔒 30s Timeframe — PRO Tier Required

You're currently on DEMO tier. Fund your IQ Option account
with at least $10 to automatically upgrade to PRO.

The bot detects your balance — no proof needed.
Once your balance reaches $10+, your tier upgrades automatically.

[ 💰 Fund Account ]   [ 👤 Support ]
```

### PRO → MASTER prompt (for locked 30s PRO, max martingale, etc.)
```
🔒 Ultra-Fast Trading — MASTER Tier Required

You're on PRO tier. Fund your account with at least $50
to automatically upgrade to MASTER.

The bot detects your balance — no proof needed.
Once your balance reaches $50+, your tier upgrades automatically.

[ 💰 Fund Account ]   [ 👤 Support ]
```

---

## Auto Tier Detection

### Balance Checker
On every trade, balance check, or bot start, check the user's IQ Option balance and auto-upgrade tier:

```ts
async function autoDetectTier(telegramId: number, sdk: ClientSdk): Promise<void> {
    const user = getUser(telegramId);
    if (!user?.ssid) return;
    
    try {
        const balances = await sdk.balances();
        const real = balances.getBalances().find(b => b.type === 'real');
        if (!real) return;
        
        const balance = real.amount;
        const currentTier = normalizeTier(user.tier);
        
        if (balance >= 50 && currentTier !== 'MASTER') {
            setUserTier(telegramId, 'MASTER');
            sendNotification(telegramId, 
                '🎉 *Auto-Upgraded to MASTER!*\n\n' +
                'Your balance reached $50+. All features unlocked.'
            );
        } else if (balance >= 10 && currentTier === 'DEMO') {
            setUserTier(telegramId, 'PRO');
            sendNotification(telegramId,
                '🎉 *Auto-Upgraded to PRO!*\n\n' +
                'Your balance reached $10+. New features unlocked: faster timeframes, more pairs, giveaways.'
            );
        }
    } catch {
        // balance check failed — try next time
    }
}
```

### Trigger Points
- After every trade completes
- When user clicks /start or opens menu
- On bot startup (for all connected users)
- When user clicks a locked feature (check balance first — they may have already funded)

---

## Funding Link
```
https://iqoption.com/pwa/payments/deposit
```
Use this as the default funding URL. Configurable via `FUNDING_URL` env var.

---

## Locked Feature Keyboard
Show ALL timeframes to everyone. Locked ones get 🔒 prefix:

```
[ 30s ] [ 🔒 1m ] [ 5m ]     ← Demo user sees this
[ 30s ] [ 1m ] [ 5m ]        ← PRO user sees this
```

Same pattern for pairs, martingale rounds, giveaways, leaderboard.
