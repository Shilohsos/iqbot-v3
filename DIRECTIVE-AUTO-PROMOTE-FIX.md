# Directive: Fix auto-promotion failure due to stale SSID

## Problem
Users who fund their account with $10 or more are not auto-promoted to PRO/MASTER because the SDK balance fetch (sdk.balances()) fails when the stored SSID is stale or invalid. The failure is swallowed by a broad try-catch, leaving the balance undefined and skipping the promotion logic.

## Evidence
- Frequent logs: `[connect fail] You entered the wrong credentials.`
- Successful promotions only occur when SDK call succeeds (e.g., `auto-promoted 7553116750 DEMO → PRO ($11.08)`)
- The SDK pool does not automatically refresh SSIDs on auth failure.

## Required Changes
Modify the balance-check pathways in `/root/iqbot-v3/src/bot.ts` to:
1. Detect SDK authentication failures (both during SDK creation and balance fetch).
2. On auth failure, invalidate the stored SSID for that user (set ssid = NULL in users table).
3. Log the event for monitoring.
4. Optionally notify the user to reconnect via `/connect` (if appropriate, without spamming).

## Files to Modify
- `/root/iqbot-v3/src/bot.ts` – three balance-check locations:
  a. `/balance` command handler (~line 640)
  b. SSID callback handler (~line 1160? Actually giveaway? check)
  c. Periodic auto-promote interval (~line 3935)
- Possibly `/root/iqbot-v3/src/sdk-pool.ts` to improve error handling (optional).

## Implementation Details
- In each try-catch block that calls `sdkPool.get(...)` and `sdk.balances()`, catch errors and check if the error message indicates authentication failure (e.g., contains "wrong credentials", "not authenticated", "session expired", or SDK-specific auth errors).
- On such error:
  - Call `setUserSsid(telegramId, null)` (or equivalent DB update) to clear the SSID.
  - Log: `logger.warn('auth', `SSID cleared for user ${telegramId} due to auth failure: ${error.message}`)`
  - If the context is a user-initiated command (like `/balance`), consider sending a friendly message: `⚠️ Your IQ Option session has expired. Please reconnect using /connect.`
  - Do NOT notify in background periodic checks to avoid spam.
- Ensure the SDK pool's `get` method does not cache failed SSIDs; currently it deletes entry on mismatch/max age but not on auth failure. We may enhance `sdk-pool.ts` to treat auth failures as immediate invalidation.

## Testing
- Verify that after a forced SSID expiration (e.g., manually logging out user in IQ Option), the bot clears the SSID on next balance check.
- Verify that auto-promotion works again after user reconnects and valid SSID is stored.
- Ensure no regression in normal operation.

## Notes
- Do NOT modify any other files unless absolutely necessary.
- Follow the existing code style and error-handling patterns.
- All changes must be committed to a feature branch and opened as a PR for review.