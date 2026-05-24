# Review Request: Auto-broadcast persistence across restarts

The auto-broadcast system uses `setTimeout` with a 2-6h random interval. Every bot restart resets the timer, so broadcasts never fire after a restart cycle.

## Problem
- `startAutoBroadcast()` calls `scheduleNext()` which sets `setTimeout` for 2-6h
- Bot restarts (during normal deploy/maintenance) kill the timer
- Result: broadcasts haven't fired in ~7h despite being due

## Proposed Design
Save the next-broadcast timestamp in the DB so it persists across restarts.

### DB changes
Add a simple key-value table or a column in `broadcast_messages`:
```sql
CREATE TABLE IF NOT EXISTS broadcast_schedule (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    next_send_at TEXT NOT NULL
);
```
Singleton row (id=1) stores the next scheduled time.

### Logic changes in `auto-broadcast.ts`

**On broadcast send** (after sending):
```ts
const nextDelay = getRandomIntervalMs();
const nextAt = new Date(Date.now() + nextDelay);
saveNextBroadcastAt(nextAt.toISOString());
```

**On startup** (`startAutoBroadcast()`):
```ts
const scheduled = getNextBroadcastAt(); // reads from DB
if (scheduled) {
    const msUntil = new Date(scheduled).getTime() - Date.now();
    if (msUntil > 0) {
        setTimeout(() => fireBroadcast(), msUntil);
    } else {
        // Past due — fire after a short grace period
        setTimeout(() => fireBroadcast(), 30_000);
    }
} else {
    // First ever — schedule normally
    setTimeout(() => fireBroadcast(), getRandomIntervalMs());
}
```

**`fireBroadcast()`** does the current broadcast logic + saves next time + calls `scheduleNext()`.

### Benefits
- Survives restarts, PM2 reloads, crashes
- No external deps (no cron, no filesystem)
- Simple, single-row table — no migration complexity

## Verification
1. Start bot → schedule saved in DB
2. Kill bot → restart → reads next time from DB, schedules correctly
3. If past due → fires within 30s grace period
4. Normal 2-6h randomness preserved
