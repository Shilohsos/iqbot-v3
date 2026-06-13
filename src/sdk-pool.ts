import { ClientSdk, SsidAuthMethod, WsConnectionStateEnum, type WsConnectionState } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';

interface PoolEntry {
    sdk: ClientSdk;
    ssid: string;
    inUse: boolean;
    lastUsed: number;
    createdAt: number;
    healthy: boolean;
    connState?: WsConnectionState;
    onStateChanged?: (state: WsConnectionStateEnum) => void;
}

class UserSdkPool {
    private entries = new Map<number, PoolEntry>();
    private pending = new Map<number, Promise<ClientSdk>>();
    private readonly IDLE_TTL_MS = 5 * 60 * 1000;
    private readonly MAX_AGE_MS = 5 * 60 * 1000;
    private cleanupTimer: ReturnType<typeof setInterval>;

    constructor() {
        this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }

    async get(userId: number, ssid: string): Promise<ClientSdk> {
        // Fast-path: in-flight create for this user — reuse the promise so
        // concurrent callers cannot spawn duplicate SDKs.
        const inFlight = this.pending.get(userId);
        if (inFlight) return inFlight;

        const existing = this.entries.get(userId);
        if (existing) {
            const stale = existing.ssid !== ssid || Date.now() - existing.createdAt > this.MAX_AGE_MS;
            // A cached SDK whose WebSocket has dropped must never be handed out —
            // the SDK would throw "WebSocket is closing/not open" at the user.
            if (!stale && existing.healthy) {
                existing.inUse = true;
                existing.lastUsed = Date.now();
                return existing.sdk;
            }
            await this.shutdown(userId);
        }

        // Set the pending entry synchronously BEFORE awaiting anything so a
        // second concurrent caller in the same tick sees it.
        const promise = (async () => {
            try {
                const sdk = await Promise.race([
                    ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST }),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('SDK connection timed out')), 180_000)
                    ),
                ]);
                const entry: PoolEntry = {
                    sdk,
                    ssid,
                    inUse: true,
                    lastUsed: Date.now(),
                    createdAt: Date.now(),
                    healthy: true,
                };
                this.entries.set(userId, entry);
                // Track WebSocket health event-driven so get() never returns a dead
                // connection. Failure to subscribe leaves healthy=true (fail-open).
                try {
                    const connState = await sdk.wsConnectionState();
                    const onStateChanged = (state: WsConnectionStateEnum) => {
                        entry.healthy = state === WsConnectionStateEnum.Connected;
                        if (!entry.healthy) {
                            console.warn(`[pool] user ${userId} WebSocket ${state} — entry marked unhealthy`);
                        }
                    };
                    connState.subscribeOnStateChanged(onStateChanged);
                    entry.connState = connState;
                    entry.onStateChanged = onStateChanged;
                } catch (e) {
                    console.warn(`[pool] could not subscribe to ws state for user ${userId}:`, e instanceof Error ? e.message : e);
                }
                return sdk;
            } finally {
                this.pending.delete(userId);
            }
        })();
        this.pending.set(userId, promise);
        return promise;
    }

    release(userId: number): void {
        const entry = this.entries.get(userId);
        if (entry) {
            entry.inUse = false;
            entry.lastUsed = Date.now();
        }
    }

    async shutdown(userId: number): Promise<void> {
        const entry = this.entries.get(userId);
        if (entry) {
            if (entry.connState && entry.onStateChanged) {
                try { entry.connState.unsubscribeOnStateChanged(entry.onStateChanged); } catch {}
            }
            try { await entry.sdk.shutdown(); } catch {}
            this.entries.delete(userId);
        }
        this.pending.delete(userId);
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [userId, entry] of this.entries.entries()) {
            const idle = !entry.inUse && now - entry.lastUsed > this.IDLE_TTL_MS;
            // Evict idle entries and any unhealthy entry not currently in use.
            if (idle || (!entry.inUse && !entry.healthy)) {
                this.shutdown(userId).catch(() => {});
            }
        }
        if (this.entries.size > 0) {
            console.log(`[pool] ${this.entries.size} active entries`);
        }
    }

    destroy(): void {
        clearInterval(this.cleanupTimer);
        for (const [userId] of this.entries) {
            this.shutdown(userId).catch(() => {});
        }
    }
}

export const sdkPool = new UserSdkPool();
