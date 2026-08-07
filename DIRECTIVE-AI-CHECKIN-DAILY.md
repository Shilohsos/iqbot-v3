# DIRECTIVE — Daily AI Check-in System (3 check-ins per day)

**Author:** Wizard · **Date:** 2026-08-07 · **Status:** Approved spec, validated live

## 1. Overview

Build a daily AI Check-in system: three interactive check-in messages per day
(08:00 / 13:00 / 20:00 WAT) sent to all registered users. Each check-in is a
short personal message with inline buttons that keeps the user engaged, shows
their real balance, sets a daily goal, and routes them back into trading.

A working test scaffold currently exists in `dist/bot.js` (callbacks
`test:grow`, `test:learn`, `test:watch`, `test:target:*`, `test:starttrade`,
`test:noon:*`, `test:night:*`, plus a text interceptor and the
`checkinTargetAwaiting` Map). **Remove the entire scaffold and replace it with
the production implementation described below.** The scaffold is gated to
Telegram user 6622587977 — production targets ALL users.

## 2. Design rules (LOCKED — do not deviate)

1. **Symbols only — ZERO emojis** in all check-in messages. Allowed symbols:
   `✦` `⟡` `·` `◆` `⟢` `❖` `✆` `─` `⟵`. No 💜 🚀 💰 👇 🔒 ✍️ 🎓 👀 or any
   other emoji. (Functional trade-card statuses 🟢🔴⚪ elsewhere in the bot are
   untouched — this rule applies to the check-in flow only.)
2. **Money display is currency-aware.** Read the user's account currency
   (`users.currency`, fallback USD). USD → `$`, NGN → `₦`. Always use
   thousands separators: `$1,000` not `$1000`, `₦250,000` not `₦250000`.
   Reuse the existing `fmtBalance()` / `toLocaleString` helpers.
3. **Real live balance.** Every check-in that shows a balance must fetch it
   live via the existing `refreshFundedBalanceFromLive(uid)` helper (SDK scan,
   not DB cache). Never show placeholders like "checking live...".
4. **No dead-end branches.** Every bot reply in the flow carries at least one
   inline button. Never end on a bare text message.
5. **Goal is user-set.** The user picks their own daily target from preset
   buttons or types a custom amount. The bot never assigns a goal.
6. **Button expiry — two classes:**
   - **Session buttons** (goal choices, target presets, "how did today go")
     expire at the next check-in window. An expired tap answers with a popup:
     `This check-in has ended. Next check-in at 1 PM.` (dynamic next time).
   - **Functional buttons** (✦ Start Trading, · Today's Signals, ✦ Today's
     stats, ✆ Talk to admin) NEVER expire — they always open their normal
     flow.
7. **Scheduler**: three daily windows in Africa/Lagos (WAT, UTC+1):
   `08:00` morning, `13:00` afternoon, `20:00` night. Use a cron-style check
   (existing setInterval pattern in the bot is fine) that fires each window
   once per user per day. Persist "sent" state per user per day (e.g. a
   `checkin_sent` table or reuse config storage) so restarts don't double-send.
   Deliver in small batches (e.g. 20–40 users per tick) to avoid Telegram rate
   limits.
8. **Audience**: all registered users with `approval_status='approved'`.
   Respect the existing maintenance gate (`features_paused` / `maintenance_gate`)
   — when maintenance is active, only whitelisted users receive check-ins.
   New check-in callbacks must be added to the maintenance-gate whitelist.

## 3. Morning check-in (08:00 WAT)

Message (personalized by first name):

```
Good morning, {name} ✦

Yesterday the market moved. Today it's yours.

What's your goal for today?
```

Buttons:
- `✦ Grow my account` → `test:grow` equivalent → scans live balance, shows:
  `Your balance right now: {balance}` then `What's your target for today?`
- `❖ Learn the system` → watch/learn branch (link to tutorial, then signals)
- `· Just watching today` → respectful close + `· Today's Signals` button

Target buttons (after Grow):
- `✦ $20` / `✦ $50` / `✦ $100` (currency-symbol prefixed, localized)
- `⟡ Set my own` → reply `Type your target amount for today (e.g. 1,000).`
  → capture the next text message via the interceptor at the TOP of the text
  handler (before admin wizard / brain), parse numbers only
  (`parseFloat(text.replace(/[^0-9.]/g,''))`), confirm:
  `Goal locked. ✦\n\nToday's target: {amount}\n\nI'll check on you at 1 PM.`

After goal lock (all paths), momentum block:
```
Start now ─
```
Buttons:
- `✦ Start Trading` → product-choice prompt: `Where do you want to trade?`
  with `⟡ Private Trader` (ai trading wizard) and `✦ Autopilot` (auto trading)
- `· Today's Signals` → opens signals as usual

Persist the goal: store `telegram_id, goal_date (YYYY-MM-DD), target,
currency` in a `checkin_goals` table. The goal is remembered across check-ins
that day and referenced in afternoon/night messages. Resets daily.

## 4. Afternoon check-in (13:00 WAT)

Message:

```
Good afternoon, {name} ✦

How is today going so far?

Have you been trading?
```

Buttons:
- `✦ Yes, trading now` → `That's the energy. ✦ Keep it going — I'll check your
  numbers at 8 PM.` + `✦ Start Trading` / `· Today's Signals`
- `· Not yet` → nudge: `No rush. But the afternoon session is where it
  happens. The market moves hardest between now and 5 PM.` + `· Today's
  Signals` / `✦ I'll wait for the evening` (closes politely)
- `· Just watching` → `Respect. ✦ I'll check on you at 8 PM. If you change
  your mind before then, you know where to find me.` + `· Today's Signals`

**Conditional fund nudge (rule 3 + smart flow):** after the live balance scan,
if balance is **below $100** (Private Trader minimum), append:
`You're below the trading minimum — top up and the market opens up for you`
+ `✦ Fund Account` button (existing fund/deposit link). If balance is healthy,
NEVER mention funding. Healthy balance users see their balance + trading
buttons only.

## 5. Night check-in (20:00 WAT)

Message:

```
Good evening, {name} ✦

How did today go?

Up or down?
```

Buttons:
- `✦ Up — solid day` → `That's how you close a day. ✦` + live balance +
  buttons: `✦ Lock tomorrow's goal` (re-enters goal flow),
  `✦ Today's stats`, `· I'll set it in the morning`
- `· Down — rough one` → `Some days are like that.` + live balance +
  buttons: `✦ Talk to admin` (URL to @shiloh_is_10xing),
  `· Good night`
- `· Good night` (from either branch) → `Good night, {name}. ✦\n\nSee you at
  8 AM.` + buttons: `✦ Keep trading` (product prompt), `✦ Today's stats`

### Today's stats card

```
✦ Today's stats

Today: {N} trades · {W} wins · {L} losses
Net: {net}
```

Buttons: `✦ Start Trading` / `· Back to wrap-up`.

**Stats correctness (important):** read from the `trades` table where
`telegram_id = ?` and `created_at >= today (Africa/Lagos midnight)`. Count
only settled rows (`status` in WIN/LOSS/TIE — ignore `in_flight`/`TIMEOUT`).
**Net must be true net, not gross:** the `pnl` column is GROSS on wins
(stake + profit) and 0 on losses. Compute:
`net = Σ (status=WIN ? pnl − amount : status=LOSS ? −amount : 0)`.
Do not display the raw `pnl` sum — it inflates results.

## 6. Implementation notes

- The three windows use Africa/Lagos time — server runs UTC, so schedule at
  `07:00 / 12:00 / 19:00 UTC` (or compute the offset in code). Use a fixed
  offset (+1, no DST in Lagos) rather than a timezone library.
- Batch delivery: 20–40 users per tick, small `setTimeout` gaps between
  sends. Track per-user per-day sent state to guarantee exactly-once.
- Personalized greeting uses the stored first name / username from `users`
  (existing `resolveUsername` / `getChat` helpers, cached).
- The text interceptor for custom target capture MUST sit at the very top of
  `bot.on('text')` before the admin wizard and the brain, keyed on the
  `checkinTargetAwaiting` Map (chatId → true), and cleared after capture.
- Keep the whole flow in a dedicated module (`src/checkin.ts`) with the
  scheduler, DB helpers, and message builders; register callbacks from
  `bot.ts`. Follow the existing module patterns (marathon.ts, swarm.ts).
- Run `npm run build:safe` (never a bare full `npx tsc` on the project).
- Commit to master when done.

## 7. Out of scope

- Do NOT touch broadcast/composer systems, giveaways, leaderboards, signals,
  or trading logic.
- Do NOT modify the home menu or product naming (Private Trader / Autopilot).
- No changes to the upgrade-token system already on master.
