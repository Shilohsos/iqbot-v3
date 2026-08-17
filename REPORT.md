# REPORT — Shared Telegram session conflict (AUTH_KEY_DUPLICATED)

**Branch:** `claude/shared-session-conflict-fix` (from `7abf6d1`)
**Files changed:** `src/affiliate.ts`, `src/sales-leads.ts`, `src/sales-bot.ts`,
`scripts/new-sales-session.mjs` (new), `REPORT.md`

> Replaces the previous REPORT.md (affiliate full-history), preserved in history at `2cfa400`.

---

## 1. Root cause verdict: **the key is revoked, not held. Regenerate — waiting will not fix it.**

The directive's leading suspicion was a stale server-side session entry that
expires on its own. **It does not, and this is the crux of the whole incident.**

`AUTH_KEY_DUPLICATED` is not a "busy" or "locked" signal. In MTProto it is the
DC's response to detecting one auth key in use from concurrent sessions, and its
effect is to **invalidate the key permanently**. The protocol contract is that a
client receiving it must discard the key and re-authorize — there is no expiry to
wait out, no cooldown that returns it to service.

That is precisely what the observed evidence looks like:

| Observation | Consistent with "temporarily held"? | Consistent with "revoked"? |
|---|---|---|
| Rejection persists with **zero** TCP connections from either VPS | ✗ — a lock would clear when the holder leaves | ✓ |
| Rejection persists across hours | ✗ | ✓ |
| Rejection is immediate, at `InvokeWithLayer` (first authed call) | ✗ | ✓ |

A held key produces a *transient* failure that resolves the moment the holder
disconnects. A revoked key produces exactly the permanent, connection-independent
rejection being seen. **Recommendation: regenerate now** — do not spend the hour
probing. `scripts/new-sales-session.mjs` (§4) is the tool.

The day's churn (dozens of concurrent same-key connections across 4 bots) is what
triggered the revocation. The connect-per-check work already shipped is the right
fix for *preventing recurrence*; it cannot resurrect an already-burnt key.

### Why the other two suspicions are ruled out

**Suspicion 2 — leaked session string: NO EVIDENCE OF LEAK in `iqbot-v3`.** Full
history checked, five independent ways:

| Check | Result |
|---|---|
| Was `.env` (or any `.env*`) ever committed on any branch? | **No** — only `.env.example` was ever added |
| Does `.env.example` contain Telegram keys? | **No** — it has `BOT_TOKEN`/`IQ_SSID`/etc., no `TELETHON_*`, no `API_HASH` |
| Any commit ever containing `TELETHON_SESSION=1…` (an assigned value)? | **None** |
| Any **text** blob in the entire object store containing a session-shaped literal (`1` + 300+ base64 chars)? | **None** — 1,183 objects scanned |
| What do the `TELETHON` references in code actually do? | All are `process.env.TELETHON_SESSION` **reads** |

The only two blobs matching the session shape were `assets/L2.png` and
`assets/backup-20260807/L5.png` — PNG binary that coincidentally matches base64,
confirmed by re-running the scan with binary files excluded (zero hits).
`.env` is correctly listed in `.gitignore`.

⚠️ **Not yet checked: `augustus-ai` and `Iqbot-clone-v3`.** They are not attached
to this workspace and listing them needs your approval, so I could not scan them.
Given the augustus/olaoluwa bots run from a `dist/affiliate.js` clone, those repos
are the more likely leak site if one exists. Run this in each:

```bash
# from the repo root, with the CURRENT session value in $S
S=$(grep -m1 '^TELETHON_SESSION=' .env | cut -d= -f2- | tr -d '"'"'"' ' | cut -c1-16)
git log --all --oneline -S"$S"          # any commit that ever contained it
git log --all --oneline -- .env         # was .env ever tracked?
```
Any output from either line = the key was published and must be rotated
regardless of the outage.

**Suspicion 3 — API_ID/API_HASH mismatch: ruled out as the cause of *this* error.**
Both consumers construct the session from the same env pair
(`src/affiliate.ts`, `src/sales-leads.ts` — verified identical reads). More
decisively, a session used with the wrong app does not fail with
`AUTH_KEY_DUPLICATED`; it fails with `AUTH_KEY_UNREGISTERED` / `API_ID_INVALID`.
The error text alone rules this out. (Still worth keeping the pair identical
everywhere — the regeneration script prints which pair it used.)

---

## 2. What changed

### 2a. Session ownership, enforced and observable (`src/affiliate.ts`)

- A rule block at the top of the file states plainly: **the sales bot owns the
  session; every other consumer is connect-per-check.** It names the four
  consumers, explains why (one live connection per auth key), and warns that
  introducing a persistent client here takes the scanner down.
- `releaseClient()` now emits **`[affiliate] released (was connected|half-open)`**
  after every release, and a distinct `released (forced after disconnect timeout)`
  on the force-close path. This is the trace to grep for — see §3.
- Idempotency verified and documented: the client reference is nulled *first*, so
  the watchdog racing the `finally` block is a no-op rather than a double-destroy.
  The half-open path (`connected === false`) still force-destroys the raw socket.

### 2b. Self-healing scanner (`src/sales-leads.ts`, wired in `src/sales-bot.ts`)

**Two problems found beyond the directive's assumptions.**

**(i) The scanner loop does not exist in this repo.** `scanChannelForLeads()` is
exported and has **no caller** — `createSalesBot()` only schedules the Sunday
reveal, and `src/sales-bot-entry.ts` (named in the directive) does not exist here.
The live 2-minute loop must be in a deployed-only file. I therefore put the loop
in `sales-leads.ts` as `startLeadScanner()` and wired it from `createSalesBot()`,
so it runs wherever the sales bot runs. **It is idempotent** — if your deployed
entry file also starts a scan loop, this cannot double-scan.

**(ii) There was no cursor at all.** The directive says resume-from-cursor is
"already the design"; it is not. The scan read a flat `getMessages(limit: 50)` and
relied on `INSERT OR IGNORE` for dedupe. **Every event older than the newest 50
messages during an outage was lost permanently** — which is exactly what a 17-hour
outage produces. Measured on a 400-message fixture with 35 events in the gap:

- old fixed-50 window: **5 of 35 recovered — 30 events lost**
- new cursor resume: **35 of 35 recovered**

Now implemented:
- **Cursor** — `sales_scan_state.last_scanned_msg_id`, its own table because
  `MAX(channel_msg_id)` from `lead_events` only advances on a *matched* event and
  so cannot bound a gap full of non-event chatter. Pages backwards (100/page, 20-page
  cap per tick, remainder next tick) until it reaches the cursor. Advanced **only**
  after a clean pass, so a mid-scan failure re-reads that range instead of skipping it.
- **Backoff** — 2 → 4 → 8 → 15 min, hard-capped at 15, resetting on success.
- **Alarm** — one admin message to `1615652240` when no successful scan for >60 min,
  plus one recovery notice with the catch-up counts. Never repeats.
- **`scanChannelForLeads()` now throws on connect failure** instead of returning
  `{0,0}`. Swallowing it is precisely why the outage was silent for 17 hours.

### 2c. Session regeneration tool (`scripts/new-sales-session.mjs`)

Interactive phone → code → 2FA login that prints a fresh `TELETHON_SESSION`.
**Not run by me** (per directive). It disconnects in a `finally` so the tool
itself never holds the key it just minted. Includes the `.env` update and the
exact PM2 restart commands, and a warning that a new key does **not** grant
concurrency — one key is still one connection.

---

## 3. How to verify

**Automated (run and passing):** 13/13 assertions against the compiled scanner —
first-run single page + cursor set; 35/35 outage catch-up with a quantified
comparison against the old window; no duplicates on re-scan; `AUTH_KEY_DUPLICATED`
propagating with its text intact; cursor **held** after a failed scan; and
`startLeadScanner` idempotent with no admin spam before the threshold.
`tsc --noEmit` byte-identical to baseline (zero new errors); `node --check` clean
on `scripts/new-sales-session.mjs`.

**Ownership trace (directive 4a) — after deploying the main bot:**
```bash
pm2 logs iqbot-v3-bot --lines 200 | grep -c '\[affiliate\] released'
```
This count must equal the number of User-ID verifications in that window. A
verification with **no** matching `released` line means the session was not handed
back — that is the regression to watch for.

**Scanner health — after deploying the sales bot:**
```bash
pm2 logs sales-bot --lines 100 | grep '\[sales-leads\]'
```
Expect at boot: `scanner started (2min tick, backoff to 15min, alert >60min; cursor=…)`.
On failure: `scan FAILED (#N, AUTH_KEY_DUPLICATED): … — retrying in Nmin, down Nmin`.
On recovery: `scanner RECOVERED (caught up X FTD / Y redep)` + an admin message.

**Confirm the cursor is live:**
```sql
SELECT * FROM sales_scan_state;   -- last_scanned_msg_id, last_success_at
```

**Restart commands (operator-approved, per directive §6):**
```bash
pm2 restart sales-bot iqbot-v3-bot        # 81.0.219.89
pm2 restart augustus-bot olaoluwa-bot     # 173.249.16.116
```

**`dist/` sync:** `dist/` is gitignored, so `dist/affiliate.js` cannot ship in this
branch. Rebuild after merge:
```bash
npx tsc --pretty false --target es2022 --module es2022 --moduleResolution bundler \
  --outDir dist --rootDir src --skipLibCheck --esModuleInterop src/affiliate.ts
node --check dist/affiliate.js
```

---

## 4. Recommended sequence

1. **Regenerate the session** — `node scripts/new-sales-session.mjs`. Do not wait
   out the current key (§1).
2. Update `TELETHON_SESSION` in `.env` on **both** VPSs, restart all four bots.
3. Confirm `[sales-leads] scanner started` then a clean scan with no
   `AUTH_KEY_DUPLICATED`; confirm `[affiliate] released` after each verification.
4. Run the leak check on `augustus-ai` and `Iqbot-clone-v3` (§1). If either ever
   contained the string, rotate again after removing it.
5. **Strongly consider one session per bot.** Four bots on one key is why the key
   burned. Connect-per-check narrows the window but does not close it — two checks
   overlapping by milliseconds still duplicate. Minting a session per consumer
   removes the failure class entirely; the same script does it, run once per bot.

## 5. What I could not test

- **The live reconnect.** Requires the operator — and deliberately so: connecting
  from here with the shared session would be a *new* connection on that key and
  could kill whichever bot currently holds it. I did not probe the DC.
- **The hour-long retry probe** (directive §3 suspicion 1). Same reason, and §1
  argues it would not have succeeded anyway.
- **`augustus-ai` / `Iqbot-clone-v3` history** — not attached; command supplied.
- **The deployed 2-minute loop** — not in this repo, so I could not confirm whether
  it duplicates `startLeadScanner()`. The idempotency guard makes that safe either
  way, but worth a glance at the entry file on the VPS.
