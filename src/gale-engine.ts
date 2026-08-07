/**
 * GaleEngine — single martingale authority (Upgrade Phase 2).
 * Consumes TradeCore FINAL only. Never doubles on TIMEOUT/NO_FILL.
 */
import type { ClientSdk } from './index.js';
import { settle, type CoreFinal, type CoreOrder, type FinalStatus } from './trade-core.js';
import { logger } from './logger.js';

export interface GaleParams {
    pair: string;
    direction: 'call' | 'put';
    amount: number;
    timeframeSec: number;
    galeRounds: number;
    balanceType: 'demo' | 'live';
    telegramId?: number;
    cooldownMs?: number;
}

export interface GaleRoundInfo {
    round: number;
    amount: number;
    result: CoreFinal;
}

export interface GaleOutcome {
    status: FinalStatus | 'LOSS';
    totalPnl: number;
    rounds: number;
    last: CoreFinal | null;
}

export type GaleOnRound = (info: GaleRoundInfo) => void | Promise<void>;

function netWinPnl(closeProfit: number, stake: number): number {
    // IQ closeProfit is usually stake+profit (gross). If value > stake, treat as gross.
    if (closeProfit >= stake) return closeProfit - stake;
    return closeProfit;
}

/**
 * Run full gale on sticky SDK.
 * WIN → stop. TIE → same stake, no round burn.
 * NO_FILL → same stake retry (max 2) then abort — NEVER double.
 * LOSS → double until galeRounds exhausted.
 */
export async function runGale(
    sdk: ClientSdk,
    params: GaleParams,
    onRound?: GaleOnRound,
): Promise<GaleOutcome> {
    const cooldownMs = params.cooldownMs ?? 2000;
    const runId = crypto.randomUUID();
    let currentAmount = params.amount;
    let totalPnl = 0;
    let noFillStreak = 0;
    const maxNoFill = 2;
    let last: CoreFinal | null = null;

    for (let round = 1; round <= params.galeRounds + 1; round++) {
        const order: CoreOrder = {
            pair: params.pair,
            direction: params.direction,
            amount: currentAmount,
            timeframeSec: params.timeframeSec,
            balanceType: params.balanceType,
            telegramId: params.telegramId,
            martingaleRunId: runId,
        };

        const result = await settle(sdk, order);
        last = result;
        await onRound?.({ round, amount: currentAmount, result });

        logger.info(
            'gale',
            `round=${round}/${params.galeRounds + 1} final=${result.status} amt=${currentAmount} source=${result.settleSource} ms=${result.settleMs}`,
        );

        if (result.status === 'WIN') {
            totalPnl += netWinPnl(result.pnl, currentAmount);
            return { status: 'WIN', totalPnl, rounds: round, last: result };
        }

        if (result.status === 'TIE') {
            noFillStreak = 0;
            round--;
            if (cooldownMs > 0) await new Promise(r => setTimeout(r, cooldownMs));
            continue;
        }

        if (result.status === 'NO_FILL') {
            noFillStreak++;
            logger.warn('gale', `NO_FILL streak=${noFillStreak} err=${result.error ?? ''}`);
            if (noFillStreak > maxNoFill) {
                return { status: 'NO_FILL', totalPnl, rounds: round, last: result };
            }
            round--;
            if (cooldownMs > 0) await new Promise(r => setTimeout(r, cooldownMs));
            continue;
        }

        // LOSS only
        noFillStreak = 0;
        totalPnl -= currentAmount;
        if (round <= params.galeRounds) {
            currentAmount *= 2;
            if (cooldownMs > 0) await new Promise(r => setTimeout(r, cooldownMs));
        }
    }

    return { status: 'LOSS', totalPnl, rounds: params.galeRounds + 1, last };
}
