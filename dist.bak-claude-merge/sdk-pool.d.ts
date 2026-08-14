import { ClientSdk } from './index.js';
declare class UserSdkPool {
    private entries;
    private pending;
    /** Idle connections closed after this (not mid-trade). */
    private readonly IDLE_TTL_MS;
    /** Force-evict stuck inUse entries (dead WS that never released). */
    private readonly MAX_FORCE_EVICT_MS;
    /** Hard cap — prevents Contabo IP socket storms. */
    private readonly MAX_POOL_SIZE;
    private cleanupTimer;
    constructor();
    get(userId: number, ssid: string): Promise<ClientSdk>;
    private createSdk;
    private createAndPool;
    ensureHealthy(userId: number, ssid: string): Promise<boolean>;
    release(userId: number): void;
    shutdown(userId: number): Promise<void>;
    private cleanup;
    destroy(): void;
}
export declare const sdkPool: UserSdkPool;
export {};
