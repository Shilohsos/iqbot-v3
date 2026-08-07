/**
 * Trade facade — Upgrade Phase 2.
 * All settlement goes through trade-core. TIMEOUT is never a gale input.
 */
import {
    ClientSdk,
    SsidAuthMethod,
    type Positions,
    type Position,
} from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
import { settle, type CoreFinal, type FinalStatus } from './trade-core.js';
import { runGale } from './gale-engine.js';
import { logger } from './logger.js';

export interface TradeRequest {
    pair: string;
    direction: 'call' | 'put';
    amount: number;
    martingaleRunId?: string;
    timeframeSec?: number;
    balanceType?: 'demo' | 'live';
    telegramId?: number;
}

/** Legacy shape kept for bot/auto compatibility. NO_FILL maps from core. TIMEOUT never emitted. */
export interface TradeResult {
    status: 'WIN' | 'LOSS' | 'TIE' | 'TIMEOUT' | 'ERROR' | 'NO_FILL';
    pnl: number;
    tradeId: number;
    pair: string;
    direction: string;
    amount: number;
    error?: string;
    settleSource?: string;
    settleMs?: number;
    externalId?: number;
}

function coreToLegacy(f: CoreFinal): TradeResult {
    // Map NO_FILL → ERROR for older UI branches that only know ERROR, but keep NO_FILL too.
    return {
        status: f.status === 'NO_FILL' ? 'NO_FILL' : f.status,
        pnl: f.pnl,
        tradeId: f.tradeId,
        pair: f.pair,
        direction: f.direction,
        amount: f.amount,
        error: f.error,
        settleSource: f.settleSource,
        settleMs: f.settleMs,
        externalId: f.externalId,
    };
}

/**
 * Single-round settle via TradeCore. Never returns TIMEOUT.
 */
export async function executeTradeWithSdk(sdk: ClientSdk, trade: TradeRequest): Promise<TradeResult> {
    const final = await settle(sdk, {
        pair: trade.pair,
        direction: trade.direction,
        amount: trade.amount,
        timeframeSec: trade.timeframeSec,
        balanceType: trade.balanceType,
        telegramId: trade.telegramId,
        martingaleRunId: trade.martingaleRunId,
    });
    return coreToLegacy(final);
}

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
        const msg = err instanceof Error ? err.message : String(err);
        return {
            status: 'NO_FILL',
            pnl: 0,
            tradeId: 0,
            pair: trade.pair,
            direction: trade.direction,
            amount: trade.amount,
            error: msg.includes('timed out') ? 'Connection timed out' : msg,
        };
    }
    try {
        return await executeTradeWithSdk(sdk, trade);
    } finally {
        try { await sdk.shutdown(); } catch { /* */ }
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
    galeRounds: number;
    balanceType: 'demo' | 'live';
    telegramId?: number;
    cooldownMs?: number;
}

export interface MartingaleRoundInfo {
    round: number;
    amount: number;
    result: TradeResult;
}

export interface MartingaleOutcome {
    status: 'WIN' | 'LOSS' | 'TIE' | 'ERROR' | 'TIMEOUT' | 'NO_FILL';
    totalPnl: number;
    rounds: number;
}

/**
 * Auto/Swarm/Copy entry — GaleEngine over TradeCore.
 * Never doubles on unconfirmed settlement.
 */
export async function runMartingaleCore(
    sdk: ClientSdk,
    params: MartingaleParams,
    onRound?: (info: MartingaleRoundInfo) => void | Promise<void>,
): Promise<MartingaleOutcome> {
    const outcome = await runGale(sdk, {
        pair: params.pair,
        direction: params.direction,
        amount: params.amount,
        timeframeSec: params.timeframeSec,
        galeRounds: params.galeRounds,
        balanceType: params.balanceType,
        telegramId: params.telegramId,
        cooldownMs: params.cooldownMs,
    }, async (info) => {
        await onRound?.({
            round: info.round,
            amount: info.amount,
            result: coreToLegacy(info.result),
        });
    });

    // Map for auto-trading which checks ERROR/TIMEOUT
    let status: MartingaleOutcome['status'] = outcome.status as MartingaleOutcome['status'];
    if (outcome.status === 'NO_FILL') status = 'NO_FILL';

    logger.info('trade', `runMartingaleCore done status=${status} pnl=${outcome.totalPnl} rounds=${outcome.rounds}`);
    return {
        status,
        totalPnl: outcome.totalPnl,
        rounds: outcome.rounds,
    };
}

// Re-export core helpers for bot wiring
export { settle, recoverFinal } from './trade-core.js';
export { runGale } from './gale-engine.js';

/** @deprecated — use settle(); kept so old imports don't crash */
export function waitForResult(
    _positions: Positions,
    _optionId: number,
    _timeoutSeconds: number,
): Promise<Pick<TradeResult, 'status' | 'pnl' | 'error'> & { externalId?: number }> {
    return Promise.resolve({ status: 'ERROR', pnl: 0, error: 'waitForResult deprecated — use settle()' });
}
