# Issue 38: Dynamic top picks — auto-refreshed pair win rates every 2 hours

## Current behavior
The "Top picks ready" message in the `tf:` handler is hardcoded with fake win rates:
```
🏆 EUR/GBP OTC — Win rate ≈83%
✅ EUR/USD OTC — Win rate ≈78%
✅ AUD/USD OTC — Win rate ≈70%
✅ USD/CAD OTC — Win rate ≈66%
```

## Required
Calculate real win rates from trade history. Show 5 pairs in specific win rate tiers:
1. **1 pair** with win rate ≥ 90%
2. **2 pairs** with win rate ≥ 80%
3. **1 pair** with win rate ≥ 70%
4. **1 pair** with win rate < 70%

Auto-refresh every 2 hours.

## Implementation

### New file: src/topPicks.ts (or add to src/db.ts)

Create a function to calculate win rates per pair using the circle-counting method (same as Issue 32):

```typescript
export interface PairWinRate {
    pair: string;
    winRate: number;
    totalCircles: number;
}

export function calculatePairWinRates(): PairWinRate[] {
    const sql = `
        WITH circle_results AS (
            SELECT martingale_run,
              (SELECT status FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS final_status,
              (SELECT pair FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS pair
            FROM trades t1 WHERE martingale_run IS NOT NULL GROUP BY martingale_run
            UNION ALL
            SELECT CAST(id AS TEXT), status, pair FROM trades WHERE martingale_run IS NULL
        )
        SELECT pair,
               ROUND(CAST(SUM(CASE WHEN final_status = 'WIN' THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1) * 100, 1) AS winRate,
               COUNT(*) AS total
        FROM circle_results
        WHERE pair IS NOT NULL
        GROUP BY pair
        ORDER BY winRate DESC
    `;
    // ... returns array of { pair, winRate, total }
}
```

### Selection logic

```typescript
export function selectTopPicks(rates: PairWinRate[]): PairWinRate[] {
    const picks: PairWinRate[] = [];

    // 1. Pick the best pair ≥ 90%
    const top90 = rates.find(r => r.winRate >= 90);
    if (top90) picks.push(top90);

    // 2. Pick 2 pairs ≥ 80% (skip already picked)
    const top80 = rates.filter(r => !picks.includes(r) && r.winRate >= 80).slice(0, 2);
    picks.push(...top80);

    // 3. Pick 1 pair ≥ 70%
    const top70 = rates.find(r => !picks.includes(r) && r.winRate >= 70);
    if (top70) picks.push(top70);

    // 4. Pick 1 pair < 70% (or lowest remaining)
    const below70 = rates.find(r => !picks.includes(r) && r.winRate < 70);
    if (below70) picks.push(below70);

    // Fill remaining slots with best available if not enough
    const remaining = rates.filter(r => !picks.includes(r));
    while (picks.length < 5 && remaining.length > 0) {
        picks.push(remaining.shift()!);
    }

    return picks;
}
```

### Cached refresh in bot.ts

**In src/bot.ts**, add:

```typescript
import { calculatePairWinRates, selectTopPicks, type PairWinRate } from './db.js';  // or new file

// Cached top picks, refreshed every 2 hours
let cachedTopPicks: PairWinRate[] = [];
let lastPicksRefresh = 0;
const PICKS_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours

function getTopPicks(): PairWinRate[] {
    const now = Date.now();
    if (cachedTopPicks.length === 0 || now - lastPicksRefresh > PICKS_REFRESH_MS) {
        const rates = calculatePairWinRates();
        cachedTopPicks = selectTopPicks(rates);
        lastPicksRefresh = now;
        console.log('[topPicks] refreshed:', cachedTopPicks.map(p => `${p.pair}=${p.winRate}%`).join(', '));
    }
    return cachedTopPicks;
}
```

Or use `setInterval` for auto-refresh:
```typescript
// Auto-refresh top picks every 2 hours
setInterval(() => {
    const rates = calculatePairWinRates();
    cachedTopPicks = selectTopPicks(rates);
    lastPicksRefresh = Date.now();
}, PICKS_REFRESH_MS);
```

### Update tf: handler message

In the `tf:` handler (line 754-758), replace the hardcoded message with dynamic content:

```typescript
const picks = getTopPicks();
const medals = ['🏆', '🥇', '🥈', '🥉', '4️⃣'];
let picksMsg = 'Top picks ready 🎯\n\nHighest chance to win right now:\n\n';
picks.forEach((p, i) => {
    picksMsg += `${medals[i] ?? `${i + 1}.`} ${p.pair} — Win rate ≈${p.winRate}%\n`;
});
picksMsg += '\n🚀 Make your choice below 👇';
```

Then use `picksMsg` in the `editMessageText` call instead of the hardcoded string.

### Acceptance Criteria
- [ ] Win rates calculated from actual trade history using circle counting
- [ ] 5 pairs shown with win rate tiers (90%+, 80%+ x2, 70%+, <70%)
- [ ] Auto-refreshes every 2 hours on schedule
- [ ] Refreshes on bot startup
- [ ] Gracefully handles pairs with no trade data yet (falls back to default OTC list)
- [ ] All existing pair selection, pagination, and trading flows unchanged
