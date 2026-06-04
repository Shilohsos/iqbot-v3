# Directive: Demo trade limit (10/day) + trade counter + funding gates

**IMPORTANT: Merge master first**

## Overview

Cap demo trades at **10 per day**. Show a live counter on each trade. Trigger funding sequence at milestones. Block demo trading after 10 — user must fund to go live or wait for daily reset.

### Flow

| Trade # | Behavior |
|---------|----------|
| 1st | Congrats + command guide (existing) |
| 2nd | Show counter "2/10 — 8 remaining" + funding sequence (5-10 min delay) |
| 3rd–4th | Show counter only |
| 5th | Show counter + funding sequence |
| 6th–9th | Show counter only |
| 10th | Show counter + funding sequence + **"Demo limit reached. Fund to continue or wait for reset."** |
| After 10th | Block demo trades. Show "Fund to go live" message |
| Daily reset | Counter resets at 00:00 UTC |

---

## Step 1 — Add DB schema

**File:** `src/db.js` — add migration

```typescript
// Run once on startup
db.exec(`
    CREATE TABLE IF NOT EXISTS daily_demo_tracking (
        telegram_id INTEGER,
        date TEXT,
        trade_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (telegram_id, date)
    )
`);

export function getDailyDemoCount(telegramId: number): number {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare(
        'SELECT trade_count FROM daily_demo_tracking WHERE telegram_id = ? AND date = ?'
    ).get(telegramId, today) as { trade_count: number } | undefined;
    return row?.trade_count ?? 0;
}

export function incrementDailyDemoCount(telegramId: number): number {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
        INSERT INTO daily_demo_tracking (telegram_id, date, trade_count)
        VALUES (?, ?, 1)
        ON CONFLICT(telegram_id, date) DO UPDATE SET trade_count = trade_count + 1
    `).run(telegramId, today);
    return getDailyDemoCount(telegramId);
}

export function resetDailyDemoCount(telegramId: number): void {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare('DELETE FROM daily_demo_tracking WHERE telegram_id = ? AND date = ?').run(telegramId, today);
}
```

Also update `resetUser()` to clear `daily_demo_tracking`:
```typescript
export function resetUser(telegramId: number): void {
    db.prepare(`UPDATE users SET ssid = NULL, iq_user_id = NULL, approval_status = 'pending', onboarding_state = NULL WHERE telegram_id = ?`).run(telegramId);
    db.prepare(`DELETE FROM onboarding_tracking WHERE telegram_id = ?`).run(telegramId);
    db.prepare(`DELETE FROM daily_demo_tracking WHERE telegram_id = ?`).run(telegramId);  // ADD THIS
}
```

---

## Step 2 — Gate demo trades by daily limit

**File:** `src/bot.ts` — in `runMartingale` / trade execution path

Before executing a demo trade (balanceType === 'demo'), check the daily limit:

```typescript
if (balanceType === 'demo') {
    const dailyCount = getDailyDemoCount(ctx.from!.id);
    if (dailyCount >= 10) {
        await ctx.reply(
            `🎯 You've used all 10 demo trades for today.\n\n` +
            `Fund your account to go live and keep trading:\n` +
            `👉 https://iqoption.com/pwa/payments/deposit?payment_method_id=6786\n\n` +
            `Or wait until tomorrow for a fresh 10 demo trades.`,
            { reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786' }],
                    [{ text: '📊 Check Balance', callback_data: 'ui:balance' }],
                ]
            }}
        );
        return;  // Block the trade
    }
}
```

---

## Step 3 — Show trade counter + funding gates on WIN

**File:** `src/bot.ts` — in the demo WIN path (replace the current `if (balanceType === 'demo')` block, around line 963)

**Current (just deployed):**
```typescript
if (balanceType === 'demo') {
    const demoCount = getDemoTradeCount(ctx.from!.id);
    if (demoCount === 0) {
        // first trade congrats...
    } else {
        await showDemoUpsell(ctx, sentMessages);
        await checkFundingSequence(...);
    }
}
```

**Replace with:**
```typescript
if (balanceType === 'demo') {
    const prevDailyCount = getDailyDemoCount(ctx.from!.id);
    // prevDailyCount is the count BEFORE this trade.
    // The trade just completed. We increment AFTER sending messages.
    // So for the first demo trade, prevDailyCount === 0.

    if (prevDailyCount === 0) {
        // First trade: congrats + command guide + main menu (existing flow)
        await sendFirstTradeCongrats(ctx);
    }

    // Increment daily counter after processing the trade result
    const newDailyCount = incrementDailyDemoCount(ctx.from!.id);
    const remaining = Math.max(0, 10 - newDailyCount);

    // Send trade counter message (every trade except the first)
    if (prevDailyCount > 0) {
        const counterMsg = remaining > 0
            ? `📊 Trade ${newDailyCount}/10 — ${remaining} demo trades remaining today`
            : `📊 Trade 10/10 — Demo limit reached for today`;
        await ctx.reply(counterMsg).catch(() => {});
    }

    // Funding gate at trades 2, 5, 10 (with 5-10 minute delay)
    if (newDailyCount === 2 || newDailyCount === 5 || newDailyCount === 10) {
        // Delay 5 minutes before sending funding sequence
        setTimeout(async () => {
            try {
                const templateKeys = [
                    'funding_win_screenshot', 'funding_lifestyle_video', 'funding_testimonial',
                    'funding_payout_proof', 'funding_lifestyle_photo', 'funding_user_result',
                    'funding_user_result_video',
                ];
                const key = templateKeys[Math.floor(Math.random() * templateKeys.length)];
                const t = getTemplateByKey(key);
                if (!t) return;
                const promo = ['10xfirst', '10xsecond'][Math.floor(Math.random() * 2)];
                const msg = t.message.replace(/10xfirst|10xsecond/g, promo);
                const btnMarkup = t.button_text && t.button_url
                    ? { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] }
                    : { inline_keyboard: [[{ text: '💰 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786' }]] };
                const media = getSequenceMedia(key);
                if (media?.file_id) {
                    if (media.media_type === 'video') {
                        await ctx.replyWithVideo(media.file_id, { caption: msg, reply_markup: btnMarkup });
                    } else {
                        await ctx.replyWithPhoto(media.file_id, { caption: msg, reply_markup: btnMarkup });
                    }
                } else {
                    await ctx.reply(msg, { reply_markup: btnMarkup });
                }
            } catch {}
        }, 5 * 60_000);  // 5-minute delay
    }

    // Show demo upsell on trades 2+
    if (prevDailyCount > 0 && prevDailyCount < 10) {
        await showDemoUpsell(ctx, sentMessages);
    }

    // On trade 10: show limit reached + fund prompt
    if (newDailyCount >= 10) {
        await showDemoLimitReached(ctx);
    }
}
```

Add the helper functions:

```typescript
async function sendFirstTradeCongrats(ctx: Context): Promise<void> {
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
}

async function showDemoLimitReached(ctx: Context): Promise<void> {
    await ctx.reply(
        `🎯 Demo limit reached for today.\n\n` +
        `You've used all 10 demo trades. To keep winning:\n\n` +
        `👉 Fund your IQ Option account and go LIVE\n` +
        `👉 Live trades = real profits you can withdraw\n\n` +
        `⚡ Or wait until tomorrow for a fresh 10 demo trades.`,
        { reply_markup: {
            inline_keyboard: [
                [{ text: '💰 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786' }],
                [{ text: '📊 Check Balance', callback_data: 'ui:balance' }],
            ]
        }}
    );
}
```

---

## Step 4 — Block demo trades in the trade execution path

**File:** `src/trade.ts` or the trade initiation handler in `src/bot.ts`

When a user tries to initiate a demo trade (via `ui:trade` callback or trade command), check the daily limit:

In the trade button handler (`bot.action('ui:trade', ...)`) or wherever trade amount is confirmed:

```typescript
if (!wantLive) {
    const dailyCount = getDailyDemoCount(ctx.from!.id);
    if (dailyCount >= 10) {
        await ctx.answerCbQuery('🎯 Demo limit reached. Fund to go live or wait until tomorrow.', { show_alert: true });
        return;
    }
}
```

---

## Step 5 — Update imports

**File:** `src/bot.ts` — add to db.js imports:
```
+   getDailyDemoCount,
+   incrementDailyDemoCount,
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/db.ts` | Add `daily_demo_tracking` table, `getDailyDemoCount()`, `incrementDailyDemoCount()`, update `resetUser()` |
| `src/bot.ts` | Gate demo trades by daily limit, add trade counter, funding gates at 2/5/10, add helper functions |

## Verification

1. `npx tsc --noEmit` — must pass
2. Connect fresh user → first trade WIN → congrats + commands + menu (no counter)
3. Second trade WIN → counter "2/10 — 8 remaining" + funding sequence (5min delay)
4. 3rd-4th → counter only
5. 5th → counter + funding
6. 10th → counter + funding + "limit reached" message
7. 11th attempt → blocked with fund prompt
8. Next day → counter resets, 10 fresh trades available
