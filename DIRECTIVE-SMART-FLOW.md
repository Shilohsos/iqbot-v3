# DIRECTIVE — Smart Flow (✦ Your setup for this session)

## Context

10x AI is a premium personal wealth tool. Users currently enter trading through the manual wizard. We want a recommendation-driven entry: when a user opens the Private Trader product, show a personalized setup card first — a live balance read plus suggested stake, assets and timeframe — with a one-tap Start or a "Choose manually" fallback to the existing wizard. It is **recommendation only**: it never executes a trade, never pushes messages on its own, and the manual wizard remains fully available.

## Requirements

### 1. Entry point

- The Private Trader menu button (currently opens the manual AI Trading wizard) opens Smart Flow first.
- The Smart Flow card includes a **Choose manually** button that opens the existing wizard unchanged.
- All existing wizard callbacks and handler names stay intact — Smart Flow is an added layer, not a rewrite.

### 2. The recommendation card

One clean card. Symbols only, no decorative emojis, luxury voice:

```
✦ Your setup for this session

Balance: $1,234.56 · Practice $8,857.80

Product: ⟡ Private Trader
Suggested stake: $62 per trade
Suggested assets: EURUSD-OTC · XAUUSD-OTC · GBPJPY-OTC
Timeframe: 1m

[✦ Start with this setup] [⟡ Choose manually]
```

Rules:
- Money renders with thousands separators (`$1,234.56` not `$1234.56`) and the user's account currency symbol.
- An honest-risk line is allowed ("Nothing is guaranteed") — it is part of the brand voice.
- If the user is below the live minimum, the card shows the practice/Signals path with a Fund Account button (deposit URL) instead of a live stake.

### 3. Scan rules — on open only, no background

- When the user opens the flow: if there is **no cached scan**, the cache is **older than 6 hours**, or the **live balance dropped ≥50%** since the last scan → run a fresh scan.
- Otherwise reuse the cached recommendation (no SDK call, instant render).
- Live balance comes from the existing live-balance helper (SDK, real + practice). SDK failures fall back to the cached snapshot with a note.

### 4. Recommendation logic

- **Live balance < $100** → recommend practice mode / Signals (No-charge positioning) + Fund Account button. No live stake.
- **$100–$499** → ⟡ Private Trader live. Suggested stake = **5% of live balance**. Suggested assets = the user's 3 most-traded pairs from the last 7 days (fallback: EURUSD-OTC, XAUUSD-OTC, GBPJPY-OTC). Timeframe = the user's most-used timeframe (fallback 1m).
- **$500+** → same as above, with a product choice line: ⟡ Private Trader or ✦ Autopilot (default Private Trader; note Autopilot is hands-free).
- **Suggested assets must be currently open** — a closed OTC pair is skipped and never suggested. Follow the same actives/`canBeBoughtAt` market-awareness pattern already used elsewhere in the codebase (closed pairs rotate out; if all suggested pairs are closed, fall back to currently-open defaults).

### 5. Data

- New table `smart_flow_cache`:
  - `telegram_id` INTEGER PRIMARY KEY
  - `last_scan_at` TEXT (ISO)
  - `balance_live` REAL
  - `balance_demo` REAL
  - `recommendations` TEXT (JSON)
  - `updated_at` TEXT (ISO)
- Use the existing db.ts patterns (`CREATE TABLE IF NOT EXISTS` + PRAGMA auto-migration so existing databases get the table on boot).
- User history comes from the `trades` table (`telegram_id`, `created_at`, `pair`, `timeframe_sec`) — most frequent pair + timeframe in the last 7 days.

### 6. Patterns to follow (established conventions)

- **Symbols only**: ✦ ⟡ ❖ · ◆ ─. Functional status emojis only (🟢 🔴 ⚪ 🟡 ⚠️ ✅). No decorative emojis anywhere in user-facing text.
- **Luxury word map**: No-charge (not free), Private Trader (not AI Trading), Autopilot (not Auto Trading), finest/premium (not best), effortless (not easy), Exclusive (not Limited).
- **Maintenance gate aware**: when `maintenance_gate=1`, only `MAINTENANCE_ALLOWED_IDS` (6622587977 + the admin) receive Smart Flow. Duplicate the allowlist locally in the new module, matching how checkin.ts mirrors it (bot.ts does not export module-private constants).
- New module `src/smart-flow.ts`; wire it in bot.ts. Keep the module self-contained like checkin.ts.
- Compile note for the new module after your main build: run
  `npx tsc --pretty false --target es2022 --module es2022 --moduleResolution bundler --outDir dist --rootDir src --skipLibCheck --esModuleInterop src/smart-flow.ts`
  (the default build copies bot.ts and compiles core modules only).

### 7. Out of scope

- No auto-execution of trades. No background/push scanning (nothing fires unless the user opens the flow).
- No changes to Autopilot / Auto Trading. No changes to Signals. No changes to the manual wizard's behavior.

## Verification

1. `npm run build` succeeds; `node --check dist/smart-flow.js` passes.
2. No decorative emojis in the new module (symbols only).
3. Manual test path: with maintenance gate on, the allowlisted IDs see Smart Flow; opening the flow twice within 6h reuses the cache; a −50% balance drop triggers a fresh scan.
4. Closed OTC pairs never appear in suggested assets.
