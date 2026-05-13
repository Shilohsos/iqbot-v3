import { ClientSdk, SsidAuthMethod, BlitzOptionsDirection, BalanceType, } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
import { insertTrade } from './db.js';
const normTicker = (s) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
/**
 * Runs a single trade on an already-authenticated SDK instance.
 * The caller owns the SDK lifecycle (connect / shutdown).
 * Catches SDK-internal TimeoutError and converts it to an ERROR result
 * so the martingale loop can handle it gracefully instead of crashing.
 *
 * All timeframes (30s / 60s / 300s) execute via BlitzOptions.
 */
export async function executeTradeWithSdk(sdk, trade) {
    try {
        // sdk.positions() is cached after the first call — safe to call every round.
        const positions = await sdk.positions();
        const balances = await sdk.balances();
        const wantLive = trade.balanceType === 'live';
        const selectedBalance = balances.getBalances().find(b => b.type === (wantLive ? BalanceType.Real : BalanceType.Demo));
        if (!selectedBalance)
            return errorResult(trade, wantLive ? 'No real balance found' : 'No demo balance found');
        const currentTime = sdk.currentTime();
        const targetSize = trade.timeframeSec ?? 60;
        const normalizedInput = normTicker(trade.pair);
        const blitzOptions = await sdk.blitzOptions();
        const active = blitzOptions.getActives().find(a => normTicker(a.ticker) === normalizedInput ||
            normTicker(a.localizationKey) === normalizedInput);
        if (!active)
            return errorResult(trade, `Unknown pair: ${trade.pair}`);
        if (!active.canBeBoughtAt(currentTime))
            return errorResult(trade, `${trade.pair} market is closed right now`);
        if (!active.expirationTimes.includes(targetSize))
            return errorResult(trade, `No ${targetSize}s instrument available for ${trade.pair}`);
        const dir = trade.direction === 'call' ? BlitzOptionsDirection.Call : BlitzOptionsDirection.Put;
        const option = await blitzOptions.buy(active, dir, targetSize, trade.amount, selectedBalance);
        const result = await waitForResult(positions, option.id, targetSize + 90);
        const tradeResult = {
            ...result,
            tradeId: option.id,
            pair: trade.pair,
            direction: trade.direction,
            amount: trade.amount,
        };
        insertTrade({
            telegram_id: trade.telegramId,
            pair: tradeResult.pair,
            direction: tradeResult.direction,
            amount: tradeResult.amount,
            status: tradeResult.status,
            pnl: tradeResult.pnl,
            trade_id: tradeResult.tradeId,
            error: tradeResult.error,
            martingale_run: trade.martingaleRunId,
        });
        return tradeResult;
    }
    catch (err) {
        // SDK's p-timeout throws TimeoutError — convert to a safe ERROR result
        // so callers never see an unhandled rejection.
        if (isTimeoutError(err)) {
            return errorResult(trade, 'IQ Option timed out');
        }
        throw err;
    }
}
/**
 * Convenience wrapper for one-shot trades.
 * Creates its own SDK connection and shuts it down after the trade.
 */
export async function executeTrade(ssid, trade) {
    let sdk;
    try {
        sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
    }
    catch (err) {
        if (isTimeoutError(err))
            return errorResult(trade, 'Connection timed out');
        throw err;
    }
    try {
        return await executeTradeWithSdk(sdk, trade);
    }
    finally {
        await sdk.shutdown();
    }
}
export function createSdk(ssid) {
    return ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
}
function isTimeoutError(err) {
    if (!(err instanceof Error))
        return false;
    return err.name === 'TimeoutError' || err.message.includes('timed out') || err.message.includes('TimeoutError');
}
function waitForResult(positions, optionId, timeoutSeconds) {
    return new Promise(resolve => {
        let externalId;
        let done = false;
        const finish = (result) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            clearInterval(poll);
            positions.unsubscribeOnUpdatePosition(callback);
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish({ status: 'TIMEOUT', pnl: 0, error: 'Result timeout' });
        }, timeoutSeconds * 1000);
        // Initial sync: capture externalId if the position is already in the opened list
        const existing = positions.getOpenedPositions().find(p => p.orderIds.includes(optionId));
        if (existing)
            externalId = existing.externalId;
        const callback = (pos) => {
            if (externalId === undefined && pos.orderIds.includes(optionId)) {
                externalId = pos.externalId;
            }
            if (externalId !== undefined && pos.externalId === externalId && pos.status === 'closed') {
                const pnl = pos.closeProfit ?? 0;
                const reason = pos.closeReason ?? '';
                const status = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                finish({ status, pnl });
            }
        };
        positions.subscribeOnUpdatePosition(callback);
        // Polling fallback every 5s:
        // - Captures externalId if the websocket open event was missed
        // - Detects close if the websocket close event is never delivered
        const poll = setInterval(() => {
            const opened = positions.getOpenedPositions();
            if (externalId === undefined) {
                const match = opened.find(p => p.orderIds.includes(optionId));
                if (match)
                    externalId = match.externalId;
            }
            if (externalId !== undefined) {
                const pos = opened.find(p => p.externalId === externalId);
                if (pos?.status === 'closed') {
                    const pnl = pos.closeProfit ?? 0;
                    const reason = pos.closeReason ?? '';
                    const status = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                    finish({ status, pnl });
                }
            }
        }, 5_000);
    });
}
function errorResult(trade, error) {
    return { status: 'ERROR', pnl: 0, tradeId: 0, pair: trade.pair, direction: trade.direction, amount: trade.amount, error };
}
