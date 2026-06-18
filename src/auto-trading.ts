// Auto Trading engine (directive §5). A long-lived background loop per user that
// rotates through up to 3 chosen assets, analyses each, and trades LIVE or DEMO.
// Keeps exactly one position open at a time. Independent of the request-scoped
// sdkPool (whose idle TTL would evict a multi-hour session), each runner owns its
// own SDK connection for the life of the session.
//
// ── Mode System (2026-06-15) ──
// Demo mode: admin privilege (200 candles, 6 indicators), 30 min/day timer.
// Live mode: drainage (5 candles, RSI only), unlimited above $100/$10 thresholds.
// Timer: wall-clock, pauses on stop, resumes on start.

import type { ClientSdk } from './index.js';
import { createSdk, runMartingaleCore, type MartingaleOutcome } from './trade.js';
import { analyzePairWithSdk } from './analysis.js';
import { runAdminAnalysis, type AdminCandle } from './admin-analysis.js';
import { AUTO_CONFIDENCE_FLOOR, PRODUCT_LIMITS } from './access.js';
import {
    getAutoSession, getRunningAutoSessions, setAutoSessionStatus,
    recordAutoSessionTrade, recordAutoSessionEvaluation, getUser,
    setAutoSessionMgState, type AutoTradingSession,
    db, setProductMinutes, getProductUsage,
} from './db.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';
import { friendlyError } from './errors.js';
import { BalanceType } from './index.js';

// Minimal Telegram surface we need — injected from bot.ts to avoid a circular import.
interface Notifier {
    sendMessage(chatId: number, text: string, extra?: unknown): Promise<{ message_id: number }>;
    editMessageText(chatId: number, msgId: number, inlineId: undefined, text: string, extra?: unknown): Promise<unknown>;
    /** Re-login with stored creds and return the fresh SSID, or null on failure.
     *  Injected from bot.ts (which owns autoReconnect/loginAndCaptureSsid). */
    reconnect(telegramId: number): Promise<string | null>;
}

let notifier: Notifier | undefined;
const RECONNECT_BACKOFF_MS = [2000, 4000, 8000, 16000];
// Pause a session after this many consecutive failed/timed-out trades so a
// persistent OTC WebSocket issue can't retry-spam the user forever (Issue 1).
const MAX_CONSECUTIVE_ERRORS = 3;

// Privileged user IDs that get admin-grade analysis (200 candles, 6 indicators)
// in the auto engine even in demo mode. Module-level so it isn't rebuilt per loop.
const PRIV_IDS = new Set([6622587977, 8986669286, 6683209485, 8471649166]);

// ── Timer tracking for demo mode ──────────────────────────────────────────

// Accumulated demo minutes used today. `baselineMin` is the DB-stored total
// captured when the timer started, so totals SURVIVE a PM2 restart (the old code
// only counted in-memory ms and its flush overwrote the DB to a small value,
// handing every restart a fresh 30-minute cap).
const demoTimers = new Map<number, { startedAt: number; accumulatedMs: number; baselineMin: number; flushTimer?: ReturnType<typeof setInterval> }>();

/** Total demo minutes used today = DB baseline + this run's elapsed time. With no
 *  active timer (e.g. right after a restart) we read straight from the DB. */
function getDemoMinutesUsed(telegramId: number): number {
    const t = demoTimers.get(telegramId);
    if (!t) return getProductUsage(telegramId, 'auto_trading').minutes;
    const liveMs = t.accumulatedMs + (t.startedAt > 0 ? Date.now() - t.startedAt : 0);
    return t.baselineMin + Math.ceil(liveMs / 60_000);
}

function flushDemoMinutes(telegramId: number, t: { startedAt: number; accumulatedMs: number; baselineMin: number }): void {
    const liveMs = t.accumulatedMs + (t.startedAt > 0 ? Date.now() - t.startedAt : 0);
    try { setProductMinutes(telegramId, 'auto_trading', t.baselineMin + Math.ceil(liveMs / 60_000)); } catch {}
}

function startDemoTimer(telegramId: number): void {
    const existing = demoTimers.get(telegramId);
    if (existing && existing.startedAt > 0) return; // already running
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
            if (t && t.startedAt > 0) flushDemoMinutes(telegramId, t);
        }, 60_000),
    });
}

function pauseDemoTimer(telegramId: number): number {
    const t = demoTimers.get(telegramId);
    if (!t || t.startedAt <= 0) return t?.accumulatedMs ?? 0;
    const elapsed = Date.now() - t.startedAt;
    t.accumulatedMs += elapsed;
    t.startedAt = 0;
    if (t.flushTimer) { clearInterval(t.flushTimer); t.flushTimer = undefined; }
    flushDemoMinutes(telegramId, t);
    return t.accumulatedMs;
}

function stopDemoTimer(telegramId: number): number {
    const totalMs = pauseDemoTimer(telegramId);
    demoTimers.delete(telegramId);
    return totalMs;
}

function tfLabel(sec: number): string {
    return sec === 30 ? '30s' : sec === 60 ? '1m' : sec === 300 ? '5m' : `${sec}s`;
}

/** Sleep until the next candle boundary for `tfSec`, with a small floor so the
 *  just-closed candle is available to the analyzer. */
function msToNextCandle(tfSec: number): number {
    const now = Math.floor(Date.now() / 1000);
    const next = (Math.floor(now / tfSec) + 1) * tfSec;
    return Math.max(3000, (next - now) * 1000 + 1500);
}

/** Race a promise against a timeout. Rejects with a timeout error if the
 *  operation doesn't complete within `ms`. Prevents the auto-trading loop
 *  from freezing indefinitely on a hung WebSocket. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), ms);
        promise.then(
            v => { clearTimeout(timer); resolve(v); },
            e => { clearTimeout(timer); reject(e); },
        );
    });
}

class AutoRunner {
    private sdk: ClientSdk | undefined;
    private stopping = false;
    private statusMsgId: number | undefined;
    private assets: string[];
    private lastWsNotify = 0;
    private ssid = '';   // current SSID; updated when reconnect() re-logs in for a fresh one
    public readonly mode: 'demo' | 'live';

    constructor(public readonly session: AutoTradingSession, mode?: 'demo' | 'live') {
        this.assets = JSON.parse(session.assets) as string[];
        this.mode = mode ?? 'live';
        this.statusMsgId = session.status_msg_id ?? undefined;
    }

    private get chatId(): number { return this.session.telegram_id; }

    private async connect(ssid: string): Promise<void> {
        this.sdk = await createSdk(ssid);
    }

    /** Reconnect with exponential backoff. First retries the same SSID (transient
     *  WebSocket drop); if that keeps failing the SSID is likely expired, so we
     *  re-login for a fresh SSID and build the SDK from that. Returns false only
     *  if everything fails. The fresh SSID is adopted for the rest of the run. */
    private async reconnect(ssid: string): Promise<boolean> {
        for (const delay of RECONNECT_BACKOFF_MS) {
            if (this.stopping) return false;
            await new Promise(r => setTimeout(r, delay));
            try {
                try { await this.sdk?.shutdown(); } catch { /* already gone */ }
                this.sdk = await createSdk(ssid);
                return true;
            } catch {
                logger.warn('auto', `reconnect attempt failed for ${this.chatId}`);
            }
        }
        // Same-SSID reconnect exhausted — the SSID is probably expired. Re-login
        // for a fresh one (directive Fix 2).
        try {
            const freshSsid = notifier ? await notifier.reconnect(this.chatId) : null;
            if (freshSsid) {
                this.ssid = freshSsid;
                try { await this.sdk?.shutdown(); } catch { /* already gone */ }
                this.sdk = await createSdk(freshSsid);
                logger.info('auto', `re-logged in for ${this.chatId} with a fresh SSID`);
                return true;
            }
        } catch {
            logger.warn('auto', `fresh re-login failed for ${this.chatId}`);
        }
        return false;
    }

    private async renderStatus(last?: string): Promise<void> {
        const s = getAutoSession(this.chatId);
        if (!s) return;
        const idx = (s.current_asset_index % this.assets.length) + 1;
        const sign = s.pnl >= 0 ? '+' : '';
        const pnlFormatted = `${sign}${s.pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${s.currency}`;
        const asset = this.assets[s.current_asset_index % this.assets.length];
        const statusEmoji = s.status === 'running' ? '🟢 Live' : s.status === 'paused' ? '🟡 Paused' : '⚪ Stopped';
        const modeLabel = this.mode === 'demo' ? '🎮 Demo' : '💎 Live';
        const text = [
            `🚀 *Auto Trading* · ${statusEmoji} · ${modeLabel}`,
            ``,
            `${asset} (${idx}/${this.assets.length}) · ${tfLabel(s.timeframe)} · ${s.gale_rounds}-round recovery`,
            `Trades: ${s.trades_done}   Scanned: ${s.evaluations}   P&L: ${pnlFormatted}`,
            last ? `_${last}_` : '',
        ].filter(Boolean).join('\n');
        const extra = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
                { text: '⏸ Pause', callback_data: 'auto:pause' },
                { text: '⏹ Stop', callback_data: 'auto:stop' },
            ]] },
        };
        try {
            if (this.statusMsgId) {
                await notifier?.editMessageText(this.chatId, this.statusMsgId, undefined, text, extra);
            } else {
                const m = await notifier?.sendMessage(this.chatId, text, extra);
                if (m?.message_id) {
                    this.statusMsgId = m.message_id;
                    // Persist so we can edit after restart
                    try { db.prepare('UPDATE auto_trading_sessions SET status_msg_id = ? WHERE telegram_id = ?').run(m.message_id, this.chatId); } catch {}
                }
            }
        } catch { /* message edit races are non-fatal */ }
    }

    private async notify(text: string, withResume = false): Promise<void> {
        const extra = withResume
            ? { reply_markup: { inline_keyboard: [[
                { text: '▶️ Resume', callback_data: 'auto:resume' },
                { text: '⏹ Stop', callback_data: 'auto:stop' },
            ]] } }
            : undefined;
        try { await notifier?.sendMessage(this.chatId, text, extra); } catch { /* ignore */ }
    }

    /** Notify the user about a WebSocket hiccup at most once per minute so a
     *  flapping connection doesn't spam them. Returns true if the error was a WS error. */
    private async maybeNotifyWsError(msg: string): Promise<boolean> {
        if (!/websocket|is closing|not open|^TIMEOUT:/i.test(msg)) return false;
        const now = Date.now();
        if (now - this.lastWsNotify > 60_000) {
            this.lastWsNotify = now;
            await this.notify(`🚀 Auto Trading — ${friendlyError(new Error(msg))} Retrying automatically.`);
        }
        return true;
    }

    private async liveBalance(): Promise<number> {
        if (!this.sdk) return 0;
        const balanceType = this.mode === 'demo' ? BalanceType.Demo : BalanceType.Real;
        const all = (await this.sdk.balances()).getBalances();
        const target = all.find(b => b.type === balanceType) ?? all.find(b => b.type === undefined);
        const bal = target?.amount ?? 0;
        // Demo accounts get $10K practice balance from IQ Option — if the SDK
        // misreports it as 0, use the fallback so the engine doesn't pause.
        if (this.mode === 'demo' && bal <= 0) return 10_000;
        return bal;
    }

    // ── Demo timer check ──────────────────────────────────────────────────

    private isDemoLimitReached(): boolean {
        if (this.mode !== 'demo') return false;
        const cap = PRODUCT_LIMITS.auto_trading.dailyCap; // 30 minutes
        const used = getDemoMinutesUsed(this.chatId);
        return used >= cap;
    }

    private async handleDemoLimit(): Promise<void> {
        setAutoSessionStatus(this.chatId, 'paused', 'demo_limit');
        stopDemoTimer(this.chatId);
        await this.notify(
            `⏰ You've used your ${PRODUCT_LIMITS.auto_trading.dailyCap} minutes of demo Auto Trading for today.\n\n` +
            `Fund $${PRODUCT_LIMITS.auto_trading.unlockBalance}+ for unlimited live trading. 💜`,
            false
        );
    }

    // ── Analysis routing ──────────────────────────────────────────────────

    private async analyzeAsset(asset: string, timeframeSec: number): Promise<{ direction: 'call' | 'put'; confidence: number }> {
        if (!this.sdk) throw new Error('No SDK connection');

        if (this.mode === 'demo') {
            // Demo mode — admin privilege (200 candles, 6 indicators)
            const turboOpts = await this.sdk.turboOptions();
            const norm = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');
            const normalizedAsset = norm(asset);
            const active = turboOpts.getActives().find(
                a => norm(a.ticker) === normalizedAsset || norm(a.localizationKey) === normalizedAsset
            );
            if (!active) throw new Error(`Unknown pair: ${asset}`);
            const candlesFacade = await this.sdk.candles();
            const history = await candlesFacade.getCandles(active.id, timeframeSec, { count: 200 }) as AdminCandle[];
            if (history.length < 30) throw new Error('Not enough candle data for admin analysis');
            return runAdminAnalysis(history);
        } else {
            // Live mode — drainage (5 candles, RSI only)
            return analyzePairWithSdk(this.sdk, asset, timeframeSec, 'MASTER', 5);
        }
    }

    async start(ssid: string): Promise<void> {
        this.ssid = ssid;
        logger.info('auto', `start() for ${this.chatId} (mode=${this.mode})`);
        try {
            await this.connect(ssid);
        } catch (err) {
            logger.error('auto', `connect failed for ${this.chatId}: ${err instanceof Error ? err.message : err}`);
            setAutoSessionStatus(this.chatId, 'paused', 'connect_failed');
            await this.notify('🚀 Auto Trading could not connect to your account. Reconnect and resume.', true);
            engineUnregister(this.chatId);
            return;
        }

        // Validate martingale state: any mg_active on (re)start is orphaned — the
        // in-flight trade died with the previous process — so clear it and start
        // the sequence fresh instead of "resuming" a trade that no longer exists.
        const s = getAutoSession(this.chatId);
        if (s?.mg_active) {
            logger.warn('auto', `clearing orphaned martingale state for ${this.chatId} (was amount ${s.mg_next_amount})`);
            setAutoSessionMgState(this.chatId, false);
        }

        // Start demo timer if in demo mode
        if (this.mode === 'demo') {
            startDemoTimer(this.chatId);
        }

        await this.renderStatus();
        logger.info('auto', `launching loop for ${this.chatId}`);
        // loop() guards itself, but catch here too so a launch-time throw is never
        // swallowed silently (the cause of "running but no trades" — Issue 2).
        this.loop(ssid).catch(err => {
            logger.error('auto', `loop launch rejected for ${this.chatId}: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
            const cur = getAutoSession(this.chatId);
            if (cur?.status === 'running') setAutoSessionStatus(this.chatId, 'paused', 'loop_launch_failed');
            engineUnregister(this.chatId);
        });
    }

    stop(): void {
        this.stopping = true;
        if (this.mode === 'demo') {
            stopDemoTimer(this.chatId);
        }
    }

    private async loop(ssid: string): Promise<void> {
        this.ssid = ssid;
        let consecutiveErrors = 0;
        logger.info('auto', `loop started for ${this.chatId} (mode=${this.mode})`);
        try {
            while (!this.stopping) {
                const s = getAutoSession(this.chatId);
                if (!s || s.status !== 'running') break;

                // Demo mode: check time limit
                if (this.mode === 'demo' && this.isDemoLimitReached()) {
                    await this.handleDemoLimit();
                    break;
                }

                const idx = s.current_asset_index % this.assets.length;
                const asset = this.assets[idx];
                const nextIdx = (idx + 1) % this.assets.length;

                // Affordability guard — never fire a trade the balance can't cover.
                let balance: number;
                try {
                    balance = await withTimeout(this.liveBalance(), 10_000, 'liveBalance');
                } catch (err) {
                    if (!(await this.reconnect(this.ssid))) {
                        setAutoSessionStatus(this.chatId, 'paused', 'reconnect_failed');
                        await this.notify('🚀 Auto Trading paused — lost connection to your account. Resume when ready.', true);
                        break;
                    }
                    continue;
                }
                if (balance < s.amount) {
                    setAutoSessionStatus(this.chatId, 'paused', 'insufficient_balance');
                    await this.notify(`🚀 Auto Trading paused — balance ${balance.toFixed(2)} ${s.currency} is below your ${s.amount} ${s.currency} stake. Fund and resume.`, true);
                    break;
                }

                // Skip an asset that already has an open position (the 1-position
                // and no-duplicate-asset rules — directive §5.4).
                let hasOpen = false;
                try {
                    const positions = await withTimeout(this.sdk!.positions(), 10_000, 'positions');
                    hasOpen = positions.getOpenedPositions().length > 0;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (/^TIMEOUT:/i.test(msg)) {
                        if (await this.maybeNotifyWsError(msg)) await this.reconnect(this.ssid);
                    }
                    /* other errors: treat as none open; analysis will surface real errors */
                }
                if (hasOpen) {
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }

                // Analyse; skip low-confidence setups without burning a trade.
                let direction: 'call' | 'put';
                try {
                    const isPrivileged = this.chatId === getAdminId() || PRIV_IDS.has(this.chatId);

                    let a: { direction: 'call' | 'put'; confidence: number };
                    if (this.mode === 'demo' || isPrivileged) {
                        // Demo mode or privileged → admin analysis
                        a = await withTimeout(
                            this.analyzeAsset(asset, s.timeframe),
                            15_000, 'analyze',
                        );
                    } else {
                        // Live mode → drainage via analyzePairWithSdk
                        a = await withTimeout(
                            analyzePairWithSdk(this.sdk!, asset, s.timeframe, 'MASTER', 5),
                            15_000, 'analyze',
                        );
                    }

                    // Only privileged users get the quality gate. Everyone else trades
                    // whatever direction the analysis returns, regardless of confidence.
                    if (isPrivileged && a.confidence < AUTO_CONFIDENCE_FLOOR) {
                        // Skipped setup — advance the cursor and count an evaluation,
                        // NOT a trade. trades_done must only reflect placed trades.
                        recordAutoSessionEvaluation(this.chatId, nextIdx);
                        await new Promise(r => setTimeout(r, msToNextCandle(s.timeframe)));
                        continue;
                    }
                    direction = a.direction;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (/auth|ssid|unauthor|401/i.test(msg) && !(await this.reconnect(this.ssid))) {
                        setAutoSessionStatus(this.chatId, 'paused', 'reconnect_failed');
                        await this.notify('🚀 Auto Trading paused — your session expired. Reconnect and resume.', true);
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
                let startAmount = s.amount;
                if (s.mg_active && s.mg_next_amount > 0) {
                    startAmount = s.mg_next_amount;
                    logger.info('auto', `resuming martingale for ${this.chatId} at amount ${startAmount}`);
                }
                setAutoSessionMgState(this.chatId, true, startAmount);

                let outcome: MartingaleOutcome;
                let lastTradePnl = 0;
                const balanceType: 'demo' | 'live' = this.mode === 'demo' ? 'demo' : 'live';
                try {
                    outcome = await withTimeout(
                        runMartingaleCore(this.sdk!, {
                            pair: asset, direction, amount: startAmount, timeframeSec: s.timeframe,
                            galeRounds: s.gale_rounds, balanceType, telegramId: this.chatId,
                        }, (info) => {
                            if (info.result.status === 'WIN') {
                                lastTradePnl = info.result.pnl - info.amount;
                            } else if (info.result.status === 'LOSS') {
                                lastTradePnl = -info.amount;
                            } else {
                                lastTradePnl = 0;
                            }
                            const nextAmt = info.result.status === 'LOSS'
                                ? info.amount * 2
                                : s.amount;
                            setAutoSessionMgState(this.chatId, true, nextAmt);
                        }),
                        600_000, 'runMartingaleCore',
                    );
                } catch (err) {
                    setAutoSessionMgState(this.chatId, false);
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.warn('auto', `trade run failed for ${this.chatId}: ${msg}`);
                    // Reconnect silently on auth/WebSocket errors — no per-error
                    // "retrying" spam; the pause message below is the only notice.
                    const isConnErr = /auth|ssid|unauthor|401|websocket|is closing|not open|timeout/i.test(msg);
                    if (isConnErr && !(await this.reconnect(this.ssid))) {
                        setAutoSessionStatus(this.chatId, 'paused', 'reconnect_failed');
                        await this.notify('🚀 Auto Trading paused — lost connection to your account. Resume when ready.', true);
                        break;
                    }
                    // Rotate off the failing asset and bound consecutive failures so a
                    // persistent OTC timeout can't loop (and spam) forever (Issue 1).
                    recordAutoSessionEvaluation(this.chatId, nextIdx);
                    consecutiveErrors++;
                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        setAutoSessionStatus(this.chatId, 'paused', 'repeated_errors');
                        await this.notify('🚀 Auto Trading paused — repeated errors (likely a temporary connection issue). Tap Resume to try again.', true);
                        break;
                    }
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }

                // Sequence complete — clear martingale state.
                setAutoSessionMgState(this.chatId, false);
                console.log(`[auto-trade] uid=${this.chatId} outcome=${outcome.status} totalPnl=${outcome.totalPnl} rounds=${outcome.rounds} mode=${this.mode}`);
                const isError = outcome.status === 'ERROR' || outcome.status === 'TIMEOUT';
                if (isError) {
                    // A settled error/timeout: rotate to the next asset (don't count it
                    // as a trade) and bound consecutive failures (Issue 1).
                    recordAutoSessionEvaluation(this.chatId, nextIdx);
                    consecutiveErrors++;
                    logger.warn('auto', `trade ${outcome.status} for ${this.chatId} — consecutive=${consecutiveErrors}`);
                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        setAutoSessionStatus(this.chatId, 'paused', 'repeated_timeouts');
                        await this.notify('🚀 Auto Trading paused — trades kept timing out (likely a temporary connection issue). Tap Resume to try again.', true);
                        break;
                    }
                } else {
                    consecutiveErrors = 0;
                    recordAutoSessionTrade(this.chatId, nextIdx, outcome.totalPnl);
                    const s2 = getAutoSession(this.chatId);
                    console.log(`[auto-trade] uid=${this.chatId} AFTER record: sessionPnl=${s2?.pnl} trades=${s2?.trades_done}`);
                    const emoji = outcome.status === 'WIN' ? '🟢' : outcome.status === 'TIE' ? '⚪' : '🔴';
                    const displayPnl = outcome.status === 'WIN' ? lastTradePnl : outcome.totalPnl;
                    const sign = displayPnl >= 0 ? '+' : '';
                    await this.renderStatus(`${emoji} ${outcome.status} ${sign}${displayPnl.toFixed(2)} ${s.currency}`);
                }

                await new Promise(r => setTimeout(r, msToNextCandle(s.timeframe)));
            }
            logger.info('auto', `loop ended normally for ${this.chatId} (stopping=${this.stopping})`);
        } catch (err) {
            // An unexpected throw would otherwise leave the session 'running' with a
            // dead runner (Issue 2). Log it loudly; the finally normalizes status.
            logger.error('auto', `loop crashed for ${this.chatId}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        } finally {
            try { await this.sdk?.shutdown(); } catch { /* ignore */ }
            this.sdk = undefined;
            const s = getAutoSession(this.chatId);
            if (s?.status === 'running') setAutoSessionStatus(this.chatId, 'paused', 'loop_exited');
            await this.renderStatus();
            if (this.mode === 'demo') {
                stopDemoTimer(this.chatId);
            }
            engineUnregister(this.chatId);
        }
    }
}

const runners = new Map<number, AutoRunner>();

function engineUnregister(telegramId: number): void { runners.delete(telegramId); }

function ssidFor(telegramId: number): string | null {
    const user = getUser(telegramId);
    return user?.ssid ?? process.env.IQ_SSID ?? null;
}

export function initAutoEngine(n: Notifier): void { notifier = n; }

export const autoEngine = {
    isRunning(telegramId: number): boolean {
        return runners.has(telegramId);
    },

    getDemoMinutes(telegramId: number): number {
        return getDemoMinutesUsed(telegramId);
    },

    /** Start (or restart) the engine for a user whose session row is already 'running'. */
    start(telegramId: number, mode?: 'demo' | 'live'): boolean {
        if (runners.has(telegramId)) return true;
        const session = getAutoSession(telegramId);
        if (!session || session.status !== 'running') return false;
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
    stop(telegramId: number): void {
        setAutoSessionStatus(telegramId, 'stopped');
        runners.get(telegramId)?.stop();
    },

    pause(telegramId: number): void {
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
    resume(telegramId: number): boolean {
        const session = getAutoSession(telegramId);
        if (!session) return false;
        setAutoSessionStatus(telegramId, 'running', null);
        const runner = runners.get(telegramId);
        const mode = runner?.mode ?? getAutoSessionMode(telegramId);
        return this.start(telegramId, mode);
    },

    /** Rehydrate every 'running' session after a process restart (directive §5.5/E). */
    async restoreAll(): Promise<void> {
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
        if (sessions.length) logger.info('auto', `restored ${sessions.length} auto-trading session(s)`);
    },
};

/** Read the stored mode from the auto_trading_sessions table (or default to 'live'). */
function getAutoSessionMode(telegramId: number): 'demo' | 'live' {
    try {
        const row = db.prepare('SELECT mode FROM auto_trading_sessions WHERE telegram_id = ?').get(telegramId) as { mode?: string } | undefined;
        if (row?.mode === 'demo') return 'demo';
    } catch {}
    return 'live';
}
