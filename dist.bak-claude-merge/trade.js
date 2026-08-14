/**
 * Trade facade — Upgrade Phase 2.
 * All settlement goes through trade-core. TIMEOUT is never a gale input.
 */
import { ClientSdk, SsidAuthMethod, } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
import { settle } from './trade-core.js';
import { runGale } from './gale-engine.js';
import { logger } from './logger.js';
function coreToLegacy(f) {
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
export async function executeTradeWithSdk(sdk, trade) {
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
export async function executeTrade(ssid, trade) {
    let sdk;
    try {
        sdk = await Promise.race([
            ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 180_000)),
        ]);
    }
    catch (err) {
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
    }
    finally {
        try {
            await sdk.shutdown();
        }
        catch { /* */ }
    }
}
export function createSdk(ssid) {
    return ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
}
/**
 * Auto/Swarm/Copy entry — GaleEngine over TradeCore.
 * Never doubles on unconfirmed settlement.
 */
export async function runMartingaleCore(sdk, params, onRound) {
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
    let status = outcome.status;
    if (outcome.status === 'NO_FILL')
        status = 'NO_FILL';
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
export function waitForResult(_positions, _optionId, _timeoutSeconds) {
    return Promise.resolve({ status: 'ERROR', pnl: 0, error: 'waitForResult deprecated — use settle()' });
}
