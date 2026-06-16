# DIRECTIVE: Live SDK Balance Check for Trade Mode Gates

## IMPORTANT: Merge master first
Before implementing, merge the latest master into your working branch. The codebase has recent changes to the product gating system.

## Problem

When a user clicks **Trade Live** (AI Trading or Auto Trading), the bot checks `funded_balance_usd` from the **DB cache** — which is only updated during `/start` menu. If a user funded their IQ Option account **after** connecting to the bot, their DB value is still `0.0` and the gate incorrectly blocks them.

**Example:** User Mike4b has $20 in IQ Option but bot shows "You have $0.00 funded" because the DB was never refreshed after his deposit.

## Files to Modify

### 1. `src/bot.ts` — `mode:live` handler (AI Trading balance gate)

**Location:** Lines ~1498-1512 (inside `bot.action(/^mode:(demo|live)$/)`)

**Current code:**
```typescript
} else {
    // Live mode — check if user has enough balance (only for new funders without existing access)
    const user = getUser(ctx.from!.id);
    const funded = (user?.funded_balance_usd ?? 0);
    const hasAccessViaToken = hasAccess(user?.access_level, 'ai_trading');
    if (!hasAccessViaToken && funded < PRODUCT_LIMITS.ai_trading.unlockBalance) {
        await ctx.reply(
            `⚠️ Live trading requires $${PRODUCT_LIMITS.ai_trading.unlockBalance}+ funded.\n\nYou have $${funded.toFixed(2)} funded. Use Demo mode or fund your account.`,
            { reply_markup: { inline_keyboard: [
                [{ text: '💰 Fund Account', url: DEPOSIT_URL }],
                [{ text: '🔄 Trade Demo', callback_data: 'mode:demo' }],
            ]}}
        );
        return;
    }
}
```

**Required change:** Replace the static `getUser()` read with a live SDK balance check that:
1. Gets the user's SSID
2. Creates an SDK via sdkPool
3. Calls `sdk.balances()` with timeout
4. Finds the Real balance
5. Converts to USD via `convertToUsd()`
6. Updates `setUserFundedBalance()` in the DB
7. Then re-checks the threshold against the **fresh** balance

**Pattern to follow:** The `/start` callback handler at lines ~1058-1087 already does this exact SDK query — use the same pattern. Key excerpt:
```typescript
const sdk = await sdkPool.get(telegramId, ssid!);
const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
const real = all.find(b => b.type === BalanceType.Real);
if (real) {
    const usdAmount = await convertToUsd(real.amount, real.currency ?? 'USD', sdk);
    if (usdAmount !== null) {
        const newAccess = resolveAccess(usdAmount, getProduct(user.access_level), user.access_expires_at);
        setUserFundedBalance(telegramId, usdAmount, newAccess);
        user.access_level = newAccess;
        user.funded_balance_usd = usdAmount;
        // ... then check threshold against usdAmount
    }
}
```

**Error handling:** If the SDK call fails (auth expired, timeout, network error):
- If `isAuthExpiredError(err)` → try `autoReconnect()`, and if reconnected, retry balances
- If still fails → fall back to the cached DB value (current behavior) — show the gate message with cached value
- Always release the SDK back to the pool in a `finally` block

### 2. `src/bot.ts` — `auto:start:live` handler (Auto Trading balance gate)

**Location:** Lines ~2507-2517

**Current code:**
```typescript
bot.action('auto:start:live', async ctx => {
    await ctx.answerCbQuery();
    const user = getUser(ctx.from!.id);
    const funded = user?.funded_balance_usd ?? 0;
    const hasAccessViaToken = hasAccess(user?.access_level, 'auto_trading');
    if (ctx.from!.id !== getAdminId() && !hasAccessViaToken && funded < PRODUCT_LIMITS.auto_trading.unlockBalance) {
        await ctx.reply(
            `⚠️ Live trading requires $${PRODUCT_LIMITS.auto_trading.unlockBalance}+ funded.\n\nYou have $${funded.toFixed(2)} funded. Use Demo mode or fund your account.`,
            { reply_markup: { inline_keyboard: [[{ text: '💰 Fund Account', url: DEPOSIT_URL }], [{ text: '🎮 Demo Mode', callback_data: 'auto:start:demo' }]] } }
        );
        return;
    }
```

**Required change:** Same pattern as the `mode:live` handler above. Replace the `getUser()` read with a live SDK balance check before the gate.

**Important:** Keep the admin bypass at line 2512 (`ctx.from!.id !== getAdminId()`) — admin always passes through regardless of balance. The live SDK check should only run for non-admin users who don't already have access via token.

## Edge Cases to Handle

1. **User has no SSID** (never connected) — skip SDK check, show standard "Connect Account" prompt
2. **SSID expired** — try `autoReconnect()` first, if fails show reconnect prompt
3. **SDK times out** (15s timeout on balances) — fall through to cached DB value with a soft warning
4. **No Real balance found** (demo-only account) — treat as $0 funded, show gate message
5. **Conversion rate unavailable** (`convertToUsd` returns null) — don't re-gate, allow fallback to cached value

## Verification

After implementation:
1. A user with funded_balance_usd=0 in DB but $20+ in IQ Option should pass the Trade Live gate
2. A user with $0 real balance should still see the gate message
3. Admin always bypasses the gate
4. Token holders (access_level = 'ai_trading' / 'auto_trading') still bypass
5. Errors don't crash the handler — fall through gracefully
