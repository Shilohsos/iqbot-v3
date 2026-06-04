# IMPORTANT: Merge master first
## DIRECTIVE: FUNDING-SEQUENCE-FIXES
## Fixes: Go Live broadcast failing + Funding sent to funded users + Dead funding code

### Fix 1: Go Live broadcast — MarkdownV2 escape

**File:** `src/bot.ts` — Go Live handler

**Problem:** `LIVE_MSG_APPROVED` uses `parse_mode: 'MarkdownV2'` but the `!` in "right now!" is not escaped. Telegram's MarkdownV2 requires ALL special characters (`_ * [ ] ( ) ~ > # + - = | { } . !`) to be backslash-escaped even in plain text. One unescaped `!` causes the entire send to throw "Can't parse entities" — making every Go Live broadcast fail for ALL users.

**Fix:** Change `parse_mode: 'MarkdownV2'` to `parse_mode: 'Markdown'` (legacy mode is lenient and doesn't require strict escaping). No change needed to the message text itself.

Search for `parse_mode: 'MarkdownV2'` in the Go Live handler (around the `LIVE_MSG_APPROVED` / `LIVE_MSG_PENDING` sends) and replace with `parse_mode: 'Markdown'`.

---

### Fix 2: Funding sequence — exclude funded users from re-engagement loop

**File:** `src/db.ts` — `getDemoTraders()` function

**Problem:** `getDemoTraders()` returns ALL approved users with SSID and `demo_trade_count >= 1` regardless of tier. This means MASTER and PRO users (who have $10+ real balance) receive "Fund Account" funding sequence messages — completely wrong for users who are already funded.

**Fix:** Add a tier exclusion to the query so PRO and MASTER users are filtered out.

```sql
-- Current (broken):
SELECT u.* FROM users u
JOIN onboarding_tracking ot ON u.telegram_id = ot.telegram_id
WHERE u.ssid IS NOT NULL AND u.ssid != ''
  AND u.approval_status = 'approved'
  AND ot.demo_trade_count >= 1

-- Fixed:
SELECT u.* FROM users u
JOIN onboarding_tracking ot ON u.telegram_id = ot.telegram_id
WHERE u.ssid IS NOT NULL AND u.ssid != ''
  AND u.approval_status = 'approved'
  AND (u.tier IS NULL OR u.tier = 'DEMO')
  AND ot.demo_trade_count >= 1
```

Also apply the same tier check to the re-engagement funding loop in `src/bot.ts` (Segment 3 — the `getDemoTraders()` call at the funding sequence section), as a belt-and-suspenders measure.

---

### Fix 3: Wire inline funding sequence into trade completion

**File:** `src/onboarding.ts` / `src/bot.ts`

**Problem:** `checkFundingSequence()` is defined and exported in `src/onboarding.ts` but **never imported or called** anywhere in the bot's codebase. This means the funding sequence that should trigger at demo trades 2, 5, and 10 never fires. Users only get funding prompts from the re-engagement loop (which runs on a cron, not at the moment of the trade).

**Fix:** Import and call `checkFundingSequence()` in the demo trade completion handler in `src/bot.ts`. 

In the trade completion flow (where `balanceType === 'demo'` and the trade succeeds), after the win/loss reply is sent and the daily counter is updated, add:

```typescript
import { checkFundingSequence } from './onboarding.js';

// After successful demo trade, around where incrementDailyDemoCount is called:
if (balanceType === 'demo') {
    // existing code...
    checkFundingSequence(ctx.from.id, async (msg, btn) => {
        return ctx.reply(msg, { reply_markup: btn });
    }).catch(() => {});
}
```

The existing `checkFundingSequence()` already has:
- 6-hour cooldown via `last_funding_at`
- Template selection from `FUNDING_TEMPLATES`
- Promo code rotation
- Feature-paused check
- Rate limiting (only fires at trades 2, 5, 10, then every 10)

---

### Testing checklist

1. **Go Live:** Tap Go Live — should send successfully to all users, not 0/152
2. **Funding to funded users:** Verify `getDemoTraders()` no longer returns MASTER/PRO users
3. **Inline funding:** Take a demo trade — funding message should appear at trades 2, 5, 10 (with 6h cooldown between)
4. **Re-engagement loop:** Next loop iteration should skip PRO/MASTER users for funding segment
