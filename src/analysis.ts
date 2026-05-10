import { createSdk } from './trade.js';

export interface AnalysisResult {
    direction: 'call' | 'put';
    confidence: number;
    reason: string;
}

export async function analyzePair(ssid: string, pair: string, timeframeSec: number): Promise<AnalysisResult> {
    const sdk = await createSdk(ssid);
    try {
        const turboOptions = await sdk.turboOptions();
        const normalizedPair = pair.replace(/^front\./i, '');
        const active = turboOptions.getActives().find(a =>
            a.ticker === normalizedPair ||
            a.localizationKey === normalizedPair ||
            a.localizationKey === `front.${normalizedPair}`
        );
        if (!active) throw new Error(`Unknown pair: ${pair}`);

        const candlesFacade = await sdk.candles();
        const history = await candlesFacade.getCandles(active.id, timeframeSec, { count: 35 });

        if (history.length < 30) throw new Error('Not enough data for analysis');

        const closes = history.map(c => c.close);
        const rsi = computeRSI(closes, 14);
        const ema9 = computeEMA(closes, 9);
        const ema21 = computeEMA(closes, 21);

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
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}
