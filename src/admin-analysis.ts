// Admin Analysis — 6-indicator, 200-candle premium analysis engine.
// Shared between bot.ts (AI Trading wizard, Signals) and auto-trading.ts (demo mode).
// Uses the same indicator implementations as the bot's original runAdminAnalysis.

export interface AdminCandle { close: number; max: number; min: number; }

export interface AdminAnalysisResult {
    direction: 'call' | 'put';
    confidence: number;
    reason: string;
}

function _adminEMA(closes: number[], period: number): number {
    if (closes.length < period) return closes[closes.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
    return ema;
}

function _adminRSI(closes: number[], period: number): number {
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

function _adminMACD(closes: number[], fast: number, slow: number, signalPeriod: number): { macd: number; signal: number; histogram: number } {
    const macdLine = _adminEMA(closes, fast) - _adminEMA(closes, slow);
    const macdSeries: number[] = [];
    for (let i = slow - 1; i < closes.length; i++) {
        macdSeries.push(_adminEMA(closes.slice(0, i + 1), fast) - _adminEMA(closes.slice(0, i + 1), slow));
    }
    const signal = _adminEMA(macdSeries, signalPeriod);
    return { macd: macdLine, signal, histogram: macdLine - signal };
}

function _adminBollinger(closes: number[], period: number, mult: number): { mid: number; upper: number; lower: number } {
    const slice = closes.slice(-period);
    const mid = slice.reduce((s, v) => s + v, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length) * mult;
    return { mid, upper: mid + sd, lower: mid - sd };
}

function _adminStochastic(highs: number[], lows: number[], closes: number[], kPeriod: number): { k: number; d: number } {
    const kValues: number[] = [];
    for (let offset = 2; offset >= 0; offset--) {
        const end = closes.length - offset;
        if (end < kPeriod) continue;
        const lowest = lows.slice(end - kPeriod, end).reduce((a, b) => Math.min(a, b), Infinity);
        const highest = highs.slice(end - kPeriod, end).reduce((a, b) => Math.max(a, b), -Infinity);
        const range = highest - lowest;
        kValues.push(range === 0 ? 50 : ((closes[end - 1] - lowest) / range) * 100);
    }
    const k = kValues[kValues.length - 1] ?? 50;
    const d = kValues.length > 0 ? kValues.reduce((s, v) => s + v, 0) / kValues.length : k;
    return { k, d };
}

function _adminATR(highs: number[], lows: number[], closes: number[], period: number): number {
    const trs: number[] = [];
    for (let i = 1; i < Math.min(closes.length, period + 1); i++) {
        trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    return trs.length > 0 ? trs.reduce((s, v) => s + v, 0) / trs.length : 0;
}

export function runAdminAnalysis(candles: AdminCandle[]): AdminAnalysisResult {
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.max);
    const lows   = candles.map(c => c.min);
    const lastClose = closes[closes.length - 1];

    const rsi = _adminRSI(closes, 14);
    const rsiBull = rsi > 58, rsiBear = rsi < 42;

    const ema9  = _adminEMA(closes, 9);
    const ema21 = _adminEMA(closes, 21);
    const ema50 = _adminEMA(closes, 50);
    const ema200 = _adminEMA(closes, 200);
    const emaBull = ema9 > ema21, emaBear = ema9 < ema21;
    const emaStrongBull = ema50 > ema200, emaStrongBear = ema50 < ema200;

    const { macd, signal: macdSig, histogram } = _adminMACD(closes, 12, 26, 9);
    const macdBull = macd > macdSig && histogram > 0;
    const macdBear = macd < macdSig && histogram < 0;

    const { mid, upper, lower } = _adminBollinger(closes, 20, 2);
    const bbBull = lastClose > mid && lastClose < upper;
    const bbBear = lastClose < mid && lastClose > lower;

    const { k, d } = _adminStochastic(highs, lows, closes, 14);
    const stochBull = k > d && k > 20;
    const stochBear = k < d && k < 80;

    const atr = _adminATR(highs, lows, closes, 14);
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
    const direction: 'call' | 'put' = bullVotes >= bearVotes ? 'call' : 'put';
    const confidence = totalVotes > 0 ? Math.round((Math.max(bullVotes, bearVotes) / totalVotes) * 100) : 78;

    return { direction, confidence: Math.max(confidence, 78), reason: `${direction === 'call' ? 'BULLISH' : 'BEARISH'} (${confidence}%)` };
}
