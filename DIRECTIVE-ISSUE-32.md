# Issue 32: Admin top trader edit + martingale circle counting

## Part A: Admin — Edit manually added top trader amounts

### Current behavior
- Admin → Top Traders → shows leaderboard with "➕ Manual Add" button
- `addLeaderboardManual()` creates entries with `manual_profit` set and `auto_profit = 0`
- `updateLeaderboardAuto()` only touches entries where `manual_profit IS NULL`
- No way to edit an existing manually-added entry's profit

### Required
Add an "Edit Amount" button next to each manually added entry in the admin leaderboard. Only entries with `manual_profit NOT NULL` (manually added) should be editable — auto-generated entries should NOT be editable.

### Files to change

**`src/db.ts`** — add:
- `getLeaderboardDetailed()` — returns full row data including `manual_profit`, `auto_profit`, `telegram_id`, `id`
- `updateLeaderboardManual(telegramId: number, profit: number): void` — updates `manual_profit` for existing manual entry

**`src/ui/admin.ts`** — update:
- `topTradersAdminKeyboard()` — needs to show dynamic edit buttons per manually-added entry, plus existing "Manual Add" and "Back" buttons
- New function to generate edit buttons from leaderboard data

**`src/bot.ts`** — add:
- `bot.action('admin:edit_trader', async ctx => { ... })` — enters admin session asking for Telegram ID of entry to edit
- Text handler for `edit_trader_profit` — receives new profit amount, calls `updateLeaderboardManual()`
- `admin:top_traders` handler — pass detailed data to keyboard so edit buttons appear per manual entry

### Design
When admin clicks "Top Traders", show:
```
🏆 Today's Leaderboard

🥇 662****** — +$726,389.00  [Edit]  ← manual entry, button to edit
🥈 173****** — +$183.00      [Edit]  ← manual entry, button to edit
🥉 662****** — +$2,520.30            ← auto entry, no edit button
```

Buttons at bottom: [➕ Manual Add] [🔙 Admin Menu]

Clicking [Edit] on a manual entry prompts: "Enter new profit amount for user `662******`:"
Then updates the `manual_profit` field and shows confirmation.

---

## Part B: Martingale circle-based trade counting

### Current behavior
Each individual trade round is counted as a separate entry.
Example — a martingale circle with 4 rounds (LOSS $25, LOSS $50, LOSS $100, WIN $200):
- Stats shows: 4 trades | 1W / 3L / 0T
- Should show: 1 trade | 1W / 0L / 0T (because the circle closed as a win)

### Required
All trades sharing the same `martingale_run` GROUP ID form one "circle". The circle result is determined by the **last trade's status** in that run. Only the circle-level result counts for W/L/T.

Trades with NULL `martingale_run` (individual singleton trades) count as one each.

### PnL calculation
PnL remains the sum of all individual trades in the run (which is correct already — the final round recovers losses + profit). The `totalPnl` field doesn't need to change, only the W/L/T counts.

### Files to change

**`src/db.ts`** — modify:
- `getTradeStats()` — change SQL to group by `martingale_run`:
  ```sql
  -- For each martingale_run, take the LAST trade's status as the circle result
  -- Singleton trades (martingale_run IS NULL) count individually
  WITH circle_results AS (
    SELECT
      martingale_run,
      -- The last trade by created_at determines the circle result
      (SELECT status FROM trades t2
       WHERE t2.martingale_run = t1.martingale_run
       ORDER BY created_at DESC LIMIT 1) AS final_status,
      telegram_id
    FROM trades t1
    WHERE martingale_run IS NOT NULL
    GROUP BY martingale_run
    UNION ALL
    -- Singleton trades (no martingale run) count individually
    SELECT
      CAST(id AS TEXT) AS martingale_run,
      status AS final_status,
      telegram_id
    FROM trades
    WHERE martingale_run IS NULL
  )
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN final_status = 'WIN'  THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN final_status = 'LOSS' THEN 1 ELSE 0 END) AS losses,
    SUM(CASE WHEN final_status = 'TIE'  THEN 1 ELSE 0 END) AS ties,
    -- Total PnL is still sum of all individual trades
    (SELECT COALESCE(SUM(pnl), 0) FROM trades ${whereClause}) AS totalPnl
  FROM circle_results cr
  ${whereTelegramId ? 'WHERE cr.telegram_id = ?' : ''}
  ```

- `getRecentTrades()` — should group by `martingale_run` and show circle-level entries, not individual rounds. Show the date, pair, result, and PnL for the circle. The `getRecentTrades` function needs to be updated to return circles instead of individual trade rows.

### Acceptance Criteria
- [ ] Admin: Edit button appears only on manually-added top trader entries
- [ ] Admin: Clicking Edit prompts for new amount, updates `manual_profit` in DB
- [ ] History: Shows circle-level entries (e.g., "EUR/USD OTC — WIN +$372.00" instead of 4 individual rounds)
- [ ] Stats: A 4-round martingale that wins shows 1W / 0L / 0T with correct total PnL
- [ ] Singleton trades (no martingale) still count individually
- [ ] Backward compatible — existing data works correctly
