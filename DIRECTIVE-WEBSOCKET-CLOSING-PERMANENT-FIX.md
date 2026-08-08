# DIRECTIVE — Permanent Fix: "WebSocket is closing; new requests are rejected" during martingale chains

## Context

Users are reporting real-money trades failing mid-chain with `WebSocket is closing; new requests are rejected` (screenshot 2026-08-08: Private Trader session, ₦1,500 Trade 1 placed, ₦3,000 Trade 2 failed TWICE with that error; bot correctly did NOT gale-double — "No gale double was applied" — but the user never got a recovery attempt on a fresh connection).

The error string comes from `src/index.ts:8148` in `doRequest()`:
```js
if (this.isClosing || this.disconnecting) {
    return Promise.reject(new Error('WebSocket is closing; new requests are rejected'));
}
```
`isClosing` is set by `disconnectGracefully()`, `disconnecting` by `disconnect()` and `disconnectGracefully()`. So the SDK object the martingale loop is using was shut down or mid-disconnect when the buy was attempted.

## Root causes (verified in code)

1. **The martingale loop holds one `activeSdk` for the whole chain** (src/bot.ts runMartingale region). If the pool evicts it, an auth-failure path calls `disconnect()`, or the WS drops and enters reconnect backoff between rounds, every subsequent buy on that same object rejects with the closing error. The rebuild path exists (bot.ts ~1723) but runs only ONCE and only AFTER a failure has already burned the attempt — and it goes through `sdkPool.get()`, which can return the same dead entry.

2. **`isEntryHealthy()` trusts the stale `healthy` flag** (src/sdk-pool.ts:118-130): when it cannot read `readyState` (ws/socket undefined), it falls through to `return true` based on the flag alone. A pool entry whose SDK was `disconnect()`-ed (flag never updated to false in that path) is handed out as healthy.

3. **No immediate unhealthy-marking on closing rejection**: when `doRequest` rejects with "WebSocket is closing", nothing marks the pool entry unhealthy at that moment, so the next `sdkPool.get()` may return the same dying SDK instead of rebuilding.

## Required Fix (all three parts — implement together)

### Part A — Pre-buy health gate in the martingale chain (src/bot.ts, runMartingale)

Before EVERY round buy (the first trade AND every gale round), verify the SDK's WebSocket is actually usable. Add a small helper near the trade loop:

```js
function sdkUsable(sdk) {
    try {
        const ws = sdk?.ws?.socket?.readyState;
        // 1 = OPEN; treat undefined as "can't check" → assume usable
        if (ws !== undefined && ws !== 1) return false;
        const client = sdk?.wsApiClient;
        if (client && (client.isClosing || client.disconnecting)) return false;
        return true;
    } catch { return true; }
}
```

Before each buy: if the current `activeSdk` fails `sdkUsable()` → force-close it (call its shutdown/forceClose if exposed, else pool eviction), then obtain a **fresh SDK** (admin → `createSdk(getAdminSsid())`; user → `sdkPool.get(userId, freshSsid)` after evicting the stale entry), then proceed with the buy. This must happen BEFORE the buy call — never attempt a buy on a socket known to be closing. The existing post-failure rebuild (bot.ts ~1723) stays as a second line of defense.

Also: the `isBuyFailure` regex already matches `WebSocket.*clos|is closing` — keep that, but the pre-buy gate means we stop attempting on dead sockets at all.

### Part B — Pool never hands out closing sockets (src/sdk-pool.ts)

Extend `isEntryHealthy(entry)` so it also rejects entries whose SDK is in a closing/disconnecting state, even when readyState can't be read:

```js
isEntryHealthy(entry) {
    if (!entry) return false;
    if (!entry.sdk) return false;
    if (!entry.healthy) return false;
    if (Date.now() - entry.lastUsed > 5 * 60 * 1000) return false;
    try {
        const ws = entry.sdk?.ws?.socket?.readyState;
        if (ws !== undefined && ws !== 1) return false;
        const client = entry.sdk?.wsApiClient;
        if (client && (client.isClosing || client.disconnecting)) return false;
    } catch { /* can't check — trust healthy flag */ }
    return true;
}
```

Note the existing catch swallows errors — keep that shape, but add the wsApiClient flag check INSIDE the try so a closing-state SDK is rejected. This makes `sdkPool.get()` rebuild instead of returning the dead entry.

### Part C — Mark unhealthy immediately on closing rejection (src/sdk-pool.ts)

Where the pool wraps SDK calls / where `get()` returns an entry, or in the rejection path of `doRequest` if reachable from the pool layer — the pool should mark an entry unhealthy the moment a "WebSocket is closing" / "connection is not open" rejection is observed on it. Concretely:

- In `get()`: after obtaining an entry and before returning it, if the entry's SDK rejects a lightweight probe with a closing/not-open error, set `entry.healthy = false` and rebuild.
- If a lightweight probe is undesirable per-call, then ensure the existing health-check paths (ensureHealthy, pre-trade check) set `entry.healthy = false` when they detect `isClosing || disconnecting` on the wsApiClient.

Choose the least-invasive correct approach; the requirement is: **a pool entry whose SDK is closing must never be returned as healthy**.

### Do NOT touch

- Trade settlement logic (TradeCore / GaleEngine / trade.ts settle paths) — settlement behavior must not change.
- The `isBuyFailure` / gale-double rules — no gale doubling changes.
- user-facing message text, templates, card renderers.
- PM2 / ecosystem configs, heartbeat, watchdog (already shipped separately).
- No new npm dependencies.

### Build & verify steps (exact)

```bash
cd /root/iqbot-v3
# compile modified modules (sdk-pool is tsc-compiled; bot.ts must stay plain JS)
npx tsc --pretty false --target es2022 --module es2022 --moduleResolution bundler \
  --outDir dist --rootDir src --skipLibCheck --esModuleInterop src/sdk-pool.ts
node --check dist/sdk-pool.js
# bot.ts: verify the helper + gate are plain JS (no TS annotations), then:
bash upgrades/scripts/build-safe.sh
node --check dist/bot.js
```

### Acceptance criteria

1. `sdkUsable()` helper present in src/bot.ts, called before EVERY buy in runMartingale (first trade + each gale round)
2. `isEntryHealthy()` in src/sdk-pool.ts rejects entries with `wsApiClient.isClosing || wsApiClient.disconnecting`
3. No pool path returns a closing-state entry as healthy; closing rejections mark entries unhealthy immediately
4. `node --check` clean on dist/bot.js and dist/sdk-pool.js after build
5. `grep -c "isClosing" dist/sdk-pool.js` ≥ 1 and `grep -c "sdkUsable" dist/bot.js` ≥ 1
6. Report: confirmation of all checks + boot log excerpt

## Scope lock

Work ONLY within the files named in this directive (`src/bot.ts`, `src/sdk-pool.ts`). Do not explore the broader codebase. Do not run repo-wide searches/audits/greps or read unrelated modules. Do not modify any file not directly required by this directive. Everything outside the directive is out of scope — ignore it entirely.
