# Section 4: Interactive Trade + On-Demand Bias Analysis

## Goal

Replace the manual `/trade EURUSD-OTC put 10` command with an interactive wizard flow that
analyzes the chosen pair on-demand and auto-selects direction (call/put) before running the
existing martingale pipeline.

## Interaction Flow

```
User: /trade
Bot:  "Enter amount:"                    → inline buttons: $10, $25, $50, $100, Custom
User: taps $10
Bot:  "Pick timeframe:"                 → inline buttons: 1m, 5m, 15m
User: taps 5m
Bot:  "Pick pair:"                      → inline buttons: EURUSD-OTC, GBPUSD-OTC, EURJPY-OTC, More...
User: taps EURUSD-OTC
Bot:  "Analyzing EURUSD-OTC on 5m..."
      (fetches candles, computes RSI + EMA, picks direction)
Bot:  "EURUSD-OTC 5m → BULLISH (+72%) — entering CALL"
      → normal martingale pipeline fires
```

## Technical Details

### Indicators (only two)

**RSI (14):**
- Standard RSI on close prices over last 14 candles
- Score: RSI > 50 → bullish, RSI < 50 → bearish, RSI = 50 → neutral
- Weight: 50% of final direction score

**EMA Crossover (9/21):**
- Compute EMA(9) and EMA(21) on close prices
- EMA9 > EMA21 → bullish, EMA9 < EMA21 → bearish
- Weight: 50% of final direction score

### Direction Decision

```
bullish_score = (RSI > 50 ? 50 : 0) + (EMA9 > EMA21 ? 50 : 0)
// bullish_score ∈ {0, 50, 100}

if bullish_score >= 50 → CALL
if bullish_score < 50  → PUT
```

Add confidence percentage: `bullish_score`% (e.g. "BULLISH (+100%)" if both agree, "BULLISH (+50%)" if split).

### Fetching Candles

Use the existing `@quadcode-tech/client-sdk-js`. The SDK exposes candle history. Fetch
enough candles to compute indicators (minimum 30 candles). Map timeframe:

- `1m` → 60 seconds
- `5m` → 300 seconds
- `15m` → 900 seconds

### Pair List

Hardcode OTC pairs (these never expire, always tradable):

```
EURUSD-OTC, GBPUSD-OTC, EURJPY-OTC, GBPJPY-OTC,
USDJPY-OTC, AUDUSD-OTC, USDCAD-OTC, EURGBP-OTC
```

Paginate if more than 6 pairs (inline keyboard row limit).

## Files to Create

- `src/analysis.ts` — `analyzePair(ssid, pair, timeframe)` → `{ direction, confidence, reason }`
- `src/menu.ts` — inline keyboard builders for amount, timeframe, pair selection

## Files to Change

- `src/bot.ts` — replace `/trade` handler with interactive wizard flow using Telegraf scenes
  or a simple conversation state machine. After analysis, feed result into existing
  martingale loop (already handles `executeTrade()` with any direction).

## Don't Change

- `src/trade.ts` — `executeTrade()` untouched
- `src/db.ts` — no new tables needed
- `src/protocol.ts` — unchanged

## Acceptance Criteria

1. `/trade` with no args opens interactive flow
2. Three steps: amount → timeframe → pair, all via inline keyboards
3. Analysis runs in 5-10 seconds (fetch candles + compute indicators)
4. Direction auto-selected: BULLISH → CALL, BEARISH → PUT
5. Result displayed before trade: "EURUSD-OTC 5m → BULLISH (+72%) — entering CALL"
6. Existing martingale pipeline runs with auto-direction
7. User can cancel at any step

## Notes

- No persistent bias engine. No Redis. No separate PM2 process.
- Analysis is inline, single SDK connection, happens once per trade trigger.
- If candle fetch fails: show error, abort.
- If insufficient candles (< 30): show "Not enough data for analysis", abort.
