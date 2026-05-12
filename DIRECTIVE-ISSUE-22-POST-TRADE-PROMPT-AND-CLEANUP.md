# Issue #22 — Post-trade prompt + auto-cleanup

## Issue A: Post-trade "Trade Again" prompt

After any trade closes (win, loss, or martingale exhaustion), show a **prompt to trade again** with a button instead of just ending the conversation.

### Current behavior

After a trade result is shown, the bot just displays the result text and returns to idle. User has to manually go back to main menu and click "Take a trade" to start again.

### Expected behavior

After every trade result message, append a **"New Opportunity"** button (or "Trade Again" button) that directly starts a new trade wizard. The button text should be something like:

```
🔄 New Opportunity
```

Tapping it should restart the trade wizard flow from the mode selection step (showing L4 image + mode keyboard), exactly like `ui:trade` does.

### Where to add

There are 3 places where trades end:
1. **Win/TIE** (line ~324 in runMartingale) — after result message + demo upsell
2. **Loss + martingale exhausted** (line ~347) — after "Lost this one" message
3. **Error/Timeout** (line ~328-330) — after error message

In all 3 cases, append a keyboard button below the result:

```typescript
{ reply_markup: { inline_keyboard: [[{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }]] } }
```

The `ui:trade` callback already exists and restarts the wizard from mode selection with L4.

---

## Issue B: Auto-delete trade messages after 1 hour

### Problem

Trade session logs, result images (L10, L11a/b/c), and result text remain in the chat forever, cluttering the Telegram channel.

### Expected behavior

All messages from a **single trade session** (including images, log updates, result messages, and the trade-again prompt) should be **auto-deleted 1 hour after the trade concludes**.

Users can still find trade history via the **History** and **Stats** buttons, which query the database — those are permanent.

### Implementation approach

Track all message IDs sent during `runMartingale()`:

1. Add a `sentMessages: number[]` array in the martingale function scope
2. After every `ctx.reply()` or `ctx.replyWithPhoto()`, push the `message_id` to this array
3. After the trade result is displayed (and prompt sent), schedule a deletion:

```typescript
// 1 hour = 3600000 ms
setTimeout(async () => {
    for (const msgId of sentMessages) {
        try { await ctx.telegram.deleteMessage(ctx.chat!.id, msgId); } catch {}
    }
}, 3600_000);
```

Messages to track and delete:
- L10 image (recovery activated)
- L11a/L11b/L11c images (results)
- All trade session log updates (`Trade 1|Step 2|...`)
- Result text ("+$37.40 added to your balance...")
- "New Opportunity" prompt button
- "SMART RECOVERY ACTIVATED" text
- "Lost this one" text
- Error/stopped messages

Messages NOT to delete (keep permanent):
- The demo upsell messages (L12, L13) — these are marketing
- Initial wizard images from before trade execution (L4/L5/L6/L7/L8/L9) — these are configuration steps

### Files to change

- `src/bot.ts` — runMartingale function:
  1. Track sent message IDs in an array
  2. After trade ends, schedule `setTimeout` cleanup
  3. Append "New Opportunity" keyboard to all result messages

---

*Directive: keep chat clean, keep users trading*
