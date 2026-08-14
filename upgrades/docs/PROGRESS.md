# Upgrade Progress

## Phase 0 — DONE
- BASELINE.md written
- release-pre-upgrade backup under upgrades/release-pre-upgrade/
- Config: upgrade_phase=2_trade_core, upgrade_freeze_features=1

## Phase 1 — PARTIAL
- DO_NOT_TSC_FROM_STALE_SRC.md
- src/bot.ts still stale; do not full `npx tsc`
- New modules authored in src/ and compiled in isolation

## Phase 2 — IN PROGRESS / LIVE
- src/trade-core.ts + dist/trade-core.js — settle() FINAL only
- src/gale-engine.ts + dist/gale-engine.js — never double on NO_FILL
- src/trade.ts + dist/trade.js — executeTradeWithSdk/runMartingaleCore → core
- dist/bot.js — NO_FILL handler; TIMEOUT ≠ false LOSS; Trade N label fix
- dist/auto-trading.js — NO_FILL treated as non-settled error

## Phase 3 — PARTIAL
- Admin users.ssid aligned to config.admin_ssid (pool ssidMatch)

## Law live
TIMEOUT is internal. Callers get WIN|LOSS|TIE|NO_FILL. Gale doubles only on LOSS.


## Continue pass 2026-07-29T13:50:48.519921Z
- Pool session pin/unpin (no mid-gale steal)
- AI outer timeout extended; outer throw → NO_FILL
- Auto pins during runMartingaleCore
- Admin SSID already aligned


## Continue pass 2 — 2026-07-29T13:58:14.704259+00:00
- Signals hybrid C: chart hit/miss/draw + disclaimer (not IQ settlement)
- Copy: balanceType live; NO_FILL emoji
- Swarm: longer settle timeout; NO_FILL/ERROR not counted as settled trade
- acceptance-check.mjs soak/false-gale heuristic


## Continue pass 3 — 2026-07-29T14:01:17.010442+00:00
- tradeRecovery rewritten: recoverFinal; stale → ERROR unconfirmed (never invented LOSS)
- build-safe.sh + npm run build:safe (blocks full bot.ts tsc)
- src/auto-trading.ts synced pin + NO_FILL
- in_flight cleaned (only young open remain)
- acceptance: false-gale 0, admin SSID match, core OK


## Full fix pass — 2026-07-29T14:06:21.398585+00:00
- src/bot.ts REUNIFIED from production dist (ts-nocheck)
- Supertrend labels → PRO engine
- WIN PnL display uses netWinDisplay
- Swarm/Copy use sdkPool + pin
- build-safe syncs bot.js from src/bot.ts
- in_flight 0, false-gale 0


## Stay-Alive complete — 2026-07-29T14:18:43.920856+00:00
### Phase A
- PM2 max_memory_restart=1G, kill_timeout=30s, min_uptime=60s, backoff
- safeExit taxonomy: watchdog/keepalive/polling/boot
- Multi-strike keepalive (3), watchdog 5min

### Phase B
- Pool MAX=28, idle TTL=3min, stats/pinnedCount
- Job diet: fab/marathon 3min, giveaway 60s, balance scan cap 40, SSID health 2h, signals 8s

### Phase C (pragmatic)
- safeExit waits up to 120s for gale pins before process.exit
- Full telegram/trade process split deferred (optional later if RSS still climbs)

### Phase D
- stay-alive.json metrics every 30s
- pm2 app iqbot-stay-alive monitor
- STAY_ALIVE_RUNBOOK.md + stay-alive-check.mjs
