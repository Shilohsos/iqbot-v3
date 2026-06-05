# Directive: Handle 403 on Callback Responses (Channel Users)

## IMPORTANT: Merge master first
```
git checkout master && git pull origin master
git checkout -b claude/callback-403-handle-ZsX3J
```

---

**Problem:** When a user joins via the channel, the bot sends onboarding via `telegram.sendMessage()` (join request context allows it). But when the user taps a callback button, `ctx.reply()` / `ctx.replyWithPhoto()` in the handler fails with `403: Forbidden: bot can't initiate conversation with a user` because the user hasn't messaged the bot directly in 1-on-1.

The user sees the button loading stop (answerCbQuery succeeds) but no response message — looks like nothing happens.

**Fix:** Catch 403 errors in callback handlers and prompt the user to start a conversation with `/start`.

---

## Change 1: Add a helper to send-or-prompt

Add this function somewhere in `src/bot.ts`:

```typescript
/**
 * Try to send a message to a user. If Telegram blocks it (403/privacy),
 * prompt them to start the bot first via the channel.
 */
async function tryReply(ctx: Context, text: string, extra?: Record<string, unknown>): Promise<void> {
    try {
        await ctx.reply(text, extra);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('403') || msg.includes("can't initiate conversation")) {
            // Bot can't message user — tell them to start the bot
            // Use answerCbQuery to show a brief alert instead
            try {
                await ctx.answerCbQuery(
                    '⚠️ Message me first! Send /start to activate the bot 💜',
                    { show_alert: true }
                );
            } catch {}
        } else {
            throw err; // Re-throw unexpected errors
        }
    }
}
```

The key is using `answerCbQuery()` with `show_alert: true` — this shows a popup alert to the user even when sending a new message fails.

---

## Change 2: Wrap all callback handlers in onboarding flow

Wrap `ctx.reply()` calls in the following handlers. The easiest approach: modify `sendTemplate` to use `tryReply` internally.

### 2a. Modify `sendTemplate` in `src/onboarding.ts`

Change the reply call (line 67) from:
```typescript
} else {
    await ctx.reply(msg, { ...(markup ? { reply_markup: markup } : {}) });
}
```

To:
```typescript
} else {
    await tryReply(ctx, msg, markup ? { reply_markup: markup } : {});
}
```

Also wrap `ctx.replyWithPhoto` and `ctx.replyWithVideo` lines (63-65):
```typescript
if (mediaFileId && mediaType === 'video') {
    try {
        await ctx.replyWithVideo(mediaFileId, { caption: msg, ...(markup ? { reply_markup: markup } : {}) });
    } catch (err: unknown) {
        if ((err instanceof Error ? err.message : '').includes('403')) return;
        throw err;
    }
} else if (mediaFileId) {
    try {
        await ctx.replyWithPhoto(mediaFileId, { caption: msg, ...(markup ? { reply_markup: markup } : {}) });
    } catch (err: unknown) {
        if ((err instanceof Error ? err.message : '').includes('403')) return;
        throw err;
    }
}
```

### 2b. Import `tryReply` in onboarding.ts

The `tryReply` function is defined in `bot.ts`. But `sendTemplate` is in `onboarding.ts`. You have two options:
1. Move `tryReply` to `onboarding.ts` (simpler — define it there since that's where it's used)
2. Export from bot.ts and import in onboarding.ts

**Recommendation:** Option 1 — define `tryReply` directly in `onboarding.ts` since all the onboarding callback handlers use it.

### 2c. Also wrap the `handleUserIdBrainRoute` function

In `bot.ts`, the `handleUserIdBrainRoute` function (added by previous directive) also uses `ctx.reply()` — wrap those calls the same way.

---

## Change 3: Handle in the re-engagement loop (Segment 1)

The re-engagement loop in bot.ts uses `bot.telegram.sendMessage()` and `sendPhoto()` directly. These already catch errors (the `catch {}` at lines 4895 and 4931). So 403 errors from these are already silently swallowed — the user just doesn't get the message.

The ONLY change needed for the re-engagement loop is that when the user taps a callback button from a re-engagement message, the handler should catch 403 and show an alert. This is handled by Change 2 (wrapping `sendTemplate`).

---

## Verification

1. Build: `npx tsc --noEmit`
2. Restart: `pm2 restart iqbot-v3-bot --update-env`
3. Test: Join the channel as a fresh user, tap the onboarding button
   - Should see popup: "⚠️ Message me first! Send /start to activate the bot 💜"
4. After sending /start, tap again → should work normally
