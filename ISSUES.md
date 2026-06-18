# Auto-Trading Issues — June 18, 2026

Claude, these are live production issues. Not a directive — diagnose and fix at the source level. The Wizard has been patching dist/bot.js manually and it's not holding.

---

## Issue 1: OTC Trade Timeout → Infinite Retry Spam

**Symptom:** Auto-trading on OTC pairs hangs mid-trade, produces "Trade took too long to complete" error, then retries infinitely. Users get spammed every 2-16 minutes with error messages.

**Evidence:** User 8359136998 received 6 error messages in 50 minutes:
```
10:57 — Trade took too long to complete. Reconnecting and retrying...
11:18 — ⚠️ Something went wrong. Please try again. Retrying automatically.
11:30 — ⚠️ Something went wrong. Please try again. Retrying automatically.
11:44 — ⚠️ Something went wrong. Please try again. Retrying automatically.
11:46 — ⚠️ Something went wrong. Please try again. Retrying automatically.
11:47 — ⚠️ Something went wrong. Please try again. Retrying automatically.
```

**Root cause:** The auto-trading loop in `auto-trading.ts` has no retry limit. On ERROR/TIMEOUT from `runMartingaleCore`, the loop sleeps `msToNextCandle()` then retries the same trade. If the trade keeps timing out (OTC WebSocket issue on Contabo VPS), it loops forever.

**Fix needed:**
- Max 3 consecutive timeouts → pause session, notify user ONCE
- Or: rotate to next asset on timeout instead of retrying same one
- Never send the same error message twice in a row

---

## Issue 2: Auto-Trading Session Doesn't Resume After Restart

**Symptom:** After `pm2 restart`, `restoreAll()` logs "restored 2 auto-trading session(s)" but only Shara's session actually trades. Other sessions (e.g., 8359136998) stay in 'running' status but the runner silently does nothing — no trades, no logs, no errors.

**Evidence:** 8359136998 had status='running', valid SSID, valid balance ($37.13) — but after restart the runner never produced a single trade. Took 3 bot restarts before it picked up.

**Fix needed:** Diagnose why `restoreAll()` → `runner.start()` silently fails for some sessions. Add logging to every exit path in `AutoRunner.start()` and `loop()`.

---

## Issue 3: Martingale State Corruption on Restart

**Symptom:** When the bot restarts mid-martingale, the `mg_active` flag and `mg_next_amount` persist in DB but the underlying trade state is lost. The runner logs "resuming martingale at amount $8" repeatedly without the trade ever completing.

**Evidence:**
```
10:46:32 resuming martingale for 8359136998 at amount 8
10:47:17 resuming martingale for 8359136998 at amount 8
```
Two calls 45 seconds apart, no trade outcome between them.

**Fix needed:**
- Validate martingale state on restore — check if the in-flight trade that triggered the martingale actually exists
- If the original trade was lost (restart orphaned it), clear mg_active and start fresh
- Or: re-query SDK position history on restore to determine actual state

---

## Issue 4: AI Trading Demo Gate Fix Keeps Getting Reverted

**Symptom:** Wizard manually patches `dist/bot.js` to let unfunded users access Demo Mode via `ui:trade`. Every time Claude pushes new code, the merge overwrites this fix and unfunded users get locked out again.

**Fix needed:** Implement the fix properly in `src/bot.ts` so it survives future merges. Logic: if user has valid SSID but no `hasAccessLive('ai_trading')`, route them to Demo Mode with daily cap check instead of showing the lock screen.

---

## Issue 5: Demo/Live Menu Shows Wrong Gate for Users With Token Access

**Symptom:** The auto-trading menu always shows "Live Mode — 🔒 Requires $100+ funded" even for users who have `auto_trading` access via token (e.g., 8359136998 has access='auto_trading' and successfully traded live with $37.13).

**Fix needed:** The menu text should reflect the user's actual access, not a hardcoded threshold. If user has token-based access, show "Live Mode — ✅ Unlocked" or just hide the lock.

---

## Issue 6: No Proxy Support for SDK WebSocket Connections

**Symptom:** `createSdk()` in `trade.js` creates a direct WebSocket connection. The Contabo VPS is partially blocked from IQ Option's Carquardin CDN. HTTP login goes through proxy (`LOGIN_PROXY_URL`), but WebSocket trading is direct and times out intermittently.

**Fix needed:** Add proxy support to the Quadcode SDK connection, or implement a WebSocket proxy tunnel. The residential proxy pool (10 proxies) is already available and healthy.

---

## Context

- **VPS:** Contabo UK — IQ Option's Carquardin CDN partially blocks it
- **WS endpoint:** `wss://ws.iqoption.com/echo/websocket` (Cloudflare route, works intermittently)
- **Proxy pool:** 10 residential proxies, healthy, used for HTTP login only
- **Repro:** Any user on OTC pairs with auto-trading will eventually hit the timeout loop
- **Impact:** Users see spam errors, auto-trading feels broken, trust erodes
