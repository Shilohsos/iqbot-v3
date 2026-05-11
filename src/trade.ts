import {
    ClientSdk,
    SsidAuthMethod,
    BlitzOptionsDirection,
    BalanceType,
    type Positions,
    type Position,
} from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
import { insertTrade } from './db.js';

export interface TradeRequest {
    pair: string;
    direction: 'call' | 'put';
    amount: number;
    martingaleRunId?: string;
    timeframeSec?: number;
}

export interface TradeResult {
    status: 'WIN' | 'LOSS' | 'TIE' | 'TIMEOUT' | 'ERROR';
    pnl: number;
    tradeId: number;
    pair: string;
    direction: string;
    amount: number;
    error?: string;
}

const normTicker = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');

/**
 * Runs a single trade on an already-authenticated SDK instance.
 * The caller owns the SDK lifecycle (connect / shutdown).
 * Catches SDK-internal TimeoutError and converts it to an ERROR result
 * so the martingale loop can handle it gracefully instead of crashing.
 *
 * All timeframes (30s / 60s / 300s) execute via BlitzOptions.
 */
export async function executeTradeWithSdk(sdk: ClientSdk, trade: TradeRequest): Promise<TradeResult> {
    try {
        // sdk.positions() is cached after the first call — safe to call every round.
        const positions = await sdk.positions();

        const balances = await sdk.balances();
        const demoBalance = balances.getBalances().find(b => b.type === BalanceType.Demo);
        if (!demoBalance) return errorResult(trade, 'No demo balance found');

        const currentTime = sdk.currentTime();
        const targetSize = trade.timeframeSec ?? 60;
        const normalizedInput = normTicker(trade.pair);

        const blitzOptions = await sdk.blitzOptions();
        const active = blitzOptions.getActives().find(a =>
            normTicker(a.ticker) === normalizedInput ||
            normTicker(a.localizationKey) === normalizedInput
        );
        if (!active) return errorResult(trade, `Unknown pair: ${trade.pair}`);
        if (!active.canBeBoughtAt(currentTime)) return errorResult(trade, `${trade.pair} market is closed right now`);
        if (!active.expirationTimes.includes(targetSize)) return errorResult(trade, `No ${targetSize}s instrument available for ${trade.pair}`);

        const dir = trade.direction === 'call' ? BlitzOptionsDirection.Call : BlitzOptionsDirection.Put;
        const option = await blitzOptions.buy(active, dir, targetSize, trade.amount, demoBalance);

        const result = await waitForResult(positions, option.id, targetSize + 90);
        const tradeResult: TradeResult = {
            ...result,
            tradeId: option.id,
            pair: trade.pair,
            direction: trade.direction,
            amount: trade.amount,
        };

        insertTrade({
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
    } catch (err: unknown) {
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
export async function executeTrade(ssid: string, trade: TradeRequest): Promise<TradeResult> {
    let sdk: ClientSdk;
    try {
        sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
    } catch (err: unknown) {
        if (isTimeoutError(err)) return errorResult(trade, 'Connection timed out');
        throw err;
    }
    try {
        return await executeTradeWithSdk(sdk, trade);
    } finally {
        await sdk.shutdown();
    }
}

export function createSdk(ssid: string): Promise<ClientSdk> {
    return ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
}

function isTimeoutError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return err.name === 'TimeoutError' || err.message.includes('timed out') || err.message.includes('TimeoutError');
}

function waitForResult(
    positions: Positions,
    optionId: number,
    timeoutSeconds: number,
): Promise<Pick<TradeResult, 'status' | 'pnl' | 'error'>> {
    return new Promise(resolve => {
        let externalId: number | undefined;
        let done = false;

        const finish = (result: Pick<TradeResult, 'status' | 'pnl' | 'error'>) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            positions.unsubscribeOnUpdatePosition(callback);
            resolve(result);
        };

        const timer = setTimeout(() => {
            finish({ status: 'TIMEOUT', pnl: 0, error: 'Result timeout' });
        }, timeoutSeconds * 1000);

        // Check if position is already synced (in case we missed the open event)
        const existing = positions.getOpenedPositions().find(p => p.orderIds.includes(optionId));
        if (existing) externalId = existing.externalId;

        const callback = (pos: Position) => {
            if (externalId === undefined && pos.orderIds.includes(optionId)) {
                externalId = pos.externalId;
            }
            if (externalId !== undefined && pos.externalId === externalId && pos.status === 'closed') {
                const pnl = pos.closeProfit ?? 0;
                const reason = pos.closeReason ?? '';
                const status: TradeResult['status'] = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                finish({ status, pnl });
            }
        };

        positions.subscribeOnUpdatePosition(callback);
    });
}

function errorResult(trade: TradeRequest, error: string): TradeResult {
    return { status: 'ERROR', pnl: 0, tradeId: 0, pair: trade.pair, direction: trade.direction, amount: trade.amount, error };
}
