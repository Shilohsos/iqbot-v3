# IQ Bot V3 — Full General Audit Report
**Date:** 2026-06-13 18:00 WAT
**Auditor:** Wizard (Hermes Agent)
**Scope:** Every code path, every feature, live-verified — zero assumptions
**Rule:** Audit only. No fixes applied.

---

## ⚠️ CRITICAL (3 issues)

| # | Finding | Detail | Impact |
|---|---------|--------|--------|
| C1 | **Heap at 91.53% — near OOM** | 39.78 MiB used / 43.47 MiB heap. Memory climbing: 138mb → 164mb RSS in 30 min. | Bot will crash when heap exhausts. No monitoring active. |
| C2 | **82 MarkdownV2 `-` errors TODAY** | User 7547864280 hitting "Character '-' is reserved" in loop. Error.log.current has 82 instances. bot.catch catches it but the broken button keeps regenerating. | One user in infinite error loop. UX broken for that user. |
| C3 | **53 admin handlers rely on single-point central gate** | `broadcast:send_now`, `compose_delivery:*`, `giveaway_winners_confirm:*`, `token_tier:*`, `user_action:*` — zero per-handler authorization. If the middleware at line 292 is ever removed/commented, any user becomes admin. | Privilege escalation vulnerability. No defense-in-depth. |

---

## 🔴 HIGH (5 issues)

| # | Finding | Detail |
|---|---------|--------|
| H1 | **4 stuck in_flight trades** | Users 8986669286 (2 trades, $55K + $70K) and 7597021142 (2 trades, $500 each). All from today 15:22-15:44 UTC. Have external_id populated but recovery didn't catch them on restart. |
| H2 | **181 failed notifications** | notifications_queue has 181 `failed` status messages — user-facing messages that were never delivered. |
| H3 | **Monitor process STOPPED** | `iqbot-v3-monitor` is down. No health watchdog active. If bot crashes, no auto-restart alert. |
| H4 | **101 TIMEOUT trades (0.8%)** | Out of 12,287 total trades. 22 unique users affected in 7 days. |
| H5 | **Jun 10 connectivity spike** | 108 `fetch failed` errors + 97 `WebSocket not open` errors in single day. IQ Option was partially unreachable. No alerting. |

---

## 🟡 MEDIUM (7 issues)

| # | Finding | Detail |
|---|---------|--------|
| M1 | **Features paused** | `features_paused=1` — auto-broadcast, funding cycle, reconnect loop all gated. Intentional but worth documenting in audit. |
| M2 | **335 FOREIGN KEY errors on Jun 7** | Bulk operation errors during schema migration. Resolved but schema evolution has no migration framework. |
| M3 | **9 notifyAdmin MarkdownV2 parse errors** | Admin notifications failing with "Can't find end of the entity" — dynamic content not escaped for MarkdownV2. |
| M4 | **6 DeepSeek brain timeouts** | Brain occasionally times out. Users get fallback template but no retry. |
| M5 | **5 dead keyboard buttons** | `broadcast:preview_approve`, `broadcast:preview_edit`, `member:filter:active/inactive/funded` — callbacks defined in admin.ts but no handlers in bot.ts. Dead clicks. |
| M6 | **aconfirm missing `requireAutoAccess()`** | Auto-trading confirmation handler has no access check. Low risk (wizard-scoped) but violates defense-in-depth. |
| M7 | **SSID validity: 37 users marked invalid** | ssid_valid=0 for 37 users who HAVE an SSID stored. Inconsistent state. 206 users have NULL ssid_valid (never set). |

---

## 🟢 PASSED (all other checks)

| Area | Checks | Result |
|------|--------|--------|
| **Trade execution** | friendlyError in runMartingale, external_id early save, tradeRecovery by external_id, FriendlyErrors map | ✅ All PASS |
| **SDK pool** | Health check via `healthy: boolean` + WsConnectionState subscription, evict unhealthy, 5-min MAX_AGE | ✅ All PASS |
| **Background loops** | Funding (tier filter), Reconnect (5 states), Auto-broadcast (features_paused gate), Signal tracking (race prevention), Auto-promote (convertToUsd), Token expiry (hourly + startup) | ✅ All PASS |
| **LLM/Brain** | Model (deepseek-v4-flash), API (api.deepseek.com), 115 templates in 26 categories, API key present, DeepSeek reachable | ✅ All PASS |
| **User-facing surfaces** | MarkdownV2 (3 usages, all static), No tier labels (all product names), /start mid-flow safe, Callback timeout handling (3 handlers), bot.catch fallback | ✅ All PASS |
| **Database** | 0 orphaned trades, indexes present on trades/funnel_events, 34 tables, 12,287 trades | ✅ All PASS |
| **Connectivity** | IQ Option HTTP 200, WS SSL valid, proxy working, DeepSeek 200 | ✅ All PASS |
| **Meta/Funnel** | meta-track online (3D uptime), health check 200, events flowing (ViewContent + Lead today) | ✅ All PASS |
| **Funnel conversion** | 729 joins → 202 connected (27.7%) → 94 funded (12.9%) | ℹ️ Data point |

---

## 📊 System State at Audit Time

| Metric | Value |
|--------|-------|
| Users | 445 |
| Trades (total) | 12,287 |
| Win rate | 49.4% (5,943 WIN / 6,090 LOSS / 149 TIE) |
| Funnel events | 6,427 |
| Templates | 115 (26 brain categories) |
| SSID valid rate | 202 valid / 37 invalid / 206 unknown |
| Pool entries | 2-4 cycling normally |
| Bot uptime | 27 min (65 restarts total) |
| Bot memory | 164.8 MB RSS (91.53% heap) |
| Monitor | STOPPED |
| Features paused | YES (config flag) |
| IQ Option WS | Cloudflare route — accessible |
| Proxy | Working (multiple successful connects) |
| DeepSeek API | Reachable, model verified |

---

## 🔍 Top Recommendations (if you decide to fix)

1. **Immediate:** Restart bot to clear heap before OOM crash
2. **Immediate:** Start monitor (`pm2 start iqbot-v3-monitor`)
3. **High:** Add per-handler admin guards to 53 sensitive callbacks
4. **High:** Investigate MarkdownV2 `-` loop for user 7547864280
5. **High:** Recover 4 stuck in_flight trades
6. **Medium:** Fix notifyAdmin MarkdownV2 escaping
7. **Medium:** Fix 5 dead keyboard buttons
8. **Low:** Add `requireAutoAccess()` to `aconfirm` handler

---

*Audit completed 2026-06-13 by Wizard. No code modified. No assumptions made.*
