# Section 3: Auto-Martingale (6 Rounds)

**Date:** 2026-05-10
**Status:** Section 2 ✅ confirmed
**Stack:** TypeScript only
**Builds on:** Section 2 (trade.ts, bot.ts, db.ts)

---

## Goal

After a LOSS, automatically double the stake and retry — up to 6 rounds. On any WIN, stop and show summary. If all 6 rounds lose, stop and report total loss.

**No user input between rounds.** The bot trades continuously until WIN or round 6.

---

## Behavior

```
User: /trade EURUSD-OTC put 10

Round 1: 💔 LOSS — doubling to $20...
Round 2: 💔 LOSS — doubling to $40...
Round 3: 💚 WIN! +$74.40

📊 Martingale complete:
  Rounds: 3
  Total PnL: +$4.40
```

Or if all 6 lose:

```
Round 1-6: all LOSS

💔 Martingale exhausted (6 rounds):
  Total Loss: -$630.00
```

---

## Files to modify

| File | Change |
|---|---|
| `src/bot.ts` | `/trade` flow changed — confirmation message before starting, then kick off martingale |
| `src/trade.ts` | New `executeMartingale()` function |
| `src/db.ts` | Add `martingale_run_id` column to track which trades belong to same run |

---

## Technical Specification

### `src/trade.ts` — `executeMartingale()`

```typescript
export interface MartingaleResult {
  rounds: number;
  status: 'WIN' | 'EXHAUSTED';
  totalPnl: number;
  trades: TradeResult[];
}

export async function executeMartingale(
  ssid: string,
  trade: TradeRequest,
  maxRounds: number = 6,
): Promise<MartingaleResult> {
  const trades: TradeResult[] = [];
  let currentAmount = trade.amount;
  let totalPnl = 0;

  for (let round = 1; round <= maxRounds; round++) {
    const roundTrade: TradeRequest = {
      pair: trade.pair,
      direction: trade.direction,
      amount: currentAmount,
    };

    const result = await executeTrade(ssid, roundTrade);

    // Inject round info for display
    (result as any).round = round;
    (result as any).maxRounds = maxRounds;
    trades.push(result);

    totalPnl += result.pnl - (result.status === 'LOSS' ? roundTrade.amount : 0);

    if (result.status === 'WIN' || result.status === 'TIE') {
      return { rounds: round, status: 'WIN', totalPnl, trades };
    }

    if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
      return { rounds: round, status: 'EXHAUSTED', totalPnl, trades };
    }

    // LOSS — double for next round
    currentAmount = currentAmount * 2;
  }

  return { rounds: maxRounds, status: 'EXHAUSTED', totalPnl, trades };
}
```

### `src/bot.ts` — Updated `/trade` Command

```typescript
// /trade <pair> <direction> <amount>
bot.command('trade', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 3) {
    return ctx.reply(
      'Usage: /trade <pair> <direction> <amount>\n' +
      'Example: /trade EURUSD-OTC put 50\n\n' +
      'Auto-martingale: 6 rounds, doubles on loss.'
    );
  }

  const [rawPair, rawDir, amountStr] = args;
  const direction = rawDir.toLowerCase();
  const amount = parseFloat(amountStr);

  if (direction !== 'call' && direction !== 'put') {
    return ctx.reply('Direction must be "call" or "put".');
  }
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('Amount must be a positive number.');
  }

  const trade: TradeRequest = {
    pair: rawPair.toUpperCase(),
    direction: direction as 'call' | 'put',
    amount,
  };

  // Show confirmation
  await ctx.reply(
    `🎯 *Martingale Trade*\n\n` +
    `Pair: \`${trade.pair}\`\n` +
    `Direction: *${trade.direction.toUpperCase()}*\n` +
    `Base: $${amount}\n` +
    `Max exposure: $${amount * 63}\n\n` +
    `_6 rounds. Auto-doubles on loss._`,
    { parse_mode: 'Markdown' }
  );

  // Run all rounds
  try {
    const result = await executeMartingale(IQ_SSID!, trade, 6);

    // Report each round as it happens (handled inside the martingale loop)
    await reportMartingaleResult(ctx, result);
  } catch (err: any) {
    await ctx.reply(`❌ Martingale failed: ${err.message}`);
  }
});
```

Wait — the issue with the above approach: `executeMartingale()` runs ALL rounds synchronously and then reports at the end. The user sees nothing for 6+ minutes.

**Better approach:** report each round from within the bot command, round by round.

```typescript
bot.command('trade', async (ctx) => {
  // ... parse args, create trade ...

  await ctx.reply(
    `🎯 *Martingale starting*\n` +
    `Pair: \`${trade.pair}\` *${trade.direction.toUpperCase()}*\n` +
    `Base: $${amount} | Max: $${amount * 63}\n\n` +
    `_Round 1 starting..._`,
    { parse_mode: 'Markdown' }
  );

  let currentAmount = amount;
  let totalPnl = 0;
  const MAX_ROUNDS = 6;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const roundTrade: TradeRequest = {
      pair: trade.pair,
      direction: trade.direction,
      amount: currentAmount,
    };

    const result = await executeTrade(IQ_SSID!, roundTrade);

    // Save to DB
    insertTrade({
      pair: result.pair,
      direction: result.direction,
      amount: result.amount,
      status: result.status,
      pnl: result.pnl,
      trade_id: result.tradeId,
      error: result.error,
    });

    const roundPnl = result.status === 'WIN' ? result.pnl : -currentAmount;
    totalPnl += roundPnl;

    // Report round result
    const emoji = result.status === 'WIN' ? '💚' : result.status === 'LOSS' ? '💔' : result.status === 'TIE' ? '⚪' : '⚠️';
    let roundMsg = `${emoji} *Round ${round}/${MAX_ROUNDS}*\n`;
    roundMsg += `Amount: $${currentAmount} | `;
    if (result.status === 'WIN') roundMsg += `Profit: +$${result.pnl.toFixed(2)}`;
    else if (result.status === 'LOSS') roundMsg += `Loss: -$${currentAmount.toFixed(2)}`;
    else roundMsg += result.status;

    if (result.status === 'WIN' || result.status === 'TIE') {
      roundMsg += `\n\n✅ *Martingale complete*\nTotal PnL: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`;
      await ctx.reply(roundMsg, { parse_mode: 'Markdown' });
      return;
    }

    if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
      roundMsg += `\n\n⚠️ *Martingale stopped*\n${result.error || 'Trade failed'}`;
      await ctx.reply(roundMsg, { parse_mode: 'Markdown' });
      return;
    }

    // LOSS — show and continue
    if (round < MAX_ROUNDS) {
      currentAmount = currentAmount * 2;
      roundMsg += `\n\n🔄 Doubling to $${currentAmount.toFixed(2)} for round ${round + 1}...`;
    }

    await ctx.reply(roundMsg, { parse_mode: 'Markdown' });

    if (round === MAX_ROUNDS) {
      await ctx.reply(
        `💔 *Martingale exhausted* — all ${MAX_ROUNDS} rounds lost.\n` +
        `Total loss: -$${Math.abs(totalPnl).toFixed(2)}`,
        { parse_mode: 'Markdown' }
      );
    }
  }
});
```

### `src/db.ts` — No Schema Change Needed

The existing `trades` table is sufficient. Each round is a separate row. To group them as a martingale run, add a `martingale_run` column:

```sql
ALTER TABLE trades ADD COLUMN martingale_run TEXT;
```

A run ID (UUID or timestamp) shared across all rounds in the same martingale sequence. This is optional — the directive code above doesn't require it, but Claude can add it if clean.

---

## Verification Checklist

- [ ] `/trade EURUSD-OTC put 10` starts with confirmation message showing max exposure
- [ ] Round 1 executes and result displays
- [ ] On LOSS: automatically doubles and shows "Doubling to $20 for round 2..."
- [ ] Round 2 executes without user input
- [ ] On WIN: shows "Martingale complete" with total PnL
- [ ] `/history` shows all rounds as separate trades
- [ ] 6 consecutive losses shows "Martingale exhausted"
- [ ] Stats in `/start` reflect all rounds

---

## Notes for Claude

1. **Round-by-round reporting is critical** — user must see each round's result in real-time. Don't batch all rounds into one message at the end.
2. **Keep `executeTrade()` unchanged** — the martingale loop calls it per round. No need to modify the core trade function.
3. **Max exposure** — base amount × (2⁶ - 1) = base × 63. Show this in the confirmation message.
4. **If ERROR or TIMEOUT mid-sequence** — stop immediately. Don't continue doubling into a broken connection.
5. **TIE counts as stop** — stake is refunded, treat as a WIN for stopping purposes.
