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
    balanceType?: 'demo' | 'live';
    telegramId?: number;
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
        const wantLive = trade.balanceType === 'live';
        let selectedBalance = balances.getBalances().find(b =>
            b.type === (wantLive ? BalanceType.Real : BalanceType.Demo)
        );
        // Fallback for accounts whose balance typeId the SDK doesn't map (e.g. NGN)
        if (!selectedBalance) {
            selectedBalance = wantLive
                ? balances.getBalances().find(b => b.type === undefined || b.type === BalanceType.Real)
                : balances.getBalances().find(b => b.type === undefined || b.type === BalanceType.Demo);
        }
        if (!selectedBalance) return errorResult(trade, wantLive ? 'No real balance found' : 'No demo balance found');

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
        const option = await blitzOptions.buy(active, dir, targetSize, trade.amount, selectedBalance);

        const result = await waitForResult(positions, option.id, targetSize + 90);
        const tradeResult: TradeResult = {
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
            external_id: result.externalId,
        });

        return tradeResult;
    } catch (err: unknown) {
        if (isTimeoutError(err)) {
            return errorResult(trade, 'IQ Option timed out');
        }
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(trade, msg);
    }
}

/**
 * One-shot trade — fresh connection per call, shut down when done.
 */
export async function executeTrade(ssid: string, trade: TradeRequest): Promise<TradeResult> {
    let sdk: ClientSdk;
    try {
        sdk = await Promise.race([
            ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Connection timed out')), 180_000)
            ),
        ]);
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

export interface MartingaleParams {
    pair: string;
    direction: 'call' | 'put';
    amount: number;
    timeframeSec: number;
    galeRounds: number;            // 0 = no recovery (single trade)
    balanceType: 'demo' | 'live';
    telegramId?: number;
    cooldownMs?: number;           // wait between recovery rounds
}

export interface MartingaleRoundInfo {
    round: number;                 // 1-based
    amount: number;
    result: TradeResult;
}

export interface MartingaleOutcome {
    status: 'WIN' | 'LOSS' | 'TIE' | 'ERROR' | 'TIMEOUT';
    totalPnl: number;
    rounds: number;                // rounds actually executed
}

/**
 * UI-free martingale runner: executes a trade on an already-connected SDK and
 * doubles the stake on loss until a win/tie, an error, or `galeRounds` recovery
 * rounds are exhausted. Shared execution primitive (`executeTradeWithSdk`) with
 * the Telegram-coupled runMartingale in bot.ts. The optional `onRound` callback
 * lets callers render progress without this function knowing about Telegram.
 */
export async function runMartingaleCore(
    sdk: ClientSdk,
    params: MartingaleParams,
    onRound?: (info: MartingaleRoundInfo) => void | Promise<void>,
): Promise<MartingaleOutcome> {
    const runId = crypto.randomUUID();
    const cooldownMs = params.cooldownMs ?? 2000;
    let currentAmount = params.amount;
    let totalPnl = 0;

    for (let round = 1; round <= params.galeRounds + 1; round++) {
        const roundTrade: TradeRequest = {
            pair: params.pair,
            direction: params.direction,
            amount: currentAmount,
            martingaleRunId: runId,
            timeframeSec: params.timeframeSec,
            balanceType: params.balanceType,
            telegramId: params.telegramId,
        };

        const result = await executeTradeWithSdk(sdk, roundTrade);
        await onRound?.({ round, amount: currentAmount, result });

        if (result.status === 'WIN' || result.status === 'TIE') {
            totalPnl += result.status === 'WIN' ? result.pnl : 0;
            return { status: result.status, totalPnl, rounds: round };
        }
        if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
            return { status: result.status, totalPnl, rounds: round };
        }

        // LOSS
        totalPnl -= currentAmount;
        if (round <= params.galeRounds) {
            currentAmount *= 2;
            if (cooldownMs > 0) await new Promise(r => setTimeout(r, cooldownMs));
        }
    }

    return { status: 'LOSS', totalPnl, rounds: params.galeRounds + 1 };
}

function isTimeoutError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return err.name === 'TimeoutError' || err.message.includes('timed out') || err.message.includes('TimeoutError');
}

export function waitForResult(
    positions: Positions,
    optionId: number,
    timeoutSeconds: number,
): Promise<Pick<TradeResult, 'status' | 'pnl' | 'error'> & { externalId?: number }> {
    return new Promise(resolve => {
        let externalId: number | undefined;
        let done = false;

        const finish = (result: Pick<TradeResult, 'status' | 'pnl' | 'error'>) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearInterval(poll);
            positions.unsubscribeOnUpdatePosition(callback);
            resolve({ ...result, externalId });
        };

        const timer = setTimeout(() => {
            finish({ status: 'TIMEOUT', pnl: 0, error: 'Result timeout' });
        }, timeoutSeconds * 1000);

        // Initial sync: capture externalId if the position is already in the opened list
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

        // Polling fallback every 5s:
        // - Captures externalId if the websocket open event was missed
        // - Detects close if the websocket close event is never delivered
        // - Falls back to position history API for trades that left the opened list
        const poll = setInterval(async () => {
            const opened = positions.getOpenedPositions();

            if (externalId === undefined) {
                const match = opened.find(p => p.orderIds.includes(optionId));
                if (match) externalId = match.externalId;
            }

            if (externalId !== undefined) {
                const pos = opened.find(p => p.externalId === externalId);
                if (pos?.status === 'closed') {
                    const pnl = pos.closeProfit ?? 0;
                    const reason = pos.closeReason ?? '';
                    const status: TradeResult['status'] = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                    finish({ status, pnl });
                    return;
                }

                if (!pos) {
                    try {
                        const historyPos = await positions.getPositionsHistory().getPositionHistory(externalId);
                        if (historyPos && historyPos.status === 'closed') {
                            const pnl = historyPos.closeProfit ?? 0;
                            const reason = historyPos.closeReason ?? '';
                            const status: TradeResult['status'] = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                            finish({ status, pnl });
                        }
                    } catch {
                        // History lookup failed — next poll will retry
                    }
                }
            }
        }, 5_000);
    });
}

function errorResult(trade: TradeRequest, error: string): TradeResult {
    return { status: 'ERROR', pnl: 0, tradeId: 0, pair: trade.pair, direction: trade.direction, amount: trade.amount, error };
}
