# DIRECTIVE: 10x Yacht Club Join Button + Balance Gate

## IMPORTANT: Merge master first

Before implementing, merge the latest master into your working branch.

## Overview

Add a single "Join 10x Yacht Club" button to the bot's start menu that:
1. Checks the user's IQ Option real balance (live SDK check, not cached)
2. If balance < $50 → shows Yacht Club info + minimum requirement
3. If balance >= $50 → reveals the channel invite link

## 1. Add button to start menu

**File:** `src/ui/user.ts` — `startKeyboard()` function

Add a new row with a single button (not paired):

```typescript
[{ text: '🛥️ Join 10x Yacht Club', callback_data: 'ui:yacht' }]
```

Place it after the existing trading buttons, before the admin button (if applicable).

## 2. Create the callback handler

**File:** `src/bot.ts`

Add a new handler:

```typescript
bot.action('ui:yacht', async ctx => {
    await ctx.answerCbQuery();
    
    const uid = ctx.from!.id;
    const user = getUser(uid);
    const ssid = getSsidForUser(uid);
    
    if (!ssid) {
        await ctx.reply(
            `🛥️ *10x Yacht Club* — Premium Trading Circle\n\n`
            + `A premium community for serious 10x AI traders. Daily live sessions with Shiloh, milestones, giveaways, and a proven process to help you cover daily expenses and reach your dream purchases.\n\n`
            + `👑 *Entry requirement:* $50 minimum funded IQ Option account.\n\n`
            + `Connect your account first to check eligibility.`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                [{ text: '🔗 Connect Account', callback_data: 'ui:connect' }],
                [{ text: '🔙 Back', callback_data: 'ui:start' }],
            ]}}
        );
        return;
    }
    
    // Live balance check via SDK
    try {
        const sdk = await sdkPool.get(uid, ssid);
        let realBalance: { amount: number; currency: string } | null = null;
        try {
            const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
            const real = all.find((b: any) => b.type === BalanceType.Real);
            if (real) {
                realBalance = { amount: real.amount, currency: real.currency ?? 'USD' };
            }
        } finally {
            sdkPool.release(uid);
        }
        
        if (!realBalance || realBalance.amount <= 0) {
            await ctx.reply(
                `🛥️ *10x Yacht Club* — Premium Trading Circle\n\n`
                + `A premium community for serious 10x AI traders. Daily live sessions with Shiloh, milestones, giveaways, and a proven process to help you cover daily expenses and reach your dream purchases.\n\n`
                + `👑 *Entry requirement:* $50 minimum funded IQ Option account.\n\n`
                + `It looks like your account has no real balance. Fund your account with at least $50 to join.`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                    [{ text: '💰 Fund Account', url: DEPOSIT_URL }],
                    [{ text: '🔙 Back', callback_data: 'ui:start' }],
                ]}}
            );
            return;
        }
        
        const usdAmount = await convertToUsd(realBalance.amount, realBalance.currency, sdk);
        if (usdAmount !== null && usdAmount < 50) {
            await ctx.reply(
                `🛥️ *10x Yacht Club* — Premium Trading Circle\n\n`
                + `A premium community for serious 10x AI traders. Daily live sessions with Shiloh, milestones, giveaways, and a proven process to help you cover daily expenses and reach your dream purchases.\n\n`
                + `👑 You need a minimum of **$50** funded to access the Yacht Club.\n`
                + `Your current balance is **~$${usdAmount.toFixed(2)}**.\n\n`
                + `Fund your account with at least $50 to unlock access.`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                    [{ text: '💰 Fund Account', url: DEPOSIT_URL }],
                    [{ text: '🔙 Back', callback_data: 'ui:start' }],
                ]}}
            );
            return;
        }
        
        // If balance >= $50 equivalent — show the invite
        await ctx.reply(
            `🛥️ *You qualify for the 10x Yacht Club!*\n\n`
            + `Welcome to the inner circle. Click below to join:\n\n`
            + `👉 [Join 10x Yacht Club](https://t.me/+Y3LbEi18ECVmMWI0)\n\n`
            + `See you inside. 💜`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (err) {
        // Handle auth errors gracefully
        if (isAuthExpiredError(err)) {
            const reconnected = await autoReconnect(uid);
            if (reconnected) {
                // Retry by re-triggering this handler's logic
                // For simplicity, show info + reconnect button
                await ctx.reply(
                    `🛥️ *10x Yacht Club*\n\nYour session was refreshed. Tap the button again to check.`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                        [{ text: '🛥️ Check Again', callback_data: 'ui:yacht' }],
                    ]}}
                );
                return;
            }
            clearUserSsid(uid);
            setSsidValid(uid, 0);
        }
        
        // Fallback: show info with generic message
        await ctx.reply(
            `🛥️ *10x Yacht Club* — Premium Trading Circle\n\n`
            + `A premium community for serious 10x AI traders. Daily live sessions with Shiloh, milestones, giveaways, and a proven process to help you cover daily expenses and reach your dream purchases.\n\n`
            + `👑 *Entry requirement:* $50 minimum funded IQ Option account.\n\n`
            + `Could not verify your balance right now. Try again later.`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                [{ text: '🔄 Try Again', callback_data: 'ui:yacht' }],
                [{ text: '🔙 Back', callback_data: 'ui:start' }],
            ]}}
        );
    }
});
```

## 3. Yacht Club description text

The description text is repeated in multiple branches. Consider extracting to a constant for maintainability:

```typescript
const YACHT_CLUB_DESC = `A premium community for serious 10x AI traders. Daily live sessions with Shiloh, milestones, giveaways, and a proven process to help you cover daily expenses and reach your dream purchases.`;
```

## Important Notes

- The channel is public: `@xyachtclub` (t.me/+Y3LbEi18ECVmMWI0)
- 3,000 member limit — exclusive
- $50 minimum funded balance required
- The button should be a **single standalone button** in its own row — not paired with another button
- Use a live SDK balance check, NOT cached `funded_balance_usd` — the user's real IQ Option balance must be queried fresh each time
- The `sdk` variable inside the catch block after `sdkPool.release()` is already released — the catch path should handle this gracefully (the `sdk` reference in `convertToUsd` on line ~54 is problematic because the try/finally released it already. See the balance check pattern in `auto:god` handler for the correct try/catch/finally structure with sdk release)
