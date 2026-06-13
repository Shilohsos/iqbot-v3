// Auto Trading engine (directive §5). A long-lived background loop per user that
// rotates through up to 3 chosen assets, analyses each, and trades LIVE only —
// keeping exactly one position open at a time. Independent of the request-scoped
// sdkPool (whose idle TTL would evict a multi-hour session), each runner owns its
// own SDK connection for the life of the session.

import type { ClientSdk } from './index.js';
import { createSdk, runMartingaleCore, type MartingaleOutcome } from './trade.js';
import { analyzePairWithSdk } from './analysis.js';
import { AUTO_CONFIDENCE_FLOOR } from './access.js';
import {
    getAutoSession, getRunningAutoSessions, setAutoSessionStatus,
    recordAutoSessionTrade, getUser, type AutoTradingSession,
} from './db.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';
import { friendlyError } from './errors.js';
import { BalanceType } from './index.js';

// Minimal Telegram surface we need — injected from bot.ts to avoid a circular import.
interface Notifier {
    sendMessage(chatId: number, text: string, extra?: unknown): Promise<{ message_id: number }>;
    editMessageText(chatId: number, msgId: number, inlineId: undefined, text: string, extra?: unknown): Promise<unknown>;
}

let notifier: Notifier | undefined;
const RECONNECT_BACKOFF_MS = [2000, 4000, 8000, 16000];

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

class AutoRunner {
    private sdk: ClientSdk | undefined;
    private stopping = false;
    private statusMsgId: number | undefined;
    private assets: string[];
    private lastWsNotify = 0;

    constructor(public readonly session: AutoTradingSession) {
        this.assets = JSON.parse(session.assets) as string[];
    }

    private get chatId(): number { return this.session.telegram_id; }

    private async connect(ssid: string): Promise<void> {
        this.sdk = await createSdk(ssid);
    }

    /** Reconnect with exponential backoff; returns false if all attempts fail. */
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
        const text = [
            `🚀 *Auto Trading* · ${statusEmoji}`,
            ``,
            `${asset} (${idx}/${this.assets.length}) · ${tfLabel(s.timeframe)} · ${s.gale_rounds}-round recovery`,
            `Trades: ${s.trades_done}   P&L: ${pnlFormatted}`,
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
                this.statusMsgId = m?.message_id;
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
        if (!/websocket|is closing|not open/i.test(msg)) return false;
        const now = Date.now();
        if (now - this.lastWsNotify > 60_000) {
            this.lastWsNotify = now;
            await this.notify(`🚀 Auto Trading — ${friendlyError(new Error(msg))} Retrying automatically.`);
        }
        return true;
    }

    private async liveBalance(): Promise<number> {
        if (!this.sdk) return 0;
        const all = (await this.sdk.balances()).getBalances();
        const real = all.find(b => b.type === BalanceType.Real) ?? all.find(b => b.type === undefined);
        return real?.amount ?? 0;
    }

    async start(ssid: string): Promise<void> {
        try {
            await this.connect(ssid);
        } catch {
            setAutoSessionStatus(this.chatId, 'paused', 'connect_failed');
            await this.notify('🚀 Auto Trading could not connect to your account. Reconnect and resume.', true);
            engineUnregister(this.chatId);
            return;
        }
        await this.renderStatus();
        void this.loop(ssid);
    }

    stop(): void { this.stopping = true; }

    private async loop(ssid: string): Promise<void> {
        try {
            while (!this.stopping) {
                const s = getAutoSession(this.chatId);
                if (!s || s.status !== 'running') break;

                const idx = s.current_asset_index % this.assets.length;
                const asset = this.assets[idx];
                const nextIdx = (idx + 1) % this.assets.length;

                // Affordability guard — never fire a trade the balance can't cover.
                let balance: number;
                try {
                    balance = await this.liveBalance();
                } catch (err) {
                    if (!(await this.reconnect(ssid))) {
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
                    const positions = await this.sdk!.positions();
                    hasOpen = positions.getOpenedPositions().length > 0;
                } catch { /* treat as none open; analysis will surface real errors */ }
                if (hasOpen) {
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }

                // Analyse; skip low-confidence setups without burning a trade.
                let direction: 'call' | 'put';
                try {
                    const PRIV_IDS = new Set([6622587977, 8986669286, 6683209485, 8471649166]);
                    const user = getUser(this.chatId);
                    const userCandles = user?.analysis_candles ?? undefined;
                    const privCandles = userCandles !== undefined
                        ? userCandles
                        : (this.chatId === getAdminId() || PRIV_IDS.has(this.chatId)) ? 200 : undefined;
                    const a = await analyzePairWithSdk(this.sdk!, asset, s.timeframe, 'MASTER', privCandles);
                    if (a.confidence < AUTO_CONFIDENCE_FLOOR) {
                        recordAutoSessionTrade(this.chatId, nextIdx, 0); // advance cursor only
                        // note: trades_done increments here; acceptable as "evaluations"
                        await new Promise(r => setTimeout(r, msToNextCandle(s.timeframe)));
                        continue;
                    }
                    direction = a.direction;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (/auth|ssid|unauthor|401/i.test(msg) && !(await this.reconnect(ssid))) {
                        setAutoSessionStatus(this.chatId, 'paused', 'reconnect_failed');
                        await this.notify('🚀 Auto Trading paused — your session expired. Reconnect and resume.', true);
                        break;
                    }
                    // A dropped WebSocket: tell the user once, reconnect, then retry.
                    if (await this.maybeNotifyWsError(msg)) {
                        await this.reconnect(ssid);
                    }
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }

                let outcome: MartingaleOutcome;
                try {
                    outcome = await runMartingaleCore(this.sdk!, {
                        pair: asset, direction, amount: s.amount, timeframeSec: s.timeframe,
                        galeRounds: s.gale_rounds, balanceType: 'live', telegramId: this.chatId,
                    });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.warn('auto', `trade run failed for ${this.chatId}: ${msg}`);
                    // Surface a dropped WebSocket once and reconnect before retrying.
                    if (await this.maybeNotifyWsError(msg)) {
                        await this.reconnect(ssid);
                    }
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }

                recordAutoSessionTrade(this.chatId, nextIdx, outcome.totalPnl);
                const isError = outcome.status === 'ERROR' || outcome.status === 'TIMEOUT';
                if (!isError) {
                    const emoji = outcome.status === 'WIN' ? '🟢' : outcome.status === 'TIE' ? '⚪' : '🔴';
                    const sign = outcome.totalPnl >= 0 ? '+' : '';
                    await this.renderStatus(`${emoji} ${outcome.status} ${sign}${outcome.totalPnl.toFixed(2)} ${s.currency}`);
                }

                await new Promise(r => setTimeout(r, msToNextCandle(s.timeframe)));
            }
        } finally {
            try { await this.sdk?.shutdown(); } catch { /* ignore */ }
            this.sdk = undefined;
            const s = getAutoSession(this.chatId);
            if (s?.status === 'running') setAutoSessionStatus(this.chatId, 'stopped');
            await this.renderStatus();
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

    /** Start (or restart) the engine for a user whose session row is already 'running'. */
    start(telegramId: number): boolean {
        if (runners.has(telegramId)) return true;
        const session = getAutoSession(telegramId);
        if (!session || session.status !== 'running') return false;
        const ssid = ssidFor(telegramId);
        if (!ssid) {
            setAutoSessionStatus(telegramId, 'paused', 'no_ssid');
            return false;
        }
        const runner = new AutoRunner(session);
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
        runners.get(telegramId)?.stop();
    },

    /** Resume a paused session from where it left off. */
    resume(telegramId: number): boolean {
        const session = getAutoSession(telegramId);
        if (!session) return false;
        setAutoSessionStatus(telegramId, 'running', null);
        return this.start(telegramId);
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
            const runner = new AutoRunner(s);
            runners.set(s.telegram_id, runner);
            void runner.start(ssid);
        }
        if (sessions.length) logger.info('auto', `restored ${sessions.length} auto-trading session(s)`);
    },
};
