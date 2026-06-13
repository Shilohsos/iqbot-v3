# DIRECTIVE: Fix Signal Card Race Condition — Button Timeout

**Date:** 2026-06-13
**From:** Wizard
**To:** Claude
**Repo:** iqbot-v3
**IMPORTANT:** Merge master first.

---

## Problem

After a signal is placed, the "New Signal" and "Back" buttons become unresponsive. Two competing processes edit the same card message:

| Process | What it does | Frequency |
|---------|-------------|-----------|
| Prep countdown (bot.ts:~2115) | Edits card with countdown timer | Every 10s × 6 times |
| Signal tracking loop (bot.ts:~6388) | Edits card with win/loss result + buttons | Once when result arrives |

**Race condition:** Both try `editMessageText` on the same `card_msg_id`. If one edit lands while the other is in-flight, it fails. The fallback creates a **duplicate card** — now the user has two messages. The old card's buttons point to a message the tracking loop already replaced. Tapping them either times out or fires a stale handler.

---

## Fix

### 1. Make the prep countdown cancelable and yield to the tracking loop

Before the tracking loop edits the card, it already calls `cancelPrepCountdown()`. But the countdown's `editMessageText` might still be mid-flight. 

**Fix:** After `cancelPrepCountdown()`, add a short delay (200ms) or use a mutex/lock on the card message to ensure the countdown has fully stopped before the tracking loop edits.

### 2. Don't create a duplicate card on edit failure

**Current fallback (bot.ts:~6395):**
```typescript
if (!edited) {
    try {
        await bot.telegram.sendMessage(sig.telegram_id, notifyText, ...);
    } catch {}
}
```

**Fix:** If the edit fails because the message was deleted, send a new message AND clear the old `card_msg_id` from the signal tracking record. If the edit fails for other reasons (network), retry once with 1s backoff before falling back to new message.

### 3. Deduplicate — delete old card when creating new one

When the tracking loop creates a new card (fallback path), delete the old card message first using the stored `card_msg_id`:
```typescript
if (!edited) {
    // Delete old card before creating new one
    if (sig.card_msg_id) {
        bot.telegram.deleteMessage(sig.card_chat_id, sig.card_msg_id).catch(() => {});
    }
    // Create new card
    const newMsg = await bot.telegram.sendMessage(...);
    // Update stored card_msg_id
    updateSignalTrackCard(sig.id, newMsg.chat.id, newMsg.message_id);
}
```

### 4. Add a lock to prevent overlapping edits

Add a per-user signal lock (`Map<number, boolean>`) that prevents the countdown and tracking loop from editing simultaneously:
```typescript
const signalCardLocks = new Map<number, Promise<void>>();

async function editSignalCard(uid: number, chatId: number, msgId: number, text: string, keyboard: any) {
    // Wait for any in-flight edit to complete
    while (signalCardLocks.has(uid)) {
        await signalCardLocks.get(uid);
    }
    // Create new lock
    let resolve: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    signalCardLocks.set(uid, promise);
    try {
        await bot.telegram.editMessageText(chatId, msgId, undefined, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } finally {
        signalCardLocks.delete(uid);
        resolve!();
    }
}
```

---

## Files Modified

| File | Section | Change |
|------|---------|--------|
| `src/bot.ts` | 1-4 | Prep countdown yield, dedup fallback, edit lock |
