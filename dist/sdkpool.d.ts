import { ClientSdk } from './index.js';
export declare function getSdk(ssid: string): Promise<ClientSdk>;
export declare function evictSdk(ssid: string): void;
export declare function runSdkOp<T>(fn: () => Promise<T>): Promise<T>;
