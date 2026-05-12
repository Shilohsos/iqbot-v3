# Issue #25 — Broadcast flow broken (timer prompt never shown)

## Problem

The broadcast feature doesn't work end-to-end.

**Steps that work:**
1. Admin clicks "Broadcast" → target selection shows ✅
2. Admin picks target → bot asks for message ✅
3. Admin types message → **timer prompt never appears** ❌
4. Message is never sent to users

## Verified working

- `getAllUserIds()`, `getActiveTraderIds()`, `getInactiveTraderIds()` all return correct data
- `bot.telegram.sendMessage()` sends successfully to users
- `pendingBroadcasts` map is defined and used correctly

## Suspected issue

The crash is somewhere in the text handler's `broadcast_message` step (around line 1210-1226 of bot.ts). The timer prompt at line 1221-1224 is never reached, which means an exception occurs somewhere between getting target IDs and showing the timer.

## Fix

1. Add `try-catch` with `console.error` around the `broadcast_message` block to catch the exact error
2. Fix whatever error is found

### Current code (line 1210-1226):
```typescript
if (as.step === 'broadcast_message') {
    const target = as.broadcastTarget!;
    let targetIds: number[];
    if (target === 'active') targetIds = getActiveTraderIds(5);
    else if (target === 'inactive') targetIds = getInactiveTraderIds(5);
    else targetIds = getAllUserIds();

    adminSessions.set(chatId, { ...as, step: 'broadcast_message', broadcastTarget: target });
    pendingBroadcasts.set(chatId, { message: text, targetIds });
    await ctx.reply(
        `📤 Ready to send to *${targetIds.length}* users.\n\nAuto-delete after?`,
        { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() }
    );
    return;
}
```

### Fix with try-catch:
```typescript
if (as.step === 'broadcast_message') {
    try {
        const target = as.broadcastTarget!;
        let targetIds: number[];
        if (target === 'active') targetIds = getActiveTraderIds(5);
        else if (target === 'inactive') targetIds = getInactiveTraderIds(5);
        else targetIds = getAllUserIds();

        adminSessions.set(chatId, { ...as, step: 'broadcast_message', broadcastTarget: target });
        pendingBroadcasts.set(chatId, { message: text, targetIds });
        await ctx.reply(
            `📤 Ready to send to *${targetIds.length}* users.\n\nAuto-delete after?`,
            { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() }
        );
    } catch (err) {
        console.error('[broadcast] Error:', err);
        await ctx.reply('❌ Broadcast failed. Check server logs.', { reply_markup: adminBackKeyboard() });
    }
    return;
}
```

Also add try-catch around the ENTIRE admin section of the text handler (line 1178-1260) — any unhandled error in the admin wizard silently crashes the text handler for that interaction.

### Also needed: confirm broadcast also supports link buttons

When composing a broadcast message, the admin should also be able to include a **link** that shows as a **button** on the client's side (not just inline text).

Flow:
1. After typing the broadcast message, before the timer prompt, ask: "Include a link button?"
2. If yes → ask for link URL and button text
3. Show timer prompt → broadcast happens with inline keyboard button

## Files

- `src/bot.ts` — broadcast_message handler needs try-catch + link button support
