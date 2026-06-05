# Directive: Hourly Auto-Broadcast + Persistent Auto-Delete

## IMPORTANT: Merge master first
Before working on this branch, make sure you're on the latest master:
```
git checkout master && git pull origin master
git checkout -b claude/hourly-broadcast-PERSISTENT-DEL
```

---

## Change 1: Fixed 1-hour interval

**File:** `src/auto-broadcast.ts`

Replace the random interval (2-6h) with fixed 1 hour:

- Remove the `getRandomIntervalMs()` function entirely
- Replace all calls to `getRandomIntervalMs()` with `3_600_000` (1 hour in ms)
- Update the startup log message to say "1h fixed interval"
- Update the console log in `scheduleNext()` to show hours accurately

**Before (lines 10-14):**
```typescript
function getRandomIntervalMs(): number {
    const minHours = 2;
    const maxHours = 6;
    return (minHours + Math.random() * (maxHours - minHours)) * 60 * 60 * 1000;
}
```

**After:** Delete the function entirely.

**Replacement calls to update in the same file:**
- Line 80: `scheduleNext(bot, getRandomIntervalMs());` → `scheduleNext(bot, 3_600_000);`
- Line 96: `scheduleNext(bot, getRandomIntervalMs());` → `scheduleNext(bot, 3_600_000);`
- Line 106: `scheduleNext(bot, getRandomIntervalMs());` → `scheduleNext(bot, 3_600_000);`
- Line 110: `scheduleNext(bot, getRandomIntervalMs());` → `scheduleNext(bot, 3_600_000);`

**Line 112** update:
```typescript
console.log('[auto-broadcast] started (1h fixed interval, image-gated, DB-persisted, persistent auto-delete)');
```

**Line 72** update:
```typescript
console.log(`[auto-broadcast] next broadcast in 1.0h`);
```
(The `delayMs` is always 3600000 now, so just hardcode "1.0h".)

---

## Change 2: Persistent broadcast message IDs for auto-delete

Currently `lastBroadcastMsgIds` is an in-memory `Map<number, number>` (line 16). On bot restart, all stored message IDs are lost — old broadcasts stay.

**Replace with DB persistence.**

### 2a. Add table in `src/db.ts`

Add this table creation alongside the other `CREATE TABLE` statements in `createTables()`:

```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS broadcast_user_messages (
    telegram_id INTEGER PRIMARY KEY,
    message_id  INTEGER NOT NULL,
    sent_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
```

### 2b. Add helper functions in `src/db.ts`

```typescript
export function getLastBroadcastMsgId(telegramId: number): number | null {
    const row = db.prepare(
        'SELECT message_id FROM broadcast_user_messages WHERE telegram_id = ?'
    ).get(telegramId) as { message_id: number } | undefined;
    return row?.message_id ?? null;
}

export function saveLastBroadcastMsgId(telegramId: number, messageId: number): void {
    db.prepare(`
        INSERT INTO broadcast_user_messages (telegram_id, message_id, sent_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
            message_id = excluded.message_id,
            sent_at = excluded.sent_at
    `).run(telegramId, messageId);
}
```

### 2c. Update `src/auto-broadcast.ts`

**Remove line 16:**
```typescript
const lastBroadcastMsgIds = new Map<number, number>();
```

**Update imports** at the top:
```typescript
import {
    getEnabledAutoMessages, getBroadcastTargetIds, markBroadcastSent,
    getTestUserId, getNextBroadcastAt, saveNextBroadcastAt,
    getMessageIndex, saveMessageIndex,
    getLastBroadcastMsgId, saveLastBroadcastMsgId,  // ← add these
} from './db.js';
```

**Replace the delete/send block** (lines 45-56) in `fireBroadcast()`:

```typescript
        try {
            // Delete previous broadcast message from DB (survives restarts)
            const prevMsgId = getLastBroadcastMsgId(tid);
            if (prevMsgId) {
                try { await bot.telegram.deleteMessage(tid, prevMsgId); } catch {}
            }

            const sentMsg = await bot.telegram.sendPhoto(tid, msg.image_file_id!, {
                caption: msg.content,
                reply_markup: { inline_keyboard: [[{ text: 'Trade Now 👇', callback_data: 'ui:trade' }]] },
            });
            saveLastBroadcastMsgId(tid, sentMsg.message_id);
            sent++;
        } catch {
            // user blocked or unavailable
        }
```

---

## Verification

1. Build: `npx tsc --noEmit`
2. Expected: clean compile with no errors
3. Check: `broadcast_user_messages` table should be created automatically on bot restart
4. Check: after first broadcast fires, verify rows appear in `broadcast_user_messages` table
5. Check: on next fire, the old message is deleted before sending the new one
