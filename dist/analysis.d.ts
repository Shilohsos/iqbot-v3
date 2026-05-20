import type { ClientSdk } from './index.js';
export interface AnalysisResult {
    direction: 'call' | 'put';
    confidence: number;
    reason: string;
}
export declare function analyzePairWithSdk(sdk: ClientSdk, pair: string, timeframeSec: number, tier?: string): Promise<AnalysisResult>;
export declare function analyzePair(ssid: string, pair: string, timeframeSec: number, tier?: string): Promise<AnalysisResult>;
