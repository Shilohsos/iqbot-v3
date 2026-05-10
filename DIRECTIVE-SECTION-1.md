# IQ Bot V3 — Build Directive

**Date:** 2026-05-10
**Architect:** Wizard (implementer) + Claude (coder)
**Stack:** TypeScript / JavaScript (primary), Python only where strictly necessary
**Reference SDK:** `@quadcode-tech/client-sdk-js` v1.3.21 (included in repo)

---

## Philosophy

Build ONE section at a time. Each section must be **confirmed working** before proceeding to the next. No bias engine. No database. No admin panel. No users. Just the minimal code needed to prove that section works.

---

## SECTION 1: Trade Pipeline

### Goal
User sends `/trade EURUSD-OTC put 50` on Telegram → bot connects to IQ Option via official SDK → places a 60s turbo → waits for result → sends WIN/LOSS/TIE back to Telegram.

### What it MUST do
1. Receive a Telegram command: `/trade <pair> <direction> <amount>`
2. Connect to IQ Option using the official SDK (`@quadcode-tech/client-sdk-js`)
3. Authenticate with SSID (hardcoded in `.env`)
4. Place a 60-second turbo option
5. Wait for the `position-changed` result event
6. Send result back to the Telegram user: WIN/LOSS/TIE with PnL
7. Disconnect cleanly

### What it MUST NOT do (yet)
- No database — no trade history, no user storage
- No bias engine — direction is manual from the command
- No multi-user support — single SSID for testing
- No martingale, no tiers, no admin commands
- No balance checking — just raw trade execution

### Technical Specification

#### Project structure
```
iqbot-v3/
├── .env                    # BOT_TOKEN, IQ_SSID, PLATFORM_ID
├── package.json            # telegraf, @quadcode-tech/client-sdk-js, dotenv
├── tsconfig.json
├── src/
│   ├── bot.ts              # Telegram bot (Telegraf) — command handlers
│   ├── trade.ts            # Trade pipeline — SDK wrapper
│   └── protocol.ts         # IQ Option constants (WS URL, balance types, etc.)
```

#### Files

**`.env`**
```
BOT_TOKEN=<from VPS .env>
IQ_SSID=<from VPS .env>
PLATFORM_ID=15
IQ_WS_URL=wss://iqoption.com/echo/websocket
```

**`src/protocol.ts`**
```typescript
// IQ Option constants and balance type helpers
export const WS_URL = process.env.IQ_WS_URL || 'wss://iqoption.com/echo/websocket';
export const PLATFORM_ID = parseInt(process.env.PLATFORM_ID || '15', 10);
export const PRACTICE_BALANCE_TYPE = 4;
export const REAL_BALANCE_TYPE = 1;
```

**`src/trade.ts`**
```typescript
import {
    ClientSdk,
    SsidAuthMethod,
    TurboOptionsDirection,
} from '@quadcode-tech/client-sdk-js';
import { WS_URL, PRACTICE_BALANCE_TYPE } from './protocol.js';

export interface TradeRequest {
    pair: string;        // e.g. "EURUSD-OTC" or "front.EURUSD-OTC"
    direction: 'call' | 'put';
    amount: number;
    durationSeconds: number;
    balanceType?: 'PRACTICE' | 'REAL';
}

export interface TradeResult {
    status: 'WIN' | 'LOSS' | 'TIE' | 'TIMEOUT' | 'ERROR';
    pnl: number;
    tradeId: string;
    pair: string;
    direction: string;
    amount: number;
    error?: string;
}

export async function executeTrade(
    ssid: string,
    platformId: number,
    trade: TradeRequest
): Promise<TradeResult> {
    const sdk = await ClientSdk.create(
        WS_URL,
        platformId,
        new SsidAuthMethod(ssid),
        { host: 'https://iqoption.com' },
    );

    try {
        // Resolve pair → active_id from initialization data
        const initData = await sdk.binaryOptions.getInitializationData();
        const activeId = resolveActiveId(initData, trade.pair);
        if (!activeId) {
            return { status: 'ERROR', pnl: 0, tradeId: '', pair: trade.pair, direction: trade.direction, amount: trade.amount, error: `Unknown pair: ${trade.pair}` };
        }

        // Determine direction enum
        const dir = trade.direction === 'call'
            ? TurboOptionsDirection.Call
            : TurboOptionsDirection.Put;

        // Place the trade — SDK handles expiry alignment internally
        const option = await sdk.binaryOptions.openTurboOption(
            activeId,
            dir,
            trade.amount,
            trade.durationSeconds,
        );

        const tradeId = String(option.id);

        // Wait for result — SDK's internal event system delivers position-changed
        const result = await waitForTradeResult(sdk, tradeId, trade.durationSeconds + 60);

        return {
            ...result,
            tradeId,
            pair: trade.pair,
            direction: trade.direction,
            amount: trade.amount,
        };
    } finally {
        // Always disconnect
        await sdk.disconnect();
    }
}

async function waitForTradeResult(
    sdk: ClientSdk,
    tradeId: string,
    timeoutSeconds: number,
): Promise<Omit<TradeResult, 'tradeId' | 'pair' | 'direction' | 'amount'>> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            resolve({ status: 'TIMEOUT', pnl: 0, error: 'Result timeout' });
        }, timeoutSeconds * 1000);

        // Listen for position-changed events
        sdk.positions.onPositionChanged((position) => {
            if (String(position.externalId) === tradeId && position.status === 'closed') {
                clearTimeout(timer);
                const pnl = position.closeProfit || 0;
                const closeReason = position.closeReason || '';
                const status = closeReason === 'win' ? 'WIN' : closeReason === 'equal' ? 'TIE' : 'LOSS';
                resolve({ status, pnl });
            }
        });
    });
}

function resolveActiveId(initData: any, pair: string): number | null {
    // Search turbo, binary, blitz actives for matching pair name
    for (const section of ['turbo', 'binary', 'blitz']) {
        const actives = initData[section]?.actives || {};
        for (const [id, active] of Object.entries(actives) as [string, any][]) {
            const name = active.name || '';
            if (name === pair || name === `front.${pair}` || name.replace('front.', '') === pair) {
                return parseInt(id, 10);
            }
        }
    }
    return null;
}
```

**`src/bot.ts`**
```typescript
import { Telegraf } from 'telegraf';
import { executeTrade, TradeRequest } from './trade.js';
import { PLATFORM_ID } from './protocol.js';
import 'dotenv/config';

const BOT_TOKEN = process.env.BOT_TOKEN!;
const IQ_SSID = process.env.IQ_SSID!;

const bot = new Telegraf(BOT_TOKEN);

// /trade <pair> <direction> <amount>
// Example: /trade EURUSD-OTC put 50
bot.command('trade', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 3) {
        return ctx.reply('Usage: /trade <pair> <direction> <amount>\nExample: /trade EURUSD-OTC put 50');
    }

    const [pair, direction, amountStr] = args;
    const amount = parseFloat(amountStr);

    if (direction !== 'call' && direction !== 'put') {
        return ctx.reply('Direction must be "call" or "put".');
    }
    if (isNaN(amount) || amount <= 0) {
        return ctx.reply('Amount must be a positive number.');
    }

    const trade: TradeRequest = {
        pair: pair.startsWith('front.') ? pair : `front.${pair}`,
        direction: direction as 'call' | 'put',
        amount,
        durationSeconds: 60,
        balanceType: 'PRACTICE',
    };

    await ctx.reply(`⏳ Placing trade: ${trade.pair} ${trade.direction.toUpperCase()} $${amount}...`);

    try {
        const result = await executeTrade(IQ_SSID, PLATFORM_ID, trade);

        const emoji = result.status === 'WIN' ? '💚' : result.status === 'LOSS' ? '💔' : result.status === 'TIE' ? '⚪' : '⚠️';

        let message = `${emoji} *${result.status}*\n`;
        message += `Pair: \`${result.pair}\`\n`;
        message += `Direction: *${result.direction.toUpperCase()}*\n`;
        message += `Amount: $${result.amount}\n`;

        if (result.status === 'WIN') {
            message += `Profit: +$${result.pnl.toFixed(2)}\n`;
        } else if (result.status === 'LOSS') {
            message += `Loss: -$${result.amount.toFixed(2)}\n`;
        }

        if (result.error) {
            message += `_${result.error}_`;
        }

        await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (err: any) {
        await ctx.reply(`❌ Trade failed: ${err.message || 'Unknown error'}`);
    }
});

// /start — basic welcome
bot.command('start', (ctx) => {
    ctx.reply(
        '🤖 *IQ Bot V3*\n\n' +
        'Trade directly from Telegram:\n' +
        '`/trade EURUSD-OTC put 50`\n\n' +
        '_Section 1: Trade Pipeline_',
        { parse_mode: 'Markdown' },
    );
});

// /ping — health check
bot.command('ping', (ctx) => ctx.reply('pong'));

bot.launch();
console.log('[v3-bot] IQ Bot V3 running');
```

### Verification Checklist

When Section 1 is deployed, confirm the following:

- [ ] `/start` responds immediately
- [ ] `/ping` responds "pong"
- [ ] `/trade EURUSD-OTC put 10` starts a trade
- [ ] Bot displays "Placing trade..." within 2 seconds
- [ ] Result (WIN/LOSS/TIE) arrives within 90 seconds
- [ ] Profit/loss amount is displayed correctly
- [ ] `/trade EURUSD-OTC call 5` works (call direction)

### Notes for Claude

1. **Use the official SDK** — `@quadcode-tech/client-sdk-js` is the npm package. The source code reference is at `/root/iqbot-v3/src/index.ts` (but the npm package has the proper TypeScript types and exports).

2. **The SDK's internal event system** handles `position-changed` events. You do NOT need to write any WebSocket protocol code or subscribeMessage frames. The SDK does it all.

3. **Turbo options only for now** — `openTurboOption()` with 60s duration. Binary options later.

4. **No retry logic** — one attempt. If it times out, report timeout.

5. **TypeScript strict mode** — all types explicit, no `any` except where SDK types are unknown.

6. **Single file is fine** — if 3 files is too much, one `bot.ts` with everything inline is acceptable for Section 1.

7. **The iq-trader service from V2 is identical** to what this will become. Use it as reference if needed.

---

## After Section 1 is confirmed working...

We add Section 2, Section 3, etc. Each section builds on the last. No section is built until the previous section passes the verification checklist.
