# DIRECTIVE-BOT-HANG-FIX.md

## Issue
iqbot-v3 hung silently for 2+ hours on 2026-06-22. PM2 showed "online" but zero log output from 10:15 to 12:36 UTC. Required manual restart.

## Root Cause Analysis

1. **SDK Pool Mass Eviction** — pool cleanup interval evicted 112 unhealthy WebSocket connections (113 → 1 active). Something in the eviction/shutdown loop blocked the event loop.
2. **DeepSeek Brain Timeouts** — `[brain] DeepSeek request timed out` repeated in error log. If the brain's fetch doesn't have a proper timeout, it can hang the event loop.
3. **Telegram Polling Errors** — `400: Bad Request: channel direct messages topic must be specified` repeating for ChatID -2072766084283. Bot is sending to a topic-enabled group without specifying `message_thread_id`, generating error spam that may contribute to backlog.
4. **No Self-Healing** — bot had 194 restarts in 20h but none were health-check-driven. A hung event loop doesn't crash the process so PM2 never restarts it.

## Required Fixes

### 1. Event Loop Hang Guard (Critical)
Add a heartbeat mechanism that logs every 60 seconds. If the heartbeat stops, the bot is hung.
- Simple approach: `setInterval(() => logger.info('[heartbeat] alive'), 60_000)` 
- If this stops appearing in logs, PM2 can't detect it — need internal watchdog:
  - Track `lastHeartbeat` timestamp
  - Separate interval checks if `Date.now() - lastHeartbeat > 120_000` → `process.exit(1)` (PM2 will restart)

### 2. SDK Pool Cleanup — Non-Blocking
The pool cleanup (`UserSdkPool.cleanup()`) iterates all entries and calls `this.shutdown()` which awaits SDK disconnect. If one shutdown hangs, the whole loop hangs.
- Wrap each `shutdown()` call in `Promise.race` with a 5-second timeout
- Catch individual shutdown errors — don't let one bad entry block the rest

### 3. DeepSeek Brain — Hard Timeout
The brain classifier calls DeepSeek API. If the fetch hangs (no response, TCP stall), it blocks.
- Add `AbortController` with 15s timeout to the fetch call in the brain handler
- On timeout: log, return a fallback response, do not retry

### 4. Topic-Aware Message Sending
ChatID -2072766084283 is a topic-enabled group. Sending without `message_thread_id` causes 400 errors.
- Add a check: if chat_id is a topic-enabled supergroup (starts with `-207` or similar), include `message_thread_id` parameter
- Or simply catch 400 errors on send and skip that chat instead of retrying

### 5. Telegram Polling Error Backoff
Repeated 400 errors from the same chat should trigger a cooldown, not continuous retry spam.
- Track error count per chat_id in last 60s
- If >5 errors in 60s, suppress messages to that chat for 5 minutes

## Files to Modify
- `src/bot.ts` — heartbeat watchdog, topic-aware sending, polling error backoff
- `src/sdk-pool.ts` — non-blocking cleanup with timeout
- `src/brain.ts` (or wherever DeepSeek is called) — AbortController timeout

## Verification
- Bot must survive SDK pool mass-eviction without hanging
- Heartbeat must appear every 60s in logs
- No single stuck operation should freeze the entire bot
