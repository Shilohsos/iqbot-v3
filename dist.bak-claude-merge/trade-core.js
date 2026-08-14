/**
 * TradeCore — single settlement authority (Upgrade Phase 2).
 *
 * LAW: Callers never receive TIMEOUT as a gale input.
 * Finals only: WIN | LOSS | TIE | NO_FILL
 */
import { BlitzOptionsDirection, BalanceType, } from './index.js';
import { db } from './db.js';
import { logger } from './logger.js';
const normTicker = (s) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
function sdkTimeout(p, label, ms = 15_000) {
    return Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`SDK ${label} timed out`)), ms)),
    ]);
}
function isTimeoutError(err) {
    if (!(err instanceof Error))
        return false;
    return err.name === 'TimeoutError' || /timed out|TimeoutError/i.test(err.message);
}
function mapCloseReason(reason, pnl) {
    const r = (reason || '').toLowerCase();
    if (r === 'win')
        return 'WIN';
    if (r === 'equal')
        return 'TIE';
    if (r === 'loss' || r === 'loose')
        return 'LOSS';
    if (r === 'win' || r === 'equal' || r === 'loss' || r === 'loose')
        return null;
    // unknown reason
    if (pnl > 0)
        return 'WIN';
    if (pnl === 0 && r === '')
        return null;
    if (pnl <= 0 && r)
        return 'LOSS';
    return pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : null;
}
function finalFromPosition(pos) {
    if (pos.status && pos.status !== 'closed')
        return null;
    const pnl = Number(pos.closeProfit ?? 0);
    const reason = String(pos.closeReason ?? '');
    const mapped = mapCloseReason(reason, pnl);
    if (!mapped) {
        // closed with no reason: profit decides; flat → TIE
        if (pnl > 0)
            return { status: 'WIN', pnl, externalId: pos.externalId, settleSource: 'history' };
        if (pnl === 0)
            return { status: 'TIE', pnl: 0, externalId: pos.externalId, settleSource: 'history' };
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
export async function recoverFinal(sdk, optionId, externalId, amount, startedAtMs) {
    try {
        const positions = await sdkTimeout(sdk.positions(), 'positions-recover', 12_000);
        const attempts = 6;
        for (let i = 0; i < attempts; i++) {
            // 1) still open?
            const opened = positions.getOpenedPositions();
            let ext = externalId;
            if (ext == null) {
                const m = opened.find(p => p.orderIds?.includes(optionId));
                if (m?.externalId != null)
                    ext = m.externalId;
            }
            if (ext != null) {
                const live = opened.find(p => p.externalId === ext);
                if (live?.status === 'closed') {
                    const f = finalFromPosition(live);
                    if (f)
                        return { status: f.status, pnl: f.pnl, externalId: ext, settleSource: 'poll' };
                }
            }
            // 2) history by externalId then optionId
            try {
                const hist = positions.getPositionsHistory();
                for (const id of [ext, optionId].filter((x) => x != null && x > 0)) {
                    try {
                        const hp = await hist.getPositionHistory(id);
                        if (hp && hp.status === 'closed') {
                            const f = finalFromPosition(hp);
                            if (f)
                                return { status: f.status, pnl: f.pnl, externalId: ext ?? hp.externalId, settleSource: 'history' };
                        }
                    }
                    catch { /* try next id */ }
                }
            }
            catch { /* */ }
            // 3) history page scan by amount + time window
            try {
                const facade = positions.positionsHistoryFacade;
                if (facade?.fetchPrevPage)
                    await facade.fetchPrevPage().catch(() => { });
                const list = typeof facade?.getPositions === 'function' ? await facade.getPositions() : [];
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
                    if (f)
                        return { status: f.status, pnl: f.pnl, externalId: match.externalId, settleSource: 'history' };
                }
            }
            catch { /* */ }
            await new Promise(r => setTimeout(r, 1500 + i * 500));
        }
    }
    catch (e) {
        logger.warn('trade-core', `recoverFinal failed: ${e instanceof Error ? e.message : e}`);
    }
    return null;
}
function waitForClose(positions, optionId, timeoutSeconds) {
    return new Promise(resolve => {
        let externalId;
        let done = false;
        const finish = (r) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            clearInterval(poll);
            try {
                positions.unsubscribeOnUpdatePosition(callback);
            }
            catch { /* */ }
            resolve(r);
        };
        const mapPos = (pos, source) => {
            const pnl = pos.closeProfit ?? 0;
            const reason = pos.closeReason ?? '';
            let status;
            if (reason === 'win')
                status = 'WIN';
            else if (reason === 'equal')
                status = 'TIE';
            else if (reason === 'loss' || reason === 'loose')
                status = 'LOSS';
            else
                status = pnl > 0 ? 'WIN' : pnl === 0 ? 'TIE' : 'LOSS';
            finish({ status, pnl: status === 'WIN' ? pnl : 0, externalId, settleSource: source });
        };
        const timer = setTimeout(() => {
            finish({ status: 'TIMEOUT', pnl: 0, externalId, settleSource: 'none', error: 'Result timeout' });
        }, timeoutSeconds * 1000);
        const existing = positions.getOpenedPositions().find(p => p.orderIds.includes(optionId));
        if (existing)
            externalId = existing.externalId;
        const callback = (pos) => {
            if (externalId === undefined && pos.orderIds.includes(optionId))
                externalId = pos.externalId;
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
                    if (m)
                        externalId = m.externalId;
                }
                if (externalId === undefined)
                    return;
                const pos = opened.find(p => p.externalId === externalId);
                if (pos?.status === 'closed') {
                    mapPos(pos, 'poll');
                    return;
                }
                if (!pos) {
                    try {
                        const hist = positions.getPositionsHistory();
                        let hp = null;
                        try {
                            hp = await hist.getPositionHistory(externalId);
                        }
                        catch { /* */ }
                        if (!hp || hp.status !== 'closed') {
                            try {
                                hp = await hist.getPositionHistory(optionId);
                            }
                            catch { /* */ }
                        }
                        if (hp && hp.status === 'closed') {
                            const pnl = hp.closeProfit ?? 0;
                            const reason = hp.closeReason ?? '';
                            let status;
                            if (reason === 'win')
                                status = 'WIN';
                            else if (reason === 'equal')
                                status = 'TIE';
                            else if (reason === 'loss' || reason === 'loose')
                                status = 'LOSS';
                            else
                                status = pnl > 0 ? 'WIN' : pnl === 0 ? 'TIE' : 'LOSS';
                            finish({ status, pnl: status === 'WIN' ? pnl : 0, externalId, settleSource: 'history' });
                        }
                    }
                    catch { /* next poll */ }
                }
            }
            catch { /* */ }
        }, 2000);
    });
}
/**
 * Place + await FINAL. Never returns TIMEOUT to caller.
 */
export async function settle(sdk, order) {
    const t0 = Date.now();
    const pair = order.pair;
    const direction = order.direction;
    const amount = order.amount;
    let optionId;
    const noFill = (error) => ({
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
        const positions = await sdkTimeout(sdk.positions(), 'positions');
        const balances = await sdkTimeout(sdk.balances(), 'balances');
        const wantLive = order.balanceType === 'live';
        let selectedBalance = balances.getBalances().find(b => b.type === (wantLive ? BalanceType.Real : BalanceType.Demo));
        if (!selectedBalance) {
            selectedBalance = wantLive
                ? balances.getBalances().find(b => b.type === undefined || b.type === BalanceType.Real)
                : balances.getBalances().find(b => b.type === undefined || b.type === BalanceType.Demo);
        }
        if (!selectedBalance)
            return noFill(wantLive ? 'No real balance found' : 'No demo balance found');
        const currentTime = sdk.currentTime();
        const targetSize = order.timeframeSec ?? 60;
        const normalizedInput = normTicker(pair);
        const blitzOptions = await sdkTimeout(sdk.blitzOptions(), 'blitzOptions');
        // refresh actives when available
        try {
            await blitzOptions.refreshActives?.();
        }
        catch { /* */ }
        const active = blitzOptions.getActives().find(a => normTicker(a.ticker) === normalizedInput ||
            normTicker(a.localizationKey) === normalizedInput);
        if (!active)
            return noFill(`Unknown pair: ${pair}`);
        if (!active.canBeBoughtAt(currentTime))
            return noFill(`${pair} market is closed right now`);
        if (!active.expirationTimes.includes(targetSize))
            return noFill(`No ${targetSize}s instrument available for ${pair}`);
        const dir = direction === 'call' ? BlitzOptionsDirection.Call : BlitzOptionsDirection.Put;
        let option;
        try {
            option = await sdkTimeout(blitzOptions.buy(active, dir, targetSize, amount, selectedBalance), 'buy');
        }
        catch (buyErr) {
            const msg = buyErr instanceof Error ? buyErr.message : String(buyErr);
            // one silent refresh+retry on profit rate
            if (/4117|profit rate|not been purchased/i.test(msg)) {
                try {
                    await blitzOptions.refreshActives?.();
                    await new Promise(r => setTimeout(r, 400));
                    option = await sdkTimeout(blitzOptions.buy(active, dir, targetSize, amount, selectedBalance), 'buy-retry');
                }
                catch (e2) {
                    return noFill(e2 instanceof Error ? e2.message : String(e2));
                }
            }
            else if (isTimeoutError(buyErr) || /WebSocket|is closing|not open/i.test(msg)) {
                return noFill(`Buy failed — no trade placed (${msg})`);
            }
            else {
                return noFill(msg);
            }
        }
        optionId = option.id;
        const nowSql = new Date().toISOString();
        if (order.telegramId != null) {
            db.prepare(`INSERT OR IGNORE INTO users (telegram_id, created_at, last_used) VALUES (?, datetime('now'), datetime('now'))`)
                .run(order.telegramId);
        }
        db.prepare(`INSERT INTO trades (telegram_id, pair, direction, amount, status, trade_id, created_at, timeframe_sec)
                     VALUES (?, ?, ?, ?, 'in_flight', ?, ?, ?)`)
            .run(order.telegramId ?? null, pair, direction, amount, optionId, nowSql, order.timeframeSec ?? 60);
        let externalId;
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
        if (closed.externalId)
            externalId = closed.externalId;
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
            }
            else {
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
        const finalStatus = closed.status;
        const tradeResult = {
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
        logger.info('trade-core', `SETTLE final=${finalStatus} pair=${pair} amt=${amount} optionId=${optionId} ext=${tradeResult.externalId ?? '-'} source=${tradeResult.settleSource} ms=${tradeResult.settleMs}`);
        return tradeResult;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (optionId != null) {
            db.prepare(`UPDATE trades SET status = 'ERROR', error = ? WHERE trade_id = ? AND status = 'in_flight'`)
                .run(msg, optionId);
        }
        if (optionId == null)
            return noFill(msg);
        // buy placed but outer throw — try recover
        const recovered = await recoverFinal(sdk, optionId, undefined, amount, t0);
        if (recovered) {
            const f = {
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
