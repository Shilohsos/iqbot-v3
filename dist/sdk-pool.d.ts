import { ClientSdk } from './index.js';
declare class UserSdkPool {
    private entries;
    private pending;
    private readonly IDLE_TTL_MS;
    private readonly MAX_AGE_MS;
    private cleanupTimer;
    constructor();
    get(userId: number, ssid: string): Promise<ClientSdk>;
    release(userId: number): void;
    shutdown(userId: number): Promise<void>;
    private cleanup;
    destroy(): void;
}
export declare const sdkPool: UserSdkPool;
export {};
