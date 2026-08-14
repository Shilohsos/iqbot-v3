export interface AdminCandle {
    close: number;
    max: number;
    min: number;
    open?: number;
    volume?: number;
    from?: number;
    to?: number;
}
export interface AdminAnalysisResult {
    direction: 'call' | 'put';
    confidence: number;
    reason: string;
}
export declare function runAdminAnalysis(candles: AdminCandle[]): AdminAnalysisResult;
