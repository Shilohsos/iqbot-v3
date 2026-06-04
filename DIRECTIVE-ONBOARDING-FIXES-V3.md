# Fix: Onboarding flow — @username, balance display, first-trade experience

**IMPORTANT: Merge master first**

## Overview

Three fixes in one directive:

1. **`@username` literal** in password prompt — `resolveUsername()` not called
2. **Hardcoded `$10,000.00`** in connected message — real SDK balances fetched but discarded
3. **First demo trade** hits upsell pitch immediately — should show congrats + command guide + main menu instead

---

## Fix 1: Resolve `@username` in password prompt

**File:** `src/onboarding.ts` — function `handleEmailCollected()` (line 180)

**Current:**
```typescript
export async function handleEmailCollected(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'awaiting_password');
    const t = getTemplateByKey('awaiting_password');
    await ctx.reply(t?.message ?? '🔑 Now enter your password:');
}
```

**Replace with:**
```typescript
export async function handleEmailCollected(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'awaiting_password');
    const t = getTemplateByKey('awaiting_password');
    const name = firstName(ctx);
    await ctx.reply(t ? resolveUsername(t.message, name) : '🔑 Now enter your password:');
}
```

**Verification:** `npx tsc --noEmit` — passes. Template message with `@username` now resolves to user's first name.

---

## Fix 2: Show real balances in connected message

**Root cause:** In the state-machine onboarding path (`awaiting_password` handler, bot.ts lines 4042-4050), the SDK's `balances()` is called and both demo/real balances are fetched, but they're **local variables that are never used**. The code then calls `handleConnected()` which uses the `connected_success` template with hardcoded `$10,000.00`.

### Step 2a — Update `handleConnected` to accept balance text

**File:** `src/onboarding.ts` — function `handleConnected()` (line 187)

**Current:**
```typescript
export async function handleConnected(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'connected');
    const name = firstName(ctx);
    const t = getTemplateByKey('connected_success');
    const msg = t ? resolveUsername(t.message, name) : `✅ Connected ${name}! 💜\n\nYou're locked in. The bot is ready.`;
    await ctx.reply(msg, {
        reply_markup: makeKeyboard([[{ text: 'Take a trade 👾', callback_data: 'ui:trade' }]]),
    });
}
```

**Replace with:**
```typescript
export async function handleConnected(ctx: Context, telegramId: number, balanceText?: string): Promise<void> {
    setOnboardingState(telegramId, 'connected');
    const name = firstName(ctx);
    let msg: string;
    if (balanceText) {
        msg = `✅ Connected ${name}! 💜\n\n${balanceText}\n\nYou're now locked in. The 10x Special Bot is live and ready.\n\n👇 Tap below to take your first trade.`;
    } else {
        const t = getTemplateByKey('connected_success');
        msg = t ? resolveUsername(t.message, name) : `✅ Connected ${name}! 💜\n\nYou're locked in. The bot is ready.`;
    }
    await ctx.reply(msg, {
        reply_markup: makeKeyboard([[{ text: 'Take a trade 👾', callback_data: 'ui:trade' }]]),
    });
}
```

### Step 2b — Pass balances from `awaiting_password` handler

**File:** `src/bot.ts` — the `awaiting_password` handler (lines 4036-4052)

**Current:**
```typescript
try {
    const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, text), 12_000, 'login');
    saveUser({ telegram_id: ctx.from!.id, ssid });
    saveUserCred(ctx.from!.id, Buffer.from(`${email}:${text}`).toString('base64'), email);
    setSsidValid(ctx.from!.id, 1);
    await clearReconnectPromptMessage(ctx.from!.id);
    try {
        const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
        const real = all.find(b => b.type === BalanceType.Real);
        const demo = all.find(b => b.type === BalanceType.Demo);
        if (real?.currency) saveUserCurrency(ctx.from!.id, real.currency);
        else if (demo?.currency) saveUserCurrency(ctx.from!.id, demo.currency);
    } finally {
        sdk.shutdown().catch(() => {});
    }
    onboardSessions.delete(chatId);
    await handleConnected(ctx, ctx.from!.id);
} catch (err) {
```

**Replace with:**
```typescript
try {
    const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, text), 12_000, 'login');
    saveUser({ telegram_id: ctx.from!.id, ssid });
    saveUserCred(ctx.from!.id, Buffer.from(`${email}:${text}`).toString('base64'), email);
    setSsidValid(ctx.from!.id, 1);
    await clearReconnectPromptMessage(ctx.from!.id);
    let balanceText: string | undefined;
    try {
        const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
        const real = all.find(b => b.type === BalanceType.Real);
        const demo = all.find(b => b.type === BalanceType.Demo);
        if (real?.currency) saveUserCurrency(ctx.from!.id, real.currency);
        else if (demo?.currency) saveUserCurrency(ctx.from!.id, demo.currency);
        const parts: string[] = [];
        if (demo) parts.push(`🎮 Practice: ${fmtBalance(demo)}`);
        if (real) parts.push(`💎 Live: ${fmtBalance(real)}`);
        if (parts.length) balanceText = parts.join('\n');
    } finally {
        sdk.shutdown().catch(() => {});
    }
    onboardSessions.delete(chatId);
    await handleConnected(ctx, ctx.from!.id, balanceText);
} catch (err) {
```

---

## Fix 3: First demo trade — congrats + command guide (skip upsell)

**Root cause:** `showDemoUpsell()` runs on EVERY demo trade win with no trade-count check. The first trade should show a welcome/congrats flow instead.

### Step 3a — Add `getDemoTradeCount` helper

**File:** `src/db.ts` — add after `incrementDemoTradeCount()` (after line 2073)

```typescript
export function getDemoTradeCount(telegramId: number): number {
    const row = db.prepare('SELECT demo_trade_count FROM onboarding_tracking WHERE telegram_id = ?').get(telegramId) as { demo_trade_count: number } | undefined;
    return row?.demo_trade_count ?? 0;
}
```

Also add `getDemoTradeCount` to the exports in `src/onboarding.ts` line 9:
```
getOnboardingTracking, setLastFundingAt, incrementDemoTradeCount,
```
→
```
getOnboardingTracking, setLastFundingAt, incrementDemoTradeCount, getDemoTradeCount,
```

And in `src/bot.ts` line 63:
```
    getStuckOnboardingUsers,
```
→ nearby where demoTradeCount-related functions are imported.

### Step 3b — Gate upsell behind trade count, send first-trade flow

**File:** `src/bot.ts` — the demo WIN path (lines 963-978)

**Current:**
```typescript
            if (balanceType === 'demo') {
                await showDemoUpsell(ctx, sentMessages);
                await checkFundingSequence(ctx.from!.id, async (msg, button, templateKey) => {
                    const fundMedia = getSequenceMedia(templateKey);
                    const btnMarkup = { inline_keyboard: [[{ text: button.text, url: button.url }]] };
                    if (fundMedia?.file_id) {
                        if (fundMedia.media_type === 'video') {
                            await ctx.replyWithVideo(fundMedia.file_id, { caption: msg, reply_markup: btnMarkup });
                        } else {
                            await ctx.replyWithPhoto(fundMedia.file_id, { caption: msg, reply_markup: btnMarkup });
                        }
                    } else {
                        await ctx.reply(msg, { reply_markup: btnMarkup });
                    }
                }).catch(() => {});
            }
```

**Replace with:**
```typescript
            if (balanceType === 'demo') {
                const tradeCount = getDemoTradeCount(ctx.from!.id);
                if (tradeCount === 0) {
                    // First demo trade — congrats + command guide + main menu
                    const name = ctx.from?.first_name ?? 'there';
                    await ctx.reply(
                        `🎉 Congratulations ${name}! You just won your first trade.\n\n` +
                        `This is just the beginning — you're now trading with the 10x Special Bot 💜`
                    );
                    await ctx.reply(
                        `Use the commands below to make use of your 10x bot 👇\n\n` +
                        `/start — Main menu\n` +
                        `/help — Contact admin\n` +
                        `/connect — Reconnect your IQ Option account\n` +
                        `/balance — Check your balances\n` +
                        `/tiers — View your account tier`
                    );
                    await sendStartMenu(ctx);
                } else {
                    await showDemoUpsell(ctx, sentMessages);
                    await checkFundingSequence(ctx.from!.id, async (msg, button, templateKey) => {
                        const fundMedia = getSequenceMedia(templateKey);
                        const btnMarkup = { inline_keyboard: [[{ text: button.text, url: button.url }]] };
                        if (fundMedia?.file_id) {
                            if (fundMedia.media_type === 'video') {
                                await ctx.replyWithVideo(fundMedia.file_id, { caption: msg, reply_markup: btnMarkup });
                            } else {
                                await ctx.replyWithPhoto(fundMedia.file_id, { caption: msg, reply_markup: btnMarkup });
                            }
                        } else {
                            await ctx.reply(msg, { reply_markup: btnMarkup });
                        }
                    }).catch(() => {});
                }
            }
```

Also verify `getDemoTradeCount` is imported in `bot.ts` — add to the existing import from `./db.js` at the top.

---

## Files Changed

| File | Change |
|------|--------|
| `src/onboarding.ts` | Fix 1: `handleEmailCollected()` — add `resolveUsername()` |
| `src/onboarding.ts` | Fix 2: `handleConnected()` — accept optional `balanceText` param |
| `src/onboarding.ts` | Fix 3: import `getDemoTradeCount` |
| `src/bot.ts` | Fix 2: `awaiting_password` handler — build `balanceText` and pass to `handleConnected()` |
| `src/bot.ts` | Fix 3: gate `showDemoUpsell()` behind `demo_trade_count > 0`, send first-trade flow |
| `src/db.ts` | Fix 3: add `getDemoTradeCount()` function |

## Verification

1. `npx tsc --noEmit` — must pass cleanly
2. Test `/refresh` → enter User ID → email → password → verify `@username` is resolved
3. Verify connected message shows real demo + live balances (not hardcoded `$10,000`)
4. Take first demo trade → verify congrats + command guide + menu (no upsell)
5. Take second demo trade → verify upsell/funding sequence triggers
