# Section 2: History + Balance

**Date:** 2026-05-10
**Status:** Section 1 ✅ confirmed
**Stack:** TypeScript only
**Builds on:** Section 1 (trade.ts, bot.ts, protocol.ts)

---

## Goal

After every trade, store the result in SQLite. Add `/history` and `/balance` commands. Single-SSID, no accounts table yet.

## Files to modify/create

```
iqbot-v3/
├── src/
│   ├── bot.ts          # Add /history, /balance commands
│   ├── trade.ts        # Auto-save result to DB after executeTrade()
│   ├── protocol.ts     # Unchanged
│   └── db.ts           # NEW — SQLite wrapper
├── .env                # Unchanged
├── package.json        # Add better-sqlite3
```

## Technical Specification

### `src/db.ts` — SQLite Wrapper

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve('iqbot-v3.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Auto-create table on first run
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,
    pnl REAL NOT NULL DEFAULT 0,
    trade_id INTEGER,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

export interface TradeRecord {
  id?: number;
  pair: string;
  direction: string;
  amount: number;
  status: 'WIN' | 'LOSS' | 'TIE' | 'TIMEOUT' | 'ERROR';
  pnl: number;
  trade_id?: number;
  error?: string;
  created_at?: string;
}

export function insertTrade(t: TradeRecord): void {
  const stmt = db.prepare(`
    INSERT INTO trades (pair, direction, amount, status, pnl, trade_id, error)
    VALUES (@pair, @direction, @amount, @status, @pnl, @trade_id, @error)
  `);
  stmt.run({
    pair: t.pair,
    direction: t.direction,
    amount: t.amount,
    status: t.status,
    pnl: t.pnl,
    trade_id: t.trade_id ?? null,
    error: t.error ?? null,
  });
}

export function getRecentTrades(limit: number = 10): TradeRecord[] {
  const rows = db.prepare(`
    SELECT * FROM trades ORDER BY created_at DESC LIMIT ?
  `).all(limit) as any[];
  return rows;
}

export function getTradeStats(): { total: number; wins: number; losses: number; ties: number; totalPnl: number } {
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN status = 'TIE' THEN 1 ELSE 0 END) as ties,
      SUM(pnl) as totalPnl
    FROM trades
  `).get() as any;
  return {
    total: row.total || 0,
    wins: row.wins || 0,
    losses: row.losses || 0,
    ties: row.ties || 0,
    totalPnl: row.totalPnl || 0,
  };
}
```

### `src/trade.ts` — Add DB Save

After `executeTrade()` returns the result, call `insertTrade()`:

```typescript
// At the top of trade.ts, add:
import { insertTrade } from './db.js';

// Inside executeTrade(), right before returning:
const result = await waitForResult(positions, option.id, instrument.expirationSize + 90);
const tradeResult = { ...result, tradeId: option.id, pair: trade.pair, direction: trade.direction, amount: trade.amount };

// Save to DB (fire-and-forget — don't block result delivery for DB write)
insertTrade({
  pair: tradeResult.pair,
  direction: tradeResult.direction,
  amount: tradeResult.amount,
  status: tradeResult.status,
  pnl: tradeResult.pnl,
  trade_id: tradeResult.tradeId,
  error: tradeResult.error,
});

return tradeResult;
```

### `src/bot.ts` — Add Commands

```typescript
import { getRecentTrades, getTradeStats } from './db.js';

// /history — last 10 trades
bot.command('history', async (ctx) => {
  const trades = getRecentTrades(10);
  if (trades.length === 0) {
    return ctx.reply('No trades yet. Use /trade to get started.');
  }

  let msg = '📋 *Recent Trades*\n\n';
  for (const t of trades) {
    const emoji = t.status === 'WIN' ? '💚' : t.status === 'LOSS' ? '💔' : t.status === 'TIE' ? '⚪' : '⚠️';
    const pnlStr = t.status === 'WIN' ? `+$${t.pnl.toFixed(2)}` : t.status === 'LOSS' ? `-$${t.amount.toFixed(2)}` : '$0.00';
    msg += `${emoji} \`${t.pair}\` *${t.direction.toUpperCase()}* $${t.amount} → ${pnlStr}\n`;
    if (t.error) msg += `  _${t.error}_\n`;
  }

  const stats = getTradeStats();
  msg += `\n📊 *Stats*: ${stats.total} trades | ${stats.wins}W / ${stats.losses}L / ${stats.ties}T | PnL: ${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /balance — fetch live IQ Option balance
bot.command('balance', async (ctx) => {
  try {
    const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(IQ_SSID!), { host: IQ_HOST });
    try {
      const balances = await sdk.balances();
      const all = balances.getBalances();
      const demo = all.find(b => b.type === BalanceType.Demo);
      const real = all.find(b => b.type === BalanceType.Real);

      let msg = '💰 *Balances*\n\n';
      if (demo) msg += `🎮 Practice: $${demo.amount.toFixed(2)}\n`;
      if (real) msg += `💎 Live: $${real.amount.toFixed(2)}\n`;
      if (!demo && !real) msg += 'No balances found.';

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    } finally {
      await sdk.shutdown();
    }
  } catch (err: any) {
    await ctx.reply(`❌ Balance fetch failed: ${err.message}`);
  }
});
```

Also update `/start` to show stats:

```typescript
bot.command('start', async (ctx) => {
  const stats = getTradeStats();
  let msg = '🤖 *IQ Bot V3*\n\n';
  msg += 'Trade directly from Telegram:\n';
  msg += '`/trade EURUSD-OTC put 50`\n\n';
  msg += `📊 *Stats*: ${stats.total} trades | PnL: ${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}\n\n`;
  msg += '/history — Recent trades\n';
  msg += '/balance — Live balance\n';
  msg += '_Section 2: History + Balance_';
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});
```

### `package.json` — Add Dependency

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

## Verification Checklist

- [ ] `/start` shows trade stats
- [ ] `/trade EURUSD-OTC put 10` completes normally
- [ ] `/history` shows the trade with WIN/LOSS/TIE
- [ ] `/history` shows stats footer (W/L/T breakdown + PnL)
- [ ] `/balance` shows practice and live balances
- [ ] Multiple trades in `/history` are ordered newest first
- [ ] DB file exists at `/root/iqbot-v3/iqbot-v3.db`

## Notes for Claude

1. **better-sqlite3** is synchronous — no async/await needed. Fast, simple.
2. **Insert after result** — don't block the Telegram reply for DB writes. Fire-and-forget is fine at this scale.
3. **Balance command creates a fresh SDK connection** — the same pattern as trade but fetch-only.
4. **Keep Section 1 code intact** — add imports and save, don't restructure.
5. **No migration needed** — CREATE TABLE IF NOT EXISTS handles first run.
