# Directive — Bot Stability & Result Integrity Overhaul

## Objective
Make iqbot-v3 stable and truthful in three dimensions:
1. **No random stalls** — the bot must never hang silently on SDK calls or UI flows.
2. **No double trades** — a martingale chain must never place two positions for the same round, and recovery must never race the live chain.
3. **Result integrity** — every WIN/LOSS/TIE the bot reports to a user must be grounded in the real IQ Option settlement, never a guess, never a timeout-as-loss, never a candle heuristic when a real result exists.

Scope: AI Trading (bot.ts runMartingale), Auto Trading (trade.ts runMartingaleCore), Signals result tracking (bot.ts ~7916). All changes must be made to **both src/ and dist/** where the product runs from dist.

## Part 1 — Settlement Law (all three products)
1. A trade result is FINAL only when the SDK settles it: WIN / LOSS / TIE / NO_FILL (no fill). Nothing else is a result.
2. **TIMEOUT is internal, never a result.** If `waitForResult` misses the settlement:
   - Query IQ Option position history for the position (`external_id` / pair / direction / amount / timeframe window).
   - If found: settle with the REAL pnl. If the real result was WIN, the chain must NOT have doubled (a false LOSS already doubled must be corrected in the session total and reported).
   - If NOT found: it is a NO_FILL — same-stake retry of the same round, never double.
3. Never invent LOSS to keep a chain moving. A chain may stall awaiting settlement but must never proceed on an unknown result.
4. TIE = stake refunded. Retry same stake, same round, do not consume a gale round, do not double.
5. `settle()` (TradeCore) is the single source of truth for settlement; GaleEngine doubles ONLY on a settled LOSS.

## Part 2 — No Double Trades
1. **Recovery vs live chain race:** the periodic recovery SELECT (dist/tradeRecovery.js) must keep the expiry-aware window (`timeframe_sec + 60s` grace) so it never picks a trade the live chain is about to settle. Verify it holds for ALL timeframes including 5m and 2m.
2. **Boot-time gale scan vs periodic recovery:** both resume gale sessions. Enforce a single-flight rule: mark the gale session `resuming` BEFORE either path calls runMartingale, and skip any row already `resuming`/`active` with a live in-flight trade (pre-resume liveCheck + resumedUsers set).
3. **No duplicate round on ERROR:** when a buy fails with `market is closed`, `unknown pair`, `no instrument available`, `no balance found`, `authentication is failed`, `profit rate change` (4117) or WebSocket-closed — NO trade was placed. Retry same round same amount (max 2 retries), then abort the chain with a clear message. Never double on a failed buy.
4. `runMartingaleCore` must return a structured outcome (win/loss/tie/no_fill + real error) so callers never guess.

## Part 3 — No Random Stalls
1. **Every SDK call needs its own timeout.** Known gaps: trade-core.ts, gale-engine.ts, trade.ts currently have ZERO withTimeout wrappers (auto-trading.ts has 9). Wrap:
   - `balances()` / `getBalances()` — 10s
   - `positions()` / position history — 10s
   - `blitzOptions()` / `refreshActives()` — 15s
   - `candles()` / `getCandles()` — 15s
   - any buy — 20s
2. **Every scan/read path needs a total budget.** If a path performs N SDK calls, cap the whole path (e.g. 35s Promise.race) and fall back to cached/neutral state — the UI must always respond.
3. **No silent empty catch blocks in trading paths.** Every catch must log (logger.warn/error) with a tag so stalls are diagnosable. `catch {}` is forbidden in runMartingale, runMartingaleCore, tradeRecovery, signal tracking, and prep countdown code.
4. **Busy locks on all setInterval loops** doing async SDK work (signal tracking has trackingBusy — verify the same pattern exists for every background loop that calls SDK).
5. **Prep countdown must never appear frozen:** the fire-and-forget `void (async () => {})()` countdown must have a cancellation Map (prepCountdowns), log failures, and be cancelled when the tracking loop takes over the card.
6. **SDK pool:** `sdkPool.get()` must return a healthy SDK — dead pinned sockets must be rebuilt (never handed out), and `withTimeout` on the pre-trade health ping so a dead WS costs 2s, not a chain timeout.

## Part 4 — Signals Result Accuracy
1. Signal results are currently candle-based (open vs close of the trade-window candle). Keep the trade-window anchoring (expiry − timeframe → expiry) — that part is correct.
2. **Never mark a signal LOST when market data is missing** — that already exists (no_data → neutral "expired" message, no recovery round). Keep it.
3. If a real IQ Option settlement is obtainable for a signal (user's own position on the pair/window is detectable via position history), prefer the real settlement over the candle heuristic. Otherwise keep candle-based as the documented fallback and never present it as an IQ Option settlement.
4. Signal recovery rounds must respect the same settlement law as Part 1 — a recovery round is only "lost" when its own window settles against direction.

## Verification Checklist (run before considering done)
- [ ] No `catch {}` empty blocks in the trading paths listed above.
- [ ] Every SDK call in the trading paths has a timeout (grep `withTimeout` in trade-core.ts, gale-engine.ts, trade.ts, signals tracking).
- [ ] Recovery SELECT still refuses trades inside their expiry window (timeframe_sec + 60s).
- [ ] Boot scan and periodic recovery cannot both resume the same gale (single-flight on gale_sessions.status).
- [ ] A simulated profit-rate-change (4117) mid-chain does not double the stake.
- [ ] A simulated WebSocket death mid-chain retries same-stake, never doubles.
- [ ] A missed settlement is resolved from position history; if the real result was WIN the session total is corrected and no gale was burned.
- [ ] `npx tsc --noEmit` clean for changed modules; `node --check` clean on changed dist files.
- [ ] PM2 restart with 0 in-flight trades; boot log free of SyntaxError/Cannot-find.

## Do NOT touch
- No marketing content, no template text changes, no UI copy changes.
- No changes to analysis engines, signal generation frequency, or confidence displays.
- No changes to smart flow, check-in, admin portal, or menus.
- No changes to affiliate/approval logic.

## Delivery
Implement on a feature branch, push, and report back with the diff summary + verification results. Keep changes surgical — this directive is about correctness and stability, not features.
