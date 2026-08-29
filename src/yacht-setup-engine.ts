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
    getExecutingYachtSetups,
    getYachtSessionById,
    getYachtSetupById,
    type YachtSession,
    type YachtSetup,
} from './db.js';
import { resolveYachtSetupTrades } from './tradeRecovery.js';
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
const SETUP_PAUSE_MS = 120_000;
/** Gap between one session ending and the next starting. */
const COOLDOWN_MS = 2 * 60 * 60_000;
/** Settle slack added on top of the full martingale ladder when budgeting one
 *  setup's execution (DIRECTIVE-YACHT-RESULT-HARDENING Part 1). */
const CHAIN_SLACK_MS = 180_000;
/** How long after a setup was posted an orphaned `executing` row is considered
 *  resolvable. The row can only be orphaned by a process death — while a chain
 *  is genuinely running in-process, `engineBusy` stops any tick from reaching
 *  the check at all — so this is purely "has the broker had time to settle it".
 *  Covers the 60s entry hold + the expiry + 30s. */
const ORPHAN_SETTLE_SLACK_MS = 90_000;
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
/** Cancellation token for the live card countdown. A chain that aborts must not
 *  leave "⏳ Entry in 0:47" ticking on a card whose trade is already resolved. */
let activeCountdown: { cancelled: boolean } | null = null;
/** The boot scan runs once, inside the first tick, before any new setup starts. */
let bootScanDone = false;

let _sdk: YachtSdk | null = null;

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
    '· 10x Signal',
    '🟢 WIN — signal hit! ✅',
    '🔴 Signal finished — all attempts done.',
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

/** Currency → flag emoji, mirroring the bot's real signal card (§ bot.ts). */
const CURRENCY_FLAGS: Record<string, string> = {
    EUR: '🇪🇺', USD: '🇺🇸', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺',
    NZD: '🇳🇿', CAD: '🇨🇦', CHF: '🇨🇭',
};

function pairFlags(p: string): string {
    const m = p.match(/^(\w{3})(\w{3})/);
    if (!m) return p;
    return `${CURRENCY_FLAGS[m[1]] || ''} ${m[1]}/${m[2]} ${CURRENCY_FLAGS[m[2]] || ''}`;
}

function fmtClock(d: Date): string {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' });
}

/** Display confidence for Yacht Club cards — PURE random 80-97%, independent
 *  of the real analysis (same doctrine as the bot's clampDisplayConfidence:
 *  the shown number is cosmetic; the analysis only decides direction). */
function yachtDisplayConfidence(): number {
    return Math.floor(Math.random() * 18) + 80; // 80..97
}

/** The setup messages the engine posts to the Yacht Club:
 *   - signals → the 10x Signal card (bot.ts renderCard) — the engine executes
 *     these on the Yacht account, so the card carries the full ladder.
 *   - private_trader → a SETUP ANNOUNCEMENT, not a card: no direction shown
 *     (members trade it themselves through the button — their own Private
 *     Trader decides direction). The engine STILL executes the same setup on
 *     the Yacht account in parallel, so a real result drops at the end.
 *  Channel doctrine: no PnL / stake / balance anywhere. */
function setupCard(product: string, pair: string, timeframeSec: number, direction: string, confidence: number, galeRounds: number): string {
    const dirStr = direction === 'put' ? 'SELL' : 'BUY';
    const dirEmoji = direction === 'put' ? '🔴' : '🟢';
    if (product === 'private_trader') {
        return [
            '⟡ PRIVATE TRADER SETUP ✦',
            '',
            `◆ Assets: ${pair}`,
            `◆ Timeframe: ${tfLabel(timeframeSec)}`,
            `◆ Smart Recovery: ${galeRounds} rounds`,
            '',
            'Execute it yourself in the bot — tap the button below 👇',
        ].join('\n');
    }
    const entryTime = new Date(Date.now() + 60_000);
    const lvlTime = (n: number) => fmtClock(new Date(entryTime.getTime() + n * timeframeSec * 1000));
    return [
        '· 10x Signal',
        '',
        `✦ Accuracy Level: ${Math.round(confidence)}%`,
        '',
        `✦ Trade: ${pairFlags(pair)} (OTC)`,
        `··· Expiry: ${tfLabel(timeframeSec)}`,
        `→️ Entry: ${fmtClock(entryTime)}`,
        `◆ Direction: ${dirStr} ${dirEmoji}`,
        '',
        '→️ Martingale Levels:',
        `• Level 1 → ${lvlTime(1)}`,
        `• Level 2 → ${lvlTime(2)}`,
        `• Level 3 → ${lvlTime(3)}`,
        '',
        'The engine is executing this now.',
    ].join('\n');
}

/** WIN result — product-aware:
 *   - signals → the bot's signal-hit template
 *   - private_trader → the AI Trading result language (Direct Win / Recovery
 *     complete / New setup loading), PnL-free for the channel. */
function winCard(product: string, pair: string, timeframeSec: number, direction: string, rounds: number): string {
    const maxAttempts = 4; // initial + 3 gale rounds
    if (product === 'private_trader') {
        return [
            '⟡ PRIVATE TRADER — RESULT ✦',
            '',
            `◆ Assets: ${pair}`,
            `◆ Timeframe: ${tfLabel(timeframeSec)}`,
            `◆ Attempt: ${rounds}/${maxAttempts}`,
            '',
            rounds === 1 ? '🟢 WIN — Direct Win ✅' : '🟢 WIN — Recovery complete ✅',
            'New setup loading ✦',
        ].join('\n');
    }
    return [
        '· 10x Signal — RESULT',
        '',
        `◆ Trade: ${pairFlags(pair)} (OTC)`,
        `··· Expiry: ${tfLabel(timeframeSec)}`,
        `→️ Attempt: ${rounds}/${maxAttempts}`,
        '',
        '🟢 WIN — signal hit! ✅',
        'Ready for the next signal 👇',
    ].join('\n');
}

/** LOSS result — product-aware. Private Trader mirrors the AI Trading closer:
 *  calm, no accumulated loss total (subtle-loss doctrine). */
function lossCard(product: string, pair: string, timeframeSec: number, direction: string): string {
    const maxAttempts = 4; // initial + 3 gale rounds
    if (product === 'private_trader') {
        return [
            '⟡ PRIVATE TRADER — RESULT ✦',
            '',
            `◆ Assets: ${pair}`,
            `◆ Timeframe: ${tfLabel(timeframeSec)}`,
            `◆ Attempt: ${maxAttempts}/${maxAttempts}`,
            '',
            '🔴 LOSS — Sequence done · New setup loading ✦',
        ].join('\n');
    }
    return [
        '· 10x Signal — RESULT',
        '',
        `◆ Trade: ${pairFlags(pair)} (OTC)`,
        `··· Expiry: ${tfLabel(timeframeSec)}`,
        `→️ Attempt: ${maxAttempts}/${maxAttempts}`,
        '',
        '🔴 Signal finished — all attempts done.',
        'Try a new signal 👇',
    ].join('\n');
}

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

// ─── Telegram side — posting as the 10x bot ─────────────────────────────────
//
// The 10x bot (@Shiloh10xbot) is admin of the Yacht Club channel, so it can
// post there via the Bot API — no user session, no MTProto, no login codes.
// `botRef` is the same Telegraf instance that handles user messages.

function channelTarget(): string | number {
    const raw = (process.env.YACHT_CHANNEL_ID ?? '').trim() || CHANNEL_ID_DEFAULT;
    if (raw.startsWith('@')) return raw;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
}

/** Post one message to the Yacht Club channel as the 10x bot.
 *  Throws on any failure — callers treat that as "do not trade".
 *  Returns the posted message_id (needed for live countdown edits). */
async function postToChannel(text: string, keyboard?: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> }): Promise<number> {
    const bot = botRef;
    if (!bot) throw new Error('yacht engine has no bot reference');
    const target = channelTarget();
    const sent = await withTimeout(
        bot.telegram.sendMessage(target, text, keyboard ? { reply_markup: keyboard as never } : undefined),
        20_000,
        'channel post',
    );
    return sent.message_id;
}

/** Post to the channel with 429-aware retry (3 attempts, backoff by
 *  Telegram's retry-after). Used for results and session closes, which fire
 *  right after countdown edits and are the posts that used to 429. */
async function postToChannelRetry(text: string, keyboard?: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> }): Promise<number> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await postToChannel(text, keyboard);
        } catch (e) {
            const m = errText(e);
            if (!/429|Too Many Requests/i.test(m) || attempt >= 3) throw e;
            const wait = (retryAfterSeconds(m) || 10) * 1000;
            logger.warn('yacht', `channel post 429 (attempt ${attempt}/3) — backing off ${wait}ms`);
            await new Promise(r => setTimeout(r, wait));
        }
    }
}

/** Live countdown on the signal card: edits the posted message every second —
 *  "⏳ Entry in 0:47" during the 60s prep window, then "⏳ Expiry in 1:30"
 *  until the trade window closes. Best-effort: any edit failure stops the
 *  countdown silently (a dead countdown must never block the engine). */
function fmtCountdown(totalSec: number): string {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** Parse Telegram's "retry after N" seconds from a 429 error, 0 when absent. */
function retryAfterSeconds(m: string): number {
    const hit = m.match(/retry after (\d+)/i);
    return hit ? Number(hit[1]) : 0;
}

/** Sleep until an absolute epoch ms (1s granularity) — the entry hold, so the
 *  card countdown and the real IQ Option entry share one clock. */
async function sleepUntil(targetMs: number): Promise<void> {
    while (Date.now() < targetMs) {
        await new Promise(r => setTimeout(r, 1000));
    }
}

/** Stop the live countdown immediately. Called when a setup's chain ends —
 *  normally, on abort, or on timeout — so no edit ever lands on a card whose
 *  result has already been posted. */
function cancelCountdown(): void {
    if (activeCountdown) activeCountdown.cancelled = true;
    activeCountdown = null;
}

async function runSignalCountdown(msgId: number, baseText: string, entryAt: number, expiryAt: number, token: { cancelled: boolean }): Promise<void> {
    const bot = botRef;
    if (!bot) return;
    const target = channelTarget();
    let lastLine = '';
    let nextEditAt = 0;
    for (;;) {
        if (token.cancelled) return;
        const now = Date.now();
        let line: string;
        if (now < entryAt) {
            line = `⏳ Entry in ${fmtCountdown(Math.max(0, Math.ceil((entryAt - now) / 1000)))}`;
        } else if (now < expiryAt) {
            line = `⏳ Expiry in ${fmtCountdown(Math.max(0, Math.ceil((expiryAt - now) / 1000)))}`;
        } else {
            return; // window closed — the result card takes over
        }
        if (line !== lastLine && now >= nextEditAt) {
            try {
                await withTimeout(
                    bot.telegram.editMessageText(target, msgId, undefined, `${baseText}\n\n${line}`),
                    5_000,
                    'countdown edit',
                );
                lastLine = line;
                // Telegram's per-chat budget for bots is ~20 messages/min
                // (edits count). 2s spacing = 30/min → guaranteed 429 after a
                // minute of ticking, which froze the card (stopped at 0:23,
                // jumped to 0:02 after the penalty). 4s = 15/min, leaving
                // headroom for the setup post, result post and session close.
                nextEditAt = Date.now() + 4_000;
            } catch (e) {
                const m = errText(e);
                if (/429|Too Many Requests/i.test(m)) {
                    // Rate-limited: wait out the retry window and KEEP COUNTING —
                    // the card resumes from wall-clock so it never drifts.
                    const wait = (retryAfterSeconds(m) || 15) * 1000;
                    logger.warn('yacht', `countdown edit 429 — backing off ${wait}ms`);
                    nextEditAt = Date.now() + wait;
                } else if (/400|not found|can't edit|Forbidden/i.test(m)) {
                    return; // message gone or cannot be edited — permanent
                } else {
                    nextEditAt = Date.now() + 5_000; // transient — slow down, keep going
                }
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }
}

/** Button that opens the bot AND drops the member straight into the Private
 *  Trader trade wizard — one tap.
 *
 *  MUST be a t.me URL button: a URL is the only Telegram button type that
 *  makes the client OPEN the bot chat (navigation). A callback button can
 *  only run the flow in the background — it never opens the chat, which the
 *  user explicitly requires. The URL is /start?pt=, and bot.ts routes that
 *  payload to openTradeWizard() (Trade live | Trade Demo → wizard), so the
 *  tap both opens the bot and lands in the trade flow. */
const PRIVATE_TRADER_KB = {
    inline_keyboard: [[{ text: '⟡ Open Private Trader', url: 'https://t.me/Shiloh10xbot?start=pt' }]],
};

/** Signal drops carry a direct IQ Option link so members can trade along on
 *  their own accounts while the engine executes on the Yacht account. */
const SIGNAL_KB = {
    inline_keyboard: [[{ text: '◆ Open IQ Option', url: 'https://iqoption.com' }]],
};

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
    // Config gate: yacht_nudges=0 silences user nudges (test channel runs,
    // private session testing) while the channel posts keep working.
    if (getConfig('yacht_nudges') === '0') {
        logger.info('yacht', 'nudges disabled by config (yacht_nudges=0)');
        return 0;
    }
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

/** Timeframe pool — setups rotate through these instead of a fixed TF. */
const TIMEFRAME_POOL: number[] = [30, 60, 120, 300];
let tfCursor = 0;

function timeframeFor(product: string): number {
    // Alternate across the pool (30s → 1m → 2m → 5m → …) so the channel shows
    // different timeframes just as it shows different assets.
    const tf = TIMEFRAME_POOL[tfCursor % TIMEFRAME_POOL.length];
    tfCursor += 1;
    return tf;
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
                    confidence: yachtDisplayConfidence(),
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
    // Entry/expiry clocks — shared by the countdown and the execution hold.
    // Function-scoped (var-style) so both the post step and the execution step
    // see them; block-scoping inside the post try made them invisible later.
    let entryAt = 0;
    let expiryAt = 0;

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

    // 2. Post the setup BEFORE anything else. A failure here means no drop at all.
    try {
        // Private Trader: announcement + button into the bot (members execute
        // themselves). Signals: card + IQ Option link (members trade along).
        const kb = product === 'private_trader' ? PRIVATE_TRADER_KB : SIGNAL_KB;
        const cardText = setupCard(product, setup.pair, setup.timeframeSec, setup.direction, setup.confidence, galeRounds);
        const msgId = await postToChannel(cardText, kb);
        clearOnce('poster');
        // One clock for card and execution: the entry fires 60s after the post
        // (when the countdown hits 0:00), expiry is entry + timeframe. Signals
        // show the countdown live on the card; private-trader posts run the
        // same hold silently so results land at the true expiry.
        entryAt = Date.now() + 60_000;
        expiryAt = entryAt + setup.timeframeSec * 1000;
        if (product === 'signals') {
            const token = { cancelled: false };
            activeCountdown = token;
            void runSignalCountdown(msgId, cardText, entryAt, expiryAt, token).catch(() => { });
        }
    } catch (e) {
        updateYachtSetup(setupId, { status: 'aborted', closed_at: new Date().toISOString() });
        logger.error('yacht', `channel post failed — setup NOT dropped: ${errText(e)}`);
        await fatal(session, `channel post failed: ${errText(e)}`, `could not post to the Yacht Club channel (${errText(e)}). Nothing was placed.`);
        return;
    }
    logger.info('yacht', `setup #${setupId} posted (${product}, ${setup.pair}, ${tfLabel(setup.timeframeSec)}, ${dirLabel(setup.direction)}, ${setup.confidence}%)`);

    // 3. Nudge members. Best-effort — a nudge failure must not block anything.
    const nudged = await sendSetupNudges();
    logger.info('yacht', `nudged ${nudged} member(s)`);

    // 4. Execute — the engine runs EVERY setup (signals AND private trader) on
    //    the Yacht account so a real result drops in the channel at the end.
    //    Private Trader members still trade it themselves through the button;
    //    the engine's parallel execution is what produces the result post.
    updateYachtSetup(setupId, { status: 'executing' });

    // 4a. TOTAL-CHAIN BUDGET (DIRECTIVE-YACHT-RESULT-HARDENING Part 1).
    // The 2026-08-29 incident: the watchdog restarted the process mid-settle, the
    // in-process `runMartingaleCore` await died with it, and — because nothing
    // bounded this step — the engine sat on `status='executing'` forever, never
    // posted a confirmed WIN, and blocked the next setup for 24 minutes.
    // Budget = the full ladder's expiries + 3 min of settle slack. The 60s entry
    // hold is INSIDE the budget (it lives in the same wrapped promise), covered
    // by the slack.
    const chainTimeoutMs = (galeRounds + 1) * setup.timeframeSec * 1000 + CHAIN_SLACK_MS;
    const chainLabel = `setup ${setupId} chain`;
    let lastTradeId: string | null = null;
    let outcome: Awaited<ReturnType<typeof runMartingaleCore>> | null = null;

    try {
        outcome = await withTimeout((async () => {
            // Entry hold — the trade fires when the card's countdown reaches 0:00.
            const holdMs = entryAt - Date.now();
            if (holdMs > 0) {
                logger.info('yacht', `entry hold ${Math.round(holdMs / 1000)}s (${setup.pair} ${dirLabel(setup.direction)}) — trade fires at countdown 0:00`);
                await sleepUntil(entryAt);
            }
            const sdk = await getYachtSdk();
            logger.info('yacht', `placing ${setup.pair} ${setup.direction} stake=${stake} gale=${galeRounds} tf=${setup.timeframeSec}s (chain budget ${Math.round(chainTimeoutMs / 1000)}s)`);
            return await runMartingaleCore(sdk, {
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
        })(), chainTimeoutMs, chainLabel);
    } catch (e) {
        cancelCountdown();
        if (errText(e) === `${chainLabel} timeout`) {
            // The chain blew its budget. Do NOT fabricate a result and do NOT
            // pause the engine: resolve the real outcome from position history
            // and carry on to the next setup.
            logger.warn('yacht', `setup ${setupId} chain timed out after ${Math.round(chainTimeoutMs / 1000)}s — resolving from position history`);
            // Shutting the SDK down also kills the zombie chain still awaiting a
            // settle behind the timed-out promise, so it cannot place further
            // rounds while we recover. getYachtSdk() then logs in fresh.
            dropYachtSdk('chain timeout');
            await resolveOrphanSetup(setupId, 'chain timeout');
            nextSetupAt = Date.now() + SETUP_PAUSE_MS;
            return;
        }
        dropYachtSdk(errText(e));
        updateYachtSetup(setupId, { status: 'aborted', trade_id: lastTradeId, closed_at: new Date().toISOString() });
        // The card is already in the channel; advance the counter so the session
        // still terminates, but claim neither a win nor a loss.
        bumpYachtSessionCounters(session.id, 'none');
        nextSetupAt = Date.now() + SETUP_PAUSE_MS;
        await fatal(session, `execution failed: ${errText(e)}`, `the trade could not be executed (${errText(e)}). Nothing was posted as a result.`);
        return;
    }
    cancelCountdown();

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
        await postToChannelRetry(won ? winCard(product, setup.pair, setup.timeframeSec, setup.direction, outcome.rounds) : lossCard(product, setup.pair, setup.timeframeSec, setup.direction));
    } catch (e) {
        logger.error('yacht', `result post failed: ${errText(e)}`);
        await notifyAdminOnce('result-post', `Yacht engine: a result message could not be posted (${errText(e)}). The trade itself settled normally.`);
    }

    nextSetupAt = Date.now() + SETUP_PAUSE_MS;
}

// ─── Orphan resolution (DIRECTIVE-YACHT-RESULT-HARDENING Part 2) ────────────
//
// One code path for all three triggers — boot scan, periodic tick check, and
// the Part 1 chain timeout — so the double-post guard exists in exactly one
// place. Read-only against IQ Option: it looks the positions up, it never
// places anything, so recovery can never produce a second entry.

/** Resolve an orphaned `executing` setup and post its REAL result.
 *  Returns true when a result card was posted. */
async function resolveOrphanSetup(setupId: number, trigger: string): Promise<boolean> {
    // Re-read: this is the double-post guard. Any path that already resolved
    // this setup has flipped it off 'executing', and we stop here.
    const setup = getYachtSetupById(setupId);
    if (!setup || setup.status !== 'executing' || setup.closed_at) {
        logger.info('yacht', `setup ${setupId} already resolved (${setup?.status ?? 'missing'}) — no second post`);
        return false;
    }
    const session = setup.session_id != null ? getYachtSessionById(setup.session_id) : undefined;
    const product = setup.product;
    const galeRounds = cfgInt('yacht_gale', 3);

    let resolution: Awaited<ReturnType<typeof resolveYachtSetupTrades>> = null;
    try {
        const sdk = await getYachtSdk();
        resolution = await resolveYachtSetupTrades(sdk, setup, galeRounds);
    } catch (e) {
        logger.error('yacht', `setup ${setupId} recovery failed (${trigger}): ${errText(e)}`);
        dropYachtSdk(errText(e));
    }

    const closedAt = new Date().toISOString();

    if (!resolution || resolution.outcome === 'truncated') {
        // No position, or a ladder the dead process never finished. Posting a loss
        // card here would claim "all attempts done", which is not true — so the
        // setup is aborted silently and the session moves on.
        const why = !resolution
            ? 'no position found'
            : `ladder truncated at round ${resolution.rounds}/${galeRounds + 1}`;
        updateYachtSetup(setupId, {
            status: 'aborted',
            trade_id: resolution?.tradeId != null ? String(resolution.tradeId) : setup.trade_id,
            result_rounds: resolution?.rounds ?? null,
            closed_at: closedAt,
        });
        if (session) bumpYachtSessionCounters(session.id, 'none');
        logger.warn('yacht', `setup ${setupId} aborted — ${trigger}, ${why}`);
        await notifyAdminOnce(`orphan-${setupId}`, `Yacht engine: setup ${setupId} (${setup.pair}) could not be resolved — ${why}. No result was posted; the session continues.`);
        return false;
    }

    const won = resolution.outcome === 'win';
    // Flip the status BEFORE posting. A crash between the two loses one card;
    // the reverse order could post the same result twice, which is worse.
    updateYachtSetup(setupId, {
        status: won ? 'won' : 'lost',
        trade_id: resolution.tradeId != null ? String(resolution.tradeId) : setup.trade_id,
        result_rounds: resolution.rounds,
        closed_at: closedAt,
    });
    if (session) bumpYachtSessionCounters(session.id, won ? 'win' : 'loss');
    logger.info('yacht', `setup ${setupId} recovered via ${trigger}: ${resolution.outcome.toUpperCase()} rounds=${resolution.rounds} pair=${setup.pair}`);

    try {
        await postToChannelRetry(won
            ? winCard(product, setup.pair, setup.timeframe_sec, setup.direction, resolution.rounds)
            : lossCard(product, setup.pair, setup.timeframe_sec, setup.direction));
        return true;
    } catch (e) {
        logger.error('yacht', `recovered result post failed for setup ${setupId}: ${errText(e)}`);
        await notifyAdminOnce('result-post', `Yacht engine: the recovered result for setup ${setupId} could not be posted (${errText(e)}). The trade itself is settled in the DB.`);
        return false;
    }
}

/** Boot scan: resolve every setup a previous process left `executing` before the
 *  engine is allowed to start a new one. Runs once, inside the first tick, so it
 *  holds `engineBusy` and cannot race the scheduler. */
async function runBootScan(): Promise<void> {
    bootScanDone = true;
    let orphans: YachtSetup[] = [];
    try {
        orphans = getExecutingYachtSetups();
    } catch (e) {
        logger.error('yacht', `boot scan query failed: ${errText(e)}`);
        return;
    }
    if (orphans.length === 0) return;

    logger.warn('yacht', `boot scan: ${orphans.length} setup(s) left executing by a previous process`);
    // A recovered result is still a result: give the channel the normal pause
    // before the next setup card instead of stacking them back to back.
    nextSetupAt = Date.now() + SETUP_PAUSE_MS;
    for (const o of orphans) {
        const age = Date.now() - sqlTimeMs(o.posted_at);
        const settleDue = (Number(o.timeframe_sec) || 60) * 1000 + ORPHAN_SETTLE_SLACK_MS;
        if (age < settleDue) {
            // Posted moments before the restart — its own expiry has not passed
            // yet, so position history has nothing to say. The periodic check
            // picks it up on a later tick.
            logger.info('yacht', `boot scan: setup ${o.id} is only ${Math.round(age / 1000)}s old — leaving it for the tick check`);
            continue;
        }
        await resolveOrphanSetup(o.id, 'boot scan');
    }
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
        await postToChannelRetry(sessionCloseCard(session.product, wins, losses));
    } catch (e) {
        logger.error('yacht', `session-close post failed: ${errText(e)}`);
    }
    const closeSummary = session.product === 'private_trader'
        ? `${session.setups_done} setups shared`
        : `${wins} won / ${losses} lost`;
    await notifyAdmin(`Yacht engine: ${productLabel(session.product)} session closed — ${closeSummary}. Next session in 2 hours.`);
}

/** Periodic orphan check (Part 2, trigger 2). Returns true when the engine
 *  should stand down this tick.
 *
 *  A setup seen here is ALWAYS orphaned: while a chain is genuinely running
 *  in-process, `runOneSetup` holds `engineBusy` and no tick can reach this
 *  function at all. So there is no live chain to race — the only question is
 *  whether the broker has had time to settle it (expiry + 90s).
 *
 *  Before this directive the engine simply waited 45 minutes and then aborted
 *  without ever asking IQ Option what happened. That is what silenced the
 *  channel for 24 minutes on a trade that had already won. */
async function handleInFlight(session: YachtSession): Promise<boolean> {
    const inFlight = getInFlightYachtSetup(session.id);
    if (!inFlight) return false;

    const age = Date.now() - sqlTimeMs(inFlight.posted_at);
    const settleDue = (Number(inFlight.timeframe_sec) || 60) * 1000 + ORPHAN_SETTLE_SLACK_MS;
    if (age < settleDue) {
        logger.info('yacht', `setup ${inFlight.id} still executing (${Math.round(age / 1000)}s of ${Math.round(settleDue / 1000)}s) — waiting for its expiry`);
        return true;
    }
    logger.warn('yacht', `setup ${inFlight.id} orphaned (${Math.round(age / 1000)}s, no live chain) — resolving from position history`);
    await resolveOrphanSetup(inFlight.id, 'tick check');
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

        // Boot scan first, once — an orphan from the previous process is resolved
        // and its result posted BEFORE the engine is allowed to start anything new.
        if (!bootScanDone) await runBootScan();

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
        if (await handleInFlight(session)) return;

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
        ['yacht_nudges', '1'],
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
    ].filter(Boolean) as string[];

    logger.info('yacht', `engine ${armed ? 'ARMED' : 'paused'} (60s tick, ${SETUPS_PER_SESSION} setups/session, 2h between sessions)` +
        (missing.length ? ` — MISSING ENV: ${missing.join(', ')}` : ''));

    if (missing.length) {
        void notifyAdmin(`Yacht engine: ${missing.join(', ')} not set. The engine is loaded but cannot run a session until they are filled in.`);
    } else {
        void notifyAdmin(`Yacht engine: ${armed ? 'armed and running' : 'loaded but paused'}. Use /yacht for status.`);
    }
}

/** Arm the engine. When no session is running, a new session starts
 *  IMMEDIATELY — the 2h cooldown is bypassed (force-start). The cooldown
 *  resets to 2h from whenever that forced session ends. */
export function yachtStart(): string {
    setConfig('yacht_enabled', '1');
    notifiedOnce.clear();
    noPairsSince = 0;
    const active = getActiveYachtSession();
    if (!active) {
        const last = getLastYachtSession();
        const product = nextProduct(last);
        try {
            const session = startYachtSession(product);
            nextSetupAt = 0;
            logger.info('yacht', `session #${session.id} started (${product}) — force-started by admin (cooldown bypassed)`);
            void notifyAdmin(`Yacht engine: ${productLabel(product)} session started (forced by admin) — ${SETUPS_PER_SESSION} setups at ${tfLabel(timeframeFor(product))}.`);
        } catch (e) {
            logger.error('yacht', `force-start failed: ${errText(e)}`);
            return `❌ Yacht engine started, but the session could not be created: ${errText(e)}`;
        }
    }
    void yachtTick();
    logger.info('yacht', 'engine armed by admin');
    return active
        ? `Yacht engine started. Session #${active.id} (${productLabel(active.product)}) is already running — one session at a time.`
        : 'Yacht engine started — session forced now. The 2h wait resets when the session ends.';
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
    ].filter(Boolean) as string[];
    if (missing.length) lines.push('', `⚠ Missing env: ${missing.join(', ')}`);

    lines.push('', `Stake ${cfgNum('yacht_stake', 200)} · Gale ${cfgInt('yacht_gale', 3)} · ` +
        `Signals ${tfLabel(cfgInt('yacht_tf_signals', 60))} · Private ${tfLabel(cfgInt('yacht_tf_private', 120))}`);
    lines.push('', '/yacht start — forces a session now (bypasses the 2h wait)');
    lines.push('/yacht stop — stops after the current setup');
    return lines.join('\n');
}
