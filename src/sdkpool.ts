import { ClientSdk, SsidAuthMethod } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';

const SDK_POOL_TTL = 5 * 60 * 1000;

const pool = new Map<string, { sdk: ClientSdk; lastUsed: number }>();

export async function getSdk(ssid: string): Promise<ClientSdk> {
    const entry = pool.get(ssid);
    if (entry && Date.now() - entry.lastUsed < SDK_POOL_TTL) {
        entry.lastUsed = Date.now();
        return entry.sdk;
    }
    if (entry) {
        entry.sdk.shutdown().catch(() => {});
        pool.delete(ssid);
    }
    const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
    pool.set(ssid, { sdk, lastUsed: Date.now() });
    return sdk;
}

export function evictSdk(ssid: string): void {
    const entry = pool.get(ssid);
    if (entry) {
        entry.sdk.shutdown().catch(() => {});
        pool.delete(ssid);
    }
}

// Evict stale pool entries every minute
setInterval(() => {
    const now = Date.now();
    for (const [ssid, entry] of pool) {
        if (now - entry.lastUsed > SDK_POOL_TTL) {
            entry.sdk.shutdown().catch(() => {});
            pool.delete(ssid);
        }
    }
}, 60_000);

// Concurrency limiter — max 5 simultaneous SDK operations
const MAX_CONCURRENT = 5;
let active = 0;
const queue: Array<() => void> = [];

export async function runSdkOp<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= MAX_CONCURRENT) {
        await new Promise<void>(resolve => queue.push(resolve));
    }
    active++;
    try { return await fn(); }
    finally {
        active--;
        queue.shift()?.();
    }
}
