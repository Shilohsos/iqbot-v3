# Fix: Non-activated users sending greetings should get a response, not flow_sleep

## IMPORTANT: Merge master first

---

## Problem

When a user's SSID expires (ssid_valid=0), they become `is_activated=false`. If they send "Hi" or "Hello", the brain's rule 3 says "Do not respond to off-topic messages" — returning `flow_sleep` → silence.

The user was previously connected, their SSID just expired. They should get a friendly "Reconnect" prompt, not silence.

## Fix

**File:** `src/classifier.ts`

Replace rule 3 in the `SYSTEM_PROMPT`:

Change from:
```
3. If the user is NOT connected (is_activated=false, no SSID or ssid_valid=0):
   - Only route to: link_account (prompt to connect IQ Option), verify_user_id (send User ID), create_account (affiliate link).
   - Do not respond to off-topic messages.
```

To:
```
3. If the user is NOT connected (is_activated=false, no SSID or ssid_valid=0):
   - Only route to: link_account, verify_user_id, or create_account.
   - If the user sends a greeting or casual chat → route to link_account with a friendly message.
   - Do not respond to truly off-topic content (gibberish, spam).
```

This way "Hi" from an expired-SSID user routes to `link_account` with a friendly greeting + reconnect prompt, instead of being silenced.

---

## Verification

- User with expired SSID sends "Hi" → brain returns `{flow: "link_account", message: "Hey! Your session expired. Reconnect to keep going 👇", shouldReply: true}`
- User with expired SSID sends gibberish → brain returns `flow_sleep` (still silent for spam)
- Connected user sending "Hi" → brain returns `go_home` (unchanged — rule 2)
