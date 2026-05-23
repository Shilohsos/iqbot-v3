# DIRECTIVE: V4 UI/UX Overhaul — System-Wide Quality Upgrade

## Context

The bot currently works but feels rough. Error messages are technical. Menus are text-heavy. Trade wizard has no progress indicators. Sessions get lost on restart. This directive aims to make the bot feel polished, responsive, and professional — not just functional.

## 1. Error Messages — Human-Friendly Over Entire Codebase

### Current vs Target

| Current | Target |
|---------|--------|
| `❌ Analysis failed: Unknown pair: EURUSD-OTC` | `⚠️ Couldn't read market data for EUR/USD OTC. Try again or pick another pair.` |
| `❌ Balance fetch failed: SDK timeout` | `⏱ IQ Option is taking longer than usual. This happens during high traffic. Try again in 30 seconds.` |
| `❌ Connection timed out` | `🔌 Lost connection to IQ Option. Your account is safe — just tap Try Again.` |
| `❌ Not connected. Use /connect first.` | `🔗 Your IQ Option account isn't linked yet. Tap below to connect it in 60 seconds.` |
| `❌ Session expired — start over.` | `⏰ This session timed out. Let's start fresh 👇` |

### Implementation — `src/errors.ts` (NEW)

```typescript
export const FriendlyErrors: Record<string, string> = {
  'Unknown pair': '⚠️ Couldn\'t read market data for this pair. Try another one.',
  'SDK timeout': '⏱ IQ Option is taking longer than usual. This happens during high traffic.',
  'Connection timed out': '🔌 Lost connection to IQ Option. Your account is safe — try again.',
  'Not connected': '🔗 Your IQ Option account isn\'t linked yet. Tap to connect.',
  'Session expired': '⏰ This session timed out. Let\'s start fresh.',
  'Insufficient balance': '🚫 Not enough funds. Deposit as little as $10 to trade.',
  'No demo balance': '🧪 No practice balance found. Create a demo account on IQ Option first.',
  'No real balance': '💳 No live balance found. Fund your account to start earning.',
  'market is closed': '🔒 This market is closed right now. It opens shortly — try again in a moment.',
  'Not enough data': '📉 Not enough market data yet. Wait a moment and try again.',
};

export function friendlyError(err: unknown, fallback?: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [key, friendly] of Object.entries(FriendlyErrors)) {
    if (msg.includes(key)) return friendly;
  }
  return fallback || `⚠️ Something went wrong. Please try again.`;
}
```

Replace ALL `catch` blocks in `bot.ts` to use `friendlyError()`.

## 2. Loading States — Progress Indicators

### Trade wizard loading flow

Current: user selects pair → blank screen → 20-60s wait → result.

New flow:

```
L7 Analyzing image

🔌 Connecting to IQ Option... [spinner]
  ↓ (after SDK connected)
✅ Connected! Analyzing {pair}...
  ↓ (after analysis)
📊 Analysis complete. Signal found.

L8 image → L9 image → trade results
```

Implementation: Already partially done. The progress message already updates. This phase ensures EVERY step updates the loading message:

1. "Connecting to IQ Option..." → spinner via editMessageText with unicode hourglass
2. "Analyzing market data..." 
3. "Opening trade position..."
4. "Waiting for result... {countdown}"

### Martingale recovery loading

```
Smart Recovery round 2/6
⏳ Opening recovery trade... $20 → $40
```

## 3. Trade Confirmation Dialog

Before executing a trade, show a summary card so users know what's happening:

```
📋 *Trade Summary*

Pair: EUR/USD OTC
Direction: CALL (BUY)
Amount: $25.00
Expiry: 5 minutes
Mode: Demo

[✅ Confirm Trade]  [❌ Cancel]
```

This prevents accidental trades and makes the bot feel more controlled. Add a wizard step between pair selection and execution.

## 4. Session Persistence — Survive PM2 Restarts

### Problem

When the bot restarts (crash, deploy, manual), all in-memory state is lost:
- Active trade wizards
- Onboarding sessions
- User martingale settings
- Balance cache

### Solution already exists but is underused

The `sessions` table already persists wizard state. But martingale settings and balance caches are Map-only.

### Fixes

1. **Martingale settings in DB** — move to `users` table:

```sql
ALTER TABLE users ADD COLUMN mg_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN mg_max_rounds INTEGER NOT NULL DEFAULT 6;
```

Replace `userMartingaleSettings` Map with DB reads/writes.

2. **Session stats in DB** — persist per-session counters:

```sql
ALTER TABLE users ADD COLUMN session_trades INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN session_pnl REAL NOT NULL DEFAULT 0;
```

Replace `sessionStats` Map.

3. **Balance cache in DB** — add cache columns:

```sql
ALTER TABLE users ADD COLUMN balance_cache TEXT;
ALTER TABLE users ADD COLUMN balance_cache_ts TEXT;
```

On restart, if cache is < 5 min old, use it instead of re-fetching.

## 5. Command Improvements

### `/start` — Faster First Paint

Current: `/start` immediately fetches balance (can take 60s). User sees nothing.

Fix: Show the menu INSTANTLY with cached balance. Fetch balance in background, update the message. (Already partially done via balance cache — ensure it's used for /start too.)

### `/pairs` — More Useful

Current: Shows raw actives from Turbo options.

Improvement: Filter to only show OTC pairs. Show if each pair is currently tradable (open/closed). Show available timeframes for each pair.

### New `/status` — Quick Health Check

```
🟢 10x Bot Online

Your Tier: ⚡ PRO
IQ Option: ✅ Connected
Balance: Practice $4,371 | Live $0
Active Trades: 0
Today's PnL: +$45.82
```

### New `/support` — Direct Admin Link

Sends admin contact link with context.

## 6. Menu Redesign — Visual Polish

### Main Menu (sendStartMenu)

```
┌─────────────────────────┐
│     ⚡ 10x — Home       │
│                         │
│  Tier: PRO Trader       │
│  Balance: $4,371 DEMO   │
│                         │
│  Today: 12 trades       │
│         +$145.20        │
│                         │
│  [🎯 Trade Now]         │
│  [📊 Stats] [📆 History]│
│  [🏆 Leaderboard]       │
│  [⚙️ Settings]          │
│  [❓ Help]  [💬 Support] │
└─────────────────────────┘
```

Use unicode box drawing characters for a more polished look. Or keep it clean and modern — whatever Claude deems best. The key is consistency and visual clarity.

### Tier badges

```
🧪 Demo Trader
⚡ Pro Trader  
👑 Master Trader
```

## 7. Payment/Account Prompts

### Insufficient balance prompt (already exists but enhance)

When a trade fails due to balance:

```
🚫 *Insufficient Balance*

Your live account needs at least $10 to trade.

Current balance: $3.50
Missing: $6.50

[💳 Deposit Now]  [🔄 Trade Demo Instead]
```

### Demo upsell (after demo win)

```
🎮 You just won +$8.20 on Demo.

That would've been REAL MONEY on a live account.

→ $8.20 in your pocket
→ Withdrawable in 24h
→ 49 more wins like this covers rent

[🔋 Switch to Live]  [🔄 Keep Testing]
```

Improve existing `showDemoUpsell()` with better copy and stronger CTA.

## 8. Error Recovery — Retry Logic

### Automatic retry for transient failures

Some errors are temporary (network blip, IQ Option throttle). Add retry for:

- SDK connection timeout → retry once after 5s
- Balance fetch timeout → use 5-min cache if available
- Trade result timeout → keep waiting, don't abort

Implementation in `src/retry.ts` (NEW):

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number; onRetry?: (attempt: number, err: unknown) => void }
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 2;
  const delayMs = options.delayMs ?? 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      options.onRetry?.(attempt, err);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Unreachable');
}
```

Use in trade execution and balance fetching.

## 9. Admin UX Improvements

### Broadcast preview

Before sending a broadcast, show a preview:

```
📤 *Broadcast Preview*

"message text here..."

→ Sending to 47/67 users
→ Auto-delete: 1 hour
→ Button: "Trade Now"

[✅ Send]  [❌ Cancel]
```

### User detail card

When admin searches a user, show a rich card:

```
👤 *User: @shiloh_is_10xing*

Telegram ID: 16156XXXXX
IQ User ID: 18251XXXX
Status: ✅ Approved
Tier: ⚡ PRO
Joined: 12 days ago

Trades: 89 (Win rate: 72%)
Total PnL: +$1,247.30

[⏸️ Pause] [🗑️ Remove] [✉️ Message] [🔑 Change Tier]
```

### Giveaway management dashboard

```
🎁 *Giveaway Manager*

Active (2):
1. "Weekend Warriors" — Top 10 traders — 32 participants — ends in 6h
2. "Newbie Boost" — New users only — 15 participants — ends in 2h

Scheduled (1):
3. "Monday Motivation" — starts in 14h

[➕ Create] [✅ Pick Winners] [📋 View All] [🔙 Back]
```

## 10. Typing Indicators

Send `ctx.telegram.sendChatAction(chatId, 'typing')` during:
- Trade analysis (after pair selected)
- Balance fetching
- Giveaway winner selection

This lets users know the bot is working, not frozen.

## 11. Structured Logging

Replace `console.log` with a simple logger that timestamps and categorizes:

```typescript
// src/logger.ts (NEW)
export const logger = {
  info: (component: string, msg: string) => 
    console.log(`[${new Date().toISOString()}] [INFO] [${component}] ${msg}`),
  warn: (component: string, msg: string) => 
    console.log(`[${new Date().toISOString()}] [WARN] [${component}] ${msg}`),
  error: (component: string, msg: string, err?: unknown) => 
    console.error(`[${new Date().toISOString()}] [ERROR] [${component}] ${msg}`, err || ''),
  trade: (action: string, pair: string, telegramId: number, detail?: string) =>
    console.log(`[${new Date().toISOString()}] [TRADE] [${telegramId}] ${action} ${pair}${detail ? ' ' + detail : ''}`),
};
```

Use systematically across all files. This feeds the Phase 5 monitor with structured, parseable logs.

## 12. Files Summary

| File | Action |
|------|--------|
| `src/errors.ts` | **NEW** — friendly error messages |
| `src/retry.ts` | **NEW** — retry logic |
| `src/logger.ts` | **NEW** — structured logging |
| `src/bot.ts` | Rewrite error messages, add typing indicators, improve menus, confirmation dialog |
| `src/menu.ts` | Tier-aware keyboards with visual polish |
| `src/ui/user.ts` | Redesigned startKeyboard, tier badges |
| `src/ui/admin.ts` | Broadcast preview, user detail cards, giveaway dashboard |
| `src/db.ts` | Add session persistence columns, martingale settings in users |
| `src/trade.ts` | Retry logic on transient failures |

---

**Deploy:** `npx tsc && pm2 restart iqbot-v3-bot`

**Quality gates:**
- All `catch` blocks use `friendlyError()`
- All `console.log` replaced with `logger.*`
- Typing indicators on all slow operations
- Session state survives PM2 restart
- Trade confirmation dialog works
