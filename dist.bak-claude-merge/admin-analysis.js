// Admin Analysis — PRO multi-indicator engine.
// 14 indicators with weighted scoring. Replaces single-indicator Supertrend.
// Score range [-500, 500] → confidence [50, 99%].
// ─── ATR (Average True Range) ────────────────────────────────────────────────
function computeATR(candles, period) {
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const tr = Math.max(candles[i].max - candles[i].min, Math.abs(candles[i].max - candles[i - 1].close), Math.abs(candles[i].min - candles[i - 1].close));
        trs.push(tr);
    }
    const atrs = [];
    if (trs.length === 0)
        return atrs;
    let atr = trs.slice(0, Math.min(period, trs.length)).reduce((s, v) => s + v, 0) / Math.min(period, trs.length);
    atrs.push(atr);
    for (let i = Math.min(period, trs.length); i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
        atrs.push(atr);
    }
    return atrs;
}
// ─── RSI (Relative Strength Index) ──────────────────────────────────────────
function computeRSI(candles, period) {
    if (candles.length < period + 1)
        return 50;
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change >= 0)
            avgGain += change;
        else
            avgLoss -= change;
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period + 1; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        const gain = change >= 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0)
        return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}
// ─── EMA (Exponential Moving Average) ───────────────────────────────────────
function computeEMA(values, period) {
    if (values.length === 0)
        return [];
    const k = 2 / (period + 1);
    const emas = [values[0]];
    for (let i = 1; i < values.length; i++) {
        emas.push(values[i] * k + emas[i - 1] * (1 - k));
    }
    return emas;
}
// ─── MACD ────────────────────────────────────────────────────────────────────
function computeMACD(candles) {
    const closes = candles.map(c => c.close);
    const ema12 = computeEMA(closes, 12);
    const ema26 = computeEMA(closes, 26);
    const macdLine = [];
    for (let i = 0; i < closes.length; i++) {
        macdLine.push(ema12[i] - ema26[i]);
    }
    const signalLine = computeEMA(macdLine, 9);
    const lastIdx = closes.length - 1;
    return {
        macd: macdLine[lastIdx],
        signal: signalLine[lastIdx],
        histogram: macdLine[lastIdx] - signalLine[lastIdx],
    };
}
// ─── Bollinger Bands ────────────────────────────────────────────────────────
function computeBollingerBands(candles, period = 20, mult = 2) {
    const slice = candles.slice(-period);
    const closes = slice.map(c => c.close);
    const sma = closes.reduce((s, v) => s + v, 0) / closes.length;
    const variance = closes.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / closes.length;
    const stdDev = Math.sqrt(variance);
    return {
        upper: sma + mult * stdDev,
        middle: sma,
        lower: sma - mult * stdDev,
    };
}
// ─── Stochastic Oscillator ──────────────────────────────────────────────────
function computeStochastic(candles, kPeriod = 14, dPeriod = 3) {
    const slice = candles.slice(-kPeriod);
    const lowestLow = Math.min(...slice.map(c => c.min));
    const highestHigh = Math.max(...slice.map(c => c.max));
    const lastClose = candles[candles.length - 1].close;
    const k = highestHigh === lowestLow ? 50 : ((lastClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    // D line = SMA of last dPeriod K values (approximate using recent closes)
    const dSlice = candles.slice(-(kPeriod + dPeriod));
    const kValues = [];
    for (let i = 0; i < dPeriod && i < dSlice.length; i++) {
        const s = dSlice.slice(i, i + kPeriod);
        if (s.length < 2)
            continue;
        const ll = Math.min(...s.map(c => c.min));
        const hh = Math.max(...s.map(c => c.max));
        const cc = s[s.length - 1].close;
        kValues.push(hh === ll ? 50 : ((cc - ll) / (hh - ll)) * 100);
    }
    const d = kValues.length > 0 ? kValues.reduce((s, v) => s + v, 0) / kValues.length : k;
    return { k, d };
}
// ─── ADX (Average Directional Index) ─────────────────────────────────────────
function computeADX(candles, period = 14) {
    if (candles.length < period * 2 + 1)
        return 20; // default to neutral
    const plusDM = [];
    const minusDM = [];
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const upMove = candles[i].max - candles[i - 1].max;
        const downMove = candles[i - 1].min - candles[i].min;
        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
        const tr = Math.max(candles[i].max - candles[i].min, Math.abs(candles[i].max - candles[i - 1].close), Math.abs(candles[i].min - candles[i - 1].close));
        trs.push(tr);
    }
    // Wilder's smoothing
    let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
    let plusDMAvg = plusDM.slice(0, period).reduce((s, v) => s + v, 0) / period;
    let minusDMAvg = minusDM.slice(0, period).reduce((s, v) => s + v, 0) / period;
    const dxValues = [];
    for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
        plusDMAvg = (plusDMAvg * (period - 1) + plusDM[i]) / period;
        minusDMAvg = (minusDMAvg * (period - 1) + minusDM[i]) / period;
        const plusDI = atr > 0 ? (plusDMAvg / atr) * 100 : 0;
        const minusDI = atr > 0 ? (minusDMAvg / atr) * 100 : 0;
        const dx = (plusDI + minusDI) > 0 ? (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100 : 0;
        dxValues.push(dx);
    }
    if (dxValues.length < period)
        return 20;
    const adx = dxValues.slice(-period).reduce((s, v) => s + v, 0) / period;
    return adx;
}
// ─── RSI Divergence ──────────────────────────────────────────────────────────
function detectRSIDivergence(candles, period = 14) {
    if (candles.length < period * 3 + 5)
        return { type: null, score: 0 };
    // Find recent swing highs and lows in price
    const recent = candles.slice(-Math.min(candles.length, period * 3));
    // Split into two halves to compare
    const mid = Math.floor(recent.length / 2);
    const firstHalf = recent.slice(0, mid);
    const secondHalf = recent.slice(mid);
    const firstHigh = Math.max(...firstHalf.map(c => c.max));
    const secondHigh = Math.max(...secondHalf.map(c => c.max));
    const firstLow = Math.min(...firstHalf.map(c => c.min));
    const secondLow = Math.min(...secondHalf.map(c => c.min));
    // Compute RSI for the two halves
    const firstHalfRSI = computeRSI(firstHalf, Math.min(period, firstHalf.length - 1));
    const secondHalfRSI = computeRSI(secondHalf, Math.min(period, secondHalf.length - 1));
    // Bearish divergence: price higher high, RSI lower high
    if (secondHigh > firstHigh && secondHalfRSI < firstHalfRSI) {
        return { type: 'bearish', score: 25 };
    }
    // Bullish divergence: price lower low, RSI higher low
    if (secondLow < firstLow && secondHalfRSI > firstHalfRSI) {
        return { type: 'bullish', score: 25 };
    }
    return { type: null, score: 0 };
}
// ─── Support/Resistance ──────────────────────────────────────────────────────
function detectSR(candles, tolerance = 0.002) {
    if (candles.length < 20)
        return { nearResistance: false, nearSupport: false, score: 0 };
    const recent = candles.slice(-60);
    const highs = recent.map(c => c.max).sort((a, b) => b - a);
    const lows = recent.map(c => c.min).sort((a, b) => a - b);
    const lastClose = candles[candles.length - 1].close;
    // Find clustered highs (resistance) and lows (support)
    const resistance = highs[0]; // highest high
    const support = lows[0]; // lowest low
    const range = resistance - support;
    if (range === 0)
        return { nearResistance: false, nearSupport: false, score: 0 };
    const distToResistance = (resistance - lastClose) / range;
    const distToSupport = (lastClose - support) / range;
    // Within 0.2% tolerance
    const nearResistance = distToResistance < tolerance;
    const nearSupport = distToSupport < tolerance;
    let score = 0;
    if (nearResistance)
        score = -30; // at resistance → bearish
    if (nearSupport)
        score = 30; // at support → bullish
    return { nearResistance, nearSupport, score };
}
// ─── Multi-Timeframe Trend ───────────────────────────────────────────────────
function multiTimeframeTrend(candles) {
    const lookbacks = [10, 20, 30];
    const trends = [];
    for (const lb of lookbacks) {
        if (candles.length < lb + 1)
            continue;
        const slice = candles.slice(-lb);
        const ema9 = computeEMA(slice.map(c => c.close), Math.min(9, slice.length));
        const ema21 = computeEMA(slice.map(c => c.close), Math.min(21, slice.length));
        const lastIdx = ema9.length - 1;
        if (ema9[lastIdx] > ema21[lastIdx])
            trends.push('call');
        else
            trends.push('put');
    }
    if (trends.length === 0)
        return { direction: 'mixed', score: 0 };
    const calls = trends.filter(t => t === 'call').length;
    const puts = trends.length - calls;
    if (calls === trends.length)
        return { direction: 'call', score: 25 };
    if (puts === trends.length)
        return { direction: 'put', score: -25 };
    return { direction: 'mixed', score: 0 };
}
// ─── Candlestick Pattern Detection ──────────────────────────────────────────
function detectCandlestickPatterns(candles) {
    if (candles.length < 3)
        return { direction: null, score: 0 };
    const c = candles[candles.length - 1];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 3];
    const body = Math.abs((c.open ?? c.close) - c.close);
    const range = c.max - c.min;
    const prevBody = Math.abs((c1.open ?? c1.close) - c1.close);
    // Bullish Engulfing
    const c1Open = c1.open ?? c1.close;
    const cOpen = c.open ?? c.close;
    if (c1.close < c1Open && c.close > cOpen && c.close > c1Open && cOpen < c1.close) {
        return { direction: 'call', score: 30 };
    }
    // Bearish Engulfing
    if (c1.close > c1Open && c.close < cOpen && c.close < c1Open && cOpen > c1.close) {
        return { direction: 'put', score: -30 };
    }
    // Hammer (bullish reversal)
    if (range > 0 && body / range < 0.3 && (c.close - c.min) > 2 * body && (c.max - c.close) < body) {
        return { direction: 'call', score: 30 };
    }
    // Shooting Star (bearish reversal)
    if (range > 0 && body / range < 0.3 && (c.max - c.close) > 2 * body && (c.close - c.min) < body) {
        return { direction: 'put', score: -30 };
    }
    // Three White Soldiers
    if (c.close > c1.close && c1.close > c2.close && c.close > (c.open ?? c.close) && c1.close > (c1.open ?? c1.close) && c2.close > (c2.open ?? c2.close)) {
        return { direction: 'call', score: 30 };
    }
    // Three Black Crows
    if (c.close < c1.close && c1.close < c2.close && c.close < (c.open ?? c.close) && c1.close < (c1.open ?? c1.close) && c2.close < (c2.open ?? c2.close)) {
        return { direction: 'put', score: -30 };
    }
    // Doji (neutral)
    if (range > 0 && body / range < 0.1) {
        return { direction: null, score: 0 };
    }
    return { direction: null, score: 0 };
}
// ─── Volume Surge ────────────────────────────────────────────────────────────
function computeVolumeSurge(candles) {
    if (candles.length < 11 || !candles[0].volume)
        return { surge: false, score: 0 };
    const lastVol = candles[candles.length - 1].volume ?? 0;
    const avgVol = candles.slice(-11, -1).reduce((s, c) => s + (c.volume ?? 0), 0) / 10;
    if (avgVol === 0)
        return { surge: false, score: 0 };
    const ratio = lastVol / avgVol;
    if (ratio > 1.5) {
        // Volume surge confirms last candle direction
        const lastCandle = candles[candles.length - 1];
        const isBullish = lastCandle.close > (lastCandle.open ?? lastCandle.close);
        return { surge: true, score: isBullish ? 15 : -15 };
    }
    return { surge: false, score: 0 };
}
// ─── Trend Strength (EMA slope consistency) ──────────────────────────────────
function computeTrendStrength(candles) {
    if (candles.length < 25)
        return { score: 0 };
    const closes = candles.slice(-20).map(c => c.close);
    const ema = computeEMA(closes, 9);
    // Slope of last 5 EMA values
    const recentEma = ema.slice(-5);
    if (recentEma.length < 2)
        return { score: 0 };
    let increasing = 0;
    let decreasing = 0;
    for (let i = 1; i < recentEma.length; i++) {
        if (recentEma[i] > recentEma[i - 1])
            increasing++;
        else
            decreasing++;
    }
    const consistency = (increasing - decreasing) / (recentEma.length - 1);
    return { score: Math.round(consistency * 20) };
}
// ─── Main PRO Analysis Function ──────────────────────────────────────────────
export function runAdminAnalysis(candles) {
    const sliced = candles.slice(-60); // PRO uses 60 candles
    if (sliced.length < 22) {
        return { direction: 'call', confidence: 50, reason: 'Insufficient data' };
    }
    let score = 0;
    const reasons = [];
    // 1. RSI (±80)
    const rsi = computeRSI(sliced, 14);
    if (rsi < 30) {
        score += 80;
        reasons.push('RSI oversold');
    }
    else if (rsi > 70) {
        score -= 80;
        reasons.push('RSI overbought');
    }
    else if (rsi < 45) {
        score += 40;
        reasons.push('RSI bearish-neutral');
    }
    else if (rsi > 55) {
        score -= 40;
        reasons.push('RSI bullish-neutral');
    }
    // 2. Stochastic (±40)
    const stoch = computeStochastic(sliced, 14, 3);
    if (stoch.k < 20) {
        score += 40;
        reasons.push('Stoch oversold');
    }
    else if (stoch.k > 80) {
        score -= 40;
        reasons.push('Stoch overbought');
    }
    else if (stoch.k > stoch.d) {
        score += 15;
        reasons.push('Stoch bullish cross');
    }
    else if (stoch.k < stoch.d) {
        score -= 15;
        reasons.push('Stoch bearish cross');
    }
    // 3. EMA 9/21 crossover (±50 + 25 distance)
    const closes = sliced.map(c => c.close);
    const ema9 = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);
    const lastIdx = closes.length - 1;
    const emaDiff = ema9[lastIdx] - ema21[lastIdx];
    if (emaDiff > 0) {
        score += 50;
        reasons.push('EMA bullish');
        const sep = Math.abs(emaDiff) / closes[lastIdx];
        score += Math.min(25, Math.round(sep * 1000));
    }
    else {
        score -= 50;
        reasons.push('EMA bearish');
        const sep = Math.abs(emaDiff) / closes[lastIdx];
        score -= Math.min(25, Math.round(sep * 1000));
    }
    // 4. MACD (±40)
    const macd = computeMACD(sliced);
    if (macd.histogram > 0) {
        score += 40;
        reasons.push('MACD bullish');
    }
    else {
        score -= 40;
        reasons.push('MACD bearish');
    }
    // 5. Bollinger Bands (±60)
    const bb = computeBollingerBands(sliced, 20, 2);
    const lastClose = closes[lastIdx];
    if (lastClose <= bb.lower) {
        score += 60;
        reasons.push('BB lower band');
    }
    else if (lastClose >= bb.upper) {
        score -= 60;
        reasons.push('BB upper band');
    }
    else if (lastClose < bb.middle) {
        score += 20;
        reasons.push('BB below mid');
    }
    else {
        score -= 20;
        reasons.push('BB above mid');
    }
    // 6. ATR (±30) — volatility-weighted directional bias
    const atrs = computeATR(sliced, 14);
    const atr = atrs[atrs.length - 1] || 0;
    const atrPct = closes[lastIdx] > 0 ? (atr / closes[lastIdx]) * 100 : 0;
    // High volatility amplifies the current candle direction
    const lastCandle = sliced[sliced.length - 1];
    const lastCandleDir = lastCandle.close > (lastCandle.open ?? lastCandle.close) ? 1 : -1;
    if (atrPct > 0.5) {
        score += lastCandleDir * 30;
        reasons.push(`ATR high (${atrPct.toFixed(2)}%)`);
    }
    // 7. ADX (info only — but we use it as a gate)
    const adx = computeADX(sliced, 14);
    if (adx < 20) {
        // Ranging market — reduce confidence
        score = Math.round(score * 0.6);
        reasons.push(`ADX weak (${adx.toFixed(0)}) — ranging`);
    }
    else {
        reasons.push(`ADX strong (${adx.toFixed(0)})`);
    }
    // 8. Volume Surge (±15)
    const vol = computeVolumeSurge(sliced);
    score += vol.score;
    if (vol.surge)
        reasons.push('Volume surge');
    // 9. Candlestick Patterns (±30)
    const pattern = detectCandlestickPatterns(sliced);
    score += pattern.score;
    if (pattern.direction)
        reasons.push(`Pattern: ${pattern.direction === 'call' ? 'bullish' : 'bearish'}`);
    // 10. Trend Strength (±20)
    const trend = computeTrendStrength(sliced);
    score += trend.score;
    if (trend.score > 0)
        reasons.push('Trend strong up');
    else if (trend.score < 0)
        reasons.push('Trend strong down');
    // 11. RSI Divergence (±25)
    const divergence = detectRSIDivergence(sliced, 14);
    if (divergence.type === 'bullish') {
        score += 25;
        reasons.push('RSI bullish divergence');
    }
    else if (divergence.type === 'bearish') {
        score -= 25;
        reasons.push('RSI bearish divergence');
    }
    // 12. Multi-Timeframe Trend (±25)
    const mtf = multiTimeframeTrend(sliced);
    score += mtf.score;
    if (mtf.direction === 'call')
        reasons.push('MTF aligned bullish');
    else if (mtf.direction === 'put')
        reasons.push('MTF aligned bearish');
    else
        reasons.push('MTF mixed');
    // 13. Support/Resistance (±30)
    const sr = detectSR(sliced, 0.002);
    score += sr.score;
    if (sr.nearSupport)
        reasons.push('Near support');
    if (sr.nearResistance)
        reasons.push('Near resistance');
    // 14. MTF Alignment (already captured in multiTimeframeTrend — deduplicate)
    // The MTF alignment score is the same as #12, so we skip a separate vote.
    // ── Determine direction ──────────────────────────────────────────────────
    // Clamp score to [-500, 500]
    score = Math.max(-500, Math.min(500, score));
    // No ties — if score is exactly 0, use last candle direction as tiebreaker
    let direction;
    if (score > 0)
        direction = 'call';
    else if (score < 0)
        direction = 'put';
    else {
        // Tie at 0 — use last candle direction
        const lc = sliced[sliced.length - 1];
        direction = lc.close > (lc.open ?? lc.close) ? 'call' : 'put';
    }
    // Confidence: score [-500, 500] → confidence [50, 99]
    const absScore = Math.abs(score);
    let confidence = Math.round(50 + (absScore / 500) * 49);
    confidence = Math.min(99, Math.max(50, confidence));
    const trendWord = direction === 'call' ? 'BULLISH' : 'BEARISH';
    const topReasons = reasons.slice(0, 4).join(', ');
    return {
        direction,
        confidence,
        reason: `${trendWord} — ${topReasons} (${confidence}%)`,
    };
}
