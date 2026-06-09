# DIRECTIVE: Proxy Health Check & Auto-Rotation

**Severity:** Medium — Prevents auth login from breaking when single proxy fails
**Goal:** Eliminate single point of failure on auth proxy

---

## Overview

Auth login now routes through a Webshare datacenter proxy (set via `LOGIN_PROXY_URL` in `.env`). If that proxy goes down, new users can't login. This directive adds a 30-minute health check that tests the current proxy and auto-rotates to a backup if it fails twice consecutively.

---

## Required Files

### 1. Create `/root/iqbot-v3/scripts/proxy-healthcheck.cjs`

A Node.js script (CommonJS — package.json has `"type": "module"`) that:

**Proxy pool** (hardcoded, all use same credentials `pzxyatji:tqz8zcybhmj7`):
```
89.32.200.192:6648
154.6.11.116:5585
82.23.221.140:6470
31.58.24.215:6286
104.239.44.239:6161
181.214.13.60:5901
166.88.83.42:6699
45.38.78.64:6001
104.143.244.125:6073
192.177.103.211:6704
```

**Logic:**
1. Read state from `/root/iqbot-v3/.proxy-state.json` (`currentIndex`, `consecutiveFailures`)
2. Get current proxy from pool[currentIndex], construct full URL `http://user:pass@host:port`
3. Test it: `fetch('https://auth.iqoption.com/api/v2/login', { method:'POST', dispatcher: new ProxyAgent(proxyUrl), signal: AbortSignal.timeout(10000) })`. Success = HTTP 401 (invalid credentials) or 200.
4. If OK → reset consecutiveFailures to 0, save state
5. If fail → increment consecutiveFailures
6. If consecutiveFailures >= 2 → advance currentIndex (wrap around), update `.env`'s `LOGIN_PROXY_URL` line, `pm2 restart iqbot-v3-bot --update-env`, reset consecutiveFailures
7. If `.env`'s `LOGIN_PROXY_URL` doesn't match pool[currentIndex], sync it (handles drift from manual edits)

**State file format:**
```json
{
  "currentIndex": 0,
  "consecutiveFailures": 0
}
```

### 2. Create cron job

Hermes cron: every 30 min (`*/30 * * * *`), runs the script, reports only if rotation happens.

```bash
hermes cron create \
  --name "Proxy Health Check" \
  --schedule "*/30 * * * *" \
  --prompt "Run node /root/iqbot-v3/scripts/proxy-healthcheck.cjs. If rotation happened, report it."
```

---

## Files NOT to modify
- `.env` — script handles this file automatically
- `src/bot.ts` — proxy logic already deployed
- `src/protocol.ts` — not relevant

## Verification

```bash
# Manual test
node /root/iqbot-v3/scripts/proxy-healthcheck.cjs
# Should output: [proxy-health ...] Testing proxy[0]: 89.32.200.192:6648 ... OK

# Force rotation test (optional)
# Set .proxy-state.json consecutiveFailures=1, run again, verify it rotates
```
