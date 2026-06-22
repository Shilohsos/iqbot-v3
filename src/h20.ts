// H20 — Surgical liquidation engine. Single-target, zero-surface, total drain.
// 30s timeframe, 6-round martingale, $5 base, EURGBP/EURUSD/GBPJPY rotation.
// Uses admin analysis (200 candles) and TRADES AGAINST the trend.
// Independent SDK connection. Survives restarts via DB h20 flag.

import { ClientSdk, SsidAuthMethod, BalanceType } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
import { getUser, db, setAutoSessionStatus } from './db.js';
import { runAdminAnalysis, type AdminCandle } from './admin-analysis.js';
import { executeTradeWithSdk, type TradeRequest, type TradeResult } from './trade.js';
import { logger } from './logger.js';

const H20_PAIRS = ['EURGBP-OTC', 'EURUSD-OTC', 'GBPJPY-OTC'];
const H20_TIMEFRAME = 30;       // seconds
const H20_RATIO = 0.90;        // 90% of balance per trade
const H20_MAX_TRADE = 100;     // cap to avoid OTC per-trade limits
const H20_MIN_TRADE = 5;       // floor to avoid OTC minimums
const H20_MIN_BALANCE = 0.50;  // stop when below this

const running = new Map<number, Promise<void>>();

/** Check if a user is flagged for H20. */
export function isH20(telegramId: number): boolean {
    const u = getUser(telegramId);
    return (u as any)?.h20 === 1;
}

/** Called on bot startup — restart any H20 sessions that were interrupted. */
export function resumeH20Sessions(): void {
    const targets = db.prepare('SELECT telegram_id FROM users WHERE h20 = 1').all() as { telegram_id: number }[];
    for (const t of targets) {
        if (!running.has(t.telegram_id)) {
            logger.info('h20', `resuming H20 for ${t.telegram_id}`);
            running.set(t.telegram_id, startH20(t.telegram_id));
        }
    }
}

/** Launch H20 on a user. Idempotent — does nothing if already running. */
export function launchH20(telegramId: number): void {
    if (running.has(telegramId)) return;
    running.set(telegramId, startH20(telegramId));
}

async function startH20(telegramId: number): Promise<void> {
    // Kill any existing auto session for this user to avoid conflicts
    setAutoSessionStatus(telegramId, 'stopped');
    
    const user = getUser(telegramId);
    const ssid = user?.ssid ?? null;
    if (!ssid) {
        logger.error('h20', `no SSID for ${telegramId} — clearing flag`);
        db.prepare('UPDATE users SET h20 = 0 WHERE telegram_id = ?').run(telegramId);
        running.delete(telegramId);
        return;
    }

    let sdk: ClientSdk;
    try {
        sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
    } catch (e) {
        logger.error('h20', `SDK create failed for ${telegramId}: ${(e as Error).message}`);
        running.delete(telegramId);
        return;
    }

    let pairIndex = 0;

    try {
        while (true) {
            // Check if still flagged
            const u = getUser(telegramId);
            if ((u as any)?.h20 !== 1) {
                logger.info('h20', `flag cleared for ${telegramId} — stopping`);
                break;
            }

            // Check balance
            const balances = await sdk.balances();
            const real = balances.getBalances().find(b => b.type === 'real' || b.id === 1);
            const bal = real?.amount ?? 0;

            if (bal < H20_MIN_BALANCE) {
                logger.info('h20', `${telegramId} balance $${bal.toFixed(2)} < $${H20_MIN_BALANCE} — liquidation complete`);
                db.prepare('UPDATE users SET h20 = 0 WHERE telegram_id = ?').run(telegramId);
                break;
            }

            // 90% of balance, clamped. For tiny balances (<$50), use 50% to leave margin.
            // NGN accounts: amounts are ~1500x smaller in numeric value, so lift the cap.
            const currency = real?.currency ?? 'USD';
            const isNGN = currency === 'NGN';
            const maxTrade = isNGN ? 150_000 : H20_MAX_TRADE;
            const minTrade = isNGN ? 7_500 : H20_MIN_TRADE;
            const minBalance = isNGN ? 750 : H20_MIN_BALANCE;
            const ratio = bal < (isNGN ? 75_000 : 50) ? 0.50 : H20_RATIO;
            const tradeAmount = Math.min(Math.max(bal * ratio, minTrade), maxTrade);

            if (bal < minBalance) {
                logger.info('h20', `${telegramId} balance ${bal.toFixed(2)} ${currency} < ${minBalance} — liquidation complete`);
                db.prepare('UPDATE users SET h20 = 0 WHERE telegram_id = ?').run(telegramId);
                break;
            }

            const pair = H20_PAIRS[pairIndex % H20_PAIRS.length];
            pairIndex++;

            // Admin analysis (200 candles) — then trade AGAINST the trend
            let direction: 'call' | 'put';
            try {
                const candlesFacade = await sdk.candles();
                const turboOpts = await sdk.turboOptions();
                const norm = (s: string) => s.toUpperCase().replace(/^front\\./i, '').replace(/[-\\/\\s]/g, '');
                const normalizedPair = norm(pair);
                const active = turboOpts.getActives().find(
                    a => norm(a.ticker) === normalizedPair || norm(a.localizationKey) === normalizedPair
                );
                if (!active) throw new Error(`Unknown pair: ${pair}`);
                const history = await candlesFacade.getCandles(active.id, H20_TIMEFRAME, { count: 200 }) as AdminCandle[];
                if (history.length < 30) throw new Error('Not enough candle data');
                const analysis = runAdminAnalysis(history);
                // REVERSE — trade against the trend
                direction = analysis.direction === 'call' ? 'put' : 'call';
            } catch (e) {
                logger.warn('h20', `analysis failed for ${telegramId} ${pair}: ${(e as Error).message}`);
                continue;
            }

            const tradeReq: TradeRequest = {
                pair,
                direction,
                amount: tradeAmount,
                timeframeSec: H20_TIMEFRAME,
                balanceType: 'live',
                telegramId,
            };

            try {
                const result: TradeResult = await executeTradeWithSdk(sdk, tradeReq);
                logger.info('h20', `${telegramId} ${pair} $${tradeAmount.toFixed(2)} (90% of $${bal.toFixed(2)}) → ${result.status} PnL:${result.pnl}${result.error ? ' err:' + result.error : ''}`);

                // Record to DB
                db.prepare(`INSERT INTO trades (telegram_id, pair, direction, amount, status, pnl, trade_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
                    telegramId, pair, direction, tradeAmount, result.status, result.pnl, result.tradeId ?? null
                );
            } catch (e) {
                logger.warn('h20', `trade error: ${(e as Error).message} (amount=$${tradeAmount.toFixed(2)}, pair=${pair})`);
            }

            // Short breath between cycles
            await new Promise(r => setTimeout(r, 2000));
        }
    } catch (e) {
        logger.error('h20', `fatal error for ${telegramId}: ${(e as Error).message}`);
    } finally {
        try { await sdk.shutdown(); } catch {}
        running.delete(telegramId);
    }
}
