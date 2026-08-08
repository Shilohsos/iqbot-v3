/** @ts-nocheck */
/** @ts-nocheck - reunified from dist */
// Auto Trading engine (directive §5). A long-lived background loop per user that
// rotates through up to 3 chosen assets, analyses each, and trades LIVE or DEMO.
// Keeps exactly one position open at a time. Independent of the request-scoped
// sdkPool (whose idle TTL would evict a multi-hour session), each runner owns its
// own SDK connection for the life of the session.
//
// ── Mode System (2026-06-15) ──
// Demo mode: admin privilege (200 candles, 6 indicators), 30 min/day timer.
// Live mode: FLO Drain (35-candle analysis → fade last outcome + streak detection + noise injection).
import { createSdk, runMartingaleCore } from './trade.js';
import { sdkPool } from './sdk-pool.js';
import { analyzePairWithSdk } from './analysis.js';
import { runAdminAnalysis } from './admin-analysis.js';
import { AUTO_CONFIDENCE_FLOOR, PRODUCT_LIMITS } from './access.js';
import { getAutoSession, getRunningAutoSessions, setAutoSessionStatus, recordAutoSessionTrade, recordAutoSessionEvaluation, getUser, getAdminSsid, setAutoSessionMgState, db, setProductMinutes, getProductUsage, getConfig, } from './db.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';
import { BalanceType } from './index.js';
let notifier;
const RECONNECT_BACKOFF_MS = [2000, 4000, 8000, 16000];
// Pause a session after this many consecutive failed/timed-out trades so a
// persistent OTC WebSocket issue can't retry-spam the user forever (Issue 1).
const MAX_CONSECUTIVE_ERRORS = 3;
// Privileged user IDs that get admin-grade analysis (200 candles, 6 indicators)
// in the auto engine even in demo mode. Module-level so it isn't rebuilt per loop.
const PRIV_IDS = new Set([6622587977, 8986669286, 6683209485]);
// ── Timer tracking for demo mode ──────────────────────────────────────────
// Accumulated demo minutes used today. `baselineMin` is the DB-stored total
// captured when the timer started, so totals SURVIVE a PM2 restart (the old code
// only counted in-memory ms and its flush overwrote the DB to a small value,
// handing every restart a fresh 30-minute cap).
const demoTimers = new Map();
/** Total demo minutes used today = DB baseline + this run's elapsed time. With no
 *  active timer (e.g. right after a restart) we read straight from the DB. */
function getDemoMinutesUsed(telegramId) {
    const t = demoTimers.get(telegramId);
    if (!t)
        return getProductUsage(telegramId, 'auto_trading').minutes;
    const liveMs = t.accumulatedMs + (t.startedAt > 0 ? Date.now() - t.startedAt : 0);
    return t.baselineMin + Math.ceil(liveMs / 60_000);
}
function flushDemoMinutes(telegramId, t) {
    const liveMs = t.accumulatedMs + (t.startedAt > 0 ? Date.now() - t.startedAt : 0);
    try {
        setProductMinutes(telegramId, 'auto_trading', t.baselineMin + Math.ceil(liveMs / 60_000));
    }
    catch (e) {
        logger.warn('auto', `flushDemoMinutes failed for ${telegramId}: ${e instanceof Error ? e.message : e}`);
    }
}
function startDemoTimer(telegramId) {
    const existing = demoTimers.get(telegramId);
    if (existing && existing.startedAt > 0)
        return; // already running
    const accumulatedMs = existing?.accumulatedMs ?? 0;
    // Capture the DB total once per timer lifecycle as the baseline (preserved
    // across pause/resume); a fresh process reads whatever survived the restart.
    const baselineMin = existing?.baselineMin ?? getProductUsage(telegramId, 'auto_trading').minutes;
    demoTimers.set(telegramId, {
        startedAt: Date.now(),
        accumulatedMs,
        baselineMin,
        flushTimer: setInterval(() => {
            const t = demoTimers.get(telegramId);
            if (t && t.startedAt > 0)
                flushDemoMinutes(telegramId, t);
        }, 60_000),
    });
}
function pauseDemoTimer(telegramId) {
    const t = demoTimers.get(telegramId);
    if (!t || t.startedAt <= 0)
        return t?.accumulatedMs ?? 0;
    const elapsed = Date.now() - t.startedAt;
    t.accumulatedMs += elapsed;
    t.startedAt = 0;
    if (t.flushTimer) {
        clearInterval(t.flushTimer);
        t.flushTimer = undefined;
    }
    flushDemoMinutes(telegramId, t);
    return t.accumulatedMs;
}
function stopDemoTimer(telegramId) {
    const totalMs = pauseDemoTimer(telegramId);
    demoTimers.delete(telegramId);
    return totalMs;
}
function tfLabel(sec) {
    return sec === 30 ? '30s' : sec === 60 ? '1m' : sec === 120 ? '2m' : sec === 300 ? '5m' : `${sec}s`;
}
/** Sleep until the next candle boundary for `tfSec`, with a small floor so the
 *  just-closed candle is available to the analyzer. */
function msToNextCandle(tfSec) {
    const now = Math.floor(Date.now() / 1000);
    const next = (Math.floor(now / tfSec) + 1) * tfSec;
    return Math.max(3000, (next - now) * 1000 + 1500);
}
/** Race a promise against a timeout. Rejects with a timeout error if the
 *  operation doesn't complete within `ms`. Prevents the auto-trading loop
 *  from freezing indefinitely on a hung WebSocket. */
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), ms);
        promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
}
class AutoRunner {
    session;
    sdk;
    stopping = false;
    statusMsgId;
    assets;
    lastWsNotify = 0;
    /** After one connection-error notice, stay silent until a successful trade. */
    wsNotifiedPending = false;
    ssid = ''; // current SSID; updated when reconnect() re-logs in for a fresh one
    busy = false; // busy lock: true while runMartingaleCore is in-flight
    mode;
    // ── Live engine state for the session card (visibility directive Part E) ──
    // The card previously showed only counters, so a session that was alive but
    // filtering weak setups looked identical to a dead one ("Active for 5 min,
    // no trades — is that normal?"). These drive one extra status line.
    engineState = 'scanning'; // scanning | watching | placed | paused | stopped
    skipsSinceTrade = 0;      // consecutive low-confidence skips since the last placed trade
    lastStateLine = '';       // last rendered line — re-render only on real change
    lastStateRenderAt = 0;    // throttle stamp (see maybeRenderState)
    constructor(session, mode) {
        this.session = session;
        this.assets = JSON.parse(session.assets);
        this.mode = mode ?? 'live';
        this.statusMsgId = session.status_msg_id ?? undefined;
        this._sessionPinned = false;
    }
    get chatId() { return this.session.telegram_id; }
    /** True once stop()/pause() has signalled the loop to exit. Lets the engine
     *  tell a dying runner apart from a live one (audit H3). */
    get isStopping() { return this.stopping; }
    async connect(ssid) {
        // R2: sticky pooled SDK + session pin for entire auto run (not only per-gale).
        this.ssid = ssid;
        this.sdk = await withTimeout(sdkPool.get(this.chatId, ssid), 60_000, 'connect');
        try { sdkPool.pin(this.chatId); } catch { /* */ } // session-level pin
        this._sessionPinned = true;
    }
    /** Reconnect with exponential backoff. First retries the same SSID (transient
     *  WebSocket drop); if that keeps failing the SSID is likely expired, so we
     *  re-login for a fresh SSID and build the SDK from that. Returns false only
     *  if everything fails. The fresh SSID is adopted for the rest of the run. */
    async reconnect(ssid) {
        for (const delay of RECONNECT_BACKOFF_MS) {
            if (this.stopping)
                return false;
            await new Promise(r => setTimeout(r, delay));
            try {
                try {
                    if (this._sessionPinned) { try { sdkPool.unpin(this.chatId); } catch {} this._sessionPinned = false; }
                    await sdkPool.shutdown(this.chatId);
                }
                catch { /* already gone */ }
                this.sdk = await withTimeout(sdkPool.get(this.chatId, ssid), 60_000, 'reconnect');
                try { sdkPool.pin(this.chatId); this._sessionPinned = true; } catch {}
                return true;
            }
            catch {
                logger.warn('auto', `reconnect attempt failed for ${this.chatId}`);
            }
        }
        // Same-SSID reconnect exhausted — the SSID is probably expired. Re-login
        // for a fresh one (directive Fix 2).
        try {
            const freshSsid = notifier ? await notifier.reconnect(this.chatId) : null;
            if (freshSsid) {
                this.ssid = freshSsid;
                try {
                    if (this._sessionPinned) { try { sdkPool.unpin(this.chatId); } catch {} this._sessionPinned = false; }
                    await sdkPool.shutdown(this.chatId);
                }
                catch { /* already gone */ }
                this.sdk = await withTimeout(sdkPool.get(this.chatId, freshSsid), 60_000, 'reconnect');
                try { sdkPool.pin(this.chatId); this._sessionPinned = true; } catch {}
                logger.info('auto', `re-logged in for ${this.chatId} with a fresh SSID`);
                return true;
            }
        }
        catch {
            logger.warn('auto', `fresh re-login failed for ${this.chatId}`);
        }
        return false;
    }
    /** The live engine-state line — tells the user the loop is alive and what it
     *  is doing, so a filtering session no longer looks like a dead one. Same
     *  visual style as the rest of the card (· marker, Markdown). */
    stateLine(sessionStatus: string): string {
        if (sessionStatus === 'paused')
            return '· Paused';
        if (sessionStatus === 'stopped')
            return '· Stopped';
        if (this.engineState === 'placed')
            return '· Trade placed — waiting settlement';
        if (this.engineState === 'watching' && this.skipsSinceTrade > 0) {
            const n = this.skipsSinceTrade;
            return `· Watching — ${n} setup${n === 1 ? '' : 's'} skipped (low confidence)`;
        }
        return '· Scanning market';
    }
    /** Re-render the card only when the state line actually changed, and at most
     *  once per 25s. Skips arrive at most one per candle, so this bounds card
     *  edits to ~2/min worst case while still showing the loop is alive — it
     *  extends the existing per-trade edit cadence rather than adding messages. */
    async maybeRenderState() {
        const s = getAutoSession(this.chatId);
        if (!s)
            return;
        if (this.stateLine(s.status) === this.lastStateLine)
            return;
        if (Date.now() - this.lastStateRenderAt < 25_000)
            return;
        await this.renderStatus();
    }
    async renderStatus(last?: string) {
        const s = getAutoSession(this.chatId);
        if (!s)
            return;
        const idx = (s.current_asset_index % this.assets.length) + 1;
        const wins = s.seq_wins ?? 0;
        const losses = s.seq_losses ?? 0;
        const scanned = (s.trades_done ?? 0) + (s.evaluations ?? 0);
        const asset = this.assets[s.current_asset_index % this.assets.length];
        const statusEmoji = s.status === 'running' ? '🟢 Live' : s.status === 'paused' ? '🟡 Paused' : '⚪ Stopped';
        const modeLabel = this.mode === 'demo' ? '✦ Demo' : '✦ Live';
        const stateLine = this.stateLine(s.status);
        const text = [
            `✦ *Autopilot* · ${statusEmoji} · ${modeLabel}`,
            ``,
            `${asset} (${idx}/${this.assets.length}) · ${tfLabel(s.timeframe)} · ${s.gale_rounds}-round recovery`,
            `Trades: ${s.trades_done}   Scanned: ${scanned}   Won: ${wins}   Lost: ${losses}`,
            stateLine,
            last ? `_${last}_` : '',
        ].filter(Boolean).join('\n');
        this.lastStateLine = stateLine;
        this.lastStateRenderAt = Date.now();
        const extra = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
                        { text: '❚❚ Pause', callback_data: 'auto:pause' },
                        { text: '■ Stop', callback_data: 'auto:stop' },
                    ]] },
        };
        try {
            if (this.statusMsgId) {
                await notifier?.editMessageText(this.chatId, this.statusMsgId, undefined, text, extra);
            }
            else {
                const m = await notifier?.sendMessage(this.chatId, text, extra);
                if (m?.message_id) {
                    this.statusMsgId = m.message_id;
                    // Persist so we can edit after restart
                    try {
                        db.prepare('UPDATE auto_trading_sessions SET status_msg_id = ? WHERE telegram_id = ?').run(m.message_id, this.chatId);
                    }
                    catch { }
                }
            }
        }
        catch { /* message edit races are non-fatal */ }
    }
    async notify(text, withResume = false) {
        const extra = withResume
            ? { reply_markup: { inline_keyboard: [[
                            { text: '►️ Resume', callback_data: 'auto:resume' },
                            { text: '■ Stop', callback_data: 'auto:stop' },
                        ]] } }
            : undefined;
        try {
            await notifier?.sendMessage(this.chatId, text, extra);
        }
        catch { /* ignore */ }
    }
    /** Notify the user about a connection hiccup AT MOST once until trading recovers.
     *  Flapping IQ Option sockets must not spam "retrying" every minute. */
    async maybeNotifyWsError(msg) {
        if (!/websocket|is closing|not open|^TIMEOUT:|timed out|timeout/i.test(msg))
            return false;
        // Already told them once — reconnect silently until we place a trade again.
        if (this.wsNotifiedPending)
            return true;
        const now = Date.now();
        // Hard floor: never more than once per 5 minutes even across recoveries.
        if (now - this.lastWsNotify < 5 * 60_000)
            return true;
        this.lastWsNotify = now;
        this.wsNotifiedPending = true;
        await this.notify('✦ Autopilot — ✦ Temporary connection issue with IQ Option.\n' +
            'Your account is safe. Reconnecting in the background…');
        return true;
    }
    clearWsNotifyLock() {
        this.wsNotifiedPending = false;
    }
    async liveBalance() {
        if (!this.sdk)
            return 0;
        const balanceType = this.mode === 'demo' ? BalanceType.Demo : BalanceType.Real;
        const all = (await this.sdk.balances()).getBalances();
        const target = all.find(b => b.type === balanceType) ?? all.find(b => b.type === undefined);
        const bal = target?.amount ?? 0;
        // Demo accounts get $10K practice balance from IQ Option — if the SDK
        // misreports it as 0, use the fallback so the engine doesn't pause.
        if (this.mode === 'demo' && bal <= 0)
            return 10_000;
        return bal;
    }
    // ── Demo timer check ──────────────────────────────────────────────────
    isDemoLimitReached() {
        if (this.mode !== 'demo')
            return false;
        const cap = PRODUCT_LIMITS.auto_trading.dailyCap; // 30 minutes
        const used = getDemoMinutesUsed(this.chatId);
        return used >= cap;
    }
    async handleDemoLimit() {
        setAutoSessionStatus(this.chatId, 'paused', 'demo_limit');
        stopDemoTimer(this.chatId);
        await this.notify(`· You've used your ${PRODUCT_LIMITS.auto_trading.dailyCap} minutes of demo Autopilot for today.\n\n` +
            `Fund $${PRODUCT_LIMITS.auto_trading.unlockBalance}+ for limitless live trading. ✦`, false);
    }
    // ── Analysis routing ──────────────────────────────────────────────────
    async analyzeAsset(asset, timeframeSec) {
        if (!this.sdk)
            throw new Error('No SDK connection');
        const isPrivileged = this.chatId === getAdminId() || PRIV_IDS.has(this.chatId);
        const useAdmin = this.mode === 'demo' || isPrivileged || getConfig('admin_analysis_all') === 'true';
        if (useAdmin) {
            // Admin analysis — Supertrend (200 candles, last 30)
            const turboOpts = await this.sdk.turboOptions();
            const norm = (s) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');
            const normalizedAsset = norm(asset);
            const active = turboOpts.getActives().find(a => norm(a.ticker) === normalizedAsset || norm(a.localizationKey) === normalizedAsset);
            if (!active)
                throw new Error(`Unknown pair: ${asset}`);
            const candlesFacade = await this.sdk.candles();
            const history = await candlesFacade.getCandles(active.id, timeframeSec, { count: 200 });
            if (history.length < 30)
                throw new Error('Not enough candle data for admin analysis');
            return runAdminAnalysis(history);
        }
        else {
            // Non-privileged live mode — 2-candle RSI
            return analyzePairWithSdk(this.sdk, asset, timeframeSec, 'MASTER', 2);
        }
    }
    async start(ssid) {
        this.ssid = ssid;
        logger.info('auto', `start() for ${this.chatId} (mode=${this.mode})`);
        try {
            await this.connect(ssid);
        }
        catch (err) {
            logger.error('auto', `connect failed for ${this.chatId}: ${err instanceof Error ? err.message : err}`);
            setAutoSessionStatus(this.chatId, 'paused', 'connect_failed');
            await this.notify('✦ Autopilot could not connect to your account. Reconnect and resume.', true);
            engineUnregister(this.chatId);
            return;
        }
        // Validate martingale state: mg_active on (re)start is only orphaned if
        // there is NO pending trade to recover. If an in-flight/TIMEOUT trade
        // exists (the process died mid-chain), PRESERVE the state — the periodic
        // recovery resolves the trade and advances mg_next_amount so the chain
        // continues doubling (restart-mid-chain bug: start() wiped the state,
        // recovery found mg_active=0, next trade restarted at the base amount).
        // RACE FIX: a pending-trade count alone is not enough. Boot fires
        // recoverMissedTradeResults() and restoreAll() concurrently, and start()
        // only reaches this check after `await this.connect(ssid)`. If recovery
        // wins that race it resolves the orphan (status → LOSS) and advances
        // mg_next_amount — and this check would then see pending=0 and CLEAR the
        // state recovery just advanced, reintroducing the base-amount restart the
        // fix was meant to remove. So decide from evidence, not from timing:
        //   pending trade            → mid-chain            → preserve
        //   last settled WIN/TIE     → chain finished       → clear
        //   last settled LOSS/other  → recovery advanced it → preserve
        //   no trade in the window   → genuinely orphaned   → clear
        // mg_active only survives a restart when the process died mid-chain (the
        // normal completion path clears it), so preserving is the safe default;
        // the loop's own WIN/TIE check re-clears anything this over-preserves.
        const s = getAutoSession(this.chatId);
        if (s?.mg_active) {
            const pending = db.prepare(`SELECT COUNT(*) c FROM trades
                WHERE telegram_id=? AND status IN ('in_flight','TIMEOUT')
                  AND created_at >= datetime('now','-45 minutes')`).get(this.chatId);
            if (pending.c > 0) {
                logger.info('auto', `preserving martingale state for ${this.chatId} (${pending.c} unresolved trade(s) — recovery will advance the chain)`);
            } else {
                const last = db.prepare(`SELECT status FROM trades
                    WHERE telegram_id=? AND created_at >= datetime('now','-45 minutes')
                    ORDER BY id DESC LIMIT 1`).get(this.chatId);
                if (!last) {
                    logger.warn('auto', `clearing orphaned martingale state for ${this.chatId} (no trade in the recovery window, was amount ${s.mg_next_amount})`);
                    setAutoSessionMgState(this.chatId, false);
                } else if (last.status === 'WIN' || last.status === 'TIE') {
                    logger.info('auto', `clearing martingale state for ${this.chatId} — chain already finished (last trade ${last.status})`);
                    setAutoSessionMgState(this.chatId, false);
                } else {
                    logger.info('auto', `preserving martingale state for ${this.chatId} (last trade ${last.status} — recovery resolved it before start(); chain continues at ${s.mg_next_amount})`);
                }
            }
        }
        // Start demo timer if in demo mode
        if (this.mode === 'demo') {
            startDemoTimer(this.chatId);
        }
        await this.renderStatus();
        logger.info('auto', `launching loop for ${this.chatId}`);
        // Synchronise the DB status with reality: if the runner is alive, the
        // session MUST say "running". Otherwise a stale "paused" in the DB
        // confuses the status card (admin sees Paused but trades keep coming).
        setAutoSessionStatus(this.chatId, 'running', null);
        // loop() guards itself, but catch here too so a launch-time throw is never
        // swallowed silently (the cause of "running but no trades" — Issue 2).
        this.loop(ssid).catch(err => {
            logger.error('auto', `loop launch rejected for ${this.chatId}: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
            const cur = getAutoSession(this.chatId);
            if (cur?.status === 'running')
                setAutoSessionStatus(this.chatId, 'paused', 'loop_launch_failed');
            engineUnregister(this.chatId);
        });
    }
    stop() {
        this.stopping = true;
        if (this._sessionPinned) {
            try { sdkPool.unpin(this.chatId); } catch { /* */ }
            this._sessionPinned = false;
        }
        try { sdkPool.release(this.chatId); } catch { /* */ }
        if (this.mode === 'demo') {
            stopDemoTimer(this.chatId);
        }
    }
    async loop(ssid) {
        this.ssid = ssid;
        let consecutiveErrors = 0;
        let closedStreak = 0; // consecutive closed-market rotations (pause when ALL pairs closed)
        logger.info('auto', `loop started for ${this.chatId} (mode=${this.mode})`);
        try {
            while (!this.stopping) {
                const s = getAutoSession(this.chatId);
                if (!s || s.status !== 'running')
                    break;
                // Demo mode: check time limit
                if (this.mode === 'demo' && this.isDemoLimitReached()) {
                    await this.handleDemoLimit();
                    break;
                }
                const idx = s.current_asset_index % this.assets.length;
                const asset = this.assets[idx];
                const nextIdx = (idx + 1) % this.assets.length;
                // Affordability guard — never fire a trade the balance can't cover.
                let balance;
                try {
                    balance = await withTimeout(this.liveBalance(), 10_000, 'liveBalance');
                }
                catch (err) {
                    if (!(await this.reconnect(this.ssid))) {
                        setAutoSessionStatus(this.chatId, 'paused', 'reconnect_failed');
                        await this.notify('✦ Autopilot paused — lost connection to your account. Resume when ready.', true);
                        break;
                    }
                    continue;
                }
                if (balance < s.amount) {
                    setAutoSessionStatus(this.chatId, 'paused', 'insufficient_balance');
                    await this.notify(`✦ Autopilot paused — balance ${balance.toFixed(2)} ${s.currency} is below your ${s.amount} ${s.currency} stake. Fund and resume.`, true);
                    break;
                }
                // Skip an asset that already has an open position (the 1-position
                // and no-duplicate-asset rules — directive §5.4).
                let hasOpen = false;
                try {
                    const positions = await withTimeout(this.sdk.positions(), 10_000, 'positions');
                    hasOpen = positions.getOpenedPositions().length > 0;
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    // Timeouts, auth expiry and WebSocket drops all mean the SDK is
                    // unhealthy — reconnect now instead of silently treating it as
                    // "no open position" and wasting an iteration (audit H1).
                    if (/^TIMEOUT:|auth|ssid|unauthor|401|websocket|is closing|not open/i.test(msg)) {
                        await this.reconnect(this.ssid);
                    }
                    /* benign/unknown errors: treat as none open; analysis surfaces real issues */
                }
                if (hasOpen) {
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
                // Skip if already executing a trade sequence (prevents duplicate positions
                // when two runners briefly coexist after a pause/resume race).
                if (this.busy) {
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                // ── Restart-orphan guard (REAL double-trade fix) ──────────────────
                // After a restart, a trade placed before the crash can still be
                // in_flight/TIMEOUT in the DB while IQ already settled it. If we
                // blindly analyse and place, we get a SECOND trade on the same pair
                // at the same time (double-trade complaints). Wait for the periodic
                // recovery to resolve it before placing anything new.
                const orphan = db.prepare(`SELECT COUNT(*) c FROM trades
                    WHERE telegram_id=? AND status IN ('in_flight','TIMEOUT')
                      AND created_at >= datetime('now','-45 minutes')`).get(this.chatId);
                if (orphan.c > 0) {
                    logger.info('auto', `waiting for recovery: ${this.chatId} has unresolved trade(s) (${orphan.c}) — not placing`);
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }
                // If the last trade before this loop was a WIN/TIE (recovery resolved
                // it), the chain is finished — clear stale martingale state so we
                // don't continue a chain that already ended.
                if (s.mg_active && s.mg_next_amount > 0) {
                    const lastTrade = db.prepare(`SELECT status FROM trades
                        WHERE telegram_id=? ORDER BY id DESC LIMIT 1`).get(this.chatId);
                    if (lastTrade && (lastTrade.status === 'WIN' || lastTrade.status === 'TIE')) {
                        logger.info('auto', `last trade was ${lastTrade.status} — clearing stale martingale state for ${this.chatId}`);
                        setAutoSessionMgState(this.chatId, false);
                    }
                }
                // Analyse; skip low-confidence setups without burning a trade.
                let direction;
                try {
                    const isPrivileged = this.chatId === getAdminId() || PRIV_IDS.has(this.chatId);
                    const useAdminAnalysis = isPrivileged || getConfig('admin_analysis_all') === 'true';
                    this.engineState = 'scanning';
                    await this.maybeRenderState();
                    let a: any;
                    if (this.mode === 'demo' || useAdminAnalysis) {
                        // Demo mode or privileged → admin analysis
                        a = await withTimeout(this.analyzeAsset(asset, s.timeframe), 15_000, 'analyze');
                    }
                    else {
                        a = await withTimeout(this.analyzeAsset(asset, s.timeframe), 15_000, 'analyze');
                    }
                    // Diagnosis (Part E.3): log EVERY analysis outcome so the per-user
                    // confidence distribution can be compared — this is the data that
                    // explains the 1-trade-then-silence asymmetry between users on the
                    // same engine and the same floor. Never gates anything.
                    logger.info('auto', `analysis uid=${this.chatId} asset=${asset} tf=${s.timeframe}s direction=${a.direction} confidence=${a.confidence}% score=${a.score ?? '-'} path=${(this.mode === 'demo' || useAdminAnalysis) ? 'admin' : 'rsi'} gated=${isPrivileged ? 'yes' : 'no'}`);
                    // Only privileged users get the quality gate. Everyone else trades
                    // whatever direction the analysis returns, regardless of confidence.
                    if (isPrivileged && a.confidence < AUTO_CONFIDENCE_FLOOR) {
                        // Skipped setup — advance the cursor and count an evaluation,
                        // NOT a trade. trades_done must only reflect placed trades.
                        this.skipsSinceTrade++;
                        logger.info('auto', `skip uid=${this.chatId} asset=${asset} confidence=${a.confidence}% (floor ${AUTO_CONFIDENCE_FLOOR}%) consecutive=${this.skipsSinceTrade}`);
                        this.engineState = 'watching';
                        recordAutoSessionEvaluation(this.chatId, nextIdx);
                        await this.maybeRenderState();
                        await new Promise(r => setTimeout(r, msToNextCandle(s.timeframe)));
                        continue;
                    }
                    direction = a.direction;
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (/auth|ssid|unauthor|401/i.test(msg) && !(await this.reconnect(this.ssid))) {
                        setAutoSessionStatus(this.chatId, 'paused', 'reconnect_failed');
                        await this.notify('✦ Autopilot paused — your session expired. Reconnect and resume.', true);
                        break;
                    }
                    if (await this.maybeNotifyWsError(msg)) {
                        await this.reconnect(this.ssid);
                    }
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
                // ── Martingale persistence: if a sequence was interrupted by a
                // restart, resume at the correct gale amount instead of the base.
                // Also reduce the remaining gale rounds so the total sequence
                // doesn't exceed the user's configured limit.
                let startAmount = s.amount;
                let effectiveGaleRounds = s.gale_rounds;
                if (s.mg_active && s.mg_next_amount > 0) {
                    startAmount = s.mg_next_amount;
                    // Calculate how many rounds have already been consumed.
                    // mg_next_amount = amount * 2^(rounds_used), so rounds_used = log2(mg_next_amount / amount).
                    const roundsUsed = Math.round(Math.log2(s.mg_next_amount / s.amount));
                    effectiveGaleRounds = Math.max(0, s.gale_rounds - roundsUsed);
                    logger.info('auto', `resuming martingale for ${this.chatId} at amount ${startAmount} (${roundsUsed} rounds used, ${effectiveGaleRounds} remaining)`);
                }
                setAutoSessionMgState(this.chatId, true, startAmount);
                // A setup cleared the gate — the card moves from watching/scanning to
                // "trade placed" and the skip streak resets (it counts skips SINCE the
                // last trade, which is what makes the silence stretches legible).
                logger.info('auto', `placing uid=${this.chatId} asset=${asset} direction=${direction} amount=${startAmount} (after ${this.skipsSinceTrade} skipped setup(s))`);
                this.skipsSinceTrade = 0;
                this.engineState = 'placed';
                await this.maybeRenderState();
                let outcome;
                let lastTradePnl = 0;
                const balanceType = this.mode === 'demo' ? 'demo' : 'live';
                this.busy = true; // prevent concurrent martingale from a duplicate runner
                try {
                    // Session pin held from connect() — no gale queue (Master: never wait trades)
                    // Timeout must cover the FULL chain: (galeRounds+1) trades × timeframe +
                    // settle overhead. A hardcoded 600s killed 5m-TF chains mid-flight,
                    // leaving the underlying chain running while the catch started a
                    // second chain on the next asset (double trades, different pairs).
                    const chainTimeoutMs =
                        (effectiveGaleRounds + 1) * s.timeframe * 1000 + 120_000;
                    outcome = await withTimeout(runMartingaleCore(this.sdk, {
                        pair: asset, direction, amount: startAmount, timeframeSec: s.timeframe,
                        galeRounds: effectiveGaleRounds, balanceType, telegramId: this.chatId,
                    }, (info) => {
                        if (info.result.status === 'WIN') {
                            lastTradePnl = info.result.pnl - info.amount;
                        }
                        else if (info.result.status === 'LOSS') {
                            lastTradePnl = -info.amount;
                        }
                        else {
                            lastTradePnl = 0;
                        }
                        const nextAmt = info.result.status === 'LOSS'
                            ? info.amount * 2
                            : s.amount;
                        setAutoSessionMgState(this.chatId, true, nextAmt);
                    }), chainTimeoutMs, 'runMartingaleCore');
                }
                catch (err) {
                    this.busy = false; // release lock on error so loop can continue
                    setAutoSessionMgState(this.chatId, false);
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.warn('auto', `trade run failed for ${this.chatId}: ${msg}`);
                    // Reconnect silently on auth/WebSocket errors — no per-error
                    // "retrying" spam; the pause message below is the only notice.
                    const isConnErr = /auth|ssid|unauthor|401|websocket|is closing|not open|timeout/i.test(msg);
                    if (isConnErr && !(await this.reconnect(this.ssid))) {
                        setAutoSessionStatus(this.chatId, 'paused', 'reconnect_failed');
                        await this.notify('✦ Autopilot paused — lost connection to your account. Resume when ready.', true);
                        break;
                    }
                    // Rotate off the failing asset and bound consecutive failures so a
                    // persistent OTC timeout can't loop (and spam) forever (Issue 1).
                    recordAutoSessionEvaluation(this.chatId, nextIdx);
                    consecutiveErrors++;
                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        setAutoSessionStatus(this.chatId, 'paused', 'repeated_errors');
                        await this.notify('✦ Autopilot paused — repeated errors (likely a temporary connection issue). Tap Resume to try again.', true);
                        break;
                    }
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
                // Sequence complete — clear martingale state (keep session pin until stop()).
                setAutoSessionMgState(this.chatId, false);
                this.busy = false; // release busy lock so next iteration can trade
                console.log(`[auto-trade] uid=${this.chatId} outcome=${outcome.status} totalPnl=${outcome.totalPnl} rounds=${outcome.rounds} mode=${this.mode}`);
                const isError = outcome.status === 'ERROR' || outcome.status === 'TIMEOUT' || outcome.status === 'NO_FILL';
                if (isError) {
                    // Rotate to the next asset (don't count it as a trade).
                    recordAutoSessionEvaluation(this.chatId, nextIdx);
                    // A closed market is NOT an error: skip that pair and move on.
                    // Only real connection/trade errors count against the pause
                    // budget, so a session with one open pair keeps trading while
                    // its other pairs are in their closed window.
                    const closedNow = outcome.status === 'NO_FILL' &&
                        /market is closed|unknown pair|not available|no .*instrument available|no .*balance found/i.test(outcome.error ?? '');
                    if (closedNow) {
                        closedStreak++;
                        logger.warn('auto', `pair ${asset} closed for ${this.chatId} — rotating (${closedStreak}/${this.assets.length})`);
                        if (closedStreak >= this.assets.length) {
                            setAutoSessionStatus(this.chatId, 'paused', 'market_closed');
                            await this.notify('✦ Autopilot paused — all selected pairs are closed right now (market hours). Resume when they open.', true);
                            break;
                        }
                    }
                    else {
                        closedStreak = 0;
                        consecutiveErrors++;
                        logger.warn('auto', `trade ${outcome.status} for ${this.chatId} — consecutive=${consecutiveErrors}`);
                        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                            setAutoSessionStatus(this.chatId, 'paused', 'repeated_timeouts');
                            await this.notify('✦ Autopilot paused — trades kept timing out (likely a temporary connection issue). Tap Resume to try again.', true);
                            break;
                        }
                    }
                }
                else {
                    consecutiveErrors = 0;
                    closedStreak = 0;
                    this.clearWsNotifyLock(); // connection recovered — allow one notice next time it drops
                    recordAutoSessionTrade(this.chatId, nextIdx, outcome.totalPnl, outcome.status);
                    const s2 = getAutoSession(this.chatId);
                    console.log(`[auto-trade] uid=${this.chatId} AFTER record: sessionPnl=${s2?.pnl} trades=${s2?.trades_done} wins=${s2?.seq_wins} losses=${s2?.seq_losses}`);
                    const emoji = outcome.status === 'WIN' ? '🟢' : outcome.status === 'TIE' ? '⚪' : '';
                    const outcomeLabel = outcome.status === 'WIN' ? 'Won' : outcome.status === 'TIE' ? 'Draw' : 'Lost';
                    // Chain settled — back to scanning so the state line doesn't stay
                    // stuck on "Trade placed" through the next quiet stretch.
                    this.engineState = 'scanning';
                    await this.renderStatus(`${emoji} ${outcomeLabel}`.trim());
                }
                await new Promise(r => setTimeout(r, msToNextCandle(s.timeframe)));
            }
            logger.info('auto', `loop ended normally for ${this.chatId} (stopping=${this.stopping})`);
        }
        catch (err) {
            // An unexpected throw would otherwise leave the session 'running' with a
            // dead runner (Issue 2). Log it loudly; the finally normalizes status.
            logger.error('auto', `loop crashed for ${this.chatId}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        }
        finally {
            this.busy = false;
            try {
                await this.sdk?.shutdown();
            }
            catch { /* ignore */ }
            this.sdk = undefined;
            // If a replacement runner has already taken over (pause→resume race),
            // this dying runner must NOT touch shared state — no status flip, no
            // unregister of the new runner, no demo-timer stop (audit H3).
            if (runners.get(this.chatId) === this) {
                const s = getAutoSession(this.chatId);
                if (s?.status === 'running')
                    setAutoSessionStatus(this.chatId, 'paused', 'loop_exited');
                await this.renderStatus();
                if (this.mode === 'demo') {
                    stopDemoTimer(this.chatId);
                }
                engineUnregister(this.chatId);
            }
            else {
                logger.info('auto', `superseded runner for ${this.chatId} exited quietly`);
            }
        }
    }
}
const runners = new Map();
function engineUnregister(telegramId) { runners.delete(telegramId); }
function ssidFor(telegramId) {
    // Admin trading uses config.admin_ssid (set by admin connect), NOT users.ssid.
    // users.ssid for the admin Telegram account can be a separate personal account
    // with a tiny balance — that was pausing auto-trading at ₦7.72 despite a funded admin account.
    if (telegramId === getAdminId()) {
        return getAdminSsid() ?? process.env.IQ_SSID ?? null;
    }
    const user = getUser(telegramId);
    return user?.ssid ?? process.env.IQ_SSID ?? null;
}
export function initAutoEngine(n) { notifier = n; }
export const autoEngine = {
    isRunning(telegramId) {
        return runners.has(telegramId);
    },
    getDemoMinutes(telegramId) {
        return getDemoMinutesUsed(telegramId);
    },
    /** Start (or restart) the engine for a user whose session row is already 'running'. */
    start(telegramId, mode) {
        // If a runner already exists, stop it cleanly before starting a new one.
        // This prevents duplicate runners that can place concurrent trades.
        const existing = runners.get(telegramId);
        if (existing) {
            if (!existing.isStopping) {
                existing.stop();
                setAutoSessionMgState(telegramId, false);
                logger.warn('auto', `stopping existing runner for ${telegramId} before starting new one`);
            }
            // Give the old runner a moment to exit its loop
            engineUnregister(telegramId);
        }
        const session = getAutoSession(telegramId);
        if (!session || session.status !== 'running')
            return false;
        const ssid = ssidFor(telegramId);
        if (!ssid) {
            setAutoSessionStatus(telegramId, 'paused', 'no_ssid');
            return false;
        }
        const runner = new AutoRunner(session, mode);
        runners.set(telegramId, runner);
        void runner.start(ssid);
        return true;
    },
    /** Graceful stop — finishes the current run, then the loop exits. */
    stop(telegramId) {
        setAutoSessionStatus(telegramId, 'stopped');
        runners.get(telegramId)?.stop();
    },
    pause(telegramId) {
        setAutoSessionStatus(telegramId, 'paused');
        const runner = runners.get(telegramId);
        if (runner) {
            if (runner.mode === 'demo') {
                pauseDemoTimer(telegramId);
            }
            runner.stop();
        }
    },
    /** Resume a paused session from where it left off. */
    resume(telegramId) {
        const session = getAutoSession(telegramId);
        if (!session)
            return false;
        setAutoSessionStatus(telegramId, 'running', null);
        const runner = runners.get(telegramId);
        const mode = runner?.mode ?? getAutoSessionMode(telegramId);
        return this.start(telegramId, mode);
    },
    /** Rehydrate every 'running' session after a process restart (directive §5.5/E). */
    async restoreAll() {
        const sessions = getRunningAutoSessions();
        for (const s of sessions) {
            const ssid = ssidFor(s.telegram_id);
            if (!ssid) {
                setAutoSessionStatus(s.telegram_id, 'paused', 'reconnect_failed');
                continue;
            }
            const mode = getAutoSessionMode(s.telegram_id);
            const runner = new AutoRunner(s, mode);
            runners.set(s.telegram_id, runner);
            logger.info('auto', `restoring session for ${s.telegram_id} (mode=${mode})`);
            runner.start(ssid).catch(err => {
                logger.error('auto', `restore start failed for ${s.telegram_id}: ${err instanceof Error ? err.message : err}`);
                engineUnregister(s.telegram_id);
            });
        }
        if (sessions.length)
            logger.info('auto', `restored ${sessions.length} auto-trading session(s)`);
    },
};
/** Read the stored mode from the auto_trading_sessions table (or default to 'live'). */
function getAutoSessionMode(telegramId) {
    try {
        const row = db.prepare('SELECT mode FROM auto_trading_sessions WHERE telegram_id = ?').get(telegramId);
        if (row?.mode === 'demo')
            return 'demo';
    }
    catch { }
    return 'live';
}
