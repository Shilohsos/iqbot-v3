# DIRECTIVE: Master Verification — All Changes June 09

**IMPORTANT:** Merge master first before implementing anything on your branch. This directive covers ALL changes made in the last 10 hours — both via previous directives and direct code edits.

## 1. Context: IQ Option Routing Block

The Contabo VPS (81.0.219.89) is TCP-blocked from the following IQ Option infrastructure via Lumen/Carquardin:
- `auth.iqoption.com` (185.117.132.1) — **blocked**
- `iqoption.com` (45.88.36.129) — **blocked**
- `ws.iqoption.com` (104.18.16.240/Cloudflare) — **accessible**

This required two workarounds:
1. **WS route** → Cloudflare frontend for WebSocket trading traffic
2. **Proxy route** → paid Webshare proxy for auth HTTP traffic

---

## 2. Committed Directives (already on master)

| Commit | Directive | Summary |
|--------|-----------|---------|
| `8d5f22f` | `DIRECTIVE-AUTH-FETCH-FAILURE.md` | Auth retry logic: 1 retry attempt, detection of `fetch failed` + `Connection timed out` errors, rotation through 100 proxy IPs |
| `a475477` | `DIRECTIVE-WS-CLOUDFLARE.md` | Switch WS from `wss://front.iqoption.com` to `wss://ws.iqoption.com/echo/websocket` (Cloudflare). `IQ_HOST` stays as `https://iqoption.com` |
| `58a7503` | `DIRECTIVE-PROXY-HEALTHCHECK.md` | Proxy health check: system cron every 30 min, tests current proxy, rotates on 2 consecutive failures, restarts bot |

---

## 3. Direct Code Edits (uncommitted — already deployed to production)

The following code changes were made directly to production. Claude should verify correctness and recommend any improvements.

### 3.1 `src/protocol.ts`
- Changed `WS_URL` default: `'wss://ws.iqoption.com/echo/websocket'` (Cloudflare)
- `IQ_HOST` stays `'https://iqoption.com'`

### 3.2 `src/bot.ts`

**Proxy for auth login** (`loginAndCaptureSsid()`):
- Added `import { ProxyAgent } from 'undici'`
- Added `LOGIN_PROXY_URL` env var read
- Modified `loginAndCaptureSsid()` to conditionally set `fetchOptions.dispatcher = new ProxyAgent(LOGIN_PROXY_URL)` when the env var is set

**Multi-currency trade wizard**:
- Added `currency` step to `WizardState` (between mode and amount)
- Added `currencyKeyboard()` callback handler (`cur:NGN`, `cur:USD`, `cur:EUR`, `cur:GBP`)
- `amountKeyboard(currency)` now shows NGN amounts (₦500/₦1,000/₦2,000/₦5,000) or generic `$sym + preset` for other currencies
- Demo max check is currency-aware: `NGN → 20,000`, others → `$20`
- `fmtMoney(n, cur)` helper for multi-currency display
- All martingale log lines and win/loss messages use `fmtMoney()` with the selected currency
- Opportunity message shows `Amount: ₦700.00 NGN` instead of `Amount: $700.00 USD`

**Privileged user (Shara, 6622587977)**:
- `isPrivileged` flag set: `isAdmin || ctx.from!.id === 6622587977`
- Bypasses daily demo cap
- Gets same admin-level analysis (not the PRO/MASTER 4-indicator path)
- No max concurrent trades limit
- No tier validation

**Admin notification queue**:
- `adminNotificationQueue` — queues notifications when admin is actively in the trade wizard
- `touchAdminActivity()` — resets a 20-minute timer every time admin clicks a trade wizard button, defers notifications
- `flushAdminNotifications()` — delivers all queued notifications after 20 min of inactivity
- `notifyAdmin()` — routes through the queue if timer active, sends directly otherwise
- All admin notification paths (`executeScheduledBroadcast`, User ID fail alerts) use `notifyAdmin()` now

**Cached asset images** (`sendCachedAsset()`):
- Caches Telegram `file_id` in memory after first upload of each image
- Subsequent image sends use `replyWithPhoto(cachedFileId)` instead of re-uploading
- Covers L5.png, L6.png wizard images
- Reduces TF/pair selection latency from 10-14s to <2s

**Auto-broadcast cooldown**:
- After manual broadcast, `manual_broadcast_cooldown` is set in config table (30 min from now)
- `auto-broadcast.ts` checks this config and skips if within cooldown
- Logs remaining cooldown minutes

**Compose wizard additions**:
- `compose:manual` action — lets admin paste arbitrary text instead of using AI topic generation
- `compose_btn:contact` option — CTA button linking to `ADMIN_CONTACT_LINK`

**Broadcast target "All Users"**:
- `broadcast:all` callback added to admin broadcast keyboard
- Targets `getAllUserIds()` (all users in DB regardless of funding/activation status)

**Miscellaneous fixes**:
- User ID onboarding: strips `#` prefix from input before validation (`text.replace(/^#/, '')`)
- Martingale: `demoCounted` flag prevents counting recovery rounds against the 10-trade daily cap
- Login failure: shows actual IQ Option error message instead of generic "double-check your email"
- Brain timeout: increased from 10s to 20s (in `classifier.ts`)

### 3.3 `src/menu.ts`
- Added `currencyKeyboard()` — 4 buttons (NGN, USD, EUR, GBP) + Cancel
- Changed `amountKeyboard()` to accept optional `currency` param
- NGN amounts: ₦500, ₦1,000, ₦2,000, ₦5,000
- Non-NGN: `$10, $25, $50, $100` (using currency symbol)
- Removed old hardcoded `$10/$25/$50/$100` preset row

### 3.4 `src/classifier.ts`
- Classification timeout increased: `10_000` → `20_000`

### 3.5 `src/ui/admin.ts`
- Added `broadcast:all` button ("👥 All Users") as first option
- Added "📝 Manual Text" option to compose topic keyboard
- Added "📞 Contact Admin" CTA button option

### 3.6 `src/auto-broadcast.ts`
- Added `features_paused` check — skips broadcast when config `features_paused=1`
- Added manual broadcast cooldown check — skips auto broadcast for 30 min after admin sends manually

### 3.7 `meta-track.py`
- Changed route: `/` → `/api/track`
- Caddy handles `/api/track` → proxies to Flask on port 8766 (matches Caddyfile `handle /api/*`)

### 3.8 `package.json`
- Added dependency: `"undici": "^6.24.1"` (for ProxyAgent in bot.ts)
- Added dependency: `"https-proxy-agent": "^9.1.0"`

---

## 4. New Scripts (untracked)

### `scripts/proxy-healthcheck.cjs`
- Tests current proxy against `https://auth.iqoption.com/api/v2/login` with a test POST
- On success: marks OK, clears failure count
- On failure: increments failure count, at 2 consecutive failures rotates to next proxy in list, rewrites `.env`, runs `pm2 restart iqbot-v3-bot --update-env`
- 100 proxies stored in `SOCKS5_PROXIES` list (Webshare paid plan)
- Logs to `logs/proxy-health.log`

### `scripts/check-sequences.cjs`
- Utility to inspect sequence_media table and verify template coverage

### `.proxy-state.json`
- Tracks current proxy index and failure count

---

## 5. Pending Issues for Verification

1. **`IQ_HOST = 'https://iqoption.com'`** in `protocol.ts` — this is passed to `ClientSdk.create()` as the 4th arg `host` option. If any SDK method (like `blitzOptions()`) makes HTTP requests to this host, they will fail with `ConnectTimeoutError`. The fix would be to either proxy the SDK's HTTP traffic or ensure all SDK operations use WebSocket only.

2. **"Could not analyze market" fallback error** — some users (likely PRO/MASTER tier) hit this error. The actual error is never logged — the catch block at bot.ts line 1565-1571 only shows the fallback message. Likely caused by `fetch failed` → `ConnectTimeoutError` when `blitzOptions()` or `candles()` internally hits `iqoption.com:443`. The `friendlyError` map doesn't handle "fetch failed" → falls through to generic fallback.

3. **Translations API** — still blocked (tries `iqoption.com:443`). SDK handles this gracefully with `console.error` but it spams logs every few minutes.

4. **SDK pool has no health check for stale connections** — pooled SDKs reuse the same WS connection for up to 30 min. If the SDK's internal WS drops between calls, operations fail silently.

---

## 6. Verification Checklist

Claude should verify:

- [ ] `ProxyAgent` import and usage in `loginAndCaptureSsid()` is correct
- [ ] `LOGIN_PROXY_URL` env var is read and applied correctly
- [ ] Multi-currency wizard handles all edge cases (NGN amount limits, display formatting)
- [ ] Privileged user bypasses are properly scoped to user 6622587977 only
- [ ] Admin notification queue doesn't lose notifications on bot restart
- [ ] `sendCachedAsset()` doesn't leak memory (cached file_ids persist indefinitely in current implementation)
- [ ] Auto-broadcast respects both `features_paused` and `manual_broadcast_cooldown`
- [ ] Martingale `demoCounted` flag correctly counts only the first settled trade per sequence
- [ ] `IQ_HOST` usage in SDK — does it affect trading operations?
- [ ] All type errors resolved (build passes)
