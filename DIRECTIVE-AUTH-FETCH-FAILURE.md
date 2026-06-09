# DIRECTIVE: Auth Login Fetch Failure

**Severity:** Medium — Affects new user onboarding and reconnect flow only. Existing SSID holders trade fine.
**Date:** 2026-06-09

---

## Diagnosis

### Symptom
Users entering email + password during reconnect or onboarding get `❌ fetch failed` after the bot shows "🔐 Logging in...". This happens **intermittently** — ~14 failures vs ~12 successes in the last 2 hours.

### Error source
`src/bot.ts` line 4544-4545:
```ts
try {
    const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, text), 12_000, 'login');
```

The `loginAndCaptureSsid()` function (line 739-755) does a raw `fetch()` POST to `https://auth.iqoption.com/api/v2/login`. When the TCP connection fails, Node throws `TypeError: fetch failed`.

### Evidence

| Log period | fetch failed count |
|---|---|
| June 6-8 (3 days) | **0** |
| June 9 before 17:22 | **0** |
| **June 9 since 17:22** | **14** |

- This started **today** without any code/config change to networking.
- Trading continues fine — `wss://iqoption.com` (WebSocket) is on a different domain/IP than `auth.iqoption.com`.
- DNS resolves OK (`185.117.132.1`), but **TCP port 443 connections intermittently time out** from this Contabo UK VPS.
- The same error also affects SDK translation fetches (`Could not fetch translations after 3 attempts`), confirming it's a network-level block/throttle from Contabo's IP range to IQ Option's auth infrastructure.

### What NOT to touch
- `src/protocol.ts` — correct URL `https://auth.iqoption.com/api`
- `.env` — `IQ_AUTH_URL` is correct
- All other bot functionality unaffected

---

## Required Fix: Retry Logic on Auth Login

Implement a **simple retry loop** in `loginAndCaptureSsid()` and all callers that use it. Do NOT restructure the auth system or add proxy support.

### 1. Modify `loginAndCaptureSsid()` (line 739-755)

Wrap the fetch and SDK creation in a retry loop:

```ts
async function loginAndCaptureSsid(email: string, password: string): Promise<{ ssid: string; sdk: ClientSdk }> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2_000;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(`${IQ_AUTH_URL}/v2/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
                body: JSON.stringify({ identifier: email, password }),
            });
            const rawBody = await res.text();
            console.log(`[connect] (attempt ${attempt}/${MAX_RETRIES}) HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
            let data: { code?: string; message?: string; ssid?: string };
            try { data = JSON.parse(rawBody); } catch {
                throw new Error(`Login response is not JSON (HTTP ${res.status}): ${rawBody.slice(0, 100)}`);
            }
            if (data.code !== 'success' || !data.ssid) throw new Error(data.message ?? 'Login failed');
            const ssid = data.ssid;
            const sdk = await createSdk(ssid);
            return { ssid, sdk };
        } catch (err) {
            lastError = err instanceof Error ? err : new Error('Unknown login error');
            if (lastError.message.includes('invalid_credentials') || lastError.message.includes('wrong credentials')) {
                // Don't retry wrong passwords
                throw lastError;
            }
            if (attempt < MAX_RETRIES) {
                console.log(`[connect] retry ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms: ${lastError.message}`);
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            }
        }
    }
    throw lastError ?? new Error('Login failed after retries');
}
```

**Key logic:**
- Retry up to 3 times with 2s delay between attempts
- **Do NOT retry** on `invalid_credentials` / wrong password — would waste time and confuse user
- Retry on `fetch failed` (network), timeout, or any transient error
- Log attempt number for debugging

### 2. Update timeout wrappers (all callers)

The `withTimeout()` wrapper at lines 679, 710, 4545, 4647, 4690, 4723 currently wraps `loginAndCaptureSsid()` with 10-15s timeout. With retry logic built into the function itself:

- **Increase the outer timeout** to cover max retries: `12_000 → 20_000` for login flow (line 4545)
- OR simply remove the `withTimeout` wrapper from `loginAndCaptureSsid` calls and keep the timeout only inside the function (cleaner)

**All locations to patch:**

| Line | Current | Change |
|------|---------|--------|
| 679 | `withTimeout(loginAndCaptureSsid(...), 10_000, 'auto_reconnect')` | Remove `withTimeout` wrapper — retry inside function handles it |
| 710 | `withTimeout(loginAndCaptureSsid(...), 10_000, 'admin_auto_reconnect')` | Same |
| 4545 | `withTimeout(loginAndCaptureSsid(...), 12_000, 'login')` | Same |
| 4647 | `withTimeout(loginAndCaptureSsid(...), 15_000, 'login')` | Same |
| 4690 | `withTimeout(loginAndCaptureSsid(...), 15_000, 'admin_login')` | Same |
| 4723 | `withTimeout(loginAndCaptureSsid(...), 10_000, 'login')` | Same |

### 3. User-facing message for final failure

On line 4587-4588, the error message already shows the error:
```ts
await ctx.reply(`❌ ${errMsg}\n\n📧 Enter your IQ Option email again:`);
```

This is fine — the error will now say something like `Login failed after 3 attempts` instead of bare `fetch failed`, which is clearer.

---

## Verification

1. Restart bot: `pm2 restart iqbot-v3-bot --update-env`
2. Trigger a reconnect/login — should succeed silently on retry if the network glitch passes
3. PM2 logs should show: `[connect] (attempt 1/3) HTTP ...` / `[connect] retry 1/3 after 2000ms: fetch failed`

---

## IMPORTANT: Merge master first

This directive was written on a branch that may not contain your latest work. Before implementing:
```bash
git checkout <your-feature-branch>
git merge origin/master
```
Then implement changes, commit, push.
