# DIRECTIVE — Shared Telegram Session Conflict (AUTH_KEY_DUPLICATED)

## 1. Context

Four bots on two VPSs share ONE Telegram MTProto session (`TELETHON_SESSION` in `.env`):

| Bot | VPS | Role | Session use |
|---|---|---|---|
| `iqbot-v3-bot` (main) | 81.0.219.89 | 10x AI trading bot | `src/affiliate.ts` checkAffiliate (User ID verification) |
| `sales-bot` (@wr199_bot) | 81.0.219.89 | FTD/redep lead scanner | `src/sales-leads.ts` — scans affiliate channel every 2 min |
| `augustus-bot` | 173.249.16.116 | Augustus AI funnel | `dist/affiliate.js` (clone) |
| `olaoluwa-bot` | 173.249.16.116 | 100x Sniper funnel | `dist/affiliate.js` (clone) |

Telegram allows **one** active connection per auth key. Every new connection with the same key terminates the previous holder (`AUTH_KEY_DUPLICATED` delivered to the older connection). The sales bot is the ONLY bot that needs the session continuously (scanner). All other uses are per-check (a User ID verification, ~1-15 s).

**Result:** the sales bot scanner has been dead since 2026-08-16 17:00 UTC. Reps cannot claim FTD/redep events; `lead_events` stopped filling (last row 2026-08-16T17:00:30).

## 2. What has ALREADY been done (do not redo)

- **Main bot `src/affiliate.ts` / `dist/affiliate.js`** (commit 9b2e836):
  - `releaseClient()` — disconnect with 2 s timeout, `destroy()` fallback, raw `_socket.destroy()` fallback; runs even when `connected === false` (half-open socket kill).
  - `getClient()` — on connect timeout, kills the half-open socket, resets `_client = null`, rethrows.
  - `checkAffiliate` — `try/finally { releaseClient() }` covering ALL layers (search → backfill → lead_events), plus a HARD WATCHDOG `killWatchdog = setTimeout(..., VERIFY_BUDGET_MS + 5000)` that destroys the socket even if every await hangs.
- **Augustus + Olaoluwa `dist/affiliate.js`** on 173.249.16.116 — same connect-check-release pattern (window-scan variant), deployed.
- **Sales bot `src/sales-leads.ts`** — `getGramClient()` now has a 15 s connect timeout + `_gramClient = null` reset on failure so each 2-min tick retries fresh.

## 3. The unsolved problem (YOUR investigation)

Even with ALL four bots idle/stopped (zero TCP connections to any Telegram DC from either VPS), a fresh one-shot client using `TELETHON_SESSION` STILL receives:

```
406: AUTH_KEY_DUPLICATED (caused by InvokeWithLayer)
```

Suspicions, in order:

1. **Stale server-side session entry on Telegram's DC** — after the day's churn (dozens of concurrent same-key connections), the DC may keep the key flagged as active until its session table expires it. Test: retry cleanly every few minutes over an hour; note when the probe succeeds.
2. **External holder we cannot see** — the session string may have been leaked/copied somewhere (another machine, a committed `.env`, an exported session used by another service). **Check the git history of ALL related repos for the session string** (`git log -S '<prefix>' --all` — prefix: the first ~16 chars of `TELETHON_SESSION`; check `iqbot-v3`, `augustus-ai`, `Iqbot-clone-v3` remotes if accessible) and report ANY commit that ever contained it.
3. **API_ID/API_HASH pairing** — verify the session is being constructed with the correct `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` (a mismatched app pair can cause odd rejections).

Your job: find the actual root cause of the persistent rejection and make the system resilient so this class of failure cannot kill the scanner again.

## 4. Required deliverables

### 4a. Session owner arbitration (permanent architecture)
- Formalize: **the sales bot owns the session.** Every other consumer MUST connect-per-check and release within a bounded time (already done — verify the watchdog actually fires: add a `console.log('[affiliate] released')` trace after `releaseClient()` completes and confirm it appears after every check in the out log).
- The main bot's `releaseClient` must be idempotent and MUST close the TCP socket even in half-open states (verify against `connected=false` paths).
- Document the rule in a comment block at the top of `src/affiliate.ts`.

### 4b. Sales bot self-healing scanner
- On `AUTH_KEY_DUPLICATED` (or any connect failure): log with timestamp, retry on the next 2-min tick with a capped backoff (e.g. 2, 4, 8 min — but NEVER longer than 15 min between attempts).
- After a successful reconnect: **resume from the last processed `channel_msg_id`** (already the design — verify the cursor is persisted and correct) and backfill every message newer than it, so no event is ever missed during an outage.
- Add a heartbeat alert: if the scanner fails to scan for > 60 min, `notifyAdmin` (admin Telegram id 1615652240) — "sales scanner down".

### 4c. One-time session regeneration tooling (for the human operator)
- Provide a small script `scripts/new-sales-session.mjs` that performs an interactive MTProto login (phone → code → 2FA if needed) using `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`, and prints the fresh `TELETHON_SESSION` value to save into `.env`. The operator (not the bot) runs it once, then updates `.env` + restarts. This is the permanent fix if the current key is genuinely burnt.
- Do NOT attempt to run the login yourself; just deliver the tool + instructions.

### 4d. Root-cause report
- In `REPORT.md`: your findings on why the key is still rejected with zero consumers (test results, timestamps, the git-history leak check result), plus the recommended permanent fix (regenerate vs wait).

## 5. Files in scope

- `src/affiliate.ts`, `dist/affiliate.js` (main bot)
- `src/sales-leads.ts` (sales bot scanner)
- `src/sales-bot.ts` / `src/sales-bot-entry.ts` (only if the scanner loop needs changes)
- `scripts/new-sales-session.mjs` (new)
- `REPORT.md` (new)

## 6. Constraints

- Do NOT touch trading logic, gale/martingale code, bot UI, or any other module.
- Do NOT modify `.env` or attempt the login.
- Do NOT run repo-wide audits or read unrelated modules. Work ONLY in the files above.
- The sales bot runs via `tsx` from `src/` (no compile step). The main bot runs from `dist/` — keep `src/` and `dist/` in sync for `affiliate`.
- No external API calls beyond the affiliate channel + Telegram DC.
- `src/bot.ts` must remain 100% plain JS (never add TS annotations there — not in scope anyway).
- Any change that needs a PM2 restart: note the exact restart commands and flag that restarts are operator-approved.

## 7. Definition of done

- Root cause of the persistent `AUTH_KEY_DUPLICATED` identified and documented in `REPORT.md`.
- Session ownership rule enforced + verified in logs (release trace visible).
- Sales scanner self-heals with backoff, resumes from cursor, alerts admin after 60 min down.
- `scripts/new-sales-session.mjs` delivered with instructions.
- All tests you can run pass; report what you could not test (live reconnect requires the operator).
