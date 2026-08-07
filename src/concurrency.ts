// @ts-nocheck
/**
 * Background SDK governor only.
 * Gale concurrency queue REMOVED per Master — trades must never wait on a global gale cap.
 */
let bgSdk = 0;
const MAX_BG_SDK = Number(process.env.MAX_BG_SDK || 4);

export async function withBackgroundSdk(fn) {
    const deadline = Date.now() + 60_000;
    while (bgSdk >= MAX_BG_SDK) {
        if (Date.now() > deadline) throw new Error('Background SDK slots busy');
        await new Promise(r => setTimeout(r, 200));
    }
    bgSdk++;
    try {
        return await fn();
    } finally {
        bgSdk--;
    }
}

export function bgSdkStats() {
    return { bgSdk, maxBgSdk: MAX_BG_SDK };
}

// No-ops kept so any stale import does not crash
export async function acquireGaleSlot() { return true; }
export function releaseGaleSlot() {}
export function galeStats() { return { activeGales: 0, maxGales: Infinity, waiting: 0 }; }
