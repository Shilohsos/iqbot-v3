# DIRECTIVE-2FA-VERIFY-FLOW.md
## Feature: 2FA Email Verification Support for IQ Option Login

**Priority:** HIGH — 80% of auto-reconnect failures are 2FA-related
**Branch:** claude/broadcast-scheduling-feature-BaEF3
**IMPORTANT: Merge master first before implementing.**

---

## Problem

When IQ Option requires email verification (2FA), the login endpoint returns:

```json
{"code":"verify","method":"email","token":"<VERIFY_TOKEN>","available_methods":["email"]}
```

The bot's `attemptLogin()` only handles `code: 'success'`. When it receives `code: 'verify'` with no `message` field, it throws `'Login failed'` — a generic error that tells the user nothing useful. Users see "Login failed" and retry endlessly.

---

## Solution

Add a 2FA verification flow using the IQ Option endpoint:

**POST** `https://auth.iqoption.com/api/v2/verify/2fa`

Headers:
```
Accept: application/json
Content-Type: application/json
Referer: https://iqoption.com/en/login
Sec-Fetch-Mode: cors
User-Agent: Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36
```

Body:
```json
{"code":"<6-digit-code>","token":"<VERIFY_TOKEN>","method":"email"}
```

Success response:
```json
{"code":"success","ssid":"<SSID>","token":"<AUTH_TOKEN>"}
```

---

## Implementation

### 1. Modify `attemptLogin()` in bot.ts

When the login response has `code: 'verify'`, throw a new error type so the onboarding handler can distinguish it from other failures:

```typescript
// After: if (data.code !== 'success' || !data.ssid)
if (data.code === 'verify') {
    throw new VerifyRequiredError(data.token, data.method || 'email');
}
throw new Error(data.message ?? 'Login failed');
```

Define `VerifyRequiredError`:
```typescript
class VerifyRequiredError extends Error {
    token: string;
    method: string;
    constructor(token: string, method: string) {
        super('VERIFY_REQUIRED');
        this.name = 'VerifyRequiredError';
        this.token = token;
        this.method = method;
    }
}
```

### 2. Add `verify2FA()` function

```typescript
async function verify2FA(code: string, token: string, method: string): Promise<{ ssid: string }> {
    const fetchOptions = {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Referer': 'https://iqoption.com/en/login',
            'Sec-Fetch-Mode': 'cors',
            'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36'
        },
        body: JSON.stringify({ code, token, method }),
    };
    const proxyUrl = getProxyUrl();
    if (proxyUrl) {
        fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
    }
    const res = await fetch(`${IQ_AUTH_URL}/v2/verify/2fa`, fetchOptions);
    const rawBody = await res.text();
    console.log(`[verify] HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
    let data;
    try { data = JSON.parse(rawBody); } catch {
        throw new Error(`Verify response is not JSON (HTTP ${res.status})`);
    }
    if (data.code === 'invalid_code') {
        throw new Error('Invalid verification code. Please check your email and try again.');
    }
    if (data.code !== 'success' || !data.ssid) {
        throw new Error(data.message ?? 'Verification failed');
    }
    return { ssid: data.ssid };
}
```

### 3. Modify `loginAndCaptureSsid()` in bot.ts

Catch `VerifyRequiredError` and route to verification flow instead of falling through to direct login:

```typescript
async function loginAndCaptureSsid(email: string, password: string): Promise<{ ssid: string; sdk?: any }> {
    if (getProxyUrl()) {
        try {
            return await attemptLogin(email, password, true);
        } catch (err) {
            if (err instanceof VerifyRequiredError) {
                throw err; // Don't rotate proxy, don't fallback — pass through to caller
            }
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('invalid_credentials') || msg.includes('wrong credentials'))
                throw err;
            console.warn(`[connect] proxy login failed (${msg}) — falling back to direct + rotating proxy`);
            triggerProxyRotation().catch(() => {});
        }
    }
    try {
        return await attemptLogin(email, password, false);
    } catch (err) {
        if (err instanceof VerifyRequiredError) {
            throw err; // Pass through
        }
        throw err;
    }
}
```

### 4. Add `awaiting_verification` onboarding state

In the text handler (where `awaiting_password` is handled), add a new state:

```typescript
if (onboardingState === 'awaiting_verification') {
    touchOnboardingActivity(ctx.from.id);
    const verifySession = onboardSessions.get(chatId);
    const code = text.trim();
    
    if (!/^\d{4,8}$/.test(code)) {
        await ctx.reply('❌ Please enter the 6-digit code from your email:');
        return;
    }
    
    await ctx.reply('🔐 Verifying...');
    try {
        const { ssid } = await verify2FA(code, verifySession.verifyToken, verifySession.verifyMethod);
        saveUser({ telegram_id: ctx.from.id, ssid });
        saveUserCred(ctx.from.id, Buffer.from(`${verifySession.email}:${verifySession.password}`).toString('base64'), verifySession.email);
        setSsidValid(ctx.from.id, 1);
        await clearReconnectPromptMessage(ctx.from.id);
        
        // Continue to balance check (same as successful login)
        const sdk = await createSdk(ssid);
        // ... balance display code ...
        setOnboardingState(ctx.from.id, 'connected');
        await handleConnected(ctx, ctx.from.id, balanceText);
        onboardSessions.delete(chatId);
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Verification failed';
        await ctx.reply(`❌ ${msg}\n\nPlease try again or enter /connect to restart.`);
    }
    return;
}
```

### 5. Modify password handler to catch VerifyRequiredError

In the existing `awaiting_password` handler (where `loginAndCaptureSsid` is called), catch `VerifyRequiredError`:

```typescript
try {
    const { ssid, sdk } = await loginAndCaptureSsid(email, text);
    // ... existing success flow ...
} catch (err) {
    if (err instanceof VerifyRequiredError) {
        // Save session data and prompt for verification code
        onboardSessions.set(chatId, {
            step: 'verify',
            email: email,
            password: text,
            verifyToken: err.token,
            verifyMethod: err.method,
        });
        setOnboardingState(ctx.from.id, 'awaiting_verification');
        await ctx.reply('📧 A verification code has been sent to your email.\n\nPlease enter the code below:');
        return;
    }
    // ... existing error handling ...
}
```

### 6. Apply same pattern to standalone /connect wizard

The `/connect` flow (connectSessions) also calls `loginAndCaptureSsid` — apply the same `VerifyRequiredError` catch there.

---

## Files to Modify

1. **src/bot.ts** — `attemptLogin()`, `loginAndCaptureSsid()`, connect/onboarding text handler, add `verify2FA()` and `VerifyRequiredError`
2. No new files needed — everything stays in bot.ts

---

## Verification

After deployment:
1. Test with @evabryt (certifiedtirey92@gmail.com) — account has email 2FA enabled
2. User flows: /connect → enter email → enter password → "verification code sent" prompt → enter code → connected
3. Wrong code → "Invalid verification code" retry prompt
4. Auto-reconnect should still work for non-2FA accounts

---

## Pitfalls

- Do NOT rotate proxy on `VerifyRequiredError` — the login succeeded, we just need the code
- Do NOT fall back to direct connection — same proxy must be used for verify call
- The verify token is single-use and expires quickly (~5 min). If expired, user must restart /connect
- The `onboardSessions` must store email+password alongside the verify token so we can call `saveUserCred()` after successful verification
