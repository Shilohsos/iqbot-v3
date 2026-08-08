# DIRECTIVE — Update-Starvation Watchdog (Silent-Death Recovery)

## Context
On 2026-08-08 ~06:06 UTC the bot's Telegram update poller froze while the process itself stayed alive. Symptoms:
- Heartbeats kept firing every minute (process alive), PM2 showed `online`, `0 unstable`
- But **zero updates consumed** for ~30 minutes — no callbacks, no messages processed
- Telegram's queue ballooned: `pending_update_count = 80` (via getWebhookInfo)
- Manual `pm2 restart` fixed it instantly: pending 80 → 0, callbacks flowing again

This is the **silent-death** failure class: the process looks healthy (heartbeats, memory, pool logs all normal) while the update loop is dead. The current keepalive only logs — it has no recovery action.

## Required Fix

Create a new module `src/watchdog.ts` and wire it into `src/bot.ts` with ONE import + ONE call line.

### 1. New file: `src/watchdog.ts`

Export a single function `startUpdateWatchdog(bot)` (the Telegraf bot instance) that:

- **Tracks last consumed update** — wrap a middleware at the top of the handler chain:
  ```js
  bot.use((ctx, next) => {
      lastConsumedAt = Date.now();
      return next();
  });
  ```
  This fires on EVERY update type (messages, callbacks, join requests) — the definitive "bot is processing" signal. It must be registered as the FIRST middleware, before any other `bot.use`/`bot.on` handler.

- **Polls health every 30 seconds** via `bot.telegram.getWebhookInfo()` (cheap, read-only):
  - `pending_update_count > 0` AND `Date.now() - lastConsumedAt > 180_000` (3 min no consumption while updates queue) → log a clear error: `[watchdog] UPDATE-STARVATION pending=N lastConsumed=Xs ago — forcing restart` then `process.exit(1)` (PM2 autorestart recovers).
  - `pending_update_count > 0` but < 3 min → log a warn (informational, no action).
  - `pending_update_count === 0` → healthy; log debug at most every 5 min, never spam.
  - If `getWebhookInfo()` itself fails (network/API error) → log warn and SKIP this tick — never exit on an API error, only on the starvation condition (pending>0 + stale consumption).

- **Guard against false positives:** the 3-min threshold only counts when Telegram itself reports queued updates (`pending_update_count > 0`). Quiet periods with zero traffic (pending=0) are normal and must NOT trigger. Exit ONLY when there are waiting updates the bot is not consuming.

- Wrap all async work in try/catch; the interval must never throw unhandled. Use a simple module-level `let lastConsumedAt = Date.now()`.

### 2. Wire into `src/bot.ts` (PLAIN JS — CRITICAL)

- Add near the top with the other imports:
  ```js
  import { startUpdateWatchdog } from './watchdog.js';
  ```
- After the bot is launched (right after the existing `bot.launch(...)` call / startup section, before the first `setInterval` registration is fine):
  ```js
  startUpdateWatchdog(bot);
  ```
- **NO TypeScript annotations, NO `as` casts, NO generics anywhere in bot.ts** — the file is copied verbatim to dist/bot.js by build-safe.sh; TS syntax = boot SyntaxError.

### 3. Build & verify steps (exact)

```bash
cd /root/iqbot-v3
# compile new module
npx tsc --pretty false --target es2022 --module es2022 --moduleResolution bundler \
  --outDir dist --rootDir src --skipLibCheck --esModuleInterop src/watchdog.ts
# verify syntax
node --check dist/watchdog.js && node --check dist/bot.js
# build-safe full pass (compiles core, copies bot.ts verbatim)
bash upgrades/scripts/build-safe.sh
```

### 4. Do NOT touch

- Heartbeat / keepalive logic (leave as-is, it logs only)
- SDK pool, trade-core, gale-engine, trade.ts, tradeRecovery, stay-alive
- Smart Flow, check-in, onboarding, admin flows, any user-facing message text
- PM2 / ecosystem.config.cjs — no config changes
- No new npm dependencies

### 5. Acceptance criteria

1. `src/watchdog.ts` exists with `startUpdateWatchdog` export
2. `src/bot.ts` has exactly one import + one call line for it (grep `startUpdateWatchdog` → 2 hits in src/bot.ts)
3. `dist/bot.js` and `dist/watchdog.js` both `node --check` clean
4. After restart: boot log clean, no watchdog errors
5. Simulated test (optional, if easy): temporarily set threshold to 10s and confirm it exits only when pending>0 — then restore 180s
6. Report: confirmation of all checks + boot log excerpt

## Scope lock

Work ONLY within the files named in this directive (`src/watchdog.ts`, `src/bot.ts`). Do not explore the broader codebase. Do not run repo-wide searches/audits/greps or read unrelated modules. Do not modify any file not directly required by this directive. Everything outside the directive is out of scope — ignore it entirely.
