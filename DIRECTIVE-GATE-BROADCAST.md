# Patch: Gate dispatchBroadcastPayload with test mode

## Problem
The manual admin broadcast ("Send to all users") bypasses test mode. The `dispatchBroadcastPayload` function at `src/bot.ts:345` iterates over all `targetIds` directly without checking `getTestUserId()`.

This means even with Test Mode ON, clicking "Send Now" blasts 82 users.

## Fix
In `src/bot.ts`, at the top of `dispatchBroadcastPayload` (after line 352, before the `for` loop), add:

```ts
const testUserId = getTestUserId();
if (testUserId) {
    console.log(`[test-mode] broadcast gated — sending only to test user ${testUserId}`);
    payload.targetIds = payload.targetIds.filter(id => id === testUserId);
}
```

Also import `getTestUserId` at the top of the file if not already imported (check — it should be from the previous merge).

## Coverage
This gates ALL broadcast paths since both `executeBroadcast` and `executeScheduledBroadcast` call `dispatchBroadcastPayload`.
