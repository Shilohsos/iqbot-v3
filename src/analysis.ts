import { createSdk } from './trade.js';
import type { ClientSdk } from './index.js';

export interface AnalysisResult {
    direction: 'call' | 'put';
    confidence: number;
    reason: string;
}

export async function analyzePairWithSdk(sdk: ClientSdk, pair: string, timeframeSec: number, tier = 'DEMO'): Promise<AnalysisResult> {
    return runAnalysis(sdk, pair, timeframeSec, tier);
}

export async function analyzePair(ssid: string, pair: string, timeframeSec: number, tier = 'DEMO'): Promise<AnalysisResult> {
    const sdk = await Promise.race([
        createSdk(ssid),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Analysis SDK connection timed out')), 180_000)
        ),
    ]);
    try {
        return await runAnalysis(sdk, pair, timeframeSec, tier);
    } finally {
        await sdk.shutdown();
    }
}

async function runAnalysis(sdk: ClientSdk, pair: string, timeframeSec: number, tier: string): Promise<AnalysisResult> {
    const blitzOptions = await sdk.blitzOptions();
    const normTicker = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
    const normalizedInput = normTicker(pair);
    const active = blitzOptions.getActives().find(a =>
        normTicker(a.ticker) === normalizedInput ||
        normTicker(a.localizationKey) === normalizedInput
    );
    if (!active) throw new Error(`Unknown pair: ${pair}`);

    const candlesFacade = await sdk.candles();
    const history = await candlesFacade.getCandles(active.id, timeframeSec, { count: 35 });

    if (history.length < 30) throw new Error('Not enough data for analysis');

    const closes = history.map(c => c.close);
    const rsi  = computeRSI(closes, 14);
    const ema9  = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);

    const upperTier = tier.toUpperCase();
    if (upperTier === 'PRO' || upperTier === 'MASTER') {
        const { macd, signal: macdSignal } = computeMACD(closes, 12, 26, 9);
        const { mid, upper } = computeBollinger(closes, 20, 2);
        const lastClose = closes[closes.length - 1];

        const rsiBull  = rsi > 50;
        const emaBull  = ema9 > ema21;
        const macdBull = macd > macdSignal;
        const bollBull = lastClose > mid && lastClose < upper;

        const votes      = [rsiBull, emaBull, macdBull, bollBull].filter(Boolean).length;
        const confidence = votes / 4 * 100;
        const direction: 'call' | 'put' = confidence >= 75 ? 'call' : 'put';
        const signals = [
            `RSI ${rsi.toFixed(1)} ${rsiBull ? '▲' : '▼'}`,
            `EMA ${emaBull ? '▲' : '▼'}`,
            `MACD ${macdBull ? '▲' : '▼'}`,
            `BB ${bollBull ? '▲' : '▼'}`,
        ].join(' | ');
        return { direction, confidence, reason: `${direction === 'call' ? 'BULLISH' : 'BEARISH'} (${votes}/4) | ${signals}` };
    }

    const bullishScore = (rsi > 50 ? 50 : 0) + (ema9 > ema21 ? 50 : 0);
    const direction: 'call' | 'put' = bullishScore >= 50 ? 'call' : 'put';
    const reason = `${bullishScore >= 50 ? 'BULLISH' : 'BEARISH'} (+${bullishScore}%) | RSI ${rsi.toFixed(1)}, ${ema9 > ema21 ? 'EMA9 > EMA21' : 'EMA9 < EMA21'}`;
    return { direction, confidence: bullishScore, reason };
}

function computeMACD(closes: number[], fast: number, slow: number, signal: number): { macd: number; signal: number } {
    const emaFast = computeEMA(closes, fast);
    const emaSlow = computeEMA(closes, slow);
    const macdLine = emaFast - emaSlow;
    // Approximate signal as EMA of the last `signal` MACD values using the single macd value
    // For a proper signal we'd need historical MACD series; use a simplified single-point approach
    const macdSeries: number[] = [];
    for (let i = slow - 1; i < closes.length; i++) {
        macdSeries.push(computeEMA(closes.slice(0, i + 1), fast) - computeEMA(closes.slice(0, i + 1), slow));
    }
    const signalLine = computeEMA(macdSeries, signal);
    return { macd: macdLine, signal: signalLine };
}

function computeBollinger(closes: number[], period: number, stdDevMult: number): { mid: number; upper: number; lower: number } {
    const slice = closes.slice(-period);
    const mid = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length;
    const sd = Math.sqrt(variance) * stdDevMult;
    return { mid, upper: mid + sd, lower: mid - sd };
}

function computeRSI(closes: number[], period: number): number {
    const changes: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        changes.push(closes[i] - closes[i - 1]);
    }
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
        if (changes[i] > 0) avgGain += changes[i];
        else avgLoss += -changes[i];
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period; i < changes.length; i++) {
        const gain = changes[i] > 0 ? changes[i] : 0;
        const loss = changes[i] < 0 ? -changes[i] : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeEMA(closes: number[], period: number): number {
    if (closes.length < period) return closes[closes.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}
