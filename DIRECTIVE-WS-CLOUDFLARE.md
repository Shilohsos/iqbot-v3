# DIRECTIVE: Switch WebSocket to Cloudflare Front (ws.iqoption.com)

**Severity:** Critical — Trading is down, WebSocket cannot connect to Carquardin IPs
**Root cause:** Contabo UK VPS IP range TCP-blocked by IQ Option's upstream (Carquardin CDN, Amsterdam). Both `auth.iqoption.com` (185.117.132.1) and `iqoption.com` (45.88.36.129) are 100% unreachable on any port.

**Fix evidence:** `ws.iqoption.com` resolves to **Cloudflare** (104.18.16.240, 104.18.17.240) which IS accessible from this VPS. The SDK successfully established a WebSocket connection to `wss://ws.iqoption.com/echo/websocket` (confirmed via test). This is an official IQ Option front — they route WebSocket traffic through Cloudflare.

---

## Changes Required

### 1. Update `.env`

Change:
```
IQ_WS_URL=wss://iqoption.com/echo/websocket
```
To:
```
IQ_WS_URL=wss://ws.iqoption.com/echo/websocket
```

Also add/update `IQ_HOST` to point at the same Cloudflare front:
```
IQ_HOST=https://ws.iqoption.com
```

### 2. Update `src/protocol.ts` (defaults)

Line 1:
```ts
// Before
export const WS_URL = process.env.IQ_WS_URL ?? 'wss://iqoption.com/echo/websocket';
// After
export const WS_URL = process.env.IQ_WS_URL ?? 'wss://ws.iqoption.com/echo/websocket';
```

Line 3:
```ts
// Before  
export const IQ_HOST = 'https://iqoption.com';
// After
export const IQ_HOST = process.env.IQ_HOST ?? 'https://ws.iqoption.com';
```

### 3. Update extracted host logic (if needed)

The SDK's `extractHostFromWsUrl()` at `src/index.ts:189-193` strips `ws.` prefix:
```ts
const host = url.host.replace(/^ws\./, '')
return `https://${host}`
```

For `wss://ws.iqoption.com/echo/websocket` → extracts `https://iqoption.com` (removes `ws.` prefix).

The `{ host: IQ_HOST }` option passed to `ClientSdk.create()` overrides this extraction. Since we're setting `IQ_HOST=https://ws.iqoption.com`, the SDK will use the Cloudflare front for all HTTP API calls.

**Important:** The HTTP API paths (`/v2/login`, `/auth/oauth.v5/*`) return 404 on `ws.iqoption.com`. This means **new login/reconnect will still fail** via HTTP. But trading through the WebSocket will work because:
- Existing SSIDs authenticate through the WebSocket channel (not HTTP)
- The `SsidAuthMethod` sends the SSID directly via WS frames
- The Cloudflare WebSocket proxies these frames to IQ Option's backend

### 4. Rebuild and restart

```bash
source .env && npx tsc && pm2 restart iqbot-v3-bot --update-env
```

---

## Verification

1. Check PM2 logs for successful WebSocket connection
2. Check if existing SSID users can trade
3. If trading works, we can address auth login separately

---

## Scope

This fix restores **trading for existing SSID holders only**. SSIDs obtained before the block should still work because they authenticate through the WebSocket channel, not HTTP.

**New user login and SSID reconnection** will still fail — the HTTP auth endpoint on `ws.iqoption.com` returns 404. That needs a separate fix (e.g., routing auth through the Cloudflare WS channel using SDK's OAuth flow).

---

## IMPORTANT: Merge master first

Before implementing:
```bash
git checkout <your-feature-branch>
git merge origin/master
```
