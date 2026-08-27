# DIRECTIVE — YACHT CLUB SETUP ENGINE

**Branch:** feature/yacht-setup-engine
**Build rule:** `src/bot.ts` edits MUST be plain JavaScript (no TS annotations). New `.ts` module compiles via tsc.
**Do NOT touch dist/ (gitignored — you will not see it). Implement in src/ only.**

---

## 1. Overview

Build a **Yacht Club Setup Engine**: an automated engine that runs live trading sessions for the 10x Yacht Club VIP channel. Each session produces 10 trade setups, one at a time. For each setup:

1. The engine analyzes the market using the **exact same admin analysis path** the 10x admin engine uses (turboOptions + runAdminAnalysis, 200 candles).
2. It **posts a setup card to the Yacht Club channel** (channel id from env `YACHT_CHANNEL_ID`, default `-1004351740042`) as a **real Telegram user account** (MTProto session from env `YACHT_TELEGRAM_SESSION`).
3. It **executes the setup on IQ Option** on the Yacht Club trading account (login from env `YACHT_IQ_EMAIL` / `YACHT_IQ_PASSWORD`) — $200 base stake, 3-round martingale (200 → 400 → 800).
4. When the trade settles, it **posts the result to the channel** per the forwarding rules in §5.
5. **1-minute pause**, then the next setup (new analysis each time).

Sessions rotate product: **Signals → Private Trader → Signals → Private Trader → ...** (Autopilot is reserved for later — do NOT implement autopilot in this directive). A new session starts **2 hours after the previous session ENDED**. The engine is controllable by the admin: start / stop / status.

---

## 2. Files

- **NEW `src/yacht-setup-engine.ts`** — the whole engine (state machine, analysis, execution, posting, nudges, scheduler).
- **`src/bot.ts`** — integration only: boot-start the engine, add `/yacht` admin command, one call from the Yacht Club watcher guard. **Plain JS.**
- **`src/db.ts`** — add tables + helpers (see §3).

Do not modify any other file. Do not run repo-wide searches. Everything outside this directive is out of scope.

---

## 3. Database

Add to `src/db.ts` (mirror existing table style — `db.exec` CREATE TABLE IF NOT EXISTS at boot, plus helper functions):

**`yacht_sessions`**
```sql
CREATE TABLE IF NOT EXISTS yacht_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,            -- 'signals' | 'private_trader'
  status TEXT NOT NULL DEFAULT 'idle',   -- idle | running | cooldown | stopped
  started_at TEXT,
  ended_at TEXT,
  setups_done INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**`yacht_setups`**
```sql
CREATE TABLE IF NOT EXISTS yacht_setups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  product TEXT NOT NULL,
  pair TEXT NOT NULL,
  timeframe_sec INTEGER NOT NULL,
  direction TEXT NOT NULL,          -- 'call' | 'put'  (display BUY/SELL)
  stake REAL NOT NULL DEFAULT 200,
  status TEXT NOT NULL DEFAULT 'posted',  -- posted | executing | won | lost | aborted
  trade_id TEXT,
  result_rounds INTEGER,
  posted_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT
);
```

Helpers: `getActiveYachtSession()` (latest session with status IN ('running','cooldown')), `startYachtSession(product)`, `endYachtSession(id, wins, losses)`, `insertYachtSetup(row)`, `updateYachtSetup(id, patch)`.

Config keys (reuse existing `getConfig`/`setConfig`): `yacht_enabled` ('0'|'1'), `yacht_tf_signals` (default '60'), `yacht_tf_private` (default '120'), `yacht_stake` (default '200'), `yacht_gale` (default '3').

---

## 4. Engine — `src/yacht-setup-engine.ts`

### 4.1 State machine & scheduler
- `startYachtEngine(bot)` called at bot boot. A `setInterval` tick every **60s** runs `yachtTick()`.
- Guard: if `getConfig('yacht_enabled') !== '1'` → tick does nothing (engine armed but paused).
- **Session lifecycle:**
  - If no session OR last session status is `stopped`/`ended` → check cooldown: if last session `ended_at` exists and `now - ended_at < 2h` → stay idle (log). If cooldown elapsed → start next session with next product in rotation (track rotation via `yacht_rotation_idx` config or derive from last session product: signals → private_trader → signals...).
  - If a session is `running` and `setups_done >= 10` → end it: status `ended`, `ended_at=now`, fire session-close channel message (§5.3). Then cooldown begins.
- **Engine busy lock:** a module-level `engineBusy` flag prevents overlapping ticks. Set at tick start, cleared in `finally`. Never run two analyses/executions concurrently.
- **Restart safety:** on boot, if the latest session is `running` and has a setup with status `executing` (or an in-flight trade), do NOT auto-resume mid-trade — wait for the existing trade recovery machinery to settle it (the periodic tradeRecovery already resolves in-flight trades; the engine just reads the outcome when its next tick checks). If no in-flight trade, resume the session normally.

### 4.2 Setup generation (one at a time)
`generateSetup(product)`:
1. Fetch actives via the **turboOptions** facade (the admin analysis feed — same as the 10x admin engine uses). Filter to OTC pairs in the bot's pair list. Skip pairs the SDK reports suspended / cannot buy.
2. For each open pair, run `runAdminAnalysis(sdk, active, timeframeSec, 'MASTER')` (the PRO engine in `src/admin-analysis.ts`) at the product's timeframe (`yacht_tf_signals` for signals, `yacht_tf_private` for private trader).
3. Pick the pair with the **highest confidence**. Direction = analysis direction.
4. If NO pair is analyzable (all closed/suspended) → skip this cycle, log `[yacht] no open pairs — waiting`, no setup, no message.
5. Confidence for display: `clampDisplayConfidence()` (same as every other surface — random 80–97%, displayed only).

### 4.3 Execution
- Dedicated SDK for the Yacht Club account: at engine start (and on auth failure), obtain SSID via the proxy login flow: POST `{LOGIN_PROXY_URL}/v2/login` (same helper the bot's reconnect flow uses — `proxyLogin` pattern) with `YACHT_IQ_EMAIL` / `YACHT_IQ_PASSWORD`. Build SDK with `ClientSdk.create({ ssid, ... })` — do NOT take entries from the shared sdkPool (the Yacht account is a separate account, keep it isolated). Hold one SDK for the engine; rebuild on auth failure.
- Execute with the existing `runMartingaleCore` from `src/trade.js`: `runMartingaleCore(sdk, { pair, direction, amount: stake, galeRounds: 3, timeframeSec, balanceType: 'live', telegramId: 0, cooldownMs: 2000 })`. (It already implements the TradeCore settlement law + gale doubling.)
- Map outcome: WIN/TIE → setup `won`; LOSS/NO_FILL/ABORTED → setup `lost`; update `result_rounds` and `trade_id` (from `last.tradeId` / `last.optionId`).
- **On auth failure / SDK errors:** do NOT place the trade. Mark setup `aborted`, notify admin via `notifyAdmin('Yacht engine: login failed — check YACHT_IQ_* env')`, and pause the session (status `stopped`) until admin runs `/yacht start` again.

### 4.4 Posting (real Telegram user account)
- Use the MTProto session from env `YACHT_TELEGRAM_SESSION` (Telethon-style StringSession; the repo already has the `telegram` (GramJS) dependency — use it). If the session env is missing/empty or the client fails to authorize → log `[yacht] poster session unavailable`, notify admin once, and DO NOT run the session (abort the tick; engine stays paused until the session is valid).
- Post to `YACHT_CHANNEL_ID` (default `-1004351740042`). Reuse the existing Telegram client bootstrap pattern from `src/affiliate.ts` (connect-per-use with `releaseClient`-style cleanup, 15s timeouts) — never hold a second long-lived session.
- **Ordering guarantee (critical):** post the setup card FIRST, then execute the trade. If posting fails (channel unreachable, session error) → do NOT execute; abort setup, notify admin, pause session.

### 4.5 Message formats (exact)

**Setup card** (product-dependent header; symbols only, no PnL, no amounts):
```
· YACHT CLUB — SIGNALS SETUP ✦

{PAIR} · {TF}

Direction: BUY
Confidence: {NN}%

The engine is executing this now.
```
(Private Trader variant: header `⟡ YACHT CLUB — PRIVATE TRADER SETUP ✦`, same body.)

**Win result:**
```
🟢 WIN — setup hit.

{PAIR} · {TF} · {BUY/SELL}
Recovery: {rounds} round(s)
```
**Loss result (no card, no amounts, simple message):**
```
There was a loss on this setup.
The engine is already analyzing the next one.
```
**Session close:**
```
Session closed.

Signals: {wins} won / {losses} lost
Next session in 2 hours.
```
(Use the product name that ran. NEVER show PnL, amounts, stakes, or account balances anywhere in the channel.)

### 4.6 Bot-user nudges (alert everyone to check the Yacht Club)
- Immediately after each successful setup-card post, send a nudge to the same audience as the existing Yacht Club watcher (approved funded users): 
  ```
  · New setup just dropped in the Yacht Club ✦
  The scan is live — check it before the window closes.
  ```
  with an inline URL button `Check the Yacht Club` → `https://t.me/xyachtclub`.
- Reuse the existing `yacht_watch_sent` table for cancel-out (delete previous nudge per user before sending the new one) — exactly the pattern the watcher uses.

### 4.7 Admin commands (`src/bot.ts`, plain JS)
- `/yacht` → status card: enabled on/off, current session product + status, setups done, wins/losses, last session ended_at.
- `/yacht start` → set `yacht_enabled=1`, if a session is needed (no running session and cooldown elapsed) start it immediately. Reply `Yacht engine started.`
- `/yacht stop` → set `yacht_enabled=0`; if a setup is mid-execution, let it settle first (engine finishes the current setup, then pauses — do not kill an open trade). Reply `Yacht engine stopped after the current setup.`
- Admin-only (same guard as other admin commands).

---

## 5. Forwarding rules (channel content)

1. **Win** → forward the engine's win result message (above). No PnL.
2. **Loss** → the simple loss message above. NEVER the full loss card, NEVER amounts.
3. **Session close** → wins/losses count only. No PnL anywhere, ever, in the channel.
4. The setup cards are the only place a stake could appear — they must NOT show the stake.

---

## 6. Watcher collision guard

The existing Yacht Club watcher (channel_post handler in bot.ts) nudges users on certain keyword categories. The engine's own posts must NOT trigger the watcher (double nudge). Ensure:
- Engine message formats (§4.5) do NOT contain the watcher's trigger patterns (`|`-separated setup lines, `Gale`, `AUTOPILOT`, `WITHDRAWAL`, `TESTIMONIAL` keywords).
- The watcher's setup regexes are already anchored to `PAIR | TF | Gale N` — the engine's `{PAIR} · {TF}` format (middle dot, no `|`) does not match. Verify this holds and note it in your summary.

---

## 7. Env vars (placeholders — do NOT invent values)

Add to `.env.example` (and read in engine):
```
YACHT_CHANNEL_ID=-1004351740042
YACHT_IQ_EMAIL=__PLACEHOLDER__
YACHT_IQ_PASSWORD=__PLACEHOLDER__
YACHT_TELEGRAM_SESSION=__PLACEHOLDER__
```
The engine must treat empty/missing `YACHT_IQ_*`/`YACHT_TELEGRAM_SESSION` as a hard stop (notify admin, stay paused) — never crash the bot.

---

## 8. Logging & admin notifications

- Every engine transition logs with `[yacht]` prefix: session start/end, setup posted, trade placed, result, pause reasons, cooldown.
- `notifyAdmin(...)` on: engine armed/paused at boot, session start, session end, every fatal condition (poster session invalid, login failed, channel unreachable, no pairs for a full hour).

---

## 9. Acceptance checklist

- [ ] Engine ticks every 60s; does nothing when `yacht_enabled=0`.
- [ ] Session runs 10 setups, one at a time, 1-minute gap, new analysis per setup.
- [ ] Setup card posted to channel BEFORE execution; execution skipped if posting fails.
- [ ] Trade executes on the Yacht account SDK with $200 base / 3 gale.
- [ ] Win posts win message; loss posts simple loss message; NO PnL anywhere.
- [ ] Session close posts wins/losses count; next session starts 2h after end.
- [ ] Rotation signals → private_trader → signals...
- [ ] User nudge after each setup with cancel-out via yacht_watch_sent.
- [ ] `/yacht`, `/yacht start`, `/yacht stop` work admin-only; stop lets current trade settle.
- [ ] Engine never crashes the bot on missing env, auth failure, or channel errors — it pauses and notifies.
- [ ] All engine channel messages avoid watcher trigger patterns.
- [ ] `src/bot.ts` remains plain JS (no TS annotations).
