# DIRECTIVE: Heap fix — reduce SDK pool MAX_AGE + add pool logging

**IMPORTANT:** Merge master first before implementing.

Two small changes in `src/sdk-pool.ts`:

## 1. Reduce MAX_AGE_MS

Current: `30 * 60 * 1000` (30 min)
Change to: `10 * 60 * 1000` (10 min)

This limits how long a pooled WebSocket connection stays alive before being recreated. Fewer concurrent WS connections means less objects for V8 garbage collection to sweep, reducing the 11-14s GC pause callbacks.

## 2. Add pool size log

After the cleanup sweep at line 89 (`cleanup()` method), add:

```typescript
if (this.entries.size > 0) {
    console.log(`[pool] ${this.entries.size} active entries`);
}
```

This lets us monitor whether the pool is growing over time.

## Verification

- [ ] `MAX_AGE_MS` changed from 30 to 10 min
- [ ] Pool size log added to cleanup()
- [ ] Build passes
- [ ] No functional change — SDK connections are still reused, just cycled faster
