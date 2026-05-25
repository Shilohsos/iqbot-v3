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
    private readonly IDLE_TTL_MS = 5 * 60 * 1000;
    private readonly MAX_AGE_MS = 30 * 60 * 1000;
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
            if (!stale) {
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
                this.entries.set(userId, {
                    sdk,
                    ssid,
                    inUse: true,
                    lastUsed: Date.now(),
                    createdAt: Date.now(),
                });
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
            try { await entry.sdk.shutdown(); } catch {}
            this.entries.delete(userId);
        }
        this.pending.delete(userId);
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [userId, entry] of this.entries.entries()) {
            if (!entry.inUse && now - entry.lastUsed > this.IDLE_TTL_MS) {
                this.shutdown(userId).catch(() => {});
            }
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
