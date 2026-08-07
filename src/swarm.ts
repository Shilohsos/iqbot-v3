/** @ts-nocheck - reunified from dist */
/** @ts-nocheck - reunified from dist */
// Swarm Engine — multi-asset concurrent auto-trading with time limit.
// User sets: starting capital, smart recovery (0/3/6), duration (10min - 1hr).
// Bot auto-picks timeframes and assets, trades up to 5 simultaneously.
// Cannot be stopped until time elapses. Minimum balance: $200.
import { createSdk, runMartingaleCore } from './trade.js';
import { sdkPool } from './sdk-pool.js';
import { analyzePairWithSdk } from './analysis.js';
import { runAdminAnalysis } from './admin-analysis.js';
import { ALL_PAIRS, AUTO_CONFIDENCE_FLOOR } from './access.js';
import { pairLabel } from './menu.js';
import { getUser, getAdminSsid, db, getConfig } from './db.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';
const SWARM_MIN_BALANCE = 200; // USD
const MAX_CONCURRENT = 5;
const TIMEFRAMES = [30, 60, 120, 300];
// Privileged users — same as bot.ts PRIVILEGED_USERS
const PRIV_IDS = new Set([6622587977, 8986669286, 6683209485]);
function isPrivilegedUser(uid) {
    return uid === getAdminId() || PRIV_IDS.has(uid);
}
let notifier;
export function setSwarmNotifier(n) { notifier = n; }
const activeRunners = new Map();
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN(arr, n) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, arr.length));
}
export function initSwarmDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS swarm_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            starting_capital REAL NOT NULL,
            gale_rounds INTEGER NOT NULL,
            duration_min INTEGER NOT NULL,
            started_at INTEGER NOT NULL,
            ends_at INTEGER NOT NULL,
            status TEXT DEFAULT 'running',
            status_msg_id INTEGER,
            total_trades INTEGER DEFAULT 0,
            total_pnl REAL DEFAULT 0,
            currency TEXT DEFAULT 'USD'
        );
    `);
    // Add currency column if missing (existing DBs)
    try {
        db.exec(`ALTER TABLE swarm_sessions ADD COLUMN currency TEXT DEFAULT 'USD'`);
    }
    catch { /* already exists */ }
}
class SwarmRunner {
    session;
    sdk;
    stopping = false;
    statusMsgId;
    openTradeCount = 0;
    openPairs = new Set();
    ssid = '';
    constructor(session) {
        this.session = session;
    }
    get chatId() { return this.session.telegram_id; }
    get isStopping() { return this.stopping; }
    stop() {
        this.stopping = true;
        db.prepare('UPDATE swarm_sessions SET status = ? WHERE id = ?').run('expired', this.session.id);
        logger.info('swarm', `Swarm ${this.session.id} stop requested by user ${this.chatId}`);
    }
    buildStatusText(stateLine) {
        const remaining = Math.max(0, Math.ceil((this.session.ends_at - Date.now()) / 60000));
        const pnl = this.session.total_pnl;
        const sign = pnl >= 0 ? '+' : '';
        const isNGN = this.session.currency === 'NGN';
        const curSymbol = isNGN ? '₦' : '$';
        const fmtCap = isNGN ? this.session.starting_capital.toLocaleString() : this.session.starting_capital.toFixed(2);
        const fmtPnl = isNGN ? Math.abs(pnl).toLocaleString() : Math.abs(pnl).toFixed(2);
        const pnlStr = `${pnl >= 0 ? '+' : '-'}${curSymbol}${fmtPnl}`;
        const openCount = this.openTradeCount;
        const openSlots = '🐝'.repeat(openCount) + '⚪'.repeat(MAX_CONCURRENT - openCount);
        return [
            `🐝 *Swarm Trading* · ${stateLine}`,
            ``,
            `${openSlots}  ${openCount}/${MAX_CONCURRENT} active`,
            ``,
            `💰 Capital: ${curSymbol}${fmtCap}`,
            `🔄 Recovery: ${this.session.gale_rounds} rounds`,
            `📊 Trades: ${this.session.total_trades}   P&L: ${pnlStr}`,
            `⏱ Time left: ${remaining} min`,
        ].join('\n');
    }
    async updateStatusMessage(final = false) {
        if (!this.statusMsgId || !notifier)
            return;
        const state = final ? '✅ Complete' : '🟢 Trading';
        const text = this.buildStatusText(state);
        const extra = final ? { parse_mode: 'Markdown' } : {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
                        { text: '⏹ Stop Swarm', callback_data: 'swarm:stop' },
                    ]] },
        };
        try {
            await notifier.editMessageText(this.chatId, this.statusMsgId, undefined, text, extra);
        }
        catch { /* message may be too old to edit */ }
    }
    async connect(ssid) {
        this.ssid = ssid;
        this.sdk = await createSdk(ssid);
    }
    async start(ssid) {
        try {
            await this.connect(ssid);
        }
        catch (err) {
            logger.error('swarm', `Swarm ${this.session.id} failed to connect: ${err}`);
            await notifier?.sendMessage(this.chatId, `❌ Swarm failed to start: could not connect. Please try again.`).catch(() => { });
            db.prepare('UPDATE swarm_sessions SET status = ? WHERE id = ?').run('expired', this.session.id);
            activeRunners.delete(this.session.id);
            return;
        }
        const uid = this.chatId;
        const isPriv = isPrivilegedUser(uid);
        // Send initial status
        const statusText = this.buildStatusText('🟡 Scanning markets...');
        const msg = await notifier?.sendMessage(uid, statusText, { parse_mode: 'Markdown' });
        this.statusMsgId = msg?.message_id;
        if (this.statusMsgId) {
            db.prepare('UPDATE swarm_sessions SET status_msg_id = ? WHERE id = ?').run(this.statusMsgId, this.session.id);
        }
        logger.info('swarm', `Swarm ${this.session.id} started for uid=${uid}, capital=$${this.session.starting_capital}, gale=${this.session.gale_rounds}, duration=${this.session.duration_min}min`);
        // Main loop — analyze pairs, trade only high-confidence setups, max 5 open at once
        while (Date.now() < this.session.ends_at && !this.stopping) {
            try {
                if (this.openTradeCount >= MAX_CONCURRENT) {
                    // All slots full — wait for trades to close
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
                logger.info('swarm', `Swarm ${this.session.id} starting analysis cycle (${this.openTradeCount}/${MAX_CONCURRENT} open)`);
                await this.runAnalysisCycle(isPriv);
                this.updateStatusMessage();
                // Short wait before re-scanning
                await new Promise(r => setTimeout(r, 5000));
            }
            catch (err) {
                logger.error('swarm', `Swarm ${this.session.id} loop error: ${err}`);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
        // Time's up — stop launching new trades, wait for in-flight ones to finish
        this.stopping = true;
        this.updateStatusMessage(true);
        // Wait up to 10 minutes for open trades to settle
        const waitStart = Date.now();
        while (this.openTradeCount > 0 && Date.now() - waitStart < 600000) {
            await new Promise(r => setTimeout(r, 5000));
        }
        const trades = this.session.total_trades;
        const pnl = this.session.total_pnl;
        const isNGN = this.session.currency === 'NGN';
        const curSym = isNGN ? '₦' : '$';
        const fmtCap = isNGN ? this.session.starting_capital.toLocaleString() : this.session.starting_capital.toFixed(2);
        const fmtPnl = isNGN ? Math.abs(pnl).toLocaleString() : Math.abs(pnl).toFixed(2);
        const pnlStr = pnl >= 0 ? `+${curSym}${fmtPnl}` : `-${curSym}${fmtPnl}`;
        await notifier?.sendMessage(uid, [
            `✅ *Swarm Session Complete*`,
            ``,
            `💰 Capital: ${curSym}${fmtCap}`,
            `📊 Total trades: ${trades}`,
            `💵 Net P&L: ${pnlStr}`,
            `⏱ Session ended`,
        ].join('\n'), { parse_mode: 'Markdown' });
        db.prepare('UPDATE swarm_sessions SET status = ? WHERE id = ?').run('completed', this.session.id);
        activeRunners.delete(this.session.id);
        try {
            await this.sdk?.shutdown();
        }
        catch { /* gone */ }
    }
    /**
     * Analysis cycle — like Auto Trading but parallel:
     * 1. Pick 5 random pairs
     * 2. Analyze all 5 simultaneously (admin analysis for privileged)
     * 3. Only trade pairs that pass confidence gate (≥55%)
     * 4. All passing pairs execute simultaneously
     * 5. Wait for all trades to complete, then start next cycle
     */
    async runAnalysisCycle(isPriv) {
        const availableSlots = MAX_CONCURRENT - this.openTradeCount;
        if (availableSlots <= 0)
            return;
        // Filter out pairs that already have an open trade
        const candidates = ALL_PAIRS.filter(p => !this.openPairs.has(p));
        if (candidates.length === 0)
            return;
        const picks = pickN(candidates, Math.min(availableSlots, MAX_CONCURRENT));
        // Phase 1: Analyze all 5 pairs in parallel
        const analyses = await Promise.allSettled(picks.map(pair => this.analyzePair(pair, isPriv)));
        // Phase 2: Filter to only high-confidence setups
        const validSetups = [];
        for (let i = 0; i < analyses.length; i++) {
            const r = analyses[i];
            if (r.status === 'fulfilled' && r.value) {
                validSetups.push(r.value);
            }
        }
        if (validSetups.length === 0) {
            logger.info('swarm', `Swarm ${this.session.id} no pairs passed confidence gate this cycle`);
            return;
        }
        logger.info('swarm', `Swarm ${this.session.id} ${validSetups.length}/${picks.length} pairs passed — trading`);
        // Phase 3: Execute all passing trades simultaneously (fire and forget — don't block next cycle)
        for (const s of validSetups) {
            this.executeTrade(s.pair, s.direction, s.timeframe); // no await — runs in background
        }
    }
    async analyzePair(pair, isPriv) {
        const timeframe = pickRandom(TIMEFRAMES);
        let tradeSdk;
        try {
            tradeSdk = await createSdk(this.ssid);
        }
        catch (err) {
            logger.error('swarm', `Swarm ${this.session.id} failed to create SDK for ${pair}: ${err}`);
            return null;
        }
        try {
            logger.info('swarm', `Swarm ${this.session.id} analyzing ${pair} ${timeframe}s`);
            const turboOpts = await tradeSdk.turboOptions();
            const norm = (s) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');
            const normalizedPair = norm(pair);
            const active = turboOpts.getActives().find((a) => norm(a.ticker) === normalizedPair || norm(a.localizationKey) === normalizedPair);
            if (!active) {
                logger.warn('swarm', `Swarm ${this.session.id} pair ${pair} not found`);
                return null;
            }
            let direction;
            let confidence;
            if (isPriv || getConfig('admin_analysis_all') === 'true') {
                const candlesFacade = await tradeSdk.candles();
                const history = await candlesFacade.getCandles(active.id, timeframe, { count: 200 });
                logger.info('swarm', `Swarm ${this.session.id} ${pair} got ${history.length} candles, timeframe=${timeframe}s`);
                if (history.length < 30) {
                    logger.warn('swarm', `Swarm ${this.session.id} not enough candles for ${pair}`);
                    return null;
                }
                // Log last 5 closes for debugging
                const last5 = history.slice(-5).map(c => c.close);
                logger.info('swarm', `Swarm ${this.session.id} ${pair} last 5 closes: ${last5.join(', ')}`);
                const result = runAdminAnalysis(history);
                direction = result.direction;
                confidence = result.confidence;
                logger.info('swarm', `Swarm ${this.session.id} ${pair} analysis: ${result.reason} → ${direction}`);
            }
            else {
                const result = await analyzePairWithSdk(tradeSdk, pair, timeframe, 'MASTER', 2);
                direction = result.direction;
                confidence = result.confidence;
            }
            // Confidence gate
            if (confidence < AUTO_CONFIDENCE_FLOOR) {
                logger.info('swarm', `Swarm ${this.session.id} skipping ${pair} — confidence ${confidence}% < ${AUTO_CONFIDENCE_FLOOR}%`);
                return null;
            }
            logger.info('swarm', `Swarm ${this.session.id} ${pair} PASSED — ${direction} ${timeframe}s (${confidence}%)`);
            return { pair, direction, timeframe, confidence };
        }
        catch (err) {
            logger.error('swarm', `Swarm ${this.session.id} analyze error on ${pair}: ${err instanceof Error ? err.message : err}`);
            return null;
        }
        finally {
            try {
                if (usedPool) {
                    try {
                        sdkPool.unpin(uid);
                        sdkPool.release(uid);
                    }
                    catch { }
                }
                else {
                    try {
                        await tradeSdk?.shutdown();
                    }
                    catch { }
                }
            }
            catch { /* gone */ }
        }
    }
    async executeTrade(pair, direction, timeframe) {
        const uid = this.chatId;
        this.openTradeCount++;
        this.openPairs.add(pair);
        logger.info('swarm', `Swarm ${this.session.id} trade started on ${pair} (${this.openTradeCount}/${MAX_CONCURRENT} open)`);
        let tradeSdk;
        let usedPool = false;
        try {
            tradeSdk = await sdkPool.get(uid, this.ssid);
            usedPool = true;
            try {
                sdkPool.pin(uid);
            }
            catch { /* */ }
        }
        catch (err) {
            try {
                tradeSdk = await createSdk(this.ssid);
            }
            catch (err2) {
                logger.error('swarm', `Swarm ${this.session.id} failed to create SDK for trade ${pair}: ${err2}`);
                this.openTradeCount--;
                this.openPairs.delete(pair);
                return;
            }
        }
        try {
            logger.info('swarm', `Swarm ${this.session.id} trading ${pair} ${direction} ${timeframe}s`);
            const tradePromise = runMartingaleCore(tradeSdk, {
                pair,
                direction,
                amount: this.session.starting_capital,
                galeRounds: this.session.gale_rounds,
                timeframeSec: timeframe,
                balanceType: 'live',
                telegramId: uid,
            }, () => {
                this.updateStatusMessage();
            });
            const timeoutMs = Math.min((timeframe * 1000 * (this.session.gale_rounds + 1) * 2.5) + 400000, 2400000); // room for TradeCore settle+recover per round
            const outcome = await Promise.race([
                tradePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Trade timeout')), timeoutMs)),
            ]);
            logger.info('swarm', `Swarm ${this.session.id} ${pair} outcome: status=${outcome.status} pnl=${outcome.totalPnl} rounds=${outcome.rounds}`);
            if (outcome.status === 'ERROR') {
                const tradeRow = db.prepare('SELECT error FROM trades WHERE telegram_id = ? AND pair = ? ORDER BY created_at DESC LIMIT 1').get(uid, pair);
                logger.error('swarm', `Swarm ${this.session.id} ${pair} error detail: ${tradeRow?.error ?? 'unknown'}`);
            }
            if (outcome.status !== 'NO_FILL' && outcome.status !== 'ERROR' && outcome.status !== 'TIMEOUT') {
                this.session.total_trades++;
                this.session.total_pnl += outcome.totalPnl;
            }
            else {
                logger.warn('swarm', `Swarm ${this.session.id} ${pair} non-settled ${outcome.status} — not counting trade`);
            }
            db.prepare('UPDATE swarm_sessions SET total_trades = ?, total_pnl = ? WHERE id = ?')
                .run(this.session.total_trades, this.session.total_pnl, this.session.id);
            const resultEmoji = outcome.status === 'WIN' ? '🟢' : outcome.status === 'LOSS' ? '🟥' : '🟡';
            const resultText = outcome.status === 'WIN' ? 'WIN' : outcome.status === 'LOSS' ? 'LOSS' : outcome.status;
            const tfLabel = timeframe === 30 ? '30s' : timeframe === 60 ? '1m' : timeframe === 120 ? '2m' : '5m';
            const isNGN = this.session.currency === 'NGN';
            const curSym = isNGN ? '₦' : '$';
            const fmtPnl = isNGN ? Math.abs(outcome.totalPnl).toLocaleString() : Math.abs(outcome.totalPnl).toFixed(2);
            const pnlStr = outcome.totalPnl >= 0 ? `+${curSym}${fmtPnl}` : `-${curSym}${fmtPnl}`;
            const roundsStr = outcome.rounds > 1 ? ` (${outcome.rounds} rounds)` : '';
            await notifier?.sendMessage(uid, `${resultEmoji} ${pairLabel(pair)} (${tfLabel}) — ${resultText} ${pnlStr}${roundsStr}`);
            await this.updateStatusMessage();
        }
        catch (err) {
            logger.error('swarm', `Swarm ${this.session.id} trade error on ${pair}: ${err instanceof Error ? err.message : err}`);
        }
        finally {
            this.openTradeCount--;
            this.openPairs.delete(pair);
            try {
                await tradeSdk?.shutdown();
            }
            catch { /* gone */ }
        }
    }
}
// ─── Public API ───
export async function startSwarm(telegramId, startingCapital, galeRounds, durationMin, currency = 'USD') {
    // Validate
    if (startingCapital < 1)
        return { ok: false, error: 'Minimum capital is $1' };
    if (![0, 3, 6].includes(galeRounds))
        return { ok: false, error: 'Invalid recovery level' };
    if (durationMin < 10 || durationMin > 60)
        return { ok: false, error: 'Duration must be 10-60 minutes' };
    // Check balance gate ($200 min)
    const user = getUser(telegramId);
    if (!user)
        return { ok: false, error: 'User not found' };
    const isPriv = isPrivilegedUser(telegramId);
    if (!isPriv) {
        const fundedUsd = user.funded_balance_usd ?? 0;
        if (fundedUsd < SWARM_MIN_BALANCE) {
            return { ok: false, error: `Minimum balance for Swarm is $${SWARM_MIN_BALANCE}. Your balance: $${fundedUsd}` };
        }
    }
    // Check for existing running session
    const existing = db.prepare('SELECT id FROM swarm_sessions WHERE telegram_id = ? AND status = ?').get(telegramId, 'running');
    if (existing)
        return { ok: false, error: 'You already have a Swarm session running. Wait for it to finish.' };
    // Get SSID
    const ssid = telegramId === getAdminId() ? getAdminSsid() : user.ssid;
    if (!ssid)
        return { ok: false, error: 'No SSID. Please connect your account first.' };
    // Create session
    const now = Date.now();
    const result = db.prepare(`
        INSERT INTO swarm_sessions (telegram_id, starting_capital, gale_rounds, duration_min, started_at, ends_at, status, currency)
        VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
    `).run(telegramId, startingCapital, galeRounds, durationMin, now, now + durationMin * 60 * 1000, currency);
    const session = {
        id: Number(result.lastInsertRowid),
        telegram_id: telegramId,
        starting_capital: startingCapital,
        gale_rounds: galeRounds,
        duration_min: durationMin,
        started_at: now,
        ends_at: now + durationMin * 60 * 1000,
        status: 'running',
        status_msg_id: null,
        total_trades: 0,
        total_pnl: 0,
        currency,
    };
    // Start runner in background
    const runner = new SwarmRunner(session);
    activeRunners.set(session.id, runner);
    // Don't await — run in background
    runner.start(ssid).catch(err => {
        logger.error('swarm', `Swarm ${session.id} crashed: ${err}`);
        db.prepare('UPDATE swarm_sessions SET status = ? WHERE id = ?').run('expired', session.id);
        activeRunners.delete(session.id);
        notifier?.sendMessage(telegramId, `❌ Swarm session ended unexpectedly: ${err.message}`).catch(() => { });
    });
    return { ok: true };
}
export function getSwarmSession(telegramId) {
    const row = db.prepare('SELECT * FROM swarm_sessions WHERE telegram_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(telegramId, 'running');
    if (!row)
        return null;
    return row;
}
export function stopSwarm(telegramId) {
    for (const [id, runner] of activeRunners) {
        if (runner.chatId === telegramId) {
            runner.stop();
            activeRunners.delete(id);
            return true;
        }
    }
    // Even if no active runner, mark DB session as expired
    db.prepare('UPDATE swarm_sessions SET status = ? WHERE telegram_id = ? AND status = ?').run('expired', telegramId, 'running');
    return false;
}
export function getSwarmStats(telegramId) {
    const row = db.prepare('SELECT * FROM swarm_sessions WHERE telegram_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(telegramId, 'running');
    if (!row)
        return null;
    const remaining = Math.max(0, Math.ceil((row.ends_at - Date.now()) / 60000));
    return { trades: row.total_trades, pnl: row.total_pnl, remaining_min: remaining };
}
