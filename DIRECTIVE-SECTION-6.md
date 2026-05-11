# Section 6: Telegram UI Shells (User + Admin)

## Goal

Build the Telegram UI structure — no features, just navigation shells.
Two separate interfaces: User UI and Admin UI. Both are empty placeholders
that will be populated in later sections.

## User UI

### Entry: `/start`

Replace current `/start` text with an inline keyboard menu:

```
🤖 *IQ Bot V3*

📊 *Stats*: 29 trades | PnL: +$3454.88

[ 📊 Trade ]  [ 📈 History ]
[ 💰 Balance ]  [ ⚙️ Settings ]
```

Buttons:
- `📊 Trade` → triggers `/trade` wizard (existing flow)
- `📈 History` → triggers `/history` (existing flow)
- `💰 Balance` → triggers `/balance` (existing flow)
- `⚙️ Settings` → placeholder: "Settings coming soon."

### `/trade`, `/history`, `/balance`

Keep existing command handlers. Add a "Back" button to each that returns to `/start` menu.

## Admin UI

### Entry: `/admin`

Gated to your Telegram ID only (hardcoded). All others get "Access denied."

```
🛡️ *Admin Panel*

[ 👥 Users ]  [ 📢 Broadcast ]
[ 📊 Stats ]  [ 🔑 Tokens ]
[ 🔙 Back ]
```

Buttons (all placeholder):
- `👥 Users` → "User management coming soon."
- `📢 Broadcast` → "Broadcast system coming soon."
- `📊 Stats` → "Admin statistics coming soon."
- `🔑 Tokens` → "Token management coming soon."
- `🔙 Back` → returns to `/start` menu

### Constants

```typescript
const ADMIN_ID = 1615652240; // Your Telegram ID
```

## Files to Create

- `src/ui/admin.ts` — admin keyboard builder + placeholder handlers
- `src/ui/user.ts` — user keyboard builder + placeholder handlers

## Files to Change

- `src/bot.ts` — replace `/start` with keyboard menu, add `/admin` command, wire UI modules

## Don't Change

- `src/trade.ts`, `src/analysis.ts`, `src/menu.ts`, `src/db.ts` — unchanged

## Acceptance Criteria

1. `/start` shows inline keyboard with 4 buttons
2. `📊 Trade` → opens `/trade` wizard (full flow works)
3. `📈 History` → shows recent trades
4. `💰 Balance` → shows balances
5. `⚙️ Settings` → shows placeholder message
6. `/admin` from your ID → shows admin keyboard with 4 placeholder buttons
7. `/admin` from any other ID → "Access denied"
8. All admin buttons show placeholder messages
9. "Back" navigation works between admin → user menu
