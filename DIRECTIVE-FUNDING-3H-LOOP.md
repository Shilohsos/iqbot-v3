# Redesign: Funding sequence → 3-hour persistent loop

---

## IMPORTANT: Merge master first

Before working, ensure you're on master with the latest merge.

---

## What changes

Remove the trade-count-based funding trigger (fires at demo trades 2, 5, 10...). Replace it with a background loop that sends a funding message every 3 hours to eligible demo users.

---

## New behaviour

- **Trigger**: Fixed 3-hour loop (not trade-count-based)
- **Auto-delete**: Each new funding message deletes the previous one sent to that user
- **Trade-aware**: If user's last trade was <10 minutes ago, delay until 10 minutes after that trade
- **Persistent**: Next run time saved in DB — survives bot restarts
- **Targets**: Demo-tier users who have traded at least once and haven't funded (no real balance deposit)
- **Skip**: If `features_paused=1` or user is PRO/MASTER tier
- **Cycle**: Picks a random template from `FUNDING_TEMPLATES` each time (same variety)

---

## Implementation

### 1. Remove old trade-count trigger

**File:** `src/onboarding.ts`
**Function:** `checkFundingSequence` (lines 110-136)

Remove this entire function. Also remove its export and the `PROMO_CODES` constant.

Also remove the import of `checkFundingSequence` from `src/bot.ts` (line 112) and the call site at line 1004:

```typescript
checkFundingSequence(ctx.from!.id, async (msg, button, templateKey) => {
    const fundMedia = getSequenceMedia(templateKey);
    const btnMarkup = { inline_keyboard: [[{ text: button.text, url: button.url }]] };
    if (fundMedia?.file_id) {
```

Remove that entire block — it's inside the trade completion handler.

### 2. Add DB table for funding cycle state

**File:** `src/db.ts`

Add a new table to track per-user funding message state:

```sql
CREATE TABLE IF NOT EXISTS funding_cycle (
    telegram_id      INTEGER PRIMARY KEY,
    last_sent_at     TEXT,      -- ISO datetime of last funding message
    last_msg_id      INTEGER,   -- Telegram message_id to delete on next send
    next_run_at      TEXT       -- ISO datetime of next scheduled send
);
```

Add helper functions:

```typescript
export function getFundingCycle(telegramId: number): { last_sent_at: string | null; last_msg_id: number | null; next_run_at: string | null } | undefined {
    return db.prepare('SELECT last_sent_at, last_msg_id, next_run_at FROM funding_cycle WHERE telegram_id = ?').get(telegramId) as any;
}

export function upsertFundingCycle(telegramId: number, last_sent_at: string | null, last_msg_id: number | null, next_run_at: string): void {
    db.prepare('INSERT INTO funding_cycle (telegram_id, last_sent_at, last_msg_id, next_run_at) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET last_sent_at = excluded.last_sent_at, last_msg_id = excluded.last_msg_id, next_run_at = excluded.next_run_at').run(telegramId, last_sent_at, last_msg_id, next_run_at);
}

export function getFundingCycleDueUsers(): Array<{ telegram_id: number }> {
    return db.prepare("SELECT telegram_id FROM funding_cycle WHERE next_run_at IS NOT NULL AND next_run_at <= datetime('now')").all() as any;
}

export function getDemoUsersWithTrades(): Array<{ telegram_id: number }> {
    return db.prepare("SELECT telegram_id FROM users WHERE tier NOT IN ('PRO', 'MASTER') AND demo_trade_count > 0 AND ssid_valid = 1").all() as any;
}
```

### 3. Replace with persistent 3-hour loop

**File:** `src/bot.ts`

Add a new function near the bottom (near `startAutoBroadcast`):

```typescript
const FUNDING_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
const TRADE_COOLDOWN_MS   = 10 * 60 * 1000;       // 10 minutes after last trade

async function fireFundingCycle(bot: Telegraf): Promise<void> {
    if (getConfig('features_paused') === '1') return;

    const users = getDemoUsersWithTrades();
    const now = Date.now();

    for (const { telegram_id } of users) {
        try {
            const cycle = getFundingCycle(telegram_id);
            const lastTrade = getLastTradeTime(telegram_id); // function to get last trade timestamp

            // If user traded recently, reschedule for 10min after their trade
            if (lastTrade && (now - lastTrade.getTime()) < TRADE_COOLDOWN_MS) {
                const delayUntil = new Date(lastTrade.getTime() + TRADE_COOLDOWN_MS);
                upsertFundingCycle(telegram_id, cycle?.last_sent_at ?? null, cycle?.last_msg_id ?? null, delayUntil.toISOString());
                continue;
            }

            // Pick a random funding template
            const templateKey = FUNDING_TEMPLATES[Math.floor(Math.random() * FUNDING_TEMPLATES.length)];
            const template = getTemplateByKey(templateKey);
            if (!template) continue;

            const promo = PROMO_CODES[Math.floor(Math.random() * PROMO_CODES.length)];
            const msg = (template.message ?? '').replace(/10xfirst|10xsecond/g, promo);
            const button = { text: template.button_text ?? '💎 Fund now', url: template.button_url ?? 'https://iqoption.com/pwa/payments/deposit' };
            const fundMedia = getSequenceMedia(templateKey);

            // Delete previous funding message
            if (cycle?.last_msg_id) {
                bot.telegram.deleteMessage(telegram_id, cycle.last_msg_id).catch(() => {});
            }

            // Send new funding message with media + text + button
            let newMsgId: number | undefined;
            if (fundMedia?.file_id) {
                if (fundMedia.media_type === 'video') {
                    const m = await bot.telegram.sendVideo(telegram_id, fundMedia.file_id, {
                        caption: msg,
                        reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] },
                    }).catch(() => undefined);
                    newMsgId = m?.message_id;
                } else {
                    const m = await bot.telegram.sendPhoto(telegram_id, fundMedia.file_id, {
                        caption: msg,
                        reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] },
                    }).catch(() => undefined);
                    newMsgId = m?.message_id;
                }
            } else {
                const m = await bot.telegram.sendMessage(telegram_id, msg, {
                    reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] },
                }).catch(() => undefined);
                newMsgId = m?.message_id;
            }

            // Save state
            if (newMsgId) {
                const nextRun = new Date(now + FUNDING_INTERVAL_MS);
                upsertFundingCycle(telegram_id, new Date().toISOString(), newMsgId, nextRun.toISOString().replace('T', ' ').split('.')[0]);
            }
        } catch (err) {
            console.error(`[funding] error for ${telegram_id}:`, err instanceof Error ? err.message : err);
        }
    }
}
```

### 4. Seed initial next_run_at for existing demo users

On startup, seed the `funding_cycle` table for any demo user who has traded but has no entry yet:

```typescript
function seedFundingCycle(): void {
    const users = getDemoUsersWithTrades();
    for (const { telegram_id } of users) {
        const existing = getFundingCycle(telegram_id);
        if (!existing) {
            const nextRun = new Date(Date.now() + 300_000); // 5 min from now to stagger
            upsertFundingCycle(telegram_id, null, null, nextRun.toISOString().replace('T', ' ').split('.')[0]);
        }
    }
}
```

Call `seedFundingCycle()` before `startFundingLoop()` on startup.

### 5. Startup — persistent loop

Add a startup call similar to auto-broadcast:

```typescript
function startFundingLoop(bot: Telegraf): void {
    // Check if any funding messages are due now (survived restart)
    const dueNow = getFundingCycleDueUsers();
    if (dueNow.length > 0) {
        console.log(`[funding] startup: ${dueNow.length} users due for funding`);
        fireFundingCycle(bot);
    }

    // Schedule every 60s check (lightweight — just checks which users are due)
    setInterval(() => {
        fireFundingCycle(bot);
    }, 60_000);
}
```

Call `startFundingLoop(bot)` right after `startAutoBroadcast(bot)` in the main launch sequence.

---

## Behaviour summary

| Aspect | Old | New |
|---|---|---|
| Trigger | After demo trades 2, 5, 10... | Every 3 hours |
| Cooldown | 6 hours after last funding | N/A — 3h fixed interval, plus 10min trade cooldown |
| Auto-delete | No | Yes — deletes previous message |
| Persist across restart | No (in-memory) | Yes — uses DB |
| Trade overlap | No protection | Waits 10min after last trade |
| Targets | Demo users who traded | Demo users who traded (same) |

---

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Bot starts — seedFundingCycle creates entries for existing demo users
3. First funding messages fire after ~5 min (seeded stagger)
4. Subsequent messages fire every 3 hours
5. If a user trades during the 3h window, their message delays 10min from the trade
6. Previous funding message is deleted when new one arrives
7. Bot restart — check DB for next_run_at, resume without resetting
