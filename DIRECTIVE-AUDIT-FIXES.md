# DIRECTIVE: Audit Findings — Critical Fixes Required

**IMPORTANT:** Merge master first before implementing. This directive covers findings from a comprehensive 10-test stress audit performed June 10.

## Priority 1 — CRITICAL: Missing auth error mapping

The `FriendlyErrors` map in `src/errors.ts` is missing the key `"authentication is failed"`. When a user's SSID expires mid-session, the SDK throws this exact string. It is NOT caught by any existing key, so it falls through to the generic fallback message.

**Impact:** Users with expired SSIDs see "Could not analyze market" instead of a reconnect prompt. The PRO/MASTER analysis path (bot.ts:1565) is especially vulnerable because the error isn't caught by `handlePossibleAuthExpiry()` at that level.

**Fix:** Add two new entries to `FriendlyErrors` in `src/errors.ts`:

```
'authentication is failed': '🔐 Your session expired. Reconnect to continue trading.',
'authentication is failed': '🔐 Your session expired. Reconnect to continue trading.',
```

Wait — objects can't have duplicate keys. Change the approach: use a more specific key that covers both. Add these entries:

```
'authentication': '🔐 Your session expired. Reconnect to continue trading.',
```

Also add: `'authentication is failed'` won't match because the lookup uses `msg.includes(key)`. Since `'authenticate'` already appears in `isAuthExpiredError()` but NOT in `FriendlyErrors`, add it as a new key.

**Add to FriendlyErrors map in src/errors.ts:**
```
'authenticate': '🔐 Your session expired. Reconnect to continue trading.',
```

This catches "authentication is failed", "not authenticated", and any other auth-related SDK error.

---

## Priority 2 — CRITICAL: Brain classifier max_tokens too low

In `src/classifier.ts` line 115, `max_tokens: 150` is insufficient for `deepseek-v4-flash` which is a reasoning model. The model burns tokens on chain-of-thought reasoning and leaves zero tokens for the JSON response.

**Tested 5 scenarios at 150 tokens: 3/5 pass, 2/5 fail (truncated/empty JSON). At 300 tokens: 5/5 pass.**

**Fix:** In `src/classifier.ts`, change:
```
max_tokens: 150,
```
→
```
max_tokens: 300,
```

This adds ~$0.00015 per call at DeepSeek's pricing — negligible.

---

## Priority 3 — IQ_HOST standardization

The current `IQ_HOST = 'https://iqoption.com'` in `src/protocol.ts` points to a host that gets intermittently TCP-blocked from this VPS. The SDK's `ClientSdk.create(WS_URL, PLATFORM_ID, auth, { host: IQ_HOST })` sends HTTP requests to this host for some operations.

**Fix option:** Set `IQ_HOST` to an environment variable with the current value as default:
```
export const IQ_HOST = process.env.IQ_HOST ?? 'https://iqoption.com';
```
This is already the case from Claude's last commit. The remaining question is whether to change the default to something else (like empty string or remove it) so the SDK doesn't make HTTP calls to the blocked host at all.

Research needed: check if removing `host` from `ClientSdk.create()` options breaks anything. If SDK can operate WS-only without an HTTP host, set `IQ_HOST` to `''`.

---

## Priority 4 — Memory pressure investigation

The bot's V8 heap is at 91.12% usage (42.68/46.84 MiB). Two known sources:
1. `assetFileIdCache` in bot.ts — grows unbounded (but practically capped at number of wizard images: 2)
2. SDK pool entries — each pooled SDK holds a WS connection and in-memory state
3. `wizardSessions` Map — 10 stale entries not cleaned up

No immediate fix needed, but flagging for awareness. The slow callbacks (11-14s) in the logs are likely GC-related.

---

## Priority 5 — SSID health check

Only 135/233 users with stored SSID have `ssid_valid=1` (57.9%). The remaining 98 users will hit the "authentication is failed" error (Priority 1 above) when they try to trade. Once Priority 1 is fixed these users will get a proper reconnect prompt instead of a silent error.

---

## Verification Checklist

Claude should verify:

- [ ] `'authenticate'` key added to FriendlyErrors map (catches "authentication is failed" + "not authenticated")
- [ ] Build passes after errors.ts change
- [ ] `max_tokens` changed from 150 to 300 in classifier.ts
- [ ] IQ_HOST env-override still functional (it was already there from the last commit)
- [ ] "authentication is failed" error now surfaces a clear reconnect message instead of generic fallback
