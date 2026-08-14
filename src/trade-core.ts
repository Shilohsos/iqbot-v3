/**
 * TradeCore — single settlement authority (Upgrade Phase 2).
 *
 * LAW: Callers never receive TIMEOUT as a gale input.
 * Finals only: WIN | LOSS | TIE | NO_FILL
 */
import {
    ClientSdk,
    BlitzOptionsDirection,
    BalanceType,
    type Positions,
    type Position,
} from './index.js';
import { db } from './db.js';
import { logger } from './logger.js';

export type FinalStatus = 'WIN' | 'LOSS' | 'TIE' | 'NO_FILL';

export interface CoreOrder {
    pair: string;
    direction: 'call' | 'put';
    amount: number;
    timeframeSec?: number;
    balanceType?: 'demo' | 'live';
    telegramId?: number;
    martingaleRunId?: string;
}

export interface CoreFinal {
    status: FinalStatus;
    pnl: number; // net display: win profit amount from IQ closeProfit when WIN; 0 otherwise
    tradeId: number;
    externalId?: number;
    pair: string;
    direction: string;
    amount: number;
    error?: string;
    settleSource: 'ws' | 'poll' | 'history' | 'none';
    settleMs: number;
}

const normTicker = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');

function sdkTimeout<T>(p: Promise<T>, label: string, ms = 15_000): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`SDK ${label} timed out`)), ms)),
    ]);
}

/** Total wall-clock budget for a post-timeout history recovery pass. Bounds the
 *  attempt loop so a broken SDK can't hold a chain hostage — past the budget the
 *  caller settles on NO_FILL (never LOSS). */
const RECOVER_BUDGET_MS = 40_000;

function isTimeoutError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return err.name === 'TimeoutError' || /timed out|TimeoutError/i.test(err.message);
}

function mapCloseReason(reason: string, pnl: number): FinalStatus | null {
    const r = (reason || '').toLowerCase();
    if (r === 'win') return 'WIN';
    if (r === 'equal') return 'TIE';
    if (r === 'loss' || r === 'loose') return 'LOSS';
    if (r === 'win' || r === 'equal' || r === 'loss' || r === 'loose') return null;
    // unknown reason
    if (pnl > 0) return 'WIN';
    if (pnl === 0 && r === '') return null;
    if (pnl <= 0 && r) return 'LOSS';
    return pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : null;
}

function finalFromPosition(pos: { closeProfit?: number; closeReason?: string; status?: string; externalId?: number }): Omit<CoreFinal, 'tradeId' | 'pair' | 'direction' | 'amount' | 'settleMs'> | null {
    if (pos.status && pos.status !== 'closed') return null;
    const pnl = Number(pos.closeProfit ?? 0);
    const reason = String(pos.closeReason ?? '');
    const mapped = mapCloseReason(reason, pnl);
    if (!mapped) {
        // closed with no reason: profit decides; flat → TIE
        if (pnl > 0) return { status: 'WIN', pnl, externalId: pos.externalId, settleSource: 'history' };
        if (pnl === 0) return { status: 'TIE', pnl: 0, externalId: pos.externalId, settleSource: 'history' };
        return { status: 'LOSS', pnl: 0, externalId: pos.externalId, settleSource: 'history' };
    }
    return {
        status: mapped,
        pnl: mapped === 'WIN' ? pnl : 0,
        externalId: pos.externalId,
        settleSource: 'history',
    };
}

/** Aggressive history recovery — optionId AND externalId, with retries. */
export async function recoverFinal(
    sdk: ClientSdk,
    optionId: number,
    externalId: number | undefined,
    amount: number,
    startedAtMs: number,
): Promise<{ status: FinalStatus; pnl: number; externalId?: number; settleSource: CoreFinal['settleSource'] } | null> {
    try {
        const positions = await sdkTimeout(sdk.positions(), 'positions-recover', 10_000);
        const attempts = 6;
        const deadline = Date.now() + RECOVER_BUDGET_MS;
        for (let i = 0; i < attempts; i++) {
            if (Date.now() > deadline) {
                logger.warn('trade-core', `recoverFinal budget exhausted for optionId=${optionId} after ${i} attempts`);
                break;
            }
            // 1) still open?
            const opened = positions.getOpenedPositions();
            let ext = externalId;
            if (ext == null) {
                const m = opened.find(p => p.orderIds?.includes(optionId));
                if (m?.externalId != null) ext = m.externalId;
            }
            if (ext != null) {
                const live = opened.find(p => p.externalId === ext);
                if (live?.status === 'closed') {
                    const f = finalFromPosition(live);
                    if (f) return { status: f.status, pnl: f.pnl, externalId: ext, settleSource: 'poll' };
                }
            }

            // 2) history by externalId then optionId
            try {
                const hist = positions.getPositionsHistory();
                for (const id of [ext, optionId].filter((x): x is number => x != null && x > 0)) {
                    try {
                        const hp = await sdkTimeout(hist.getPositionHistory(id), `history#${id}`, 10_000);
                        if (hp && (hp as any).status === 'closed') {
                            const f = finalFromPosition(hp as any);
                            if (f) return { status: f.status, pnl: f.pnl, externalId: ext ?? (hp as any).externalId, settleSource: 'history' };
                        }
                    } catch (e) {
                        logger.warn('trade-core', `recoverFinal history#${id} miss: ${e instanceof Error ? e.message : e}`);
                    }
                }
            } catch (e) {
                logger.warn('trade-core', `recoverFinal history lookup failed: ${e instanceof Error ? e.message : e}`);
            }

            // 3) history page scan by amount + time window
            try {
                const facade = (positions as any).positionsHistoryFacade;
                if (facade?.fetchPrevPage) {
                    await sdkTimeout(facade.fetchPrevPage(), 'history-page', 10_000)
                        .catch((e: unknown) => logger.warn('trade-core', `recoverFinal fetchPrevPage failed: ${e instanceof Error ? e.message : e}`));
                }
                const list: any[] = typeof facade?.getPositions === 'function'
                    ? await sdkTimeout(Promise.resolve(facade.getPositions()), 'history-list', 10_000)
                    : [];
                const windowStart = startedAtMs - 5_000;
                const match = (Array.isArray(list) ? list : [])
                    .filter(p => p && p.status === 'closed')
                    .filter(p => Math.abs(Number(p.invest ?? p.amount ?? 0) - amount) < 0.021)
                    .filter(p => {
                        const ot = p.openTime ? new Date(p.openTime).getTime() : 0;
                        return !ot || ot >= windowStart;
                    })
                    .sort((a, b) => {
                        const ta = new Date(b.closeTime || 0).getTime() - new Date(a.closeTime || 0).getTime();
                        return ta;
                    })[0];
                if (match) {
                    const f = finalFromPosition(match);
                    if (f) return { status: f.status, pnl: f.pnl, externalId: match.externalId, settleSource: 'history' };
                }
            } catch (e) {
                logger.warn('trade-core', `recoverFinal page scan failed: ${e instanceof Error ? e.message : e}`);
            }

            await new Promise(r => setTimeout(r, 1500 + i * 500));
        }
    } catch (e) {
        logger.warn('trade-core', `recoverFinal failed: ${e instanceof Error ? e.message : e}`);
    }
    return null;
}

function waitForClose(
    positions: Positions,
    optionId: number,
    timeoutSeconds: number,
): Promise<{ status: FinalStatus | 'TIMEOUT'; pnl: number; externalId?: number; settleSource: CoreFinal['settleSource']; error?: string }> {
    return new Promise(resolve => {
        let externalId: number | undefined;
        let done = false;
        // First-error-only logging for the 2s poll paths: a broken SDK would
        // otherwise emit an identical line every tick for the whole wait window.
        let pollErrLogged = false;
        const logPollErr = (where: string, e: unknown) => {
            if (pollErrLogged) return;
            pollErrLogged = true;
            logger.warn('trade-core', `waitForClose ${where} error (further identical errors suppressed): ${e instanceof Error ? e.message : e}`);
        };
        const finish = (r: { status: FinalStatus | 'TIMEOUT'; pnl: number; externalId?: number; settleSource: CoreFinal['settleSource']; error?: string }) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearInterval(poll);
            try { positions.unsubscribeOnUpdatePosition(callback); } catch (e) {
                logger.warn('trade-core', `waitForClose unsubscribe failed: ${e instanceof Error ? e.message : e}`);
            }
            resolve(r);
        };

        const mapPos = (pos: Position, source: CoreFinal['settleSource']) => {
            const pnl = pos.closeProfit ?? 0;
            const reason = pos.closeReason ?? '';
            let status: FinalStatus;
            if (reason === 'win') status = 'WIN';
            else if (reason === 'equal') status = 'TIE';
            else if (reason === 'loss' || reason === 'loose') status = 'LOSS';
            else status = pnl > 0 ? 'WIN' : pnl === 0 ? 'TIE' : 'LOSS';
            finish({ status, pnl: status === 'WIN' ? pnl : 0, externalId, settleSource: source });
        };

        const timer = setTimeout(() => {
            finish({ status: 'TIMEOUT', pnl: 0, externalId, settleSource: 'none', error: 'Result timeout' });
        }, timeoutSeconds * 1000);

        const existing = positions.getOpenedPositions().find(p => p.orderIds.includes(optionId));
        if (existing) externalId = existing.externalId;

        const callback = (pos: Position) => {
            if (externalId === undefined && pos.orderIds.includes(optionId)) externalId = pos.externalId;
            if (externalId !== undefined && pos.externalId === externalId && pos.status === 'closed') {
                mapPos(pos, 'ws');
            }
        };
        positions.subscribeOnUpdatePosition(callback);

        const poll = setInterval(async () => {
            try {
                const opened = positions.getOpenedPositions();
                if (externalId === undefined) {
                    const m = opened.find(p => p.orderIds.includes(optionId));
                    if (m) externalId = m.externalId;
                }
                if (externalId === undefined) return;
                const pos = opened.find(p => p.externalId === externalId);
                if (pos?.status === 'closed') {
                    mapPos(pos, 'poll');
                    return;
                }
                if (!pos) {
                    try {
                        const hist = positions.getPositionsHistory();
                        let hp: any = null;
                        try { hp = await sdkTimeout(hist.getPositionHistory(externalId!), 'poll-history-ext', 10_000); } catch (e) { logPollErr('history-by-external', e); }
                        if (!hp || hp.status !== 'closed') {
                            try { hp = await sdkTimeout(hist.getPositionHistory(optionId), 'poll-history-opt', 10_000); } catch (e) { logPollErr('history-by-option', e); }
                        }
                        if (hp && hp.status === 'closed') {
                            const pnl = hp.closeProfit ?? 0;
                            const reason = hp.closeReason ?? '';
                            let status: FinalStatus;
                            if (reason === 'win') status = 'WIN';
                            else if (reason === 'equal') status = 'TIE';
                            else if (reason === 'loss' || reason === 'loose') status = 'LOSS';
                            else status = pnl > 0 ? 'WIN' : pnl === 0 ? 'TIE' : 'LOSS';
                            finish({ status, pnl: status === 'WIN' ? pnl : 0, externalId, settleSource: 'history' });
                        }
                    } catch (e) { logPollErr('history-fallback', e); }
                }
            } catch (e) { logPollErr('poll', e); }
        }, 2000);
    });
}

/**
 * Place + await FINAL. Never returns TIMEOUT to caller.
 */
export async function settle(sdk: ClientSdk, order: CoreOrder): Promise<CoreFinal> {
    const t0 = Date.now();
    const pair = order.pair;
    const direction = order.direction;
    const amount = order.amount;
    let optionId: number | undefined;

    const noFill = (error: string): CoreFinal => ({
        status: 'NO_FILL',
        pnl: 0,
        tradeId: 0,
        pair,
        direction,
        amount,
        error,
        settleSource: 'none',
        settleMs: Date.now() - t0,
    });

    try {
        const positions = await sdkTimeout(sdk.positions(), 'positions', 10_000);
        const balances = await sdkTimeout(sdk.balances(), 'balances', 10_000);
        const wantLive = order.balanceType === 'live';
        let selectedBalance = balances.getBalances().find(b =>
            b.type === (wantLive ? BalanceType.Real : BalanceType.Demo)
        );
        if (!selectedBalance) {
            selectedBalance = wantLive
                ? balances.getBalances().find(b => b.type === undefined || b.type === BalanceType.Real)
                : balances.getBalances().find(b => b.type === undefined || b.type === BalanceType.Demo);
        }
        if (!selectedBalance) return noFill(wantLive ? 'No real balance found' : 'No demo balance found');

        const currentTime = sdk.currentTime();
        const targetSize = order.timeframeSec ?? 60;
        const normalizedInput = normTicker(pair);
        const blitzOptions = await sdkTimeout(sdk.blitzOptions(), 'blitzOptions', 15_000);
        // refresh actives when available
        try {
            const refresh = (blitzOptions as any).refreshActives?.();
            if (refresh) await sdkTimeout(refresh, 'refreshActives', 15_000);
        } catch (e) {
            logger.warn('trade-core', `refreshActives failed (using cached actives): ${e instanceof Error ? e.message : e}`);
        }
        // Warm-up: on a fresh/rebuilt connection the actives snapshot can carry a
        // stale profit rate; IQ then rejects the first buy with 4117. Let the feed
        // sync before touching canBeBoughtAt/buy.
        await new Promise(r => setTimeout(r, 1200));
        const active = blitzOptions.getActives().find(a =>
            normTicker(a.ticker) === normalizedInput ||
            normTicker(a.localizationKey) === normalizedInput
        );
        if (!active) return noFill(`Unknown pair: ${pair}`);
        if (!active.canBeBoughtAt(currentTime)) return noFill(`${pair} market is closed right now`);
        if (!active.expirationTimes.includes(targetSize)) return noFill(`No ${targetSize}s instrument available for ${pair}`);

        const dir = direction === 'call' ? BlitzOptionsDirection.Call : BlitzOptionsDirection.Put;
        let option: { id: number };
        try {
            option = await sdkTimeout(blitzOptions.buy(active, dir, targetSize, amount, selectedBalance), 'buy', 20_000);
        } catch (buyErr) {
            const msg = buyErr instanceof Error ? buyErr.message : String(buyErr);
            // Same-stake refresh+retry on profit-rate change (4117) — the buy did not
            // fill, so retrying the SAME amount can never double a round.
            if (/4117|profit rate|not been purchased/i.test(msg)) {
                logger.warn('trade-core', `buy rejected (profit-rate/4117) pair=${pair} amt=${amount} — refreshing actives and retrying same stake`);
                let placed = false;
                const backoffs = [1000, 2000, 3000, 4000];
                for (let attempt = 0; attempt < backoffs.length; attempt++) {
                    try {
                        await new Promise(r => setTimeout(r, backoffs[attempt]));
                        const refresh = (blitzOptions as any).refreshActives?.();
                        if (refresh) await sdkTimeout(refresh, 'refreshActives-retry', 15_000);
                        await new Promise(r => setTimeout(r, 400));
                        // Re-read the FRESH active — the stale object still carries the old rate.
                        const freshActive = (blitzOptions as any).getActives().find((a: any) => normTicker(a.ticker) === normalizedInput ||
                            normTicker(a.localizationKey) === normalizedInput) ?? active;
                        option = await sdkTimeout((blitzOptions as any).buy(freshActive, dir, targetSize, amount, selectedBalance), 'buy-retry', 20_000);
                        placed = true;
                        break;
                    } catch (e2) {
                        const m2 = e2 instanceof Error ? e2.message : String(e2);
                        if (/4117|profit rate|not been purchased/i.test(m2)) {
                            logger.warn('trade-core', `buy retry ${attempt + 1} still profit-rate-rejected — backing off ${backoffs[attempt + 1] ?? 0}ms`);
                            continue;
                        }
                        return noFill(m2);
                    }
                }
                if (!placed)
                    return noFill('Payout rate changed');
            } else if (isTimeoutError(buyErr) || /WebSocket|is closing|not open/i.test(msg)) {
                return noFill(`Buy failed — no trade placed (${msg})`);
            } else {
                return noFill(msg);
            }
        }
        optionId = option!.id;

        const nowSql = new Date().toISOString();
        if (order.telegramId != null) {
            db.prepare(`INSERT OR IGNORE INTO users (telegram_id, created_at, last_used) VALUES (?, datetime('now'), datetime('now'))`)
                .run(order.telegramId);
        }
        db.prepare(`INSERT INTO trades (telegram_id, pair, direction, amount, status, trade_id, created_at, timeframe_sec)
                     VALUES (?, ?, ?, ?, 'in_flight', ?, ?, ?)`)
            .run(order.telegramId ?? null, pair, direction, amount, optionId, nowSql, order.timeframeSec ?? 60);

        let externalId: number | undefined;
        const optId = optionId;
        const saveExtId = setInterval(() => {
            const match = positions.getOpenedPositions().find(p => p.orderIds.includes(optId));
            const extId = match?.externalId;
            if (extId != null) {
                externalId = extId;
                db.prepare('UPDATE trades SET external_id = ? WHERE trade_id = ? AND status = ?')
                    .run(extId, optId, 'in_flight');
                clearInterval(saveExtId);
            }
        }, 400);
        setTimeout(() => clearInterval(saveExtId), 20_000);

        const waitSecs = targetSize + 120; // slightly longer primary wait
        let closed = await waitForClose(positions, optionId, waitSecs);
        clearInterval(saveExtId);
        if (closed.externalId) externalId = closed.externalId;

        // LAW: TIMEOUT is internal — recover to FINAL or NO_FILL
        if (closed.status === 'TIMEOUT') {
            logger.warn('trade-core', `awaitFinal TIMEOUT optionId=${optionId} — recovering (never gale on raw timeout)`);
            const recovered = await recoverFinal(sdk, optionId, externalId, amount, t0);
            if (recovered) {
                closed = {
                    status: recovered.status,
                    pnl: recovered.pnl,
                    externalId: recovered.externalId ?? externalId,
                    settleSource: recovered.settleSource,
                };
                logger.info('trade-core', `recovered FINAL=${recovered.status} pnl=${recovered.pnl} source=${recovered.settleSource}`);
            } else {
                // Strict: unconfirmed → NO_FILL (do NOT treat as LOSS / do not double)
                closed = {
                    status: 'NO_FILL',
                    pnl: 0,
                    externalId,
                    settleSource: 'none',
                    error: 'unconfirmed_settlement',
                };
                logger.error('trade-core', `UNCONFIRMED settlement optionId=${optionId} — NO_FILL (gale must not double)`);
            }
        }

        const finalStatus = closed.status as FinalStatus;
        const tradeResult: CoreFinal = {
            status: finalStatus,
            pnl: closed.pnl,
            tradeId: optionId,
            externalId: closed.externalId ?? externalId,
            pair,
            direction,
            amount,
            error: closed.error,
            settleSource: closed.settleSource,
            settleMs: Date.now() - t0,
        };

        // Persist finals only (NO_FILL stored as ERROR row for ops)
        const dbStatus = finalStatus === 'NO_FILL' ? 'ERROR' : finalStatus;
        db.prepare(`UPDATE trades SET status = ?, pnl = ?, external_id = ?, error = ?
                     WHERE trade_id = ? AND status = 'in_flight'`)
            .run(dbStatus, tradeResult.pnl, tradeResult.externalId ?? null, tradeResult.error ?? null, optionId);

        logger.info(
            'trade-core',
            `SETTLE final=${finalStatus} pair=${pair} amt=${amount} optionId=${optionId} ext=${tradeResult.externalId ?? '-'} source=${tradeResult.settleSource} ms=${tradeResult.settleMs}`,
        );
        return tradeResult;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (optionId != null) {
            db.prepare(`UPDATE trades SET status = 'ERROR', error = ? WHERE trade_id = ? AND status = 'in_flight'`)
                .run(msg, optionId);
        }
        if (optionId == null) return noFill(msg);
        // buy placed but outer throw — try recover
        const recovered = await recoverFinal(sdk, optionId, undefined, amount, t0);
        if (recovered) {
            const f: CoreFinal = {
                status: recovered.status,
                pnl: recovered.pnl,
                tradeId: optionId,
                externalId: recovered.externalId,
                pair,
                direction,
                amount,
                settleSource: recovered.settleSource,
                settleMs: Date.now() - t0,
            };
            db.prepare(`UPDATE trades SET status = ?, pnl = ?, external_id = ?, error = NULL WHERE trade_id = ?`)
                .run(f.status, f.pnl, f.externalId ?? null, optionId);
            return f;
        }
        return {
            status: 'NO_FILL',
            pnl: 0,
            tradeId: optionId,
            pair,
            direction,
            amount,
            error: `unconfirmed_after_error: ${msg}`,
            settleSource: 'none',
            settleMs: Date.now() - t0,
        };
    }
}
