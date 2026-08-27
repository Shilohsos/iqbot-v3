// Yacht Club Setup Engine (DIRECTIVE-YACHT-CLUB-SETUP-ENGINE.md).
//
// Runs live trading sessions for the 10x Yacht Club VIP channel. A session is
// 10 setups, strictly one at a time:
//
//   analyze (admin PRO path) → post the setup card to the channel as a REAL
//   Telegram user account → execute on the dedicated Yacht IQ account →
//   post the result → 1-minute pause → analyze again.
//
// Sessions alternate Signals → Private Trader → Signals → … (Autopilot is
// reserved and deliberately NOT implemented here). A new session starts 2h
// after the previous one ENDED.
//
// Two invariants the rest of this file is built around:
//
//   1. ORDERING — the setup card is posted BEFORE the trade is placed. If the
//      post fails, no trade happens. The channel never sees a result for a
//      setup it was not shown.
//   2. NO MONEY IN THE CHANNEL — no stake, no PnL, no balance, ever. The only
//      numbers that reach the channel are the display confidence, the recovery
//      round count, and the session win/loss tally.
//
// bot.ts wires this with one import, one startYachtEngine(bot) call at boot,
// the /yacht admin command, and one isYachtEngineMessage() guard inside the
// Yacht Club channel_post watcher (see the note on §6 below).

import type { Telegraf } from 'telegraf';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { ProxyAgent } from 'undici';
import {
    db,
    getConfig,
    setConfig,
    getTestUserId,
    getActiveYachtSession,
    getLastYachtSession,
    startYachtSession,
    endYachtSession,
    stopYachtSession,
    insertYachtSetup,
    updateYachtSetup,
    bumpYachtSessionCounters,
    getInFlightYachtSetup,
    type YachtSession,
} from './db.js';
import { logger } from './logger.js';
import { getAdminId } from './ui/admin.js';
import { runAdminAnalysis } from './admin-analysis.js';
import { ALL_PAIRS, clampDisplayConfidence } from './access.js';
import { createSdk, runMartingaleCore } from './trade.js';
import { IQ_AUTH_URL } from './protocol.js';
import { getProxyUrl } from './proxy.js';

type YachtSdk = Awaited<ReturnType<typeof createSdk>>;

// ─── Tuning ─────────────────────────────────────────────────────────────────

/** Scheduler granularity. Every transition is decided on a tick; nothing here
 *  runs on its own timer, so a restart cannot leave an orphan schedule. */
const TICK_MS = 60_000;
/** Setups per session. */
const SETUPS_PER_SESSION = 10;
/** Pause between a settled setup and the next analysis. */
const SETUP_PAUSE_MS = 60_000;
/** Gap between one session ending and the next starting. */
const COOLDOWN_MS = 2 * 60 * 60_000;
/** How long an `executing` setup may sit before the engine gives up on it.
 *  A process restart mid-trade orphans the row — trade recovery settles the
 *  TRADE, but nothing settles the setup, so without this the session wedges
 *  forever. Sized above the worst case (5M expiry × 3 gale rounds + cooldowns). */
const IN_FLIGHT_GRACE_MS = 45 * 60_000;
/** Admin is told about a dead market only after it has lasted this long. */
const NO_PAIRS_ALERT_MS = 60 * 60_000;
/** Candles fed to the PRO engine — same count as the 10x admin analysis path. */
const ANALYSIS_CANDLES = 200;
/** Minimum candles before a pair is considered analyzable. */
const MIN_CANDLES = 30;
/** Courtesy delay between user nudges. */
const NUDGE_DELAY_MS = 60;

const CHANNEL_ID_DEFAULT = '-1004351740042';
const YACHT_CLUB_LINK = 'https://t.me/xyachtclub';

/** Values operations has not filled in yet. Treated exactly like "missing". */
const PLACEHOLDER_RE = /^(__PLACEHOLDER__|<.*>)$/;

// ─── Module state ───────────────────────────────────────────────────────────

let botRef: Telegraf | null = null;
let tickTimer: NodeJS.Timeout | null = null;
/** Serializes the whole engine. One analysis / post / trade at a time, ever. */
let engineBusy = false;
/** Epoch ms before which the next setup must not start (the 1-minute pause). */
let nextSetupAt = 0;
/** First tick at which every pair was closed, or 0 when the market is fine. */
let noPairsSince = 0;
/** Admin-notification dedupe keys, cleared when the condition clears. */
const notifiedOnce = new Set<string>();

let _sdk: YachtSdk | null = null;
let _poster: TelegramClient | null = null;

// ─── Small helpers ──────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
    ]);
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** SQLite `datetime('now')` is UTC without a zone marker — Date.parse would read
 *  it as local time. Normalize before parsing so cooldowns are not hours off. */
function sqlTimeMs(s: string | null | undefined): number {
    if (!s) return 0;
    const iso = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
}

function envVal(name: string): string {
    const v = (process.env[name] ?? '').trim();
    return PLACEHOLDER_RE.test(v) ? '' : v;
}

function normTicker(s: string): string {
    return String(s ?? '').toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
}

function tfLabel(sec: number): string {
    if (sec >= 3600 && sec % 3600 === 0) return `${sec / 3600}H`;
    if (sec >= 60 && sec % 60 === 0) return `${sec / 60}M`;
    return `${sec}S`;
}

function productLabel(product: string): string {
    return product === 'private_trader' ? 'Private Trader' : 'Signals';
}

function dirLabel(direction: string): string {
    return direction === 'put' ? 'SELL' : 'BUY';
}

function cfgInt(key: string, fallback: number): number {
    const n = parseInt(getConfig(key) ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function cfgNum(key: string, fallback: number): number {
    const n = Number(getConfig(key) ?? '');
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function notifyAdmin(msg: string): Promise<void> {
    // Plain text deliberately: engine notifications carry pair tickers and error
    // strings that break Markdown entity parsing.
    try {
        await botRef?.telegram.sendMessage(getAdminId(), msg);
    } catch (e) {
        logger.warn('yacht', `admin notify failed: ${errText(e)}`);
    }
}

/** Notify the admin at most once per occurrence of a condition. `clearOnce(key)`
 *  re-arms it when the condition goes away. */
async function notifyAdminOnce(key: string, msg: string): Promise<void> {
    if (notifiedOnce.has(key)) return;
    notifiedOnce.add(key);
    await notifyAdmin(msg);
}

function clearOnce(key: string): void {
    notifiedOnce.delete(key);
}

// ─── §6 Watcher collision guard ─────────────────────────────────────────────
//
// The directive expected the engine's `{PAIR} · {TF}` format to miss the Yacht
// Club watcher because the watcher's Private Trader regex is anchored to
// `PAIR | TF | Gale N`. That is true of THAT regex — but the watcher also has a
// keyword fallback, and `/setup/i` and `/signal/i` live in it. Every one of the
// four engine formats below trips that fallback:
//
//   setup card    → "… SETUP ✦"                    matches /setup/i
//   win result    → "🟢 WIN — setup hit."           matches /setup/i
//   loss result   → "There was a loss on this setup." matches /setup/i
//   session close → "Signals: 7 won / 3 lost"       matches /signal/i
//
// So a content guard is required, not merely a format choice. These signatures
// are exact substrings of the engine's own copy — precise enough that a manual
// post by Master still nudges normally.
const ENGINE_SIGNATURES = [
    'YACHT CLUB — SIGNALS SETUP ✦',
    'YACHT CLUB — PRIVATE TRADER SETUP ✦',
    '🟢 WIN — setup hit.',
    'There was a loss on this setup.',
    'Next session in 2 hours.',
];

/** True when a Yacht Club channel post was written by this engine. The watcher
 *  must return early on these — the engine sends its own nudge (§4.6), so
 *  letting the watcher fire too would double-nudge every funded user. */
export function isYachtEngineMessage(text: string): boolean {
    if (!text) return false;
    return ENGINE_SIGNATURES.some(sig => text.includes(sig));
}

// ─── Message formats (§4.5) ─────────────────────────────────────────────────

function setupCard(product: string, pair: string, timeframeSec: number, direction: string, confidence: number): string {
    const header = product === 'private_trader'
        ? '⟡ YACHT CLUB — PRIVATE TRADER SETUP ✦'
        : '· YACHT CLUB — SIGNALS SETUP ✦';
    return `${header}\n\n${pair} · ${tfLabel(timeframeSec)}\n\n` +
        `Direction: ${dirLabel(direction)}\nConfidence: ${confidence}%\n\n` +
        'The engine is executing this now.';
}

function winCard(pair: string, timeframeSec: number, direction: string, rounds: number): string {
    return `🟢 WIN — setup hit.\n\n${pair} · ${tfLabel(timeframeSec)} · ${dirLabel(direction)}\n` +
        `Recovery: ${rounds} round(s)`;
}

const LOSS_CARD = 'There was a loss on this setup.\nThe engine is already analyzing the next one.';

function sessionCloseCard(product: string, wins: number, losses: number): string {
    return `Session closed.\n\n${productLabel(product)}: ${wins} won / ${losses} lost\n` +
        'Next session in 2 hours.';
}

const NUDGE_TEXT = '· New setup just dropped in the Yacht Club ✦\nThe scan is live — check it before the window closes.';
const NUDGE_KB = { inline_keyboard: [[{ text: 'Check the Yacht Club', url: YACHT_CLUB_LINK }]] };

// ─── IQ Option side — a dedicated SDK for the Yacht account ─────────────────
//
// The Yacht Club trades a SEPARATE IQ account, so it must never take an entry
// from sdkPool (that pool is keyed by telegram id and holds member sessions).
// One SDK is held for the engine and rebuilt on auth failure.

/** One login attempt, mirroring the bot's reconnect transport handling: the
 *  configured proxy first, direct as the fallback. */
async function loginAttempt(email: string, password: string, useProxy: boolean): Promise<string> {
    const opts: Record<string, unknown> = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
        body: JSON.stringify({ identifier: email, password }),
    };
    const proxyUrl = getProxyUrl();
    if (useProxy && proxyUrl) opts.dispatcher = new ProxyAgent(proxyUrl);

    const res = await fetch(`${IQ_AUTH_URL}/v2/login`, opts as RequestInit);
    const raw = await res.text();
    let data: Record<string, unknown>;
    try {
        data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        throw new Error(`login response is not JSON (HTTP ${res.status})`);
    }
    // 2FA cannot be answered by an unattended engine — surface it as a hard stop
    // rather than looping the login forever.
    if (data.code === 'verify') throw new Error('IQ Option is asking for a 2FA code — the Yacht account must have 2FA disabled');
    if (data.code !== 'success' || !data.ssid) throw new Error(String(data.message ?? 'login failed'));
    return String(data.ssid);
}

async function yachtLogin(): Promise<string> {
    const email = envVal('YACHT_IQ_EMAIL');
    const password = envVal('YACHT_IQ_PASSWORD');
    if (!email || !password) throw new Error('YACHT_IQ_EMAIL / YACHT_IQ_PASSWORD not set');

    if (getProxyUrl()) {
        try {
            return await loginAttempt(email, password, true);
        } catch (e) {
            logger.warn('yacht', `proxy login failed (${errText(e)}) — trying direct`);
        }
    }
    return loginAttempt(email, password, false);
}

async function getYachtSdk(): Promise<YachtSdk> {
    if (_sdk) return _sdk;
    const ssid = await yachtLogin();
    _sdk = await withTimeout(createSdk(ssid), 180_000, 'yacht sdk create');
    logger.info('yacht', 'IQ session established for the Yacht account');
    return _sdk;
}

function dropYachtSdk(reason: string): void {
    const sdk = _sdk;
    _sdk = null;
    if (!sdk) return;
    logger.warn('yacht', `dropping IQ session: ${reason}`);
    void Promise.resolve(sdk.shutdown()).catch(() => { /* best-effort */ });
}

// ─── Telegram side — posting as a real user account ─────────────────────────
//
// Connect-per-use with a bounded release, exactly like src/affiliate.ts: one
// auth key permits one live connection, and a half-open socket still counts on
// Telegram's side. Never hold this client between posts.

async function getPosterClient(): Promise<TelegramClient> {
    if (_poster?.connected) return _poster;

    const session = envVal('YACHT_TELEGRAM_SESSION');
    const apiId = parseInt(process.env.TELEGRAM_API_ID ?? '', 10);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';
    if (!session || !Number.isFinite(apiId) || !apiHash) {
        throw new Error('missing YACHT_TELEGRAM_SESSION / TELEGRAM_API_ID / TELEGRAM_API_HASH');
    }

    _poster = new TelegramClient(new StringSession(session), apiId, apiHash, {
        connectionRetries: 3,
        baseLogger: undefined as never,
    });
    try {
        await withTimeout(_poster.connect(), 15_000, 'poster connect');
    } catch (err) {
        try {
            const conn = (_poster as unknown as { _connection?: { _socket?: { destroy?: () => void } } })._connection;
            conn?._socket?.destroy?.();
        } catch { /* best-effort */ }
        _poster = null;
        throw err;
    }
    return _poster;
}

function releasePosterClient(): void {
    const c = _poster;
    // Null the reference first — that is what makes this idempotent.
    _poster = null;
    if (!c) return;
    const killSocket = () => {
        try {
            const conn = (c as unknown as { _connection?: { _socket?: { destroy?: () => void } } })._connection;
            conn?._socket?.destroy?.();
        } catch { /* best-effort */ }
    };
    try {
        if (c.connected) {
            Promise.race([
                c.disconnect(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('disconnect timeout')), 2000)),
            ]).catch(() => {
                try { c.destroy?.(); } catch { /* best-effort */ }
                killSocket();
            });
        } else {
            try { c.destroy?.(); } catch { /* best-effort */ }
            killSocket();
        }
    } catch { /* best-effort */ }
    logger.info('yacht', 'poster session released');
}

function channelTarget(): string | number {
    const raw = (process.env.YACHT_CHANNEL_ID ?? '').trim() || CHANNEL_ID_DEFAULT;
    if (raw.startsWith('@')) return raw;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
}

/** Post one message to the Yacht Club channel as the real user account.
 *  Throws on any failure — callers treat that as "do not trade". */
async function postToChannel(text: string): Promise<void> {
    const client = await getPosterClient();
    try {
        const target = channelTarget();
        let entity: unknown;
        try {
            entity = await withTimeout(client.getEntity(target as never), 15_000, 'resolve channel');
        } catch (e) {
            // A freshly-minted session has an empty entity cache and cannot map a
            // raw channel id to an access hash. One dialog page fills it in.
            logger.warn('yacht', `channel not in entity cache (${errText(e)}) — loading dialogs`);
            await withTimeout(client.getDialogs({ limit: 200 }), 20_000, 'get dialogs');
            entity = await withTimeout(client.getEntity(target as never), 15_000, 'resolve channel retry');
        }
        await withTimeout(client.sendMessage(entity as never, { message: text }), 20_000, 'channel post');
    } finally {
        releasePosterClient();
    }
}

// ─── User nudges (§4.6) ─────────────────────────────────────────────────────

/** Same audience the Yacht Club watcher uses: the test user when one is pinned,
 *  otherwise every approved funded member. */
function nudgeTargets(): number[] {
    const testUid = getTestUserId();
    if (testUid) return [testUid];
    try {
        return (db.prepare("SELECT telegram_id FROM users WHERE approval_status='approved' AND funded_balance_usd > 0").all() as Array<{ telegram_id: number }>)
            .map(r => r.telegram_id);
    } catch (e) {
        logger.warn('yacht', `nudge target query failed: ${errText(e)}`);
        return [];
    }
}

/** Cancel-out send: the new nudge replaces the previous one so a member never
 *  accumulates a column of them. Exactly the watcher's pattern, same table. */
async function sendSetupNudges(): Promise<number> {
    const bot = botRef;
    if (!bot) return 0;
    const targets = nudgeTargets();
    let sent = 0;
    for (const uid of targets) {
        try {
            const m = await bot.telegram.sendMessage(uid, NUDGE_TEXT, { reply_markup: NUDGE_KB });
            const prev = db.prepare('SELECT message_id FROM yacht_watch_sent WHERE telegram_id = ?').get(uid) as { message_id: number } | undefined;
            if (prev) bot.telegram.deleteMessage(uid, prev.message_id).catch(() => { });
            db.prepare('INSERT OR REPLACE INTO yacht_watch_sent (telegram_id, message_id, sent_at) VALUES (?, ?, ?)')
                .run(uid, m.message_id, Date.now());
            sent++;
        } catch { /* blocked bot, deleted account — skip */ }
        if (NUDGE_DELAY_MS > 0) await new Promise(r => setTimeout(r, NUDGE_DELAY_MS));
    }
    return sent;
}

// ─── Setup generation (§4.2) ────────────────────────────────────────────────

interface GeneratedSetup {
    pair: string;
    direction: 'call' | 'put';
    confidence: number;      // display confidence, already clamped
    timeframeSec: number;
}

function timeframeFor(product: string): number {
    return product === 'private_trader'
        ? cfgInt('yacht_tf_private', 120)
        : cfgInt('yacht_tf_signals', 60);
}

/** Analyze every open pair at the product's timeframe and return the highest
 *  confidence one. Returns null when nothing is analyzable (market closed). */
async function generateSetup(product: string): Promise<GeneratedSetup | null> {
    const timeframeSec = timeframeFor(product);
    const sdk = await getYachtSdk();

    const turbo = await withTimeout(sdk.turboOptions(), 60_000, 'turboOptions');
    const candlesFacade = await withTimeout(sdk.candles(), 60_000, 'candles');
    // Openness is checked on the facade that will actually execute the buy
    // (trade-core buys Blitz), not on the analysis feed — a pair can be present
    // in turbo actives and still be unbuyable.
    const blitz = await withTimeout(sdk.blitzOptions(), 60_000, 'blitzOptions');
    const now = sdk.currentTime();

    const turboActives = turbo.getActives();
    const blitzActives = blitz.getActives();

    let best: GeneratedSetup | null = null;
    let bestRaw = -1;
    let examined = 0;

    for (const pair of ALL_PAIRS) {
        try {
            const key = normTicker(pair);
            const active = turboActives.find(a => normTicker(a.ticker) === key || normTicker(a.localizationKey) === key);
            if (!active) continue;

            const buyable = blitzActives.find(a => normTicker(a.ticker) === key || normTicker(a.localizationKey) === key);
            if (!buyable) continue;
            if (typeof buyable.canBeBoughtAt === 'function' && !buyable.canBeBoughtAt(now)) continue;

            const history = await withTimeout(
                candlesFacade.getCandles(active.id, timeframeSec, { count: ANALYSIS_CANDLES }),
                30_000,
                `candles ${pair}`,
            );
            if (history.length < MIN_CANDLES) continue;

            examined++;
            const analysis = runAdminAnalysis(history);
            if (analysis.confidence > bestRaw) {
                bestRaw = analysis.confidence;
                best = {
                    pair,
                    direction: analysis.direction,
                    confidence: clampDisplayConfidence(analysis.confidence),
                    timeframeSec,
                };
            }
        } catch (e) {
            logger.warn('yacht', `analysis skipped ${pair}: ${errText(e)}`);
        }
    }

    if (!best) return null;
    logger.info('yacht', `best of ${examined} pair(s): ${best.pair} ${best.direction} raw=${bestRaw}% display=${best.confidence}%`);
    return best;
}

// ─── One setup, end to end ──────────────────────────────────────────────────

/** Every fatal condition lands here: the session is stopped and the engine is
 *  disarmed, so nothing restarts until the admin runs /yacht start. */
async function fatal(session: YachtSession | null, reason: string, adminMsg: string): Promise<void> {
    logger.error('yacht', `PAUSED — ${reason}`);
    if (session) stopYachtSession(session.id);
    setConfig('yacht_enabled', '0');
    await notifyAdmin(`Yacht engine: ${adminMsg}\n\nThe session is paused. Run /yacht start when it is fixed.`);
}

async function runOneSetup(session: YachtSession): Promise<void> {
    const product = session.product;

    // 1. Analysis first — it needs the IQ session, so a login failure is caught
    //    BEFORE anything is posted and the channel never sees an orphan card.
    let setup: GeneratedSetup | null;
    try {
        setup = await generateSetup(product);
    } catch (e) {
        dropYachtSdk(errText(e));
        await fatal(session, `analysis/login failed: ${errText(e)}`, `login failed — check YACHT_IQ_* env (${errText(e)})`);
        return;
    }

    if (!setup) {
        if (noPairsSince === 0) noPairsSince = Date.now();
        logger.info('yacht', 'no open pairs — waiting');
        if (Date.now() - noPairsSince >= NO_PAIRS_ALERT_MS) {
            await notifyAdminOnce('no-pairs', 'Yacht engine: no tradable pair for over an hour — the market looks closed. The engine is still armed and will resume on its own.');
        }
        return;
    }
    noPairsSince = 0;
    clearOnce('no-pairs');

    const stake = cfgNum('yacht_stake', 200);
    const galeRounds = cfgInt('yacht_gale', 3);

    const setupId = insertYachtSetup({
        session_id: session.id,
        product,
        pair: setup.pair,
        timeframe_sec: setup.timeframeSec,
        direction: setup.direction,
        stake,
    });

    // 2. Post the card BEFORE executing. A failure here means no trade at all.
    try {
        await postToChannel(setupCard(product, setup.pair, setup.timeframeSec, setup.direction, setup.confidence));
        clearOnce('poster');
    } catch (e) {
        updateYachtSetup(setupId, { status: 'aborted', closed_at: new Date().toISOString() });
        logger.error('yacht', `poster session unavailable — setup NOT executed: ${errText(e)}`);
        await fatal(session, `channel post failed: ${errText(e)}`, `could not post to the Yacht Club channel (${errText(e)}). No trade was placed.`);
        return;
    }
    logger.info('yacht', `setup #${setup.pair} posted (${product}, ${tfLabel(setup.timeframeSec)}, ${dirLabel(setup.direction)}, ${setup.confidence}%)`);

    // 3. Nudge members. Best-effort — a nudge failure must not block the trade.
    const nudged = await sendSetupNudges();
    logger.info('yacht', `nudged ${nudged} member(s)`);

    // 4. Execute.
    updateYachtSetup(setupId, { status: 'executing' });
    let lastTradeId: string | null = null;
    let outcome: Awaited<ReturnType<typeof runMartingaleCore>>;
    try {
        const sdk = await getYachtSdk();
        logger.info('yacht', `placing ${setup.pair} ${setup.direction} stake=${stake} gale=${galeRounds} tf=${setup.timeframeSec}s`);
        outcome = await runMartingaleCore(sdk, {
            pair: setup.pair,
            direction: setup.direction,
            amount: stake,
            galeRounds,
            timeframeSec: setup.timeframeSec,
            balanceType: 'live',
            telegramId: 0,
            cooldownMs: 2000,
        }, (info) => {
            const id = info.result.tradeId || info.result.externalId;
            if (id) lastTradeId = String(id);
        });
    } catch (e) {
        dropYachtSdk(errText(e));
        updateYachtSetup(setupId, { status: 'aborted', trade_id: lastTradeId, closed_at: new Date().toISOString() });
        // The card is already in the channel; advance the counter so the session
        // still terminates, but claim neither a win nor a loss.
        bumpYachtSessionCounters(session.id, 'none');
        nextSetupAt = Date.now() + SETUP_PAUSE_MS;
        await fatal(session, `execution failed: ${errText(e)}`, `the trade could not be executed (${errText(e)}). Nothing was posted as a result.`);
        return;
    }

    // 5. Settle. WIN/TIE count as a win; everything else is a loss.
    const won = outcome.status === 'WIN' || outcome.status === 'TIE';
    updateYachtSetup(setupId, {
        status: won ? 'won' : 'lost',
        trade_id: lastTradeId,
        result_rounds: outcome.rounds,
        closed_at: new Date().toISOString(),
    });
    bumpYachtSessionCounters(session.id, won ? 'win' : 'loss');
    logger.info('yacht', `result ${setup.pair} → ${outcome.status} rounds=${outcome.rounds}${outcome.error ? ` (${outcome.error})` : ''}`);

    // 6. Result to the channel. A post failure here is logged, not fatal — the
    //    trade is already settled and the counters are already correct.
    try {
        await postToChannel(won ? winCard(setup.pair, setup.timeframeSec, setup.direction, outcome.rounds) : LOSS_CARD);
    } catch (e) {
        logger.error('yacht', `result post failed: ${errText(e)}`);
        await notifyAdminOnce('result-post', `Yacht engine: a result message could not be posted (${errText(e)}). The trade itself settled normally.`);
    }

    nextSetupAt = Date.now() + SETUP_PAUSE_MS;
}

// ─── Session lifecycle (§4.1) ───────────────────────────────────────────────

function nextProduct(last: YachtSession | undefined): string {
    if (!last) return 'signals';
    return last.product === 'signals' ? 'private_trader' : 'signals';
}

async function endSession(session: YachtSession): Promise<void> {
    const wins = session.wins;
    const losses = session.losses;
    endYachtSession(session.id, wins, losses);
    logger.info('yacht', `session #${session.id} (${session.product}) ended — ${wins}W / ${losses}L; cooldown 2h`);
    try {
        await postToChannel(sessionCloseCard(session.product, wins, losses));
    } catch (e) {
        logger.error('yacht', `session-close post failed: ${errText(e)}`);
    }
    await notifyAdmin(`Yacht engine: ${productLabel(session.product)} session closed — ${wins} won / ${losses} lost. Next session in 2 hours.`);
}

/** Resolve a setup orphaned by a restart. Returns true when the engine should
 *  stand down this tick and wait for it. */
function handleInFlight(session: YachtSession): boolean {
    const inFlight = getInFlightYachtSetup(session.id);
    if (!inFlight) return false;

    const age = Date.now() - sqlTimeMs(inFlight.posted_at);
    if (age < IN_FLIGHT_GRACE_MS) {
        logger.info('yacht', `setup ${inFlight.id} still executing (${Math.round(age / 1000)}s) — not starting another`);
        return true;
    }
    // Past the grace window nothing will resolve it: the martingale promise died
    // with the process. Trade recovery settles the TRADE row; the setup is
    // released here so the session can finish. No result is posted — the engine
    // does not know the outcome and will not guess in the channel.
    logger.warn('yacht', `setup ${inFlight.id} abandoned after restart (${Math.round(age / 60000)}min) — marking aborted`);
    updateYachtSetup(inFlight.id, { status: 'aborted', closed_at: new Date().toISOString() });
    bumpYachtSessionCounters(session.id, 'none');
    nextSetupAt = Date.now() + SETUP_PAUSE_MS;
    return true;
}

/** One scheduler step. Exported so `/yacht start` can kick it immediately
 *  instead of waiting up to 60s for the interval, and so the behavioural
 *  harness can drive the state machine deterministically. Safe to call at any
 *  time: it is a no-op while the engine is busy or disarmed. */
export async function yachtTick(): Promise<void> {
    if (engineBusy) return;
    engineBusy = true;
    try {
        if (getConfig('yacht_enabled') !== '1') return;

        let session = getActiveYachtSession();

        if (!session) {
            const last = getLastYachtSession();
            const endedAt = sqlTimeMs(last?.ended_at);
            if (endedAt > 0) {
                const since = Date.now() - endedAt;
                if (since < COOLDOWN_MS) {
                    logger.info('yacht', `cooldown — next session in ${Math.ceil((COOLDOWN_MS - since) / 60000)}min`);
                    return;
                }
            }
            const product = nextProduct(last);
            session = startYachtSession(product);
            nextSetupAt = 0;
            noPairsSince = 0;
            logger.info('yacht', `session #${session.id} started (${product}, ${SETUPS_PER_SESSION} setups, ${tfLabel(timeframeFor(product))})`);
            await notifyAdmin(`Yacht engine: ${productLabel(product)} session started — ${SETUPS_PER_SESSION} setups at ${tfLabel(timeframeFor(product))}.`);
        }

        // Restart safety before anything else — never start a setup while one is
        // (or might still be) live.
        if (handleInFlight(session)) return;

        if (session.setups_done >= SETUPS_PER_SESSION) {
            await endSession(session);
            return;
        }

        if (Date.now() < nextSetupAt) {
            logger.info('yacht', `pause — next setup in ${Math.ceil((nextSetupAt - Date.now()) / 1000)}s`);
            return;
        }

        await runOneSetup(session);
    } catch (e) {
        // A throw here must never take the bot down.
        logger.error('yacht', `tick failed: ${errText(e)}`, e);
    } finally {
        engineBusy = false;
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Seed the config defaults once so /yacht shows real values before the first run. */
function seedYachtConfig(): void {
    const defaults: Array<[string, string]> = [
        ['yacht_enabled', '0'],
        ['yacht_tf_signals', '60'],
        ['yacht_tf_private', '120'],
        ['yacht_stake', '200'],
        ['yacht_gale', '3'],
    ];
    for (const [k, v] of defaults) {
        if (getConfig(k) === null) setConfig(k, v);
    }
}

export function startYachtEngine(bot: Telegraf): void {
    botRef = bot;
    seedYachtConfig();
    // The nudge cancel-out table is created by bot.ts; create it defensively so
    // module load order can never matter.
    try {
        db.exec('CREATE TABLE IF NOT EXISTS yacht_watch_sent (telegram_id INTEGER PRIMARY KEY, message_id INTEGER, sent_at INTEGER)');
    } catch { /* already exists */ }

    if (tickTimer) return;
    tickTimer = setInterval(() => { void yachtTick(); }, TICK_MS);

    const armed = getConfig('yacht_enabled') === '1';
    const missing = [
        envVal('YACHT_IQ_EMAIL') ? null : 'YACHT_IQ_EMAIL',
        envVal('YACHT_IQ_PASSWORD') ? null : 'YACHT_IQ_PASSWORD',
        envVal('YACHT_TELEGRAM_SESSION') ? null : 'YACHT_TELEGRAM_SESSION',
    ].filter(Boolean) as string[];

    logger.info('yacht', `engine ${armed ? 'ARMED' : 'paused'} (60s tick, ${SETUPS_PER_SESSION} setups/session, 2h between sessions)` +
        (missing.length ? ` — MISSING ENV: ${missing.join(', ')}` : ''));

    if (missing.length) {
        void notifyAdmin(`Yacht engine: ${missing.join(', ')} not set. The engine is loaded but cannot run a session until they are filled in.`);
    } else {
        void notifyAdmin(`Yacht engine: ${armed ? 'armed and running' : 'loaded but paused'}. Use /yacht for status.`);
    }
}

/** Arm the engine. The next tick picks it up; a tick is also kicked immediately
 *  so `/yacht start` feels instant. */
export function yachtStart(): string {
    setConfig('yacht_enabled', '1');
    notifiedOnce.clear();
    noPairsSince = 0;
    void yachtTick();
    logger.info('yacht', 'engine armed by admin');
    return 'Yacht engine started.';
}

/** Disarm. A setup already mid-execution holds `engineBusy` and finishes
 *  normally — the flag is only read at the top of the NEXT tick, so an open
 *  trade is never killed. */
export function yachtStop(): string {
    setConfig('yacht_enabled', '0');
    logger.info('yacht', 'engine disarmed by admin');
    return 'Yacht engine stopped after the current setup.';
}

/** Status card for /yacht. Admin-facing, so it may show the stake — this text
 *  never goes to the channel. */
export function yachtStatusText(): string {
    const enabled = getConfig('yacht_enabled') === '1';
    const active = getActiveYachtSession();
    const last = getLastYachtSession();
    const lines: string[] = ['◆ YACHT CLUB ENGINE', ''];

    lines.push(`Engine: ${enabled ? 'ON' : 'OFF'}`);

    if (active) {
        lines.push(`Session: #${active.id} · ${productLabel(active.product)} · ${active.status}`);
        lines.push(`Setups: ${active.setups_done}/${SETUPS_PER_SESSION}`);
        lines.push(`Record: ${active.wins} won / ${active.losses} lost`);
        if (nextSetupAt > Date.now()) {
            lines.push(`Next setup: ${Math.ceil((nextSetupAt - Date.now()) / 1000)}s`);
        }
    } else {
        lines.push('Session: none running');
        const endedAt = sqlTimeMs(last?.ended_at);
        if (endedAt > 0) {
            const left = COOLDOWN_MS - (Date.now() - endedAt);
            lines.push(left > 0
                ? `Next session: in ${Math.ceil(left / 60000)}min (${productLabel(nextProduct(last))})`
                : `Next session: due now (${productLabel(nextProduct(last))})`);
        } else {
            lines.push(`Next session: ${productLabel(nextProduct(last))}`);
        }
    }

    if (last) {
        lines.push('', `Last session: #${last.id} ${productLabel(last.product)} · ${last.status}` +
            (last.ended_at ? ` · ended ${last.ended_at} UTC` : ''));
        lines.push(`Last record: ${last.wins} won / ${last.losses} lost`);
    }

    const missing = [
        envVal('YACHT_IQ_EMAIL') ? null : 'YACHT_IQ_EMAIL',
        envVal('YACHT_IQ_PASSWORD') ? null : 'YACHT_IQ_PASSWORD',
        envVal('YACHT_TELEGRAM_SESSION') ? null : 'YACHT_TELEGRAM_SESSION',
    ].filter(Boolean) as string[];
    if (missing.length) lines.push('', `⚠ Missing env: ${missing.join(', ')}`);

    lines.push('', `Stake ${cfgNum('yacht_stake', 200)} · Gale ${cfgInt('yacht_gale', 3)} · ` +
        `Signals ${tfLabel(cfgInt('yacht_tf_signals', 60))} · Private ${tfLabel(cfgInt('yacht_tf_private', 120))}`);
    lines.push('', '/yacht start · /yacht stop');
    return lines.join('\n');
}
