# DIRECTIVE: Fix Auto-Broadcast Interval + Auto-Delete + Image Gate

## Issues

1. **Interval too short** — currently 30 minutes. User wants random intervals of **hours**, not minutes.
2. **Sent before images ready** — broadcasts went out without paired images. Must wait for user to upload images.
3. **No auto-delete** — old broadcasts should be deleted when a new one arrives.

## 1. Interval Change — src/auto-broadcast.ts

Change from 30 minutes to random 2-6 hours:

```typescript
// OLD
const BROADCAST_INTERVAL_MINUTES = 30;

// NEW
function getRandomIntervalMs(): number {
    const minHours = 2;
    const maxHours = 6;
    const randomHours = minHours + Math.random() * (maxHours - minHours);
    return randomHours * 60 * 60 * 1000;
}
```

Use `setTimeout` with random delay instead of `setInterval`:

```typescript
function scheduleNext(): void {
    const delay = getRandomIntervalMs();
    setTimeout(async () => {
        // ... send broadcast ...
        scheduleNext(); // schedule next random broadcast
    }, delay);
}
```

## 2. Image Gate — Don't Send Without Images

Add a check: if a broadcast message has `image_file_id = NULL`, skip it. Only send messages where the admin has uploaded images.

```typescript
const messages = getEnabledAutoMessages().filter(m => m.image_file_id !== null);
if (messages.length === 0) return; // no images yet, skip this cycle
```

## 3. Auto-Delete Previous Broadcast

Track the last message ID sent to each user. When sending a new broadcast, delete the old one first.

Add a `Map<number, number>` tracking `lastBroadcastMsgId` per user:

```typescript
const lastBroadcastMsgIds = new Map<number, number>();

// Before sending new broadcast:
const prevMsgId = lastBroadcastMsgIds.get(tid);
if (prevMsgId) {
    try { await bot.telegram.deleteMessage(tid, prevMsgId); } catch {}
}

// After sending:
lastBroadcastMsgIds.set(tid, sentMsg.message_id);
```

This applies per-user — different users may have different old messages. Only delete the *bot's own broadcast* sent to that specific user.

## 4. Re-Enable

After Claude implements the fixes, uncomment `startAutoBroadcast(bot)` in `src/bot.ts` line ~3324.

Currently commented out: `// startAutoBroadcast(bot); // DISABLED — pending interval fix + images`

## Files to Change

| File | Change |
|------|--------|
| `src/auto-broadcast.ts` | Random interval (2-6h), image gate, per-user auto-delete |
| `src/bot.ts` | Uncomment `startAutoBroadcast(bot)` when ready |

---

**Note:** User will provide images for the 10 seeded messages before re-enabling.
