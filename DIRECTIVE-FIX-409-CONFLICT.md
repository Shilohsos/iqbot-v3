# Fix 409 Conflict — duplicate polling connection

## IMPORTANT: Merge master first

```bash
git checkout master && git pull origin master && git checkout -b claude/fix-409-conflict
```

## Problem

When PM2 restarts the bot, the old process's `getUpdates` long-polling connection is still alive. The new process starts polling immediately, causing Telegram to reject it with `409: Conflict: terminated by other getUpdates request`. This kills the polling loop entirely — the bot stops receiving updates until manually restarted.

Impact: users who send messages during this window get **zero response** because the bot never receives their updates.

## Fix

Two changes:

### 1. Add startup delay (avoid race with old polling connection)

**File:** `src/bot.ts` — around line 4948

Replace:
```typescript
bot.launch();
```
With:
```typescript
// Wait 3s before launching to let any lingering polling connection from a
// previous instance timeout and release its Telegram lock.
await new Promise(r => setTimeout(r, 3_000));
bot.launch();
```

The `await` is safe here because this is at the top level of the module. Node.js handles top-level awaits in ESM modules, and the bot is an ESM module (it uses `import`/`export`).

### 2. Wrap polling error handler to retry on 409

**File:** `src/bot.ts` — around line 168

The existing unhandledRejection handler logs the error but does nothing. When the polling loop crashes with 409, the bot goes deaf. Add a retry mechanism.

After the existing `process.on('unhandledRejection', ...)` at line 168, add:

```typescript
// Auto-retry polling when Telegram rejects with 409 (duplicate instance).
// The old connection should release within 1-3 seconds.
async function ensurePolling() {
    const retryDelay = 5_000;
    while (true) {
        try {
            await bot.launch();
            break; // success
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('409') || msg.includes('Conflict')) {
                console.warn(`[polling] 409 Conflict — retrying in ${retryDelay}ms`);
                await new Promise(r => setTimeout(r, retryDelay));
                continue;
            }
            throw err; // non-409 error, let it crash
        }
    }
}
```

Then replace the `bot.launch()` call with `ensurePolling()`.

**Final code (around line 4948):**
```typescript
// Wait 3s before launching to allow any lingering polling connection from a
// previous instance to release its lock.
await new Promise(r => setTimeout(r, 3_000));

// Launch polling with auto-retry on 409 Conflict
async function ensurePolling() {
    const retryDelay = 5_000;
    while (true) {
        try {
            await bot.launch();
            break;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('409') || msg.includes('Conflict')) {
                console.warn(`[polling] 409 Conflict — retrying in ${retryDelay}ms`);
                await new Promise(r => setTimeout(r, retryDelay));
                continue;
            }
            throw err;
        }
    }
}
ensurePolling().catch(err => {
    console.error('[polling] Fatal error:', err);
    process.exit(1);
});
```

## Verification

After deploying:
1. Force a restart: `pm2 restart iqbot-v3-bot`
2. Check logs: `pm2 logs iqbot-v3-bot --lines 20 --nostream | grep "\[polling\]"`
3. If 409 occurs, you'll see: `[polling] 409 Conflict — retrying in 5000ms`
4. Bot should connect on retry and continue normally
