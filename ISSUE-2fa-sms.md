# 2FA Verification — Codes Not Being Sent

## Problem

IQ Option's 2FA response includes `available_methods` — often `["email", "sms"]` — but the bot hardcodes email:

```javascript
await ctx.reply('📧 A verification code has been sent to your email.\n\nPlease enter the 6-digit code below:');
```

When IQ Option sends via SMS (or doesn't send email at all), users see no code and get stuck. Reports coming in that "codes are not being sent."

## Evidence

Logs show `available_methods:["email","sms"]` in the verify response — SMS is available but never offered:
```
{"available_methods":["email","sms"],"code":"verify","method":"email","token":"..."}
{"available_methods":["push","email"],"code":"verify","method":"push","token":"..."}
```

## Fix

At `routeToVerification()` in `src/bot.ts`:

1. Read `err.method` and `err.availableMethods` from the VerifyRequiredError
2. Show the correct method in the prompt (email vs SMS vs push)
3. Add a "Resend via SMS" button when SMS is available and email was the primary method
4. Add a "Resend code" button to trigger a new verification email/SMS

The verify token and proxy transport must be preserved for the chosen method.

## Files

- `src/bot.ts` — `routeToVerification()`, `awaiting_verification` handler
- May need to extend `VerifyRequiredError` to carry `availableMethods`
