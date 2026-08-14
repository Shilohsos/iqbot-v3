# DIRECTIVE — BOT A: HOURLY SMART LOOP

**Status:** Ready for implementation
**Scope:** `src/bot-a-loop.ts` (new) + minimal wiring in `src/bot.ts` + one new table set in `src/db.ts`
**Built by:** Claude
**Reviewed & merged by:** Wizard

---

## Part 1 — What Bot A Is

Bot A is a recurring engagement loop on the main 10x AI bot. Once per hour (per user), the
bot checks whether the user has traded recently. If they have NOT, the bot sends ONE
personalized nudge — an image + a short caption + one or two buttons — and the new message
replaces the previous one (cancel-out), so a user never has more than one Bot A message
visible at a time.

There are 15 nudge archetypes (A–O). All copy and buttons live in the DB so operations can
edit them without code changes. Images live in `assets/bot-a/` on the server and are NOT
part of this repo change.

## Part 2 — Scope Lock

Work ONLY in these locations:

1. **NEW FILE:** `src/bot-a-loop.ts` — the entire engine.
2. **`src/bot.ts`** — two small wiring additions ONLY:
   - `import { startBotALoop } from './bot-a-loop.js';` near the other bot.ts imports.
   - One call `startBotALoop(bot);` at boot, in the same block where the check-in scheduler
     and other startup timers are started.
3. **`src/db.ts`** — add the table DDL (Part 4) to the existing DB-init function.

Do NOT modify any other file. Do NOT run repo-wide searches, audits, or greps. Do NOT read
modules outside this scope unless the code you are writing directly imports them. Everything
outside Parts 2–11 is out of scope — ignore it entirely.

## Part 3 — Naming & Language Rules

- The module must follow the existing code style of the repo (ESM, `import ... from './x.js'`,
  plain-JS-friendly TypeScript — this file IS compiled by `tsc`, so standard TS annotations
  are fine, but avoid `any` in public signatures).
- Use `logger` from `./logger.js` for all logging, prefixed `[bot-a]`.
- All user-facing text is rendered from DB templates — the engine must never hardcode
  marketing copy beyond neutral fallbacks (Part 6).

## Part 4 — DB Schema (add to `src/db.ts` init)

```sql
CREATE TABLE IF NOT EXISTS bot_a_templates (
    key        TEXT PRIMARY KEY,
    copy       TEXT NOT NULL,
    buttons    TEXT NOT NULL DEFAULT '[]',  -- JSON array of {text, callback|url}
    image_file TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bot_a_sent (
    telegram_id  INTEGER PRIMARY KEY,
    message_id   INTEGER,
    last_archetype TEXT,
    sent_count   INTEGER NOT NULL DEFAULT 0,
    sent_date    TEXT NOT NULL DEFAULT '',
    last_sent_at TEXT
);
```

The templates table is SEEDED BY OPERATIONS after merge — Claude must provide only the
read path: a helper `getBotATemplate(key)` returning `{ copy, buttons, image_file }`.

## Part 5 — The Engine (`src/bot-a-loop.ts`)

### 5.1 Ticker
- One `setInterval` at **60 seconds**. On each tick, process users in batches of **25** with a
  **60 ms** delay between users (mirror the check-in scheduler's cadence).
- The tick must be re-entrant safe: a `ticking` boolean guard so overlapping ticks never run.

### 5.2 Target set
- Users must be `approval_status = 'approved'`.
- EXCLUDE the admin (`getAdminId()` from `./ui/admin.js`) — never message the admin.
- EXCLUDE privileged users in `MAINTENANCE_ALLOWED_IDS` when the maintenance gate is on
  (see 5.7) — otherwise include everyone approved.
- Test mode: if `getTestUserId()` (from `./db.js`) returns an ID, ONLY that user is targeted.
  (This mirrors the existing watcher/check-in behavior.)

### 5.3 Per-user eligibility (checked inside the tick, in order)
1. `features_paused` config = `'1'` → skip everyone (return early for the whole tick).
2. Maintenance gate (5.7) → restrict target set.
3. **Activity check:** `SELECT MAX(created_at) FROM trades WHERE telegram_id = ? AND created_at >= ?`
   with `?` = now minus 60 minutes (UTC ISO). If a trade exists → user is active → SKIP
   silently (no message, no state change).
4. **Daily cap:** if `bot_a_sent.sent_count >= 24` for today (Lagos calendar date, computed
   the same way `checkin.ts` computes its date — shift UTC by +1h and read the date) → skip.
5. **Check-in coexistence:** if `checkin_sent` has a row for the user whose `sent_at` is within
   the last 30 minutes → skip (never stack a Bot A nudge on top of a fresh check-in).

### 5.4 Segment routing
Compute the user's segment:
- **non-activated:** `ssid IS NULL OR ssid = ''` → archetype **G** (connect nudge).
- **connected-not-funded:** has ssid AND `funded_balance_usd <= 0` → archetype **H** (fund nudge).
- **funded-idle:** has ssid AND `funded_balance_usd > 0` → rotate among the archetypes
  **A, B, C, D, E, F, I, K, M, N, O** (see 5.5).

Archetypes **J** (live session) and **L** (Yacht Club watcher) are handled outside this loop —
do not include them in rotation.

### 5.5 Rotation rule
- Read the user's `last_archetype` from `bot_a_sent`. The next archetype is chosen at random
  from the eligible set EXCLUDING the last one (never the same type twice in a row).
- Write the chosen archetype back to `last_archetype` after a successful send.

### 5.6 Cancel-out
- Before sending, if `bot_a_sent.message_id` exists, attempt
  `bot.telegram.deleteMessage(telegramId, message_id)` and swallow errors (message may already
  be gone). Then send the new message and UPSERT `bot_a_sent` with the new message_id and
  `sent_count + 1`, `sent_date` = today, `last_sent_at` = now.

### 5.7 Maintenance gate
- Read config `maintenance_gate`. When `'1'`, the target set is restricted to
  `MAINTENANCE_ALLOWED_IDS` (duplicate the same two IDs `checkin.ts` uses — read that file's
  constant for the exact values; do not import it).

### 5.8 Send format
1. Load the template: `{ copy, buttons, image_file }`.
2. Resolve placeholders in `copy` (Part 6).
3. If `image_file` is non-empty: `await bot.telegram.sendPhoto(uid, { source: path }, { caption, reply_markup })`
   with `path = path.resolve(process.cwd(), 'assets', 'bot-a', image_file)`. Wrap in try/catch —
   on ANY failure (missing file, send error), fall back to `sendMessage(uid, copy, { reply_markup })`.
4. `reply_markup` from the template's `buttons` JSON: each entry is
   `{ text: string, callback?: string, url?: string }` → map to inline keyboard rows (each
   button its own row unless the JSON entry has `row` grouping — keep it simple: one row per
   button object, multiple buttons allowed per row if given as an array; simplest form:
   `buttons` is an array of arrays of button objects).
5. Log `[bot-a] sent ${archetypeKey} to ${uid}` and on failure `[bot-a] send failed ${uid}: ${err}`.

### 5.9 Boot log
- `logger.info('bot-a', 'hourly smart loop started (60s tick, 24/day cap)')`.

## Part 6 — Placeholders (neutral fallbacks ONLY)

`copy` may contain these tokens — substitute before sending:

| Token | Resolution |
|---|---|
| `{confidence}` | random integer 80–97 |
| `{countdown}` | random integer 2–5 |
| `{pair}` | random of `['EURUSD', 'GBPUSD', 'AUDUSD', 'USDCAD', 'GBPJPY']` + `-OTC` |
| `{tf}` | random of `['30s', '1m', '2m']` |
| `{gale}` | random integer 2–4 |
| `{days}` | days since the user's last trade (1–9, from the activity check) |
| `{name}` | random from `bot_a_pools` where `key='names'` (fallback: `'a member'`) |
| `{amount}` | random from `bot_a_pools` where `key='amounts'` (fallback: `'+$350'`) |
| `{count}` | random integer 15–40 |
| `{goal}` | random from `['50', '100', '150']` |
| `{progress}` | random integer 20–60 |

Add this table so operations can seed the pools without code changes:

```sql
CREATE TABLE IF NOT EXISTS bot_a_pools (
    key   TEXT PRIMARY KEY,
    items TEXT NOT NULL  -- JSON array of strings
);
```

Helper `getBotAPool(key): string[]` → JSON.parse the row, fallback to the neutral default
listed above when the row is missing.

## Part 7 — Structural Template Examples (operations will overwrite these)

Provide a `seedBotATemplates()` function (called lazily on first use if the table is empty)
with these NEUTRAL structural seeds so the loop works before operations seeds real copy.
Buttons use the existing callback/URL surfaces only:

- `A` copy: `Your streak is going cold — the engine found a {confidence}% setup since. One tap ─`

Keep seeds minimal and clearly generic, e.g.:

```
A → "A fresh {confidence}% setup is waiting. Trade now ─" | [[{text:'✦ Trade Now', callback:'ui:trade'}]]
B → "Your balance is ready and the market is moving. Start now ─" | same button
C → "Opportunity closing in {countdown} minutes ✦ {pair} · {tf} · Bot's read: {confidence}%" | trade button
D → "{name} banked {amount} today ✦ Your turn ─" | trade button
E → "{count} users fired live trades in the last hour ✦ Join them ─" | trade button
F → "Up or down? {pair} · {tf} — your call. Bot's read: {confidence}%" | trade button
G → "Access is by invitation only ✦ Connect your account and it's yours." | [[{text:'⟡ Connect Account', url:'https://t.me/Shiloh10xbot?start'}]]
H → "Practice balances don't move your life. Fund & go live ─" | [[{text:'✦ Fund Account', url:'https://iqoption.com/pwa/payments/deposit'}]]
I → "TOP PICK {confidence}% ✦ {pair} — the engine's strongest read right now." | trade button
K → "Last trade: {days} days ago ✦ The engine doesn't sleep. One trade ─" | trade button
M → "Today's goal: +${goal} ✦ You're at ${progress}% of the way there. Chase it ─" | trade button
N → "A new event window just opened ✦ Check your eligibility ─" | trade button
O → "Sequence done. New setup loading ✦ Next opportunity ─" | trade button
```

Images: `image_file` values are the filenames already placed in `assets/bot-a/` on the server:
`a-streak-going-cold.jpg`, `b-capital-at-rest.jpg`, `c-opportunity-closing.jpg`,
`d-real-results.jpg`, `e-live-trades.jpg`, `f-up-or-down.jpg`, `g-invitation-only.jpg`,
`h-what-if-this-was-real.jpg`, `i-top-pick.jpg`, `j-live-now.jpg`, `k-engine-doesnt-sleep.jpg`,
`l-yacht-club.jpg`, `m-todays-goal.jpg`, `n-giveaway-open.jpg`, `o-new-setup-loading.jpg`.

Map each archetype seed to its matching filename (`A` → `a-streak-going-cold.jpg`, etc.).
`J` and `L` may be seeded with their filenames but are not used by the loop.

## Part 8 — Wiring (exact)

In `src/bot.ts`, inside the existing startup sequence (where `startCheckinScheduler(bot)` is
called), add:

```ts
startBotALoop(bot);
```

after the check-in scheduler line. Import at the top with the other `./`-imports:

```ts
import { startBotALoop } from './bot-a-loop.js';
```

Nothing else in bot.ts may change.

## Part 9 — Do NOT Touch

- `src/checkin.ts`, `src/trade-core.ts`, `src/errors.ts`, `src/access.ts`, `src/smart-flow.ts`,
  `src/auto-trading.ts`, `src/swarm.ts`, `src/copy-trading.ts`, `src/marathon.ts`,
  `src/giveaway.ts`, `src/sales-bot.ts`, `src/sales-leads.ts`, `src/sdk-pool.ts`,
  `src/admin-analysis.ts`, `src/channel.ts`, `src/onboarding.ts`, `src/broadcast*`, watcher
  blocks, trade paths, or any other module.
- No changes to message content of any existing flow.
- No repo-wide searches/audits; do not read unrelated modules.

## Part 10 — Verification Checklist (before handoff)

1. `src/bot-a-loop.ts` compiles cleanly under the project's tsconfig.
2. `src/bot.ts` and `src/db.ts` still parse (they are not compiled by you — check syntax only).
3. Boot line `[bot-a] hourly smart loop started (60s tick, 24/day cap)` appears.
4. A manual test: with test mode set, a targeted user who has NOT traded in 60 min receives
   exactly one image+caption+buttons message, and a second tick does not duplicate it
   (sent_count increments, cancel-out deletes the previous).
5. No writes to any table outside `bot_a_templates`, `bot_a_pools`, `bot_a_sent`.

## Part 11 — Handoff

Report: files changed, table DDL added, boot verification result, and any assumptions.
