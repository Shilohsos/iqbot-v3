// @ts-nocheck
/**
 * Scale-safe SDK pool (R1 fix).
 * - NEVER returns an untracked SDK
 * - Evict idle / wait for slot under cap
 * - pin always registers (even if get races)
 * - Auto can hold a long pin for whole session
 */
import { ClientSdk, SsidAuthMethod, WsConnectionStateEnum } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
class UserSdkPool {
    entries = new Map();
    pending = new Map();
    /** Soft target — cleanup prefers staying near this. */
    SOFT_MAX = 28;
    /** Hard ceiling — never exceed with tracked entries. */
    HARD_MAX = 42;
    IDLE_TTL_MS = 3 * 60 * 1000;
    MAX_FORCE_EVICT_MS = 45 * 60 * 1000;
    SLOT_WAIT_MS = 20_000;
    cleanupTimer;
    constructor() {
        this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    }
    async get(userId, ssid) {
        const inFlight = this.pending.get(userId);
        if (inFlight)
            return inFlight;
        const existing = this.entries.get(userId);
        if (existing) {
            const ssidMismatch = existing.ssid !== ssid;
            if (!ssidMismatch && existing.healthy) {
                existing.inUse = true;
                existing.lastUsed = Date.now();
                return existing.sdk;
            }
            if (existing.sessionPins > 0) {
                // Check if the pinned SDK is actually alive
                if (this.isEntryHealthy(existing)) {
                    existing.inUse = true;
                    existing.lastUsed = Date.now();
                    return existing.sdk;
                }
                // Pinned but DEAD — rebuild: save pins, forceClose, create fresh, re-pin
                const savedPins = existing.sessionPins;
                console.warn(`[pool] DEAD-PIN rebuild user ${userId} — pinned SDK dead, rebuilding (pins=${savedPins})`);
                await this.forceClose(userId);
                const promise = this.createAndPool(userId, ssid);
                this.pending.set(userId, promise);
                const freshSdk = await promise;
                // Re-attach pins to the new entry
                const newEntry = this.entries.get(userId);
                if (newEntry) {
                    newEntry.sessionPins = savedPins;
                    newEntry.inUse = true;
                    console.log(`[pool] DEAD-PIN re-pinned user ${userId} pins=${newEntry.sessionPins}`);
                }
                return freshSdk;
            }
            console.warn(`[pool] rebuild user ${userId} (ssidMatch=${!ssidMismatch}, healthy=${existing.healthy})`);
            await this.forceClose(userId);
        }
        // R1: make room — never hand out untracked sockets
        await this.ensureSlot(userId);
        const promise = this.createAndPool(userId, ssid);
        this.pending.set(userId, promise);
        return promise;
    }
    /** Wait/evict until under HARD_MAX. */
    async ensureSlot(forUserId) {
        const deadline = Date.now() + this.SLOT_WAIT_MS;
        while (this.entries.size >= this.HARD_MAX) {
            const evicted = await this.evictOneIdle('hard_cap');
            if (evicted)
                continue;
            if (Date.now() >= deadline) {
                console.error(`[pool] BUSY hard_cap=${this.HARD_MAX} for user ${forUserId} — refusing new SDK`);
                throw new Error('SDK pool busy — too many concurrent connections. Try again in a moment.');
            }
            await new Promise(r => setTimeout(r, 250));
        }
        // Soft pressure: proactively free idle when above SOFT_MAX
        while (this.entries.size >= this.SOFT_MAX) {
            const evicted = await this.evictOneIdle('soft_cap');
            if (!evicted)
                break;
        }
    }
    /** Evict oldest idle unpinned entry. Returns true if something closed. */
    async evictOneIdle(reason = 'idle') {
        let bestId = null;
        let bestLast = Infinity;
        for (const [id, e] of this.entries) {
            if (e.sessionPins > 0)
                continue;
            if (e.inUse)
                continue;
            if (e.lastUsed < bestLast) {
                bestLast = e.lastUsed;
                bestId = id;
            }
        }
        if (bestId == null)
            return false;
        console.warn(`[pool] evict user ${bestId} reason=${reason} idleMs=${Date.now() - bestLast}`);
        await this.forceClose(bestId);
        return true;
    }
    async createSdk(ssid) {
        return Promise.race([
            ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('SDK connection timed out')), 30_000)),
        ]);
    }

    /** Check if a pooled entry's SDK is actually alive. */
    isEntryHealthy(entry) {
        if (!entry) return false;
        if (!entry.sdk) return false;
        if (!entry.healthy) return false;
        // Last activity < 5 min ago
        if (Date.now() - entry.lastUsed > 5 * 60 * 1000) return false;
        // Check WebSocket readyState if available
        try {
            const ws = entry.sdk?.ws?.socket?.readyState;
            if (ws !== undefined && ws !== 1) return false; // 1 = OPEN
        } catch { /* can't check — trust healthy flag */ }
        return true;
    }

    async createAndPool(userId, ssid) {
        try {
            // Re-check slot (race with parallel gets)
            await this.ensureSlot(userId);
            const sdk = await this.createSdk(ssid);
            const entry = {
                sdk,
                ssid,
                inUse: true,
                sessionPins: 0,
                lastUsed: Date.now(),
                createdAt: Date.now(),
                healthy: true,
            };
            this.entries.set(userId, entry);
            try {
                const connState = await sdk.wsConnectionState();
                const onStateChanged = (state) => {
                    entry.healthy = state === WsConnectionStateEnum.Connected;
                    if (!entry.healthy) {
                        console.warn(`[pool] user ${userId} WebSocket ${state} — marked unhealthy`);
                    }
                };
                connState.subscribeOnStateChanged(onStateChanged);
                entry.connState = connState;
                entry.onStateChanged = onStateChanged;
            }
            catch (e) {
                console.warn(`[pool] could not subscribe to ws state for user ${userId}:`, e instanceof Error ? e.message : e);
            }
            console.log(`[pool] opened user ${userId} size=${this.entries.size}/${this.HARD_MAX}`);
            return sdk;
        }
        finally {
            this.pending.delete(userId);
        }
    }
    /**
     * R2: Register an already-created SDK into the pool (or replace unpinned).
     * Used when auto must rebuild — prefer get() instead when possible.
     */
    async adopt(userId, ssid, sdk) {
        const existing = this.entries.get(userId);
        if (existing?.sessionPins > 0 && existing.sdk !== sdk) {
            console.warn(`[pool] adopt refused — user ${userId} pinned to other sdk`);
            return existing.sdk;
        }
        if (existing && existing.sdk !== sdk) {
            await this.forceClose(userId);
        }
        if (!this.entries.has(userId) && this.entries.size >= this.HARD_MAX) {
            await this.ensureSlot(userId);
        }
        const entry = {
            sdk,
            ssid,
            inUse: true,
            sessionPins: existing?.sessionPins ?? 0,
            lastUsed: Date.now(),
            createdAt: Date.now(),
            healthy: true,
        };
        this.entries.set(userId, entry);
        return sdk;
    }
    /** Hold socket for gale or entire auto session. */
    pin(userId) {
        const entry = this.entries.get(userId);
        if (entry) {
            entry.sessionPins++;
            entry.inUse = true;
            entry.lastUsed = Date.now();
            console.log(`[pool] pin user ${userId} pins=${entry.sessionPins}`);
            return true;
        }
        // R1/R2: pin without entry — record ghost pin so safeExit still waits;
        // next get() will attach. Use negative marker via side map.
        const g = this._ghostPins.get(userId) || 0;
        this._ghostPins.set(userId, g + 1);
        console.warn(`[pool] pin user ${userId} GHOST pins=${g + 1} (no entry yet)`);
        return false;
    }
    unpin(userId) {
        const entry = this.entries.get(userId);
        if (entry) {
            entry.sessionPins = Math.max(0, entry.sessionPins - 1);
            entry.lastUsed = Date.now();
            console.log(`[pool] unpin user ${userId} pins=${entry.sessionPins}`);
            return;
        }
        const g = this._ghostPins.get(userId) || 0;
        if (g <= 1)
            this._ghostPins.delete(userId);
        else
            this._ghostPins.set(userId, g - 1);
    }
    _ghostPins = new Map();
    async ensureHealthy(userId, ssid) {
        const entry = this.entries.get(userId);
        if (!entry)
            return true;
        if (entry.sessionPins > 0) {
            // Pinned — but check if dead
            if (!this.isEntryHealthy(entry)) {
                const savedPins = entry.sessionPins;
                console.warn(`[pool] DEAD-PIN ensureHealthy rebuild user ${userId} (pins=${savedPins})`);
                await this.forceClose(userId);
                await this.get(userId, ssid);
                const newEntry = this.entries.get(userId);
                if (newEntry) newEntry.sessionPins = savedPins;
            }
            return true;
        }
        if (entry.healthy && entry.ssid === ssid)
            return true;
        console.warn(`[pool] pre-trade rebuild for user ${userId}`);
        await this.forceClose(userId);
        try {
            await this.get(userId, ssid);
            return true;
        }
        catch (e) {
            console.error(`[pool] pre-trade rebuild FAILED for user ${userId}:`, e instanceof Error ? e.message : e);
            return false;
        }
    }
    stats() {
        let pinned = 0, inUse = 0;
        for (const e of this.entries.values()) {
            if (e.sessionPins > 0)
                pinned++;
            if (e.inUse)
                inUse++;
        }
        for (const g of this._ghostPins.values()) {
            if (g > 0)
                pinned++;
        }
        return {
            poolSize: this.entries.size,
            pinned,
            inUse,
            softMax: this.SOFT_MAX,
            hardMax: this.HARD_MAX,
            ghosts: this._ghostPins.size,
        };
    }
    pinnedCount() {
        let n = 0;
        for (const e of this.entries.values())
            if (e.sessionPins > 0)
                n += e.sessionPins;
        for (const g of this._ghostPins.values())
            n += g;
        return n;
    }
    release(userId) {
        const entry = this.entries.get(userId);
        if (entry) {
            entry.inUse = entry.sessionPins > 0;
            entry.lastUsed = Date.now();
        }
    }
    /** Public shutdown respects pins. */
    async shutdown(userId) {
        const entry = this.entries.get(userId);
        if (entry?.sessionPins) {
            console.warn(`[pool] REFUSE shutdown user ${userId} — still pinned (${entry.sessionPins})`);
            return;
        }
        await this.forceClose(userId);
    }
    /** Internal close ignoring pins (only for destroy / replace). */
    async forceClose(userId) {
        const entry = this.entries.get(userId);
        if (!entry) {
            this.pending.delete(userId);
            return;
        }
        this.entries.delete(userId);
        if (entry.connState && entry.onStateChanged) {
            try {
                entry.connState.unsubscribeOnStateChanged(entry.onStateChanged);
            }
            catch { /* */ }
        }
        try {
            const sdk = entry.sdk;
            if (sdk.blitzOptionsFacade)
                sdk.blitzOptionsFacade.close();
            if (sdk.turboOptionsFacade)
                sdk.turboOptionsFacade.close();
            if (sdk.binaryOptionsFacade)
                sdk.binaryOptionsFacade.close();
            if (sdk.digitalOptionsFacade)
                sdk.digitalOptionsFacade.close();
            if (sdk.positionsFacade)
                sdk.positionsFacade.close();
            if (sdk.translationsFacade)
                sdk.translationsFacade.close();
            if (sdk.chatsFacade)
                sdk.chatsFacade.close();
        }
        catch { /* */ }
        try {
            await Promise.race([
                entry.sdk.shutdown().catch(() => { }),
                new Promise(resolve => setTimeout(resolve, 5_000)),
            ]);
        }
        catch { /* */ }
        this.pending.delete(userId);
    }
    cleanup() {
        const now = Date.now();
        for (const [userId, entry] of this.entries.entries()) {
            if (entry.sessionPins > 0)
                continue;
            const idle = !entry.inUse && now - entry.lastUsed > this.IDLE_TTL_MS;
            const idleUnhealthy = !entry.inUse && !entry.healthy;
            const stuckDead = entry.inUse && !entry.healthy && (now - entry.createdAt > 10 * 60 * 1000);
            const stuckAncient = entry.inUse && (now - entry.createdAt > 90 * 60 * 1000);
            const zombieIdle = !entry.inUse && (now - entry.createdAt > this.MAX_FORCE_EVICT_MS);
            // Soft pressure: idle even if slightly younger when over SOFT_MAX
            const softPressure = this.entries.size > this.SOFT_MAX && !entry.inUse && (now - entry.lastUsed > 60_000);
            if (idle || idleUnhealthy || stuckDead || stuckAncient || zombieIdle || softPressure) {
                if (stuckDead || stuckAncient || zombieIdle) {
                    console.warn(`[pool] force-evicting user ${userId} (age: ${Math.round((now - entry.createdAt) / 1000)}s, inUse: ${entry.inUse}, healthy: ${entry.healthy})`);
                }
                this.forceClose(userId).catch(() => { });
            }
        }
        if (this.entries.size > 0) {
            console.log(`[pool] ${this.entries.size} active entries (soft=${this.SOFT_MAX} hard=${this.HARD_MAX} pinnedUsers=${this.stats().pinned})`);
        }
    }
    destroy() {
        clearInterval(this.cleanupTimer);
        for (const [userId] of this.entries) {
            const e = this.entries.get(userId);
            if (e)
                e.sessionPins = 0;
            this.forceClose(userId).catch(() => { });
        }
        this._ghostPins.clear();
    }
}
export const sdkPool = new UserSdkPool();
