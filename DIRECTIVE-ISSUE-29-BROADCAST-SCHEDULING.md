# Issue #29 — Broadcast scheduling + pending delivery for active traders

## Feature 1: Scheduled broadcast

Admin can schedule a broadcast for a future time instead of sending immediately.

### Flow

After admin configures the broadcast (message, media, button, timer), add an option:

```
⏰ Send now or schedule?

[📤 Send Now] [⏰ Schedule]
```

If admin picks "Schedule", bot asks:

```
📅 When to send?

[15m] [30m] [1h] [2h] [✏️ Custom]
```

Admin picks a time. Multiple scheduled broadcasts are stored and sent at their scheduled times.

### Storage

```typescript
interface ScheduledBroadcast {
    id: number;
    message: string;
    targetIds: number[];
    button?: BroadcastButton;
    media?: { type: 'photo' | 'video'; fileId: string };
    deleteAfterMs: number;
    scheduledAt: Date;
    sent: boolean;
    createdAt: Date;
}
```

Store in an in-memory array (or DB if persistence across restarts is needed). Max **5 pending scheduled broadcasts** at a time.

### Scheduler

Use `setTimeout` to schedule each broadcast. On bot restart, check if any pending schedules need to be re-created.

### Scheduled broadcast management

Add a "📅 Scheduled" option to the admin Broadcast menu showing pending schedules:

```
📅 *Scheduled Broadcasts*

1. "Weekend promo..." — in 45m (to 3 users)
2. "New pair alert..." — in 2h (to all users)
...
```

Admin can cancel a scheduled broadcast before it sends.

---

## Feature 2: Pending delivery for active traders

If a user is **currently in an active trade** when a broadcast is sent, defer delivery until their trade session completes.

### Detection

The bot knows when a user is in a trade because `runMartingale()` is running for them. Track active trade sessions:

```typescript
const activeTradeSessions = new Set<number>(); // telegram_ids currently trading
```

Add to the set when `runMartingale()` starts, remove when it ends (win/loss/error).

### Broadcast delivery logic

When sending a broadcast to users:
1. For each target user, check if they're in `activeTradeSessions`
2. If NOT trading → deliver immediately
3. If IS trading → queue the message

### Queue

```typescript
const pendingDeliveries = new Map<number, Array<{
    message: string;
    button?: BroadcastButton;
    media?: { type: 'photo' | 'video'; fileId: string };
    deleteAfterMs: number;
}>>();
```

When a trade session ends (`runMartingale` returns), flush any pending deliveries for that user:

```typescript
// At the end of runMartingale, after cleanup:
const pending = pendingDeliveries.get(ctx.from!.id);
if (pending) {
    pendingDeliveries.delete(ctx.from!.id);
    for (const p of pending) {
        // Send each pending message
        if (p.media?.type === 'photo') {
            await bot.telegram.sendPhoto(ctx.from!.id, p.media.fileId, {
                caption: p.message,
                ...(p.button ? { reply_markup: { inline_keyboard: [[p.button]] } } : {}),
            });
        } else {
            await bot.telegram.sendMessage(ctx.from!.id, p.message, {
                ...(p.button ? { reply_markup: { inline_keyboard: [[p.button]] } } : {}),
            });
        }
    }
}
```

### Expired trigger buttons

Trigger buttons (like "Trade Now") that are callback-based remain functional as long as the message exists. Since the entire message auto-deletes after the timer, the buttons disappear with it. The callback handlers (`ui:trade`, etc.) are always active on the bot side, so if a user taps a button before the message is deleted, it works.

No additional changes needed for this — it works correctly already. If Master wants callback buttons to remain clickable indefinitely even if the auto-delete timer expires, that's already the case since callbacks are handled server-side.

---

## Files

- `src/bot.ts` — scheduling UI, scheduler logic, activeTradeSessions set, pending delivery queue
- `src/ui/admin.ts` — schedule keyboard, scheduled list display
- Optionally: store scheduled broadcasts in DB for persistence across restarts
