# Directive — Issue #15: Login Still Fails on User End

## Status
Issue #15 — OPEN. Waiting for Claude fix.

## Problem
Login via Telegram `/connect` still returns:
```
❌ Connection failed: Unexpected token '<', '<!doctype"... is not valid JSON
```

Despite `loginAndCaptureSsid()` now using `https://auth.iqoption.com/api/v2/login` with correct headers (`Content-Type: application/json`, `User-Agent: quadcode-client-sdk-js/1.3.21`).

## Verified
- Same `fetch` call with same headers works from server-side terminal test (Node.js / tsx) ✅
- SSID returned, SDK connects, balances load ✅

## Suspected
- Possible PM2 / tsx caching issue — old code still running despite merge
- Possible module bundling issue where the hardcoded URL in source is not what executes at runtime
- No login errors appear in `bot-error.log` PM2 logs, making server-side debugging impossible

## Required Fix
1. Add diagnostic logging: log `res.status` and first 200 chars of `res.body` when `res.json()` fails
2. Ensure PM2 picks up fresh code on restart (delete tsx cache if needed)
3. Consider using SDK's native `HttpApiClient` + `HttpLoginRequest` instead of raw `fetch` — this is the tested path the SDK ships with
