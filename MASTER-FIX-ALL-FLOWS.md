# Master Directive: Complete System Fix — All 12 Flows

**IMPORTANT: Merge master first** — this directive builds on latest master and fixes every issue identified in the audit.

---

## Phase 1: DB Hotfixes (run directly, no code change)

These are data corrections only — run on the live DB before code changes.

### 1.1 Auto-Broadcast — Re-enable all messages
```sql
UPDATE broadcast_messages SET enabled = 1 WHERE type = 'auto' AND enabled = 0;
```
Verify: `SELECT id, title, enabled FROM broadcast_messages;` — all should show `enabled = 1`.

### 1.2 Sequence Media — Fix entry_welcome key mismatch
```sql
UPDATE sequence_media SET template_key = 'entry_welcome_1' WHERE template_key = 'entry_welcome';
```
Verify: `SELECT * FROM sequence_media WHERE template_key LIKE 'entry_welcome%';` — should show `entry_welcome_1` and `entry_welcome_2`.

---

## Phase 2: Missing Templates (seed into DB)

### 2.1 Missing Onboarding Templates (7)

Insert these into the `templates` table. All use `state = 'onboarding'`.

```sql
-- new_trader_video
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('new_trader_video', 'onboarding', 'onboarding',
'@username, check this out 👆\n\nThat''s someone using 10x Bot right now.\n\n👇 Watch this 2-minute demo to see how it works:', NULL, NULL, 1, 5);

-- after_video_account
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('after_video_account', 'onboarding', 'onboarding',
'Let''s get this money @username. 💜\n\nFirst thing — you need an IQ Option account.\n\n👇 Do you have one or not?', NULL, NULL, 1, 5);

-- experienced_branch
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('experienced_branch', 'onboarding', 'onboarding',
'You''ve traded before? Say less. 💜\n\nWe''re skipping the basics.\n\n👇 Do you have an IQ Option account or not?', NULL, NULL, 1, 5);

-- experienced_have_one
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('experienced_have_one', 'onboarding', 'onboarding',
'Perfect @username. 💜\n\nLet''s get you connected. 3 quick steps:\n\n1️⃣ Open IQ Option\n2️⃣ Tap profile icon\n3️⃣ Copy your User ID (the number under your name)\n\n👇 Drop your User ID below:', NULL, NULL, 1, 5);

-- experienced_need_new
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('experienced_need_new', 'onboarding', 'onboarding',
'No problem @username. 💜\n\n👇 Tap below to create your free IQ Option account:', '🆕 Create Account', 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue', 1, 5);

-- verify_success
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('verify_success', 'onboarding', 'onboarding',
'✅ Account verified @username!\n\nNow enter your IQ Option email 📧', NULL, NULL, 1, 3);

-- verify_fail_1
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('verify_fail_1', 'onboarding', 'onboarding',
'❌ That didn''t match @username.\n\nDouble-check your User ID and paste it again 👇', NULL, NULL, 1, 3);

-- verify_fail_2
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('verify_fail_2', 'onboarding', 'onboarding',
'Still not matching @username. Let''s try a different approach:\n\n1️⃣ Copy this link: https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue\n2️⃣ Open in incognito/private browser\n3️⃣ Create an account with a new email\n4️⃣ Send your new User ID below 👇', NULL, NULL, 1, 3);

-- verify_fail_3
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('verify_fail_3', 'onboarding', 'onboarding',
'Having trouble connecting @username?\n\nLet the admin sort you out personally 👇', '👾 Contact Admin', 'https://t.me/shiloh_is_10xing', 1, 3);

-- awaiting_password
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('awaiting_password', 'onboarding', 'onboarding',
'📧 Got it @username!\n\n🔑 Now enter your IQ Option password:', NULL, NULL, 1, 3);

-- connected_success
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('connected_success', 'onboarding', 'onboarding',
'✅ Connected @username! 💜\n\nYou''re all set to start trading.\n\n👇 Take your first trade now:', '🚀 Take a Trade', NULL, 1, 3);
```

### 2.2 Missing Re-engagement Templates (3)

```sql
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('reengage_email_stuck', 'reengage', 'reengage',
'@username, drop that email.\n\nYour account is one step away from being activated.\n\n👇 Enter your IQ Option email:', NULL, NULL, 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('reengage_password_stuck', 'reengage', 'reengage',
'@username, one password away.\n\nYou''ve done the hard part — just finish the login.\n\n👇 Enter your password:', NULL, NULL, 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('reengage_never_traded', 'reengage', 'reengage',
'@username, you''re connected but you haven''t taken a single trade.\n\nThe bot is ready when you are.\n\n👇 Tap to start:', '🚀 Trade Now', NULL, 1, NULL);
```

### 2.3 Missing Funding Templates (4)

```sql
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('funding_payout_proof', 'funding', 'funding_sequence',
'Real withdrawals. Real money. @username, this could be your payout notification.\n\nUse promo: `10xfirst`', '💰 Fund Account', 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786', 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('funding_lifestyle_photo', 'funding', 'funding_sequence',
'This is what freedom looks like @username. 💜\n\nNo alarms. No bosses. Just results.\n\nUse promo: `10xsecond`', '💰 Fund Account', 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786', 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('funding_user_result', 'funding', 'funding_sequence',
'Another 10x user. Another win. @username, that could be your PnL.\n\nUse promo: `10xfirst`', '💰 Fund Account', 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786', 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('funding_user_result_video', 'funding', 'funding_sequence',
'@username, watch someone using 10x in real time.\n\nThis is what consistent winning looks like.\n\nUse promo: `10xsecond`', '💰 Fund Account', 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786', 1, NULL);
```

### 2.4 Fix `funding_user_result_video` media_type in sequence_media

```sql
UPDATE sequence_media SET media_type = 'video' WHERE template_key = 'funding_user_result_video';
```

### 2.5 Fix existing funding template URLs (affiliate → deposit)

```sql
UPDATE templates SET button_url = 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786'
WHERE key IN ('funding_win_screenshot', 'funding_lifestyle_video', 'funding_testimonial');
```

### 2.6 Add Brain Templates for Missing Categories

Add at minimum 2 templates per missing category so the LLM brain never silently returns undefined:

```sql
-- ssid_connect_fail (2 templates)
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_ssid_fail_1', 'ssid_connect_fail', 'brain',
'Looks like your IQ Option session expired @username.\n\nNo stress — just reconnect in 3 steps:\n1️⃣ Tap 🔗 Reconnect\n2️⃣ Enter your email\n3️⃣ Enter your password\n\n👇 Tap to reconnect now:', '🔗 Reconnect', NULL, 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_ssid_fail_2', 'ssid_connect_fail', 'brain',
'@username, your session needs refreshing.\n\n👇 Just reconnect — takes 10 seconds:', '🔗 Reconnect', NULL, 1, NULL);

-- risk_safety (2 templates)
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_risk_1', 'risk_safety', 'brain',
'Great question @username. 💜\n\nBinary options carry risk — that''s why we recommend starting with demo first. Learn the bot, build confidence, then consider funding what you can afford.\n\n👇 Start with a free demo trade:', '🧪 Trade Demo', NULL, 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_risk_2', 'risk_safety', 'brain',
'@username, every trade is a risk. The bot analyzes the market and gives you high-probability signals — but nothing is guaranteed.\n\nStart small, learn the rhythm, and scale up when you''re ready.', NULL, NULL, 1, NULL);

-- scam_legit (2 templates)
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_scam_1', 'scam_legit', 'brain',
'Fair question @username. 💜\n\n10x Bot is a trading signal tool — it analyzes IQ Option markets and executes trades based on what it finds. Results vary per user, but the proof is in the leaderboard.\n\n👇 Take a demo trade and judge for yourself:', '🧪 Trade Demo', NULL, 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_scam_2', 'scam_legit', 'brain',
'Legit question @username.\n\nThe best way to see if 10x works? Try it on demo. Zero risk, real results.\n\n👇 See for yourself:', '🧪 Trade Demo', NULL, 1, NULL);

-- pricing_tiers (2 templates)
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_pricing_1', 'pricing_tiers', 'brain',
'@username, 10x Bot has 3 tiers:\n\n🧪 DEMO — Free. 10 demo trades/day\n⚡ PRO — $10+ funded. Unlimited trades, 1m timeframes\n👑 MASTER — $50+ funded. Everything unlocked\n\n👇 Check your balance:', '📊 Check Balance', NULL, 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_pricing_2', 'pricing_tiers', 'brain',
'@username, your tier auto-upgrades when you fund your IQ Option account:\n\n• $10+ → PRO\n• $50+ → MASTER\n\nNo manual upgrades needed. Just fund and trade.', NULL, NULL, 1, NULL);

-- upgrade_migration (2 templates)
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_upgrade_1', 'upgrade_migration', 'brain',
'@username, upgrading is automatic.\n\nOnce your real IQ Option balance hits $10, you''re PRO. At $50, you''re MASTER.\n\n👇 Fund your account:', '💰 Fund Account', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_upgrade_2', 'upgrade_migration', 'brain',
'Already funded but still on DEMO @username?\n\n👇 Tap Check Balance to trigger the upgrade:', '📊 Check Balance', NULL, 1, NULL);

-- withdrawal (2 templates)
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_withdraw_1', 'withdrawal', 'brain',
'@username, withdrawals are handled directly on IQ Option — not through the bot.\n\n👇 Go to IQ Option to withdraw:', '🏦 IQ Option', 'https://iqoption.com/pwa', 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_withdraw_2', 'withdrawal', 'brain',
'@username, the bot doesn''t handle withdrawals. That''s done on IQ Option.\n\n👇 Tap to go to your wallet:', '🏦 My Wallet', 'https://iqoption.com/pwa', 1, NULL);

-- funding_deposit (2 templates)
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_deposit_1', 'funding_deposit', 'brain',
'@username, funding your IQ Option account is easy.\n\n👇 Tap the link below to deposit:', '💰 Fund Account', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);

INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec)
VALUES ('brain_deposit_2', 'funding_deposit', 'brain',
'@username, use promo code `10xfirst` when you fund for a bonus on your first deposit.\n\n👇 Tap to deposit:', '💰 Fund Account', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
```

---

## Phase 3: Code Fixes

### 3.1 `src/analysis.ts` — Fix SDK mismatch (turboOptions → blitzOptions)

**Problem:** `analyzePairWithSdk()` uses `sdk.turboOptions()` but trading uses `sdk.blitzOptions()`. These are different SDK subsystems with separate active lists, so the analysis signal may be based on different market data than the trade executes on.

**Fix:** Change `analyzePairWithSdk()` to use `sdk.blitzOptions()` instead of `sdk.turboOptions()`.

**Changes in `src/analysis.ts`:**

Line 28-35 (findActive + getCandles):
```typescript
// BEFORE:
const actives = await sdk.turboOptions();
const active = actives.getActive(normalizedTicker);

// AFTER:
const actives = await sdk.blitzOptions();
const active = actives.getActive(normalizedTicker);
```

Line 68-72 (getCandles):
```typescript
// BEFORE:
const candles = await actives.getCandles(active.id, 60, targetSize);

// AFTER:
const candles = await actives.getCandles(active.id, 60, targetSize);
```
(No change needed for getCandles — the actives object is the same type, just sourced from blitzOptions now.)

Verify: `npx tsc --noEmit` passes. The method signatures for `turboOptions()` and `blitzOptions()` return the same type (`Actives`), so no type errors expected.

### 3.2 `src/db.ts` — Fix FOREIGN KEY constraint on trade insert

**Problem:** `insertTrade()` at line 531 inserts a `telegram_id` that may not exist in the `users` table, causing `FOREIGN KEY constraint failed` and crashing the bot.

**Root cause:** The `trades` table likely has an implied or declarative foreign key reference to `users(telegram_id)`.

**Fix option A (preferred):** Make `insertTrade()` upsert a placeholder user record first if the user doesn't exist:

In `src/db.ts`, find the `insertTrade()` function and add a user-ensure step:

```typescript
export function insertTrade(t: TradeRow): void {
    // Ensure user exists in users table to avoid FK violations
    db.prepare(`INSERT OR IGNORE INTO users (telegram_id, created_at, last_used) VALUES (?, datetime('now'), datetime('now'))`)
        .run(t.telegram_id);
    
    // Original insert
    db.prepare(`INSERT INTO trades (telegram_id, pair, direction, amount, status, pnl, trade_id, error, martingale_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(t.telegram_id, t.pair, t.direction, t.amount, t.status, t.pnl, t.trade_id, t.error ?? null, t.martingale_run ?? null);
}
```

### 3.3 `src/bot.ts` — Re-engagement Segment 2: Replace random selection with context-relevant templates only

**Problem:** Segment 2 (connected non-traders) randomly selects from ALL 6 re-engagement keys, including onboarding-specific ones asking for User ID, email, password — which the user already provided. Only `reengage_never_traded` is relevant.

**Fix:** Replace the random pool with only `reengage_never_traded`:

In `src/bot.ts`, lines 4740-4744:

```typescript
// BEFORE:
const reengageKeys = [
    'reengage_entry_stuck', 'reengage_video_stuck', 'reengage_userid_stuck',
    'reengage_email_stuck', 'reengage_password_stuck', 'reengage_never_traded',
];
const key = reengageKeys[Math.floor(Math.random() * reengageKeys.length)];

// AFTER:
const key = 'reengage_never_traded';
```

### 3.4 `src/bot.ts` — Re-engagement: Add button support to Segments 1 & 2

**Problem:** Segments 1 and 2 of the re-engagement loop send messages without buttons. Unlike Segment 3 (funding) which has `btnMarkup`, the first two segments call `sendMessage(msg)` with no reply_markup.

**Fix:** Add button support by checking the template's `button_text`/`button_url` and passing them as inline keyboard:

In `src/bot.ts`, within the Segment 1 loop (around lines 4718-4729), add button markup:

```typescript
// Find this block (text-only send):
// const sent = await bot.telegram.sendMessage(chatId, msg);
// Replace with:

const btnMarkup = t.button_text && t.button_url
    ? { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] }
    : undefined;
const sent = await bot.telegram.sendMessage(chatId, msg, btnMarkup ? { reply_markup: btnMarkup } : {});
```

Same fix for Segment 2 (around lines 4756-4766), both the media and text paths.

### 3.5 `src/bot.ts` — Re-engagement Segment 3: Add cooldown check

**Problem:** `getDemoTraders()` returns all demo traders every hour with no time filter. Users receive funding prompts every 60 minutes with no cooldown.

**Fix in `src/bot.ts`:** Before sending a funding message in Segment 3, check the last funding time:

In `src/bot.ts` around line 4773-4813 (Segment 3 loop), add a cooldown check:

```typescript
// After getting the user and before sending:
const tracking = getReengageTracking(chatId);
if (tracking?.last_msg_id) {
    try { await bot.telegram.deleteMessage(chatId, tracking.last_msg_id); } catch {}
}

// ADD: Cooldown check — skip if funded in last 6 hours
const fundingTracking = getOnboardingTracking(chatId);
if (fundingTracking?.last_funding_at) {
    const hoursAgo = (Date.now() - new Date(fundingTracking.last_funding_at).getTime()) / 3_600_000;
    if (hoursAgo < 6) continue;
}
```

**Also need to update `setReengageMsgId` or add a separate `setLastFundingAt` call.** The cleanest approach: after sending a funding message in Segment 3, also update `last_funding_at` in `onboarding_tracking`:

```typescript
// Add after the successful send:
setLastFundingAt(chatId);
```

This requires importing `setLastFundingAt` and `getOnboardingTracking` in bot.ts (they may already be imported — check).

### 3.6 `src/bot.ts` — Go-Live: Differentiate approved vs pending messages

**Problem:** `LIVE_MSG_APPROVED` and `LIVE_MSG_PENDING` are identical strings.

**Fix:** Change `LIVE_MSG_PENDING` to acknowledge the user's pending status:

In `src/bot.ts`, find the go-live handler (around line 3198):

```typescript
const LIVE_MSG_APPROVED = `🟣 *10x Shiloh is LIVE right now!*\n\nI'm trading live with 10x AI 💜\n\n👇 Tap below to join`;
// Change this line:
const LIVE_MSG_PENDING = `🟣 *10x Shiloh is LIVE right now!*\n\nI'm trading live with 10x AI 💜\n\n⏳ Your account is still being reviewed — but you can still watch the live session!\n\n👇 Tap below to join`;
```

### 3.7 `src/bot.ts` — Opportunity message: Use real confidence instead of hardcoded 78%

**Problem:** Line 1501 hardcodes `"Confidence: 78%"` regardless of actual analysis confidence.

**Fix:** Use the real `analysis.confidence` value:

In `src/bot.ts`, line 1500-1501:

```typescript
// BEFORE:
`OPPORTUNITY FOUND\nConfidence: 78% · Bot is ready to execute.\n\n${dirStr}\n\n` +

// AFTER:
`OPPORTUNITY FOUND\nConfidence: ${Math.round(analysis.confidence)}% · Bot is ready to execute.\n\n${dirStr}\n\n` +
```

### 3.8 `src/bot.ts` — Demo losses increment daily counter

**Problem:** `incrementDailyDemoCount()` is called only on WIN/TIE (line 976). Losses don't consume the daily limit.

**Fix:** Move the counter increment to after the settlement check (line 952-955) so ALL settled results (WIN/LOSS/TIE) count:

In the martingale loop, find the WIN/TIE block (around lines 960-1008). Move the daily counter increment from inside the WIN/TIE branch to the settlement check above it.

**Change:** At line 971, remove the `if (balanceType === 'demo')` block from inside the WIN/TIE block and place it just after the settlement check at line 952-955 instead:

```typescript
// At line 952-955 (after result settlement):
if (result.status === 'WIN' || result.status === 'LOSS' || result.status === 'TIE') {
    addUserSessionStats(ctx.from!.id, 1, roundPnl);
    giveawayRecordTrade(ctx.from!.id, round > 1);
    
    // MOVE demo counter here — count ALL settled trades, not just wins
    if (balanceType === 'demo') {
        const prevDailyCount = getDailyDemoCount(ctx.from!.id);
        if (prevDailyCount === 0) {
            await sendFirstTradeCongrats(ctx);
        }
        const newDailyCount = incrementDailyDemoCount(ctx.from!.id);
        const remaining = Math.max(0, 10 - newDailyCount);
        // ... rest of counter logic
    }
}
```

### 3.9 `src/classifier.ts` — Add AbortController timeout to fetch

**Problem:** The classifier's `fetch()` to OpenRouter has no timeout. If the API hangs, the message handler blocks indefinitely.

**Fix:** Add `AbortController` with a 15-second timeout:

In `src/classifier.ts`, find the `fetch()` call (likely around line 80-90):

```typescript
// BEFORE:
const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { ... },
    body: JSON.stringify({ ... }),
});

// AFTER:
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 15_000);
try {
    const resp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { ... },
        body: JSON.stringify({ ... }),
        signal: controller.signal,
    });
    // ... handle response
} catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
        console.warn('[classifier] OpenRouter request timed out');
        return { intent: 'unrecognized', message: '' };
    }
    throw err;
} finally {
    clearTimeout(timeoutId);
}
```

### 3.10 `src/classifier.ts` — Fix category name mismatch: `ssid_connect_fail`

**Problem:** Classifier maps SSID queries to `ssid_connect_fail` but brain templates use category `ssid`. The text `ssid` (lowercase) in the VALID_CATEGORIES constant is mapped during the if-else chain to `'ssid_connect_fail'`. Both the category name in the templates table AND the classifier output need to match.

**Option A (recommended):** Fix the classifier to use `ssid` as the output category instead of `ssid_connect_fail`:

Find where the classifier maps `'ssid'` intent and change it from `'ssid_connect_fail'` to `'ssid'`.

OR if the classifier uses `if/else` on the response, ensure the intent string returned is `'ssid'` not `'ssid_connect_fail'`.

**Option B:** Rename the template category. Simpler but less consistent.

### 3.11 `src/tiers.ts` — Fix NGN→USD explosion on API failure

**Problem:** `convertToUsd()` returns raw amount when `sdk.currencies()` or `getCurrency()` fails. NGN 10,000 becomes $10,000 — instant MASTER promotion.

**Fix:** Add a sanity cap — if the converted amount is unreasonably large relative to the original (e.g., NGN→USD should never multiply), return 0 instead to prevent false promotions:

In `src/tiers.ts`, `convertToUsd()` function:

```typescript
// BEFORE:
} catch {
    logger.warn('tiers', `currency conversion failed for ${currency}, treating as USD`);
    return amount;
}

// AFTER:
} catch {
    logger.warn('tiers', `currency conversion failed for ${currency}, returning 0 to prevent false promotion`);
    return 0; // Return 0 so auto-promotion cannot happen on failed conversion
}
```

### 3.12 `src/bot.ts` — Add `giveaway_activate` handler

**Problem:** The admin UI has an "Activate Now" button with callback `giveaway_activate:{id}` but no handler exists.

**Fix:** Add the missing handler in `src/bot.ts`:

```typescript
bot.action(/^giveaway_activate:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('⏳ Activating…');
    const giveawayId = parseInt(ctx.match[1], 10);
    const event = getGiveawayEvent(giveawayId);
    if (!event) {
        await ctx.reply('❌ Giveaway not found.', { reply_markup: adminBackKeyboard() });
        return;
    }
    if (event.status !== 'pending') {
        await ctx.reply('❌ This giveaway is not in pending status.', { reply_markup: adminBackKeyboard() });
        return;
    }
    
    if (event.event_type === 'giveaway') await activateGiveaway(giveawayId);
    else if (event.event_type === 'promo_code') await activatePromoCode(giveawayId);
    else if (event.event_type === 'marathon') await activateMarathon(giveawayId);
    
    await ctx.reply(`✅ ${event.event_type} #${giveawayId} activated!`, { reply_markup: adminBackKeyboard() });
});
```

Place this near the other giveaway handlers (around line 2795-2800).

---

## Verification

1. `npx tsc --noEmit` — must pass with ZERO errors
2. `pm2 restart iqbot-v3-bot --update-env` — clean startup
3. Check PM2 logs: no FOREIGN KEY errors, no classifier timeout hangs
4. Run Phase 1 SQL hotfixes on live DB
5. Run Phase 2 SQL seed scripts
6. Verify enabled=1 on broadcast_messages
7. Test: new user onboarding — branch choices should work, all steps should show messages
8. Test: re-engagement — connected non-traders get only never_traded template with button
9. Test: funding — no more hourly messages; 6h cooldown respected
10. Test: auto-broadcast fires within 2-6h window
11. Test: giveaway_activate button from admin panel

## Migration

The Phase 2 SQL seeds use `INSERT OR IGNORE` — idempotent, safe to run multiple times.
No schema changes needed.
