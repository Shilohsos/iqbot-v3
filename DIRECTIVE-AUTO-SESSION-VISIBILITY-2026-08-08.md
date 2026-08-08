# DIRECTIVE — Auto-Trading Session: End-to-End Fix & Visibility (2026-08-08)

## Context

Today (2026-08-08) production users reported two real-money auto-trading problems:

1. **Session shows "Active/Live" but no trades are taken for long stretches** (user: "No trades have taken on Shara account even though the auto trading says active. For over 5 minutes now. Is that normal?"). Root cause verified: the engine IS running and evaluating — the privileged confidence gate (AUTO_CONFIDENCE_FLOOR = 55) skips weak setups silently. The session card gives the user ZERO visibility that the engine is alive but filtering. To the user it looks dead.

2. **After a restart mid-chain, the martingale restarted at the base amount instead of continuing** (user: "It started a new round from the base amount"). Root cause verified and FIXED LIVE (see Part A) — `start()` wiped `mg_active` unconditionally, so when recovery resolved the orphaned trade as LOSS, the chain had no state to advance from.

Also in scope: three smaller live fixes shipped today that must be verified and kept consistent (Parts B–D).

## Part A — Martingale state preservation on restart (ALREADY FIXED — VERIFY ONLY)

File: `src/auto-trading.ts` (start() method, ~line 326)

Fix already applied live and committed (`48948a8`): `start()` now checks for unresolved trades before clearing martingale state:

- If an in-flight/TIMEOUT trade exists (process died mid-chain) → PRESERVE `mg_active`; the periodic recovery (src/tradeRecovery.ts:107-109) resolves the trade and advances `mg_next_amount` (LOSS → doubles).
- If no unresolved trade → clear as before (genuinely orphaned).

**Your task for Part A: VERIFY the fix is correct and complete.** Specifically:
1. Confirm `src/auto-trading.ts` start() contains the pending-trade check (not just the old unconditional clear).
2. Confirm the recovery advance condition in `src/tradeRecovery.ts` (line ~107-109: `mg_active === 1 && mg_next_amount > 0 && mg_next_amount <= row.amount` → `mg_next_amount = row.amount * 2`) fires AFTER start() preserves state. Walk the ordering: restoreAll → start() (preserves) → loop waits for orphan (line ~434-441) → recovery resolves + advances → loop reads mg_next_amount and doubles.
3. Flag any race: could recovery run BEFORE start()'s check (so start() sees the trade still in_flight but recovery then advances, and start() also clears)? If the ordering is racy, fix it so preservation is decided AFTER recovery has had its pass, or make start() re-check before clearing.

## Part B — Session card must reset per-session counters (ALREADY FIXED — VERIFY ONLY)

File: `src/db.ts` (startAutoSession, ~line 1183)

Fix applied (`edf2fff`): ON CONFLICT DO UPDATE now includes `seq_wins = 0, seq_losses = 0`. Previously a new session showed lifetime totals ("Trades: 0 Won: 128 Lost: 13").

**Verify:** the reset is in both `src/db.ts` and compiled `dist/db.js`; confirm no other path writes seq_wins/seq_losses on session start (e.g. restoreAll, engine start) that could re-introduce carryover.

## Part C — User-facing error lines must be friendly (ALREADY FIXED — VERIFY ONLY)

File: `src/bot.ts` (runMartingale card renderer)

Fix applied (`3e11e96`): all user-facing error lines now route through `friendlyError()`:
- settle ERROR lines (was `→ ${result.error ?? result.status}`)
- NO_FILL line (`not filled (${friendlyError(result.error, 'unconfirmed')})`)
- buy-fail abort line (`→ ${friendlyError(errMsg, ...)}`)

**Verify:** no raw SDK error string (`4100`, `WebSocket is closing`, `profit rate change`, `request is failed`) can appear in the trade card; raw text stays in PM2 logs only.

## Part D — Loss strikethrough must render on ALL clients (ALREADY FIXED — VERIFY ONLY)

Files: `src/bot.ts` + `src/tradeRecovery.ts`

Fix applied (`3e11e96`): U+0336 combining marks did not render on some Android fonts. Replaced with Telegram-native HTML strikethrough: `strike(s) = <s>...</s>` + `escHtml()` escaping, and BOTH card edits (`syncLog` in bot.ts ~1366, recovery card edit in tradeRecovery.ts ~91) now pass `{ parse_mode: 'HTML' }`.

**Verify:**
1. Both editMessageText calls pass parse_mode 'HTML'.
2. ALL logLines content is HTML-safe: any `&`, `<`, `>` in dynamic values (amounts, friendly error strings, pair names) is escaped. The `escHtml` helper must be applied to every dynamic segment that could contain HTML-special chars, or the edit will fail with "can't parse entities".
3. Check the OTHER card renderers (auto-trading.ts renderStatus ~line 196, bot.ts ~3133, ~3492) — if they use Markdown parse_mode, leave them as-is (they already use Markdown); only the plain-text card edits that need `<s>` must be HTML.

## Part E — NEW: Session card visibility when the confidence gate skips

The core user complaint: an auto session can sit "Active/Live" for 5-30 minutes with zero trades and the card gives no indication the engine is alive but filtering. Users don't know whether it's broken or working.

**CRITICAL OBSERVATION (2026-08-08, live):** This is NOT uniformly "normal gating." Two sessions running the SAME engine, same floor (55%): user 7575599865 fires a trade every 2-4 min steadily (7 trades / 7 wins between 08:31-08:42), while user 6622587977 fires ONE trade then goes silent 5-10+ min (9 evaluations, 4 trades total, last trade 08:46 — pattern: 1 trade → silence → 1 trade → silence). The engine may be returning chronically low confidence for HER specifically (asset list / analysis path / SDK state). INVESTIGATE this asymmetry as part of this part — it may indicate the gate is consuming real trades for some users. Requirements:

1. **Live status line on the card**: in `src/auto-trading.ts` renderStatus (~line 196), add a dynamic status line that reflects the loop's actual state, e.g.:
   - `· Watching — N setups skipped (low confidence)` when evaluations happened recently with no trade
   - `· Scanning market` while an analysis is in progress
   - `· Trade placed — waiting settlement` while a chain is running (already implied by Trades count, but make the state explicit)
   - `· Paused` / `· Stopped` as today
   Only update this line when the state changes (avoid edit spam — the card is already edited per trade; extend the existing edit cadence, don't add new messages).

2. **Skip logging**: in the confidence-gate skip path (src/auto-trading.ts ~478), log each skip with the reason: `[auto] skip uid=X asset=Y confidence=Z% (floor 55%)` — currently skips are silent. Keep it at INFO level, one line per skip, no spam per candle beyond one line.

3. **Confidence asymmetry diagnosis**: log EVERY analysis outcome for auto sessions at INFO: `[auto] analysis uid=X asset=Y direction=D confidence=Z% score=S` — so the per-user confidence distribution can be compared (7575599865 vs 6622587977). Do NOT change the gate itself; this is data-gathering so the real cause of the 1-trade-then-silence pattern can be found.

4. **No behavior change to the gate itself**: do NOT lower AUTO_CONFIDENCE_FLOOR, do NOT make non-privileged users gated, do NOT change analysis logic. This is visibility + diagnostics only.

5. **Card text must stay in the existing visual style** (✦ markers, same layout, parse mode as currently used by that card — Markdown for auto-trading.ts renderStatus).

## Do NOT touch

- TradeCore / GaleEngine / settlement law (src/trade-core.ts, gale-engine.ts, trade.ts) — settlement behavior must not change.
- Gale doubling rules, isBuyFailure regexes, NO_FILL handling.
- AUTO_CONFIDENCE_FLOOR value or gating logic — visibility only.
- PM2 / ecosystem configs, heartbeat, watchdog.
- No new npm dependencies.
- bot.ts must remain plain JS (build-safe copies it verbatim — no TS annotations).

## Build & verify steps (exact)

```bash
cd /root/iqbot-v3
# bot.ts is copied verbatim by build-safe — keep it plain JS
bash upgrades/scripts/build-safe.sh
node --check dist/bot.js
# tsc-compiled modules:
npx tsc --pretty false --target es2022 --module es2022 --moduleResolution bundler \
  --outDir dist --rootDir src --skipLibCheck --esModuleInterop src/auto-trading.ts src/tradeRecovery.ts src/db.ts
node --check dist/auto-trading.js
node --check dist/tradeRecovery.js
node --check dist/db.js
```

## Acceptance criteria

1. Part A: verification confirmed with ordering walkthrough; any race found is fixed
2. Part B: seq_wins/seq_losses reset verified in src + dist; no other session-start path reintroduces carryover
3. Part C: no raw SDK error can reach the trade card
4. Part D: both card edits use HTML parse_mode; all dynamic segments HTML-escaped; no "can't parse entities" failures
5. Part E: renderStatus shows live engine state (watching/scanning/placed); skips are logged with reason; gate untouched
6. `node --check` clean on all four files after build
7. Report: summary of verification + the new card status line format + example log lines

## Scope lock

Work ONLY within the files named in this directive (`src/auto-trading.ts`, `src/tradeRecovery.ts`, `src/db.ts`, `src/bot.ts`, `dist/*` counterparts for build outputs). Do not explore the broader codebase. Do not run repo-wide searches/audits/greps or read unrelated modules. Do not modify any file not directly required by this directive. Everything outside the directive is out of scope — ignore it entirely.
