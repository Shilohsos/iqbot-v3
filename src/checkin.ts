// Daily AI Check-in system (DIRECTIVE-AI-CHECKIN-DAILY.md).
//
// Three interactive check-ins per day — 08:00 / 13:00 / 20:00 Africa/Lagos
// (WAT, fixed UTC+1, no DST) — pushed to every approved user. Design rules are
// locked: symbols only (no emojis), currency-aware money display, live SDK
// balance on every display (never the DB cache), no dead-end replies, and two
// button-expiry classes — session buttons (goal/target/wrap-up choices) die at
// the next check-in window, functional buttons (Start Trading, Today's
// Signals, Today's stats, Talk to admin) never expire.
//
// bot.ts wires this module in three places: registers ONE callback route
// (`checkin:*`) to handleCheckinCallback, calls tryHandleCheckinTargetText at
// the top of bot.on('text'), and injects its live-balance refresher via
// setCheckinLiveRefresher so this module never opens its own SDK connections.

import type { Telegraf, Telegram } from 'telegraf';
import { db, getUser } from './db.js';
import { AI_TRADING_MIN_USD, FALLBACK_RATES, CURRENCY_SYMBOLS, fmtBalance, fmtMoney } from './access.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';

const DEPOSIT_URL = 'https://iqoption.com/pwa/payments/deposit';
const SUPPORT_URL = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
const TUTORIAL_URL = 'https://youtu.be/5h6RyYflM6U?si=at7JABo9gfL9VfFS';
const TARGET_PRESETS_USD = [20, 50, 100];

// ─── DB ─────────────────────────────────────────────────────────────────────

export function initCheckinDb(): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS checkin_sent (
            telegram_id  INTEGER NOT NULL,
            checkin_date TEXT    NOT NULL,
            window       TEXT    NOT NULL,
            sent_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (telegram_id, checkin_date, window)
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS checkin_goals (
            telegram_id INTEGER NOT NULL,
            goal_date   TEXT    NOT NULL,
            target      REAL    NOT NULL,
            currency    TEXT    NOT NULL DEFAULT 'USD',
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (telegram_id, goal_date)
        )
    `);
}

function isSent(telegramId: number, date: string, win: string): boolean {
    return !!db.prepare('SELECT 1 FROM checkin_sent WHERE telegram_id = ? AND checkin_date = ? AND window = ?')
        .get(telegramId, date, win);
}

function markSent(telegramId: number, date: string, win: string): void {
    db.prepare('INSERT OR IGNORE INTO checkin_sent (telegram_id, checkin_date, window) VALUES (?, ?, ?)')
        .run(telegramId, date, win);
}

function saveGoal(telegramId: number, goalDate: string, target: number, currency: string): void {
    db.prepare(`
        INSERT INTO checkin_goals (telegram_id, goal_date, target, currency) VALUES (?, ?, ?, ?)
        ON CONFLICT(telegram_id, goal_date) DO UPDATE SET target = excluded.target, currency = excluded.currency
    `).run(telegramId, goalDate, target, currency);
}

/** Next batch of approved users who haven't been sent this window+date yet. */
function getPendingBatch(win: string, date: string, limit: number): number[] {
    return (db.prepare(`
        SELECT u.telegram_id AS telegram_id
        FROM users u
        WHERE u.approval_status = 'approved'
          AND NOT EXISTS (
              SELECT 1 FROM checkin_sent cs
              WHERE cs.telegram_id = u.telegram_id AND cs.checkin_date = ? AND cs.window = ?
          )
        ORDER BY u.telegram_id
        LIMIT ?
    `).all(date, win, limit) as { telegram_id: number }[]).map(r => r.telegram_id);
}

function getTodayStats(telegramId: number): { n: number; w: number; l: number; net: number } {
    const since = lagosMidnightSql();
    const rows = db.prepare(`
        SELECT status, amount, pnl FROM trades
        WHERE telegram_id = ? AND created_at >= ? AND status IN ('WIN', 'LOSS', 'TIE')
    `).all(telegramId, since) as { status: string; amount: number; pnl: number }[];
    let w = 0, l = 0, net = 0;
    for (const r of rows) {
        if (r.status === 'WIN') { w++; net += r.pnl - r.amount; }
        else if (r.status === 'LOSS') { l++; net -= r.amount; }
        // TIE: counted in n, contributes 0 to net.
    }
    return { n: rows.length, w, l, net };
}

// ─── Time — Africa/Lagos, fixed +1 offset (no DST), never a timezone library ──

type WindowName = 'morning' | 'afternoon' | 'night';

function lagosNow(): Date {
    // Shift the UTC instant by +1h so reading it with UTC getters yields the
    // Lagos wall-clock value directly — no Intl/timezone-database lookups.
    return new Date(Date.now() + 3_600_000);
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function addDays(dateStr: string, n: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return isoDate(d);
}

/**
 * The window that is currently "live" — spans from its start hour until the
 * next window's start hour, with the night window wrapping across midnight
 * into the next Lagos calendar date. Used both to fire the scheduler and to
 * gate session-button expiry.
 */
function currentWindowIdentity(): { name: WindowName; date: string } {
    const now = lagosNow();
    const hour = now.getUTCHours();
    if (hour >= 20) return { name: 'night', date: isoDate(now) };
    if (hour >= 13) return { name: 'afternoon', date: isoDate(now) };
    if (hour >= 8) return { name: 'morning', date: isoDate(now) };
    // Before 08:00 Lagos — still inside last night's window, which started yesterday.
    const yesterday = new Date(now.getTime() - 86_400_000);
    return { name: 'night', date: isoDate(yesterday) };
}

function nextWindowLabel(): string {
    const cur = currentWindowIdentity();
    if (cur.name === 'morning') return '1 PM';
    if (cur.name === 'afternoon') return '8 PM';
    return '8 AM';
}

function isSessionExpired(win: string, winDate: string): boolean {
    const cur = currentWindowIdentity();
    return !(cur.name === win && cur.date === winDate);
}

/** Lagos-midnight boundary for "today", as a SQLite datetime('now')-format string. */
function lagosMidnightSql(): string {
    const now = lagosNow();
    const midnightUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0) - 3_600_000;
    return new Date(midnightUtcMs).toISOString().slice(0, 19).replace('T', ' ');
}

// ─── Name resolution (cached getChat, mirrors auto-broadcast.ts's resolveName) ─

const NAME_CACHE_TTL = 10 * 60 * 1000;
const nameCache = new Map<number, { name: string; expires: number }>();

async function resolveName(tg: Telegram, telegramId: number): Promise<string> {
    const cached = nameCache.get(telegramId);
    if (cached && cached.expires > Date.now()) return cached.name;
    try {
        const chat: any = await tg.getChat(telegramId);
        const name: string = chat?.first_name ?? 'there';
        nameCache.set(telegramId, { name, expires: Date.now() + NAME_CACHE_TTL });
        return name;
    } catch {
        return 'there';
    }
}

// ─── Live balance — dependency-injected from bot.ts's refreshFundedBalanceFromLive
// so this module never opens its own SDK connections. ─────────────────────────

type LiveRefresher = (uid: number) => Promise<{ amount: number; currency: string } | null>;
let liveRefresher: LiveRefresher | null = null;

/** Wired once at boot: bot.ts passes its refreshFundedBalanceFromLive here. */
export function setCheckinLiveRefresher(fn: LiveRefresher): void {
    liveRefresher = fn;
}

/**
 * Live-scans the user's real balance (rule: never DB cache) and returns both
 * the native-currency display string and the USD-equivalent for threshold
 * checks (funded_balance_usd is refreshed as a side effect of the live scan).
 */
async function liveBalance(telegramId: number): Promise<{ usd: number; display: string }> {
    const real = liveRefresher ? await liveRefresher(telegramId).catch(() => null) : null;
    const user = getUser(telegramId);
    const usd = user?.funded_balance_usd ?? 0;
    if (real) return { usd, display: fmtBalance(real) };
    const currency = user?.currency ?? 'USD';
    return { usd, display: fmtBalance({ amount: 0, currency }) };
}

// ─── Money formatting for goals/targets — rounder, no forced decimals ────────

/** Round to ~2 significant figures so localized targets look like clean numbers. */
function roundNice(n: number): number {
    if (n <= 0) return 0;
    if (n < 100) return Math.round(n);
    const magnitude = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / magnitude) * magnitude;
}

/** Convert a USD preset (20/50/100) into the user's currency using the same
 *  approximate fallback rates access.ts uses for threshold display — a real
 *  SDK rate lookup is unnecessary for a rounded goal suggestion. */
function localizePreset(usdAmount: number, currency: string): number {
    if (currency === 'USD') return usdAmount;
    const rate = FALLBACK_RATES[currency.toUpperCase()];
    if (!rate) return usdAmount;
    return roundNice(usdAmount / rate);
}

function fmtTarget(amount: number, currency: string): string {
    const sym = CURRENCY_SYMBOLS[currency] || currency || '$';
    return `${sym}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

// ─── Shared keyboards ───────────────────────────────────────────────────────

function momentumKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '✦ Start Trading', callback_data: 'checkin:starttrade' }],
            [{ text: "· Today's Signals", callback_data: 'ui:signals' }],
        ],
    };
}

function signalsOnlyKeyboard() {
    return { inline_keyboard: [[{ text: "· Today's Signals", callback_data: 'ui:signals' }]] };
}

function targetKeyboard(win: string, winDate: string, goalDate: string, currency: string) {
    const presetRow = TARGET_PRESETS_USD.map(usd => {
        const localized = localizePreset(usd, currency);
        return { text: `✦ ${fmtTarget(localized, currency)}`, callback_data: `checkin:tgt:${win}:${winDate}:${goalDate}:${localized}` };
    });
    return {
        inline_keyboard: [
            presetRow,
            [{ text: '⟡ Set my own', callback_data: `checkin:tgtown:${win}:${winDate}:${goalDate}` }],
        ],
    };
}

function nightInitial(name: string, win: string, date: string) {
    return {
        text: `Good evening, ${name} ✦\n\nHow did today go?\n\nUp or down?`,
        keyboard: {
            inline_keyboard: [
                [{ text: '✦ Up — solid day', callback_data: `checkin:up:${win}:${date}` }],
                [{ text: '· Down — rough one', callback_data: `checkin:down:${win}:${date}` }],
            ],
        },
    };
}

// ─── Scheduler — initial push per window ───────────────────────────────────

function buildInitialMessage(win: WindowName, date: string, name: string): { text: string; keyboard: any } {
    if (win === 'morning') {
        return {
            text: `Good morning, ${name} ✦\n\nYesterday the market moved. Today it's yours.\n\nWhat's your goal for today?`,
            keyboard: {
                inline_keyboard: [
                    [{ text: '✦ Grow my account', callback_data: `checkin:grow:morning:${date}` }],
                    [{ text: '❖ Learn the system', callback_data: `checkin:learn:morning:${date}` }],
                    [{ text: '· Just watching today', callback_data: `checkin:watch:morning:${date}` }],
                ],
            },
        };
    }
    if (win === 'afternoon') {
        return {
            text: `Good afternoon, ${name} ✦\n\nHow is today going so far?\n\nHave you been trading?`,
            keyboard: {
                inline_keyboard: [
                    [{ text: '✦ Yes, trading now', callback_data: `checkin:aftyes:afternoon:${date}` }],
                    [{ text: '· Not yet', callback_data: `checkin:aftnot:afternoon:${date}` }],
                    [{ text: '· Just watching', callback_data: `checkin:aftwatch:afternoon:${date}` }],
                ],
            },
        };
    }
    const { text, keyboard } = nightInitial(name, win, date);
    return { text, keyboard };
}

const BATCH_SIZE = 30;
const SEND_DELAY_MS = 60;
const TICK_MS = 60_000;

// Same allowlist as bot.ts's maintenance gate (MAINTENANCE_ALLOWED_IDS) —
// duplicated locally rather than imported, matching how swarm.ts mirrors
// bot.ts's PRIVILEGED_USERS (bot.ts doesn't export module-private constants).
const MAINTENANCE_ALLOWED_IDS = new Set([6622587977, getAdminId()]);

async function sendCheckin(bot: Telegraf, telegramId: number, win: WindowName, date: string): Promise<void> {
    const name = await resolveName(bot.telegram, telegramId);
    const { text, keyboard } = buildInitialMessage(win, date, name);
    await bot.telegram.sendMessage(telegramId, text, { reply_markup: keyboard });
}

async function tick(bot: Telegraf): Promise<void> {
    const cur = currentWindowIdentity();
    const maintenanceOn = db.prepare("SELECT value FROM config WHERE key = 'maintenance_gate'").get() as { value: string } | undefined;
    let batch = getPendingBatch(cur.name, cur.date, BATCH_SIZE);
    if (maintenanceOn?.value === '1') {
        batch = batch.filter(uid => MAINTENANCE_ALLOWED_IDS.has(uid));
    }
    if (batch.length === 0) return;
    let sent = 0;
    for (const uid of batch) {
        try {
            await sendCheckin(bot, uid, cur.name, cur.date);
            sent++;
        } catch (err) {
            // Blocked/kicked/deactivated — mark sent anyway so we don't retry a
            // hard failure every tick for the rest of the window.
            logger.warn('checkin', `send failed for ${uid} (${cur.name} ${cur.date}): ${err instanceof Error ? err.message : err}`);
        }
        markSent(uid, cur.date, cur.name);
        await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    }
    logger.info('checkin', `${cur.name} ${cur.date}: sent ${sent}/${batch.length} (batch)`);
}

export function startCheckinScheduler(bot: Telegraf): void {
    tick(bot).catch(err => logger.error('checkin', 'initial tick failed', err));
    setInterval(() => {
        tick(bot).catch(err => logger.error('checkin', 'scheduler tick failed', err));
    }, TICK_MS);
    logger.info('checkin', 'daily check-in scheduler started (08:00 / 13:00 / 20:00 WAT)');
}

// ─── Callback handlers ──────────────────────────────────────────────────────

async function safeEdit(ctx: any, text: string, replyMarkup: any): Promise<void> {
    try {
        await ctx.editMessageText(text, { reply_markup: replyMarkup });
    } catch {
        try { await ctx.reply(text, { reply_markup: replyMarkup }); } catch { /* best effort */ }
    }
}

/** The ONLY answerCbQuery call for an expired session button — callers must not
 *  answer before this check, or the alert popup silently loses the race. */
async function replyExpired(ctx: any): Promise<void> {
    await ctx.answerCbQuery(`This check-in has ended. Next check-in at ${nextWindowLabel()}.`, { show_alert: true }).catch(() => { });
}

async function showGoalPrompt(ctx: any, win: string, winDate: string, dayOffset: 0 | 1): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const { display } = await liveBalance(uid);
    const goalDate = addDays(winDate, dayOffset);
    const currency = getUser(uid)?.currency ?? 'USD';
    const text = `Your balance right now: ${display}\n\nWhat's your target for today?`;
    await safeEdit(ctx, text, targetKeyboard(win, winDate, goalDate, currency));
}

async function handleLearn(ctx: any, win: string, winDate: string): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const text = "Signals show you the trade. Private Trader executes for you. Autopilot runs it hands-free.\n\nStart with signals — no risk, no pressure.";
    await safeEdit(ctx, text, {
        inline_keyboard: [
            [{ text: '❖ Watch Tutorial', url: TUTORIAL_URL }],
            [{ text: "· Today's Signals", callback_data: 'ui:signals' }],
        ],
    });
}

async function handleWatch(ctx: any, win: string, winDate: string): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const text = 'No pressure. ✦ The market will be here when you\'re ready.';
    await safeEdit(ctx, text, signalsOnlyKeyboard());
}

async function handleTargetPick(ctx: any, win: string, winDate: string, goalDate: string, amountStr: string): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const amount = parseFloat(amountStr);
    if (!isFinite(amount) || amount <= 0) return; // shouldn't happen — our own buttons only
    const currency = getUser(uid)?.currency ?? 'USD';
    saveGoal(uid, goalDate, amount, currency);
    const text = `Goal locked. ✦\n\nToday's target: ${fmtTarget(amount, currency)}\n\nI'll check on you at ${nextWindowLabel()}.\n\nStart now ─`;
    await safeEdit(ctx, text, momentumKeyboard());
}

const checkinTargetAwaiting = new Map<number, { telegramId: number; goalDate: string; win: string; winDate: string }>();

/** The goal-flow entry action for a given window — 'grow' (morning) is the only
 *  entry point for every window except 'night', which arrives via 'lockgoal'
 *  ("Lock tomorrow's goal"). Used to route the "Back" button to whichever
 *  action actually opened the target prompt, so it restores the same goalDate. */
function goalEntryAction(win: string): string {
    return win === 'night' ? 'lockgoal' : 'grow';
}

async function handleTargetOwn(ctx: any, win: string, winDate: string, goalDate: string): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const chatId = ctx.chat.id;
    checkinTargetAwaiting.set(chatId, { telegramId: uid, goalDate, win, winDate });
    await safeEdit(ctx, 'Type your target amount for today (e.g. 1,000).', {
        inline_keyboard: [[{ text: '⟵ Back', callback_data: `checkin:${goalEntryAction(win)}:${win}:${winDate}` }]],
    });
}

/** Top-of-bot.on('text') interceptor for the custom-target capture. Must run
 *  before the admin wizard / brain. Returns true when it consumed the message. */
export async function tryHandleCheckinTargetText(ctx: any): Promise<boolean> {
    const chatId = ctx.chat?.id;
    if (chatId == null) return false;
    const awaiting = checkinTargetAwaiting.get(chatId);
    if (!awaiting) return false;
    checkinTargetAwaiting.delete(chatId);

    if (isSessionExpired(awaiting.win, awaiting.winDate)) {
        await ctx.reply(`This check-in has ended. Next check-in at ${nextWindowLabel()}.`, { reply_markup: signalsOnlyKeyboard() }).catch(() => { });
        return true;
    }

    const text: string = ctx.message?.text ?? '';
    const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
    if (!isFinite(amount) || amount <= 0) {
        checkinTargetAwaiting.set(chatId, awaiting); // give them another try
        await ctx.reply('Please send a number, e.g. 1,000.', {
            reply_markup: { inline_keyboard: [[{ text: '⟵ Back', callback_data: `checkin:${goalEntryAction(awaiting.win)}:${awaiting.win}:${awaiting.winDate}` }]] },
        }).catch(() => { });
        return true;
    }

    const currency = getUser(awaiting.telegramId)?.currency ?? 'USD';
    saveGoal(awaiting.telegramId, awaiting.goalDate, amount, currency);
    const text2 = `Goal locked. ✦\n\nToday's target: ${fmtTarget(amount, currency)}\n\nI'll check on you at ${nextWindowLabel()}.\n\nStart now ─`;
    await ctx.reply(text2, { reply_markup: momentumKeyboard() }).catch(() => { });
    return true;
}

async function handleAfternoonBranch(ctx: any, win: string, winDate: string, branch: 'yes' | 'not' | 'watch'): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const { usd, display } = await liveBalance(uid);
    const belowMin = usd < AI_TRADING_MIN_USD;

    let bodyText: string;
    let rows: any[][];
    if (branch === 'yes') {
        bodyText = "That's the energy. ✦ Keep it going — I'll check your numbers at 8 PM.";
        rows = [
            [{ text: '✦ Start Trading', callback_data: 'checkin:starttrade' }],
            [{ text: "· Today's Signals", callback_data: 'ui:signals' }],
        ];
    } else if (branch === 'not') {
        bodyText = 'No rush. But the afternoon session is where it happens. The market moves hardest between now and 5 PM.';
        rows = [
            [{ text: "· Today's Signals", callback_data: 'ui:signals' }],
            [{ text: "✦ I'll wait for the evening", callback_data: `checkin:aftwait:${win}:${winDate}` }],
        ];
    } else {
        bodyText = "Respect. ✦ I'll check on you at 8 PM. If you change your mind before then, you know where to find me.";
        rows = [[{ text: "· Today's Signals", callback_data: 'ui:signals' }]];
    }

    let text = `${bodyText}\n\nYour balance right now: ${display}`;
    if (belowMin) {
        text += "\n\nYou're below the trading minimum — top up and the market opens up for you";
        rows = [[{ text: '✦ Fund Account', url: DEPOSIT_URL }], ...rows];
    }
    await safeEdit(ctx, text, { inline_keyboard: rows });
}

async function handleAfternoonWait(ctx: any, win: string, winDate: string): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const text = "No pressure. ✦ I'll check on you at 8 PM.";
    await safeEdit(ctx, text, signalsOnlyKeyboard());
}

async function handleUp(ctx: any, win: string, winDate: string): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const { display } = await liveBalance(uid);
    const text = `That's how you close a day. ✦\n\nYour balance right now: ${display}`;
    await safeEdit(ctx, text, {
        inline_keyboard: [
            [{ text: "✦ Lock tomorrow's goal", callback_data: `checkin:lockgoal:${win}:${winDate}` }],
            [{ text: "✦ Today's stats", callback_data: `checkin:stats:${win}:${winDate}` }],
            [{ text: "· I'll set it in the morning", callback_data: `checkin:setmorning:${win}:${winDate}` }],
        ],
    });
}

async function handleDown(ctx: any, win: string, winDate: string): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const { display } = await liveBalance(uid);
    const text = `Some days are like that.\n\nYour balance right now: ${display}`;
    await safeEdit(ctx, text, {
        inline_keyboard: [
            [{ text: '✆ Talk to admin', url: SUPPORT_URL }],
            [{ text: '· Good night', callback_data: `checkin:goodnight:${win}:${winDate}` }],
        ],
    });
}

async function handleFinalGoodnight(ctx: any, win: string, winDate: string): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const name = await resolveName(ctx.telegram, uid);
    const text = `Good night, ${name}. ✦\n\nSee you at 8 AM.`;
    await safeEdit(ctx, text, {
        inline_keyboard: [
            [{ text: '✦ Keep trading', callback_data: 'checkin:starttrade' }],
            [{ text: "✦ Today's stats", callback_data: `checkin:stats:${win}:${winDate}` }],
        ],
    });
}

async function handleStartTrade(ctx: any): Promise<void> {
    await ctx.answerCbQuery().catch(() => { });
    await safeEdit(ctx, 'Where do you want to trade?', {
        inline_keyboard: [[
            { text: '⟡ Private Trader', callback_data: 'ui:trade' },
            { text: '✦ Autopilot', callback_data: 'ui:auto' },
        ]],
    });
}

async function handleStats(ctx: any, win: string, winDate: string): Promise<void> {
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const currency = getUser(uid)?.currency ?? 'USD';
    const { n, w, l, net } = getTodayStats(uid);
    const sign = net >= 0 ? '+' : '-';
    const netDisplay = `${sign}${fmtMoney(Math.abs(net), currency)}`;
    const text = `✦ Today's stats\n\nToday: ${n} trades · ${w} wins · ${l} losses\nNet: ${netDisplay}`;
    await safeEdit(ctx, text, {
        inline_keyboard: [
            [{ text: '✦ Start Trading', callback_data: 'checkin:starttrade' }],
            [{ text: '· Back to wrap-up', callback_data: `checkin:backwrap:${win}:${winDate}` }],
        ],
    });
}

async function handleBackWrap(ctx: any, win: string, winDate: string): Promise<void> {
    if (isSessionExpired(win, winDate)) return replyExpired(ctx);
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const name = await resolveName(ctx.telegram, uid);
    const { text, keyboard } = nightInitial(name, win, winDate);
    await safeEdit(ctx, text, keyboard);
}

/** Single router for every `checkin:*` callback — registered once from bot.ts. */
export async function handleCheckinCallback(ctx: any): Promise<void> {
    const data: string = ctx.callbackQuery?.data ?? '';
    const parts = data.split(':');
    const action = parts[1];
    try {
        switch (action) {
            case 'grow': return await showGoalPrompt(ctx, parts[2], parts[3], 0);
            case 'lockgoal': return await showGoalPrompt(ctx, parts[2], parts[3], 1);
            case 'learn': return await handleLearn(ctx, parts[2], parts[3]);
            case 'watch': return await handleWatch(ctx, parts[2], parts[3]);
            case 'tgt': return await handleTargetPick(ctx, parts[2], parts[3], parts[4], parts[5]);
            case 'tgtown': return await handleTargetOwn(ctx, parts[2], parts[3], parts[4]);
            case 'aftyes': return await handleAfternoonBranch(ctx, parts[2], parts[3], 'yes');
            case 'aftnot': return await handleAfternoonBranch(ctx, parts[2], parts[3], 'not');
            case 'aftwatch': return await handleAfternoonBranch(ctx, parts[2], parts[3], 'watch');
            case 'aftwait': return await handleAfternoonWait(ctx, parts[2], parts[3]);
            case 'up': return await handleUp(ctx, parts[2], parts[3]);
            case 'down': return await handleDown(ctx, parts[2], parts[3]);
            case 'setmorning': return await handleFinalGoodnight(ctx, parts[2], parts[3]);
            case 'goodnight': return await handleFinalGoodnight(ctx, parts[2], parts[3]);
            case 'starttrade': return await handleStartTrade(ctx);
            case 'stats': return await handleStats(ctx, parts[2], parts[3]);
            case 'backwrap': return await handleBackWrap(ctx, parts[2], parts[3]);
            default:
                await ctx.answerCbQuery().catch(() => { });
        }
    } catch (err) {
        logger.error('checkin', `callback handler failed for action=${action}`, err);
        await ctx.answerCbQuery('Something went wrong. Try again.').catch(() => { });
    }
}
