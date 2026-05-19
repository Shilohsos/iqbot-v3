import { createSdk } from './trade.js';

export interface AnalysisResult {
    direction: 'call' | 'put';
    confidence: number;
    reason: string;
}

export async function analyzePair(ssid: string, pair: string, timeframeSec: number, tier = 'NEWBIE'): Promise<AnalysisResult> {
    const sdk = await createSdk(ssid);
    try {
    const turboOptions = await sdk.turboOptions();
    const normTicker = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
    const normalizedInput = normTicker(pair);
    const active = turboOptions.getActives().find(a =>
        normTicker(a.ticker) === normalizedInput ||
        normTicker(a.localizationKey) === normalizedInput
    );
    if (!active) throw new Error(`Unknown pair: ${pair}`);

    const candlesFacade = await sdk.candles();
    const history = await candlesFacade.getCandles(active.id, timeframeSec, { count: 35 });

    if (history.length < 30) throw new Error('Not enough data for analysis');

    const closes = history.map(c => c.close);
    const rsi = computeRSI(closes, 14);
    const ema9 = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);

    if (tier === 'PRO') {
        const { macd, signal: macdSignal } = computeMACD(closes, 12, 26, 9);
        const { mid, lower } = computeBollinger(closes, 20, 2);
        const lastClose = closes[closes.length - 1];

        const rsiBull   = rsi > 50;
        const emaBull   = ema9 > ema21;
        const macdBull  = macd > macdSignal;
        const bollBull  = lastClose < lower || lastClose > mid;

        const votes     = [rsiBull, emaBull, macdBull, bollBull].filter(Boolean).length;
        const confidence = votes / 4 * 100;
        const direction: 'call' | 'put' = confidence >= 75 ? 'call' : 'put';
        const signals = [
            `RSI ${rsi.toFixed(1)} ${rsiBull ? '▲' : '▼'}`,
            `EMA ${emaBull ? '▲' : '▼'}`,
            `MACD ${macdBull ? '▲' : '▼'}`,
            `BB ${bollBull ? '▲' : '▼'}`,
        ].join(' | ');
        const reason = `${direction === 'call' ? 'BULLISH' : 'BEARISH'} (${votes}/4) | ${signals}`;
        return { direction, confidence, reason };
    }

    const rsiScore = rsi > 50 ? 50 : 0;
    const emaScore = ema9 > ema21 ? 50 : 0;
    const bullishScore = rsiScore + emaScore;

    const direction: 'call' | 'put' = bullishScore >= 50 ? 'call' : 'put';
    const sentiment = bullishScore >= 50 ? 'BULLISH' : 'BEARISH';
    const crossStr = ema9 > ema21 ? 'EMA9 > EMA21' : 'EMA9 < EMA21';
    const reason = `${sentiment} (+${bullishScore}%) | RSI ${rsi.toFixed(1)}, ${crossStr}`;

    return { direction, confidence: bullishScore, reason };
    } finally {
        await sdk.shutdown();
    }
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
