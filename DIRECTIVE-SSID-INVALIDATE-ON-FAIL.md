# Directive: Mark SSID Invalid on Trade Connection Failure

**IMPORTANT: Merge master first**

## Problem

When a trade attempt fails with an SDK connection error that `handlePossibleAuthExpiry()` doesn't recognize, the bot says "Try again" and leaves `ssid_valid = 1` in the DB. This means:

- The brain pre-check (`!context.has_ssid || context.ssid_valid === 0`) doesn't trigger
- The trade gate (`hasValidSsid = user?.ssid && user.ssid_valid !== 0`) doesn't trigger
- User keeps seeing trade buttons → keeps failing → infinite loop

## Changes Required

### Fix fallthrough in `src/bot.ts` (line ~1450-1452)

**Current code:**
```typescript
        if (await handlePossibleAuthExpiry(err, ctx, isAdmin)) return;
        await ctx.reply(friendlyError(err, '🔌 Could not connect to IQ Option. Try again.')).catch(() => {});
        return;
```

**Replacement:**
```typescript
        if (await handlePossibleAuthExpiry(err, ctx, isAdmin)) return;
        // Connection failed and it wasn't a recognized auth expiry.
        // Mark SSID invalid anyway — it's clearly not working.
        // This ensures subsequent interactions (brain, trade gate) route to reconnect.
        if (!isAdmin && ctx.from?.id) {
            try { setSsidValid(ctx.from.id, 0); } catch {}
        }
        await ctx.reply(
            '🔌 Could not connect to IQ Option.\n\n' +
            'Your session may have expired. Reconnect in 3 steps:\n' +
            '1️⃣ Tap the 🔗 Reconnect button below\n' +
            '2️⃣ Enter your IQ Option email and password\n' +
            '3️⃣ Get back to trading instantly',
            { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
        ).catch(() => {});
        return;
```

## How It Works

| Scenario | Before | After |
|----------|--------|-------|
| Trade fails with unrecognized error | Says "Try again" — user retries forever | ✅ SSID marked invalid → reconnect prompt → next interaction caught by gates |
| Trade fails with recognized auth expiry | Shows reconnect (from `handlePossibleAuthExpiry`) | ✅ Same (unchanged) |
| User sends "Hello" AFTER trade failure | Brain pre-check sees `ssid_valid=1` → passes to DeepSeek → start_trading | ✅ Brain pre-check sees `ssid_valid=0` → reconnect |
| User taps "Start Trading" AFTER trade failure | Trade gate sees `ssid_valid=1` → shows trade buttons | ✅ Trade gate sees `ssid_valid=0` → reconnect |

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Trigger a trade attempt that fails with a non-auth SDK error
3. Verify SSID is marked invalid in DB (`ssid_valid = 0`)
4. Verify user receives reconnect prompt (not "Try again")
5. Send "Hello" after failure → brain pre-check routes to reconnect
