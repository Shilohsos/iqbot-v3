import type { ClientSdk } from './index.js';

export interface AdminTfResult {
    direction: 'call' | 'put' | 'neutral';
    confidence: number;
    signals: string;
}

export interface AdminAnalysisResult {
    direction: 'call' | 'put';
    confidence: number;
    reason: string;
    tf5m: AdminTfResult;
    tf1m: AdminTfResult;
    tf30s: AdminTfResult;
    skipped: boolean;
    skipReason?: string;
}

type Candle = { close: number; max: number; min: number };

async function fetchCandles(sdk: ClientSdk, pair: string, timeframeSec: number, count: number): Promise<Candle[]> {
    const turboOptions = await sdk.turboOptions();
    const norm = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
    const normalizedPair = norm(pair);
    const active = turboOptions.getActives().find(
        a => norm(a.ticker) === normalizedPair || norm(a.localizationKey) === normalizedPair
    );
    if (!active) throw new Error(`Unknown pair: ${pair}`);
    const candlesFacade = await sdk.candles();
    return candlesFacade.getCandles(active.id, timeframeSec, { count }) as Promise<Candle[]>;
}

function computeEMA(closes: number[], period: number): number {
    if (closes.length < period) return closes[closes.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
    return ema;
}

function computeRSI(closes: number[], period: number): number {
    const changes: number[] = [];
    for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period && i < changes.length; i++) {
        if (changes[i] > 0) avgGain += changes[i]; else avgLoss += -changes[i];
    }
    avgGain /= period; avgLoss /= period;
    for (let i = period; i < changes.length; i++) {
        const g = changes[i] > 0 ? changes[i] : 0;
        const l = changes[i] < 0 ? -changes[i] : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeMACDFull(closes: number[], fast: number, slow: number, signalPeriod: number): { macd: number; signal: number; histogram: number } {
    const emaFast = computeEMA(closes, fast);
    const emaSlow = computeEMA(closes, slow);
    const macdLine = emaFast - emaSlow;
    const macdSeries: number[] = [];
    for (let i = slow - 1; i < closes.length; i++) {
        macdSeries.push(computeEMA(closes.slice(0, i + 1), fast) - computeEMA(closes.slice(0, i + 1), slow));
    }
    const signal = computeEMA(macdSeries, signalPeriod);
    return { macd: macdLine, signal, histogram: macdLine - signal };
}

function computeBollingerFull(closes: number[], period: number, stdDevMult: number): { mid: number; upper: number; lower: number } {
    const slice = closes.slice(-period);
    const mid = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length;
    const sd = Math.sqrt(variance) * stdDevMult;
    return { mid, upper: mid + sd, lower: mid - sd };
}

function computeStochastic(highs: number[], lows: number[], closes: number[], kPeriod: number): { k: number; d: number } {
    const lowest = lows.slice(-kPeriod).reduce((a, b) => Math.min(a, b), Infinity);
    const highest = highs.slice(-kPeriod).reduce((a, b) => Math.max(a, b), -Infinity);
    const range = highest - lowest;
    const k = range === 0 ? 50 : ((closes[closes.length - 1] - lowest) / range) * 100;
    return { k, d: k };
}

function computeATR(highs: number[], lows: number[], closes: number[], period: number): number {
    const trs: number[] = [];
    for (let i = 1; i < Math.min(closes.length, period + 1); i++) {
        trs.push(Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        ));
    }
    return trs.length > 0 ? trs.reduce((s, v) => s + v, 0) / trs.length : 0;
}

function analyzeTimeframe(candles: Candle[]): AdminTfResult {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.max);
    const lows = candles.map(c => c.min);
    const lastClose = closes[closes.length - 1];

    const rsi = computeRSI(closes, 14);
    const rsiBull = rsi > 58;
    const rsiBear = rsi < 42;

    const ema9  = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);
    const ema50 = computeEMA(closes, 50);
    const ema200 = computeEMA(closes, 200);
    const emaBull  = ema9 > ema21;
    const emaBear  = ema9 < ema21;
    const emaStrongBull = ema50 > ema200;
    const emaStrongBear = ema50 < ema200;

    const { macd, signal: macdSig, histogram } = computeMACDFull(closes, 12, 26, 9);
    const macdBull = macd > macdSig && histogram > 0;
    const macdBear = macd < macdSig && histogram < 0;

    const { mid, upper, lower } = computeBollingerFull(closes, 20, 2);
    const bbBull = lastClose > mid && lastClose < upper;
    const bbBear = lastClose < mid && lastClose > lower;

    const { k, d } = computeStochastic(highs, lows, closes, 14);
    const stochBull = k > d && k > 20;
    const stochBear = k < d && k < 80;

    const atr = computeATR(highs, lows, closes, 14);
    const avgPrice = closes.reduce((s, v) => s + v, 0) / closes.length;
    const hasVolatility = avgPrice > 0 && (atr / avgPrice) * 100 > 0.03;

    let bullVotes = 0, bearVotes = 0;
    if (rsiBull) bullVotes++; else if (rsiBear) bearVotes++;
    if (emaBull && emaStrongBull) bullVotes += 2; else if (emaBear && emaStrongBear) bearVotes += 2;
    else if (emaBull) bullVotes++; else if (emaBear) bearVotes++;
    if (macdBull) bullVotes++; else if (macdBear) bearVotes++;
    if (bbBull) bullVotes++; else if (bbBear) bearVotes++;
    if (stochBull) bullVotes++; else if (stochBear) bearVotes++;
    if (hasVolatility) { if (bullVotes >= bearVotes) bullVotes++; else bearVotes++; }

    const totalVotes = bullVotes + bearVotes;
    const direction: 'call' | 'put' | 'neutral' = bullVotes > bearVotes ? 'call' : bearVotes > bullVotes ? 'put' : 'neutral';
    const confidence = totalVotes > 0 ? Math.round((Math.max(bullVotes, bearVotes) / totalVotes) * 100) : 0;

    const emaStr = emaBull ? (emaStrongBull ? '▲▲' : '▲') : emaBear ? (emaStrongBear ? '▼▼' : '▼') : '—';
    const signals = [
        `RSI ${rsi.toFixed(1)}${rsiBull ? '▲' : rsiBear ? '▼' : '—'}`,
        `EMA${emaStr}`,
        `MACD${macdBull ? '▲' : macdBear ? '▼' : '—'}`,
        `BB${bbBull ? '▲' : bbBear ? '▼' : '—'}`,
        `STOCH${stochBull ? '▲' : stochBear ? '▼' : '—'}`,
        `ATR${hasVolatility ? '✓' : '✗'}`,
    ].join(' ');

    return { direction, confidence, signals };
}

export async function adminAnalyze(sdk: ClientSdk, pair: string): Promise<AdminAnalysisResult> {
    const [candles5m, candles1m, candles30s] = await Promise.all([
        fetchCandles(sdk, pair, 300, 50),
        fetchCandles(sdk, pair, 60, 40),
        fetchCandles(sdk, pair, 30, 35),
    ]);

    const tf5m  = analyzeTimeframe(candles5m);
    const tf1m  = analyzeTimeframe(candles1m);
    const tf30s = analyzeTimeframe(candles30s);

    if (tf5m.direction === 'neutral' || tf5m.confidence < 90) {
        return { direction: 'call', confidence: 0, reason: `SKIPPED — 5m trend unclear (${tf5m.confidence}%)`, tf5m, tf1m, tf30s, skipped: true, skipReason: `5m trend unclear (${tf5m.confidence}% confidence)` };
    }
    if (tf1m.direction !== tf5m.direction || tf1m.confidence < 90) {
        return { direction: tf5m.direction as 'call' | 'put', confidence: 0, reason: `SKIPPED — 1m disagrees with 5m`, tf5m, tf1m, tf30s, skipped: true, skipReason: `1m disagrees with 5m (${tf1m.direction} vs ${tf5m.direction}, ${tf1m.confidence}%)` };
    }
    if (tf30s.direction !== tf5m.direction || tf30s.confidence < 85) {
        return { direction: tf5m.direction as 'call' | 'put', confidence: 0, reason: `SKIPPED — 30s disagrees`, tf5m, tf1m, tf30s, skipped: true, skipReason: `30s disagrees (${tf30s.direction} vs ${tf5m.direction}, ${tf30s.confidence}%)` };
    }

    const avgConfidence = Math.round((tf5m.confidence + tf1m.confidence + tf30s.confidence) / 3);
    const dir = tf5m.direction as 'call' | 'put';
    return {
        direction: dir,
        confidence: avgConfidence,
        reason: `✅ ALL-TF ${dir === 'call' ? 'BULLISH' : 'BEARISH'} (${avgConfidence}%)`,
        tf5m, tf1m, tf30s,
        skipped: false,
    };
}
