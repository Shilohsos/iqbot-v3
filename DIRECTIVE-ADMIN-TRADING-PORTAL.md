# Directive: Admin Trading Portal with Hyper-Profitable Analysis

## Goal
Add a dedicated trading system for the admin (user 1615652240) that is **significantly more profitable** than regular user trading. Admin connects their own IQ Option account via `/connect` and trades via `/trade` with a much stricter, multi-indicator analysis engine.

## Why
Admin needs to trade live with higher win rate to demonstrate the bot's capability. Regular user analysis is intentionally balanced. Admin analysis must be **ultra-strict** — skip marginal setups, only enter high-conviction trades.

## Architecture Overview

```
bot.ts
  ├── /connect        → admin flow: saves admin_ssid separately in DB/env
  ├── /disconnect     → clears admin_ssid
  └── /trade          → launches admin trade wizard with ADMIN analysis

analysis.ts
  └── NEW: adminAnalyze() → super-strict multi-TF analysis (all indicators must agree)

tiers.ts
  └── NEW: ADMIN tier config → all pairs, all timeframes, max strictness
```

---

## Step 1: Admin SSID Storage

### In database (db.ts):
Add a config row for admin's IQ Option SSID:

```typescript
// In the config table or a new row
export function setAdminSsid(ssid: string): void {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('admin_ssid', ssid);
}
export function getAdminSsid(): string | null {
    const row = db.prepare("SELECT value FROM config WHERE key = 'admin_ssid'").get() as { value: string } | undefined;
    return row?.value ?? null;
}
export function clearAdminSsid(): void {
    db.prepare("DELETE FROM config WHERE key = 'admin_ssid'").run();
}
```

### /connect handler (bot.ts):
Modify the existing `/connect` command — if the user is the admin (chat ID === ADMIN_USER_ID), save the SSID to admin_ssid in config instead of the users table:

```typescript
bot.command('connect', async ctx => {
    if (ctx.from!.id !== getAdminId()) {
        // Existing user connect flow unchanged
        connectSessions.set(ctx.chat.id, { step: 'email' });
        await ctx.reply('📧 Enter your IQ Option email:');
        return;
    }
    // Admin connect flow
    connectSessions.set(ctx.chat.id, { step: 'admin_email' });
    await ctx.reply('👑 *Admin Mode* — Enter your IQ Option email to connect your personal trading account:', { parse_mode: 'Markdown' });
});
```

Add admin credential capture in the text handler (same pattern as existing user connect, but saves to admin_ssid config):

```typescript
// In the text handler, after checking admin:
if (as.step === 'admin_email') {
    connectSessions.set(chatId, { ...as, step: 'admin_password', email: text.trim() });
    await ctx.reply('🔑 Enter your IQ Option password:');
    return;
}
if (as.step === 'admin_password') {
    await ctx.reply('⏳ Logging in to IQ Option...');
    try {
        const res = await fetch(`${IQ_AUTH_URL}/v2/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
            body: JSON.stringify({ identifier: as.email, password: text.trim() }),
        });
        const data = await res.json();
        if (data.code !== 'success' || !data.ssid) throw new Error(data.message ?? 'Login failed');
        setAdminSsid(data.ssid);
        // Also save email for display
        setConfig('admin_email', as.email);
        connectSessions.delete(chatId);
        await ctx.reply('✅ *Admin account connected!* Use /trade to start trading with ultra-strict analysis.', { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    return;
}
```

### /disconnect handler:
If admin, clear admin_ssid.

---

## Step 2: Admin Trade Wizard (/trade)

### New step types:
```typescript
| 'admin_amount'
| 'admin_timeframe'
| 'admin_pair'
```

### /trade command:
```typescript
bot.command('trade', async ctx => {
    if (ctx.from!.id !== getAdminId()) {
        // Launch existing user trade wizard
        launchTradeWizard(ctx);
        return;
    }
    const ssid = getAdminSsid();
    if (!ssid) {
        await ctx.reply('👑 *Admin Portal*\n\n⚠️ No IQ Option account connected.\nUse /connect to link your personal trading account first.', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'admin:force_connect' }]] },
        });
        return;
    }
    // Launch admin trade wizard
    adminSessions.set(ctx.chat.id, { step: 'admin_amount' });
    await ctx.reply(
        '👑 *Admin Trade Portal*\n\nEnter trade amount in USD:',
        { parse_mode: 'Markdown', reply_markup: amountKeyboard() }
    );
});
```

### Amount selection:
```typescript
bot.action(/^admin_amt:(\d+)$/, async ctx => {
    // Reuse existing amount buttons with new callback prefix
});

bot.action('admin_amt:custom', async ctx => {
    adminSessions.set(ctx.chat!.id, { step: 'admin_amount_custom' });
    await ctx.reply('✏️ Enter custom amount in USD:');
});
```

### Timeframe selection (admin gets ALL timeframes):
```typescript
bot.action(/^admin_tf:(\d+)$/, async ctx => {
    // Show pair selection with ALL 8 OTC pairs
});
```

### Pair selection → analysis → execute:
Same flow as user trading (bot.ts line 975+) but using the admin SSID and admin analysis.

---

## Step 3: Hyper-Profitable Admin Analysis Engine

### New file: `src/admin-analysis.ts` (or extend `analysis.ts`)

**Core principle:** NEVER enter a trade unless ALL indicators align with ultra-high confidence.

### Strategy:

```typescript
export async function adminAnalyze(sdk: ClientSdk, pair: string): Promise<AnalysisResult> {
    // Pull candles from 3 timeframes
    const candles5m = await getCandles(sdk, pair, 300, 50);
    const candles1m = await getCandles(sdk, pair, 60, 40);
    const candles30s = await getCandles(sdk, pair, 30, 35);

    // 1. HIGH TIMEFRAME BIAS — 5m trend must be clear
    const tf5m = analyzeTimeframe(candles5m, 'STRICT');
    if (tf5m.confidence < 90) {
        return { direction: tf5m.direction, confidence: 0, reason: 'SKIPPED — 5m trend unclear' };
    }

    // 2. MID TIMEFRAME CONFIRMATION — 1m must agree with 5m
    const tf1m = analyzeTimeframe(candles1m, 'STRICT');
    if (tf1m.direction !== tf5m.direction || tf1m.confidence < 90) {
        return { direction: tf1m.direction, confidence: 0, reason: `SKIPPED — 1m disagrees with 5m (5m=${tf5m.direction}, 1m=${tf1m.direction})` };
    }

    // 3. ENTRY TIMEFRAME — 30s must agree
    const tf30s = analyzeTimeframe(candles30s, 'ENTRY');
    if (tf30s.direction !== tf5m.direction || tf30s.confidence < 85) {
        return { direction: tf30s.direction, confidence: 0, reason: `SKIPPED — 30s disagrees (${tf30s.direction} vs ${tf5m.direction})` };
    }

    // ALL THREE TIMEFRAMES AGREE — high conviction trade
    const avgConfidence = Math.round((tf5m.confidence + tf1m.confidence + tf30s.confidence) / 3);
    return {
        direction: tf5m.direction,
        confidence: avgConfidence,
        reason: `✅ ALL-TF BULLISH (${avgConfidence}%) | 5m:${tf5m.signals} | 1m:${tf1m.signals} | 30s:${tf30s.signals}`,
    };
}
```

### Per-timeframe analysis (STRICT mode — 6 indicators):

```typescript
interface TfResult {
    direction: 'call' | 'put';
    confidence: number;
    signals: string;
}

function analyzeTimeframe(candles: Candle[], mode: 'STRICT' | 'ENTRY'): TfResult {
    const closes = candles.map(c => c.close);
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const highs = candles.map(c => c.max);
    const lows = candles.map(c => c.min);

    // 1. RSI (period 14) — STRICT thresholds
    const rsi = computeRSI(closes, 14);
    const rsiBull = rsi > 58;  // User threshold: >50, Admin: >58
    const rsiBear = rsi < 42;  // User: <50, Admin: <42
    const rsiSignal = rsiBull ? '▲' : (rsiBear ? '▼' : '—');

    // 2. EMA crossovers — 9/21 AND 50/200
    const ema9 = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);
    const ema50 = computeEMA(closes, 50);
    const ema200 = computeEMA(closes, 200);
    const emaBull = ema9 > ema21;          // Short-term bullish
    const emaStrongBull = ema50 > ema200;   // Long-term bullish (avoid counter-trend)
    const emaSignal = emaBull ? (emaStrongBull ? '▲▲' : '▲') : (emaStrongBull ? '▼' : '▼▼');

    // 3. MACD with histogram
    const { macd, signal: macdSignal, histogram } = computeMACDFull(closes, 12, 26, 9);
    const macdBull = macd > macdSignal && histogram > 0;  // MACD above signal AND histogram positive
    const macdSignal_ = macdBull ? '▲' : '▼';

    // 4. Bollinger Bands — position + squeeze detection
    const { mid, upper, lower, bandwidth } = computeBollingerFull(closes, 20, 2);
    const bbBull = lastClose > mid && lastClose < upper;  // Above midpoint but not overbought
    const bbBear = lastClose < mid && lastClose > lower;  // Below midpoint but not oversold
    const bbSqueeze = bandwidth < 0.05;  // Low bandwidth = squeezing = potential breakout
    const bbSignal = bbBull ? '▲' : (bbBear ? '▼' : '—');

    // 5. Stochastic (K/D %K)
    const { k, d } = computeStochastic(highs, lows, closes, 14, 3);
    const stochBull = k > d && k > 20;     // K above D, not oversold
    const stochBear = k < d && k < 80;     // K below D, not overbought
    const stochSignal = stochBull ? '▲' : (stochBear ? '▼' : '—');

    // 6. ATR (volatility filter) — skip if too low (no movement potential)
    const atr = computeATR(highs, lows, closes, 14);
    const avgPrice = closes.reduce((s, v) => s + v, 0) / closes.length;
    const atrPct = (atr / avgPrice) * 100;
    const hasVolatility = atrPct > 0.03;  // At least 0.03% average movement
    const atrSignal = hasVolatility ? '✓' : '✗';

    // Voting — all 6 indicators must agree for STRICT mode
    let bullVotes = 0;
    let bearVotes = 0;

    if (rsiBull) bullVotes++; else if (rsiBear) bearVotes++;
    if (emaBull && emaStrongBull) bullVotes += 2; else if (!emaBull && !emaStrongBull) bearVotes += 2;
    else if (emaBull) bullVotes++;
    else if (!emaBull) bearVotes++;
    if (macdBull) bullVotes++; else bearVotes++;
    if (bbBull) bullVotes++; else if (bbBear) bearVotes++;
    if (stochBull) bullVotes++; else if (stochBear) bearVotes++;
    if (hasVolatility) { if (bullVotes > bearVotes) bullVotes++; else bearVotes++; }

    const totalVotes = bullVotes + bearVotes;
    const direction = bullVotes > bearVotes ? 'call' : (bearVotes > bullVotes ? 'put' : 'neutral');
    const confidence = totalVotes > 0 ? Math.round((Math.max(bullVotes, bearVotes) / totalVotes) * 100) : 0;

    const signals = `RSI ${rsi.toFixed(1)}${rsiSignal} EMA${emaSignal} MACD${macdSignal_} BB${bbSignal} STOCH${stochSignal} ATR${atrSignal}`;

    return { direction, confidence, signals };
}
```

### Additional indicators needed (add to analysis.ts or admin-analysis.ts):

```typescript
function computeMACDFull(closes: number[], fast: number, slow: number, signal: number): { macd: number; signal: number; histogram: number } {
    // Same as existing computeMACD but also returns histogram (macd - signal)
}

function computeBollingerFull(closes: number[], period: number, stdDevMult: number): { mid: number; upper: number; lower: number; bandwidth: number } {
    // Same as existing but also returns bandwidth ((upper-lower)/mid)
}

function computeStochastic(highs: number[], lows: number[], closes: number[], kPeriod: number, dPeriod: number): { k: number; d: number } {
    const lowest = lows.slice(-kPeriod).reduce((a, b) => Math.min(a, b), Infinity);
    const highest = highs.slice(-kPeriod).reduce((a, b) => Math.max(a, b), -Infinity);
    const range = highest - lowest;
    const k = range === 0 ? 50 : ((closes[closes.length - 1] - lowest) / range) * 100;
    const d = k; // Simplified single-point approximation
    return { k, d };
}

function computeATR(highs: number[], lows: number[], closes: number[], period: number): number {
    const trs: number[] = [];
    for (let i = 1; i < Math.min(closes.length, period + 1); i++) {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        trs.push(Math.max(hl, hc, lc));
    }
    return trs.reduce((s, v) => s + v, 0) / trs.length;
}
```

---

## Step 4: Admin Trading Display

When a trade result comes back, show an enhanced admin trade card (different from user results):

```
👑 *ADMIN TRADE*

📈 EURUSD-OTC × $100
⏱ 60s — CALL 🟢

📊 Analysis:
• 5m: RSI 62▲ EMA▲▲ MACD▲ BB▲ STOCH▲ ATR✓
• 1m: RSI 59▲ EMA▲ MACD▲ BB▲ STOCH▲ ATR✓
• 30s: RSI 61▲ EMA▲▲ MACD▲ BB▲ STOCH▲ ATR✓

✅ ALL TIMEFRAMES CONFIRM — 94% confidence

💰 Result: +$91.00 (91% profit)
🏆 Win streak: 12
```

Use the existing martingale/session logic from bot.ts but with admin SSID.

---

## Step 5: Admin Tier Config (tiers.ts)

Add an ADMIN tier that has full access:

```typescript
ADMIN: {
    label: 'Admin',
    pairs: ALL_OTC_PAIRS,  // All 8 pairs
    analyzerTier: 'MASTER',  // Use enhanced analysis path
    maxConcurrentTrades: 10,
    allowedTimeframes: [30, 60, 300],
    allowedGaleOptions: [3],
    galeCanDisable: true,
    defaultGaleRounds: 3,  // Only 3 rounds to minimize loss exposure
    canViewLeaderboard: true,
    canParticipateGiveaway: false,
    demoUpsellEnabled: false,
}
```

The admin trade wizard should skip tier/timeframe/pair validation (admin has access to everything).

---

## Key Behavioral Differences (Admin vs Users)

| Aspect | Users | Admin |
|--------|-------|-------|
| **Indicators** | 2-4 (tier-dependent) | 6 indicators, 3 timeframes |
| **Confidence threshold** | ≥50% | ≥85% (skips marginal setups) |
| **Multi-TF** | No | Yes (5m bias + 1m confirmation + 30s entry) |
| **Indicator agreement** | Majority (≥50%) | ALL must agree |
| **RSI threshold** | >50 / <50 | >58 / <42 (wider neutrality zone) |
| **Volatility filter** | No | Yes (require ATR > 0.03%) |
| **Recovery rounds** | 3-6 | 3 max, only if confidence >90% |
| **Trades skipped** | None | Marginal/low-conviction setups skipped |
| **Win rate target** | ~70-80% | 90%+ |

---

## Files to Modify/Create

- **`src/admin-analysis.ts`** — NEW: super-strict multi-TF analysis engine
- **`src/bot.ts`** — /connect admin flow, /trade admin wizard, admin trade execution
- **`src/db.ts`** — getAdminSsid/setAdminSsid/clearAdminSsid functions
- **`src/tiers.ts`** — ADMIN tier config
- **`src/ui/admin.ts`** — admin trade keyboard templates (optional, can reuse user keyboards with admin_ prefix)
- **`src/menu.ts`** — Add `adminAmountKeyboard()` if needed

## Winning Approach Reference

For maximum profitability, the admin analysis should:
1. **Skip more than it trades** — Only enter when ALL conditions met. It's better to skip 10 trades and win 1 than to take 10 and lose 3.
2. **Use 5m as the compass** — Never trade against the 5m trend. If 5m is bearish, don't enter a call even if 30s looks bullish.
3. **Require volatility** — ATR must show enough movement potential. Flat markets kill strategies.
4. **EMA structure matters** — Require both short-term (9/21) AND long-term (50/200) alignment.
5. **Recover selectively** — Only use martingale recovery when post-loss confidence is ≥90%. Sometimes accept a small loss rather than risking recovery on a weak setup.
