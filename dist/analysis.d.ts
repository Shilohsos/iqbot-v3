export interface AnalysisResult {
    direction: 'call' | 'put';
    confidence: number;
    reason: string;
}
export declare function analyzePair(ssid: string, pair: string, timeframeSec: number): Promise<AnalysisResult>;
