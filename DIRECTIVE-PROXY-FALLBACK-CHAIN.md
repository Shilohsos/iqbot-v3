# DIRECTIVE: Proxy fallback chain — proxy → direct → rotate

**IMPORTANT:** Merge master first before implementing.

## Change: `loginAndCaptureSsid()` in `src/bot.ts`

**Current behavior:** When `LOGIN_PROXY_URL` is set, all auth requests go through the proxy only. If the proxy fails, the entire login fails.

**Desired behavior:** When `LOGIN_PROXY_URL` is set:

1. Try login via proxy (current behavior)
2. If proxy request fails (fetch error, timeout, non-2xx) → **immediately** try login via direct connection (no proxy)
3. While the direct request is in-flight, **trigger an async proxy rotation** (rotate to next IP in the proxy list and update `.env`)
4. Return the direct-connection result to the caller immediately — user never waits
5. Next login attempt will use the new rotated proxy

**Pseudocode:**

```typescript
async function loginAndCaptureSsid(email: string, password: string): Promise<{ ssid: string; sdk: ClientSdk }> {
    const makeRequest = (useProxy: boolean) => {
        const fetchOptions: RequestInit & { dispatcher?: any } = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
            body: JSON.stringify({ identifier: email, password }),
        };
        if (useProxy && LOGIN_PROXY_URL) {
            fetchOptions.dispatcher = new ProxyAgent(LOGIN_PROXY_URL);
        }
        return fetch(`${IQ_AUTH_URL}/v2/login`, fetchOptions);
    };

    // 1. Try proxy first
    if (LOGIN_PROXY_URL) {
        try {
            const res = await makeRequest(true);
            if (res.ok) {
                // Success — process & return
                return processLoginResponse(res);
            }
        } catch {
            // Proxy failed — fall through to direct + rotate
        }

        // 2. Trigger async rotation (don't await)
        triggerProxyRotation().catch(() => {});
    }

    // 3. Fallback to direct
    const res = await makeRequest(false);
    return processLoginResponse(res);
}
```

The `triggerProxyRotation()` function should read the current proxy state file, increment the index, write the new proxy URL to `.env`, and call `pm2 restart iqbot-v3-bot --update-env` — similar to what `scripts/proxy-healthcheck.cjs` already does for rotation.

**Alternatively:** Reuse the rotation logic from `scripts/proxy-healthcheck.cjs` — extract the rotation + env update into a shared function that both the health check cron and `loginAndCaptureSsid()` can call.

## Verification

- [ ] Proxy login attempt happens first
- [ ] On proxy failure, direct login fires immediately AND proxy rotation triggers in parallel
- [ ] User never waits for rotation to complete — direct result returns instantly
- [ ] Next login uses the rotated proxy
- [ ] Build passes
- [ ] No regression when `LOGIN_PROXY_URL` is not set (existing direct-only flow unchanged)
