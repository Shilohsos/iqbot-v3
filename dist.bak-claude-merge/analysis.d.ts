import type { ClientSdk } from './index.js';
export interface AnalysisResult {
    direction: 'call' | 'put';
    confidence: number;
    reason: string;
    entryPrice?: number;
}
export declare function analyzePairWithSdk(sdk: ClientSdk, pair: string, timeframeSec: number, tier?: string, candleCount?: number): Promise<AnalysisResult>;
export declare function analyzePair(ssid: string, pair: string, timeframeSec: number, tier?: string, candleCount?: number): Promise<AnalysisResult>;
