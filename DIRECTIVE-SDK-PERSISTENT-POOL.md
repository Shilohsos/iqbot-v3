# DIRECTIVE: Persistent SDK Connection Pool Per User

## Problem

Every trade creates a fresh Quadcode SDK WebSocket connection taking **64–194 seconds**. The SDK is destroyed after each trade (`sdk.shutdown()` in finally). At 500 users, this creates 2,500 connections/day = 44.4 hours of blocking in 24 hours.

## Solution

Maintain one SDK connection per user, kept alive across their entire session. When they trade again, the connection is already hot — no 64–194s wait.

## Architecture

```
UserSdkPool (new file: src/sdk-pool.ts)
├── Map<userId, { sdk, ssid, inUse, lastUsed, createdAt }>
├── get(userId, ssid): Promise<ClientSdk>
│   ├── Existing hot connection? → return immediately (0ms)
│   ├── Existing connection but stale (30min)? → disconnect, create new
│   ├── No connection? → create new, cache it, return
│   └── Connection already in progress? → wait for same promise (no duplicate connects)
├── release(userId): void
│   └── Mark as not in use, update lastUsed
├── shutdown(userId): Promise<void>
│   └── Disconnect and remove from pool
└── cleanup(): void (every 5 min via setInterval)
    └── Evict idle connections (>5 min since lastUsed), disconnect gracefully
```

## Changes Required

### 1. New file: `src/sdk-pool.ts`

```typescript
import { ClientSdk, SsidAuthMethod } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';

interface PoolEntry {
    sdk: ClientSdk;
    ssid: string;
    inUse: boolean;
    lastUsed: number;
    createdAt: number;
}

class UserSdkPool {
    private entries = new Map<number, PoolEntry>();
    private pending = new Map<number, Promise<ClientSdk>>();
    private readonly IDLE_TTL_MS = 5 * 60 * 1000;    // 5 min idle → evict
    private readonly MAX_AGE_MS = 30 * 60 * 1000;      // 30 min total → reconnect
    private cleanupTimer: ReturnType<typeof setInterval>;

    constructor() {
        // Evict idle entries every 5 minutes
        this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }

    /**
     * Get a connected SDK for this user. Returns an existing hot connection
     * or creates a new one. If a connection is already being established,
     * wait for that same promise (prevent duplicate connects).
     */
    async get(userId: number, ssid: string): Promise<ClientSdk> {
        const existing = this.entries.get(userId);

        // Existing entry: check if it's still valid
        if (existing) {
            // Different SSID? Shut down old, create new
            if (existing.ssid !== ssid) {
                await this.shutdown(userId);
            // Too old? Reconnect
            } else if (Date.now() - existing.createdAt > this.MAX_AGE_MS) {
                await this.shutdown(userId);
            // Hot and ready? Return immediately
            } else {
                existing.inUse = true;
                existing.lastUsed = Date.now();
                return existing.sdk;
            }
        }

        // Already connecting? Wait for that promise
        if (this.pending.has(userId)) {
            return this.pending.get(userId)!;
        }

        // Create new connection
        const promise = (async () => {
            const sdk = await ClientSdk.create(
                WS_URL, PLATFORM_ID,
                new SsidAuthMethod(ssid),
                { host: IQ_HOST }
            );
            this.entries.set(userId, {
                sdk,
                ssid,
                inUse: true,
                lastUsed: Date.now(),
                createdAt: Date.now(),
            });
            this.pending.delete(userId);
            return sdk;
        })();

        this.pending.set(userId, promise);
        return promise;
    }

    /** Mark this user's SDK as available for the next request */
    release(userId: number): void {
        const entry = this.entries.get(userId);
        if (entry) {
            entry.inUse = false;
            entry.lastUsed = Date.now();
        }
    }

    /** Disconnect and remove a user's SDK entirely */
    async shutdown(userId: number): Promise<void> {
        const entry = this.entries.get(userId);
        if (entry) {
            try { await entry.sdk.shutdown(); } catch {}
            this.entries.delete(userId);
        }
        this.pending.delete(userId);
    }

    /** Evict idle entries. Called by the cleanup timer. */
    private cleanup(): void {
        const now = Date.now();
        for (const [userId, entry] of this.entries.entries()) {
            if (!entry.inUse && now - entry.lastUsed > this.IDLE_TTL_MS) {
                this.shutdown(userId).catch(() => {});
            }
        }
    }

    /** Stop the cleanup timer (call on process shutdown) */
    destroy(): void {
        clearInterval(this.cleanupTimer);
        for (const [userId] of this.entries) {
            this.shutdown(userId).catch(() => {});
        }
    }
}

export const sdkPool = new UserSdkPool();
```

### 2. Modify `src/bot.ts` — import the pool

Add to imports (near line 5):
```typescript
import { sdkPool } from './sdk-pool.js';
```

### 3. Modify `src/bot.ts` — pair handler (~lines 861–980)

**Remove the SDK creation** (lines 891–920, the `createSdk` Promise.race + keepalive + error handling) and **remove the SDK shutdown** (lines 978–980, the `finally` block).

Replace with:

```typescript
bot.action(/^pair:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    await ctx.answerCbQuery();

    const pair = ctx.match[1];
    const { amount, timeframe, mode, lastImageMsgId: prevImgId } = state;
    wizardSessions.delete(chatId);

    if (!amount || !timeframe) { await ctx.reply('❌ Session error — start over.'); return; }

    const ssid = getSsidForUser(ctx.from!.id);
    if (!ssid) { await ctx.reply('❌ Not connected. Use /connect to link your IQ Option account.'); return; }

    // Clean up wizard messages
    try { await ctx.deleteMessage(); } catch {}
    if (prevImgId) { try { await ctx.telegram.deleteMessage(chatId, prevImgId); } catch {} }

    const preTradeMessageIds: number[] = [];

    // Send progress — SDK might already be hot (0s wait)
    let l7MsgId: number | undefined;
    try { const m = await ctx.replyWithPhoto(ASSET('L7.png')); l7MsgId = m.message_id; } catch {}
    const progressMsg = await ctx.reply(
        `Selected: ${pair}\n\n🔌 Connecting to IQ Option...\n⏱ Usually instant if you traded recently`
    );
    preTradeMessageIds.push(progressMsg.message_id);

    // Get SDK from pool — returns instantly if already connected
    let sdk: ClientSdk;
    try {
        sdk = await sdkPool.get(ctx.from!.id, ssid);
        await ctx.telegram.editMessageText(
            chatId, progressMsg.message_id, undefined,
            `✅ Connected! Analyzing market data for ${pair}...`
        ).catch(() => {});
    } catch (err: unknown) {
        if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
        await ctx.telegram.editMessageText(
            chatId, progressMsg.message_id, undefined,
            `❌ Could not connect to IQ Option.\n\nTry again in a moment.`
        ).catch(() => ctx.reply('❌ Could not connect to IQ Option. Try again.'));
        return;
    }

    try {
        const analysisUser = getUser(ctx.from!.id);
        const analysisTier = (analysisUser?.tier ?? 'NEWBIE').toUpperCase();
        let analysis: AnalysisResult;
        try {
            analysis = await analyzePairWithSdk(sdk, pair, timeframe, analysisTier);
        } catch (err: unknown) {
            if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
            await ctx.telegram.editMessageText(
                chatId, progressMsg.message_id, undefined,
                `❌ Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`
            ).catch(() => ctx.reply(`❌ Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
            sdkPool.release(ctx.from!.id);
            return;
        }

        if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
        await ctx.telegram.editMessageText(
            chatId, progressMsg.message_id, undefined,
            `✅ Market scanned — signal found`
        ).catch(() => {});

        // ... [KEEP existing L8, L9, opportunity display code — unchanged from current] ...

        const mgSettings = userMartingaleSettings.get(ctx.from!.id);
        const martingaleRounds = mgSettings ? (mgSettings.enabled ? mgSettings.maxRounds : 1) : undefined;
        try {
            await runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe,
                mode === 'live' ? 'live' : 'demo', martingaleRounds, preTradeMessageIds, sdk);
        } catch (err: unknown) {
            console.error('[pair] runMartingale threw:', err);
            await ctx.reply('⚠️ Trade session ended unexpectedly. Please try again.').catch(() => {});
        }
    } finally {
        // Release SDK back to pool — DON'T shut it down!
        sdkPool.release(ctx.from!.id);
    }
});
```

**Key changes from current code:**
1. `sdkPool.get()` replaces the 180s `Promise.race(createSdk(ssid), ...)` — no more slow connects
2. `sdkPool.release()` replaces `sdk.shutdown()` — SDK stays alive for next trade
3. No more 30s keepalive interval (not needed — connection is hot)
4. Error paths call `sdkPool.release()` before returning (so the SDK isn't left "in use")
5. Keep the opportunity display code (L8, L9, opportunity message) UNCHANGED

### 4. Modify `src/bot.ts` — `sendStartMenu` balance fetch (~line 442)

Use the pool instead of creating a new SDK:

```typescript
// Before (current):
sdk = await withTimeout(createSdk(ssid!), 30_000, 'balance');
// After:
sdk = await sdkPool.get(telegramId, ssid!);
// (and replace sdk?.shutdown() with sdkPool.release(telegramId))
```

### 5. Modify `src/bot.ts` — `/balance` command (~line 1189)

Same change as sendStartMenu — use pool, don't shut down.

### 6. Modify `src/bot.ts` — `/pairs` command (~line 1816)

Same change — use pool.

## IMPORTANT: What NOT to change

- `runMartingale` — already accepts `existingSdk` parameter. Works as-is.
- `analyzePairWithSdk` — already works with a pre-connected SDK. No changes needed.
- `executeTradeWithSdk` — already works with a pre-connected SDK. No changes needed.
- The `existingSdk` parameter on `runMartingale` — KEEP as is.
- All wizard handlers (mode, amount, timeframe, page) — no changes needed.

## Why this won't fail like the old pool

| Old Pool (FAILED) | New Pool |
|-------------------|----------|
| One SDK shared across MULTIPLE user SSIDs | One SDK per unique SSID |
| "authentication is failed" — SDK rejected re-auth | Authentication happens once per SDK creation |
| Pool was persistent across bot restart (Redis) | In-memory pool — clean on restart |
| Concurrent trade conflict | Sequential — `inUse` flag prevents overlap |

## Migration: How existing user flow changes

**Before (per trade):**
1. User picks pair → SDK connect (64–194s) → analyze → trade → shutdown
2. Next trade → SDK connect (64–194s) again → ...

**After (per session):**
1. User picks pair → pool.get() (0s if hot) → analyze → trade → release (SDK stays alive)
2. Next trade → pool.get() (0s — instant) → analyze → trade → release
3. 5 min idle → auto-evicted

## Acceptance Criteria

- [ ] `src/sdk-pool.ts` created with full pool implementation
- [ ] Pair handler uses `sdkPool.get()` instead of `createSdk()` Promise.race
- [ ] Pair handler uses `sdkPool.release()` instead of `sdk.shutdown()`
- [ ] `sendStartMenu` balance fetch uses pool instead of 30s-timeout SDK
- [ ] `/balance` and `/pairs` commands use pool
- [ ] No `Promise.race` with 180_000 timeout for SDK creation remains
- [ ] `runMartingale` still receives SDK via `existingSdk` parameter
- [ ] `npx tsc` passes clean
- [ ] PM2 restart → bot starts clean on `master`
- [ ] Test: first trade of a session still works (new SDK connect)
- [ ] Test: second trade within 5 min is instant (reuses hot SDK)
- [ ] Test: trade completes, user goes back to menu, starts new trade → instant
