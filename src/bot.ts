import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { ClientSdk, SsidAuthMethod, BalanceType } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST, IQ_AUTH_URL } from './protocol.js';
import { executeTrade, executeTradeWithSdk, createSdk, type TradeRequest, type TradeResult } from './trade.js';
import { getSdk, evictSdk, runSdkOp } from './sdkpool.js';
import {
    getRecentTrades, getTradeStats, getTopTradersToday,
    getUser, saveUser, saveUsername, deleteUser, getAllUsers, getAllUserIds,
    getActiveTraderIds, getInactiveTraderIds, findUsersByUsername,
    upsertOnboardingUser, approveUser, setManualApproval, rejectUser, resetUser, getApprovalStats,
    getRecentApprovals, getPendingManualUsers,
    setUserTier, saveUserCurrency, pauseUser, resumeUser,
    generateToken, validateToken, useToken, getTokens,
    updateLeaderboardAuto, addLeaderboardManual, getLeaderboard,
    getLeaderboardDetailed, updateLeaderboardManual,
    getFunnelStats, getConfig, setConfig,
    getAuditReport, maskUserId,
    calculatePairWinRates, selectTopPicks, type PairWinRate,
    setSession, getSession, deleteSession, cleanStaleSessions,
    saveGeneratedGiveawayId, isGeneratedIdUsed, getTradersIqUserIds, getGiveawayTargetIds,
} from './db.js';
import { analyzePair, type AnalysisResult } from './analysis.js';
import {
    amountKeyboard, timeframeKeyboard, pairKeyboard, tfLabel, OTC_PAIRS,
    tierKeyboard, tradeModeKeyboard, demoUpsellKeyboard, affiliateFailKeyboard,
} from './menu.js';
import { startKeyboard, backKeyboard, onboardKeyboard } from './ui/user.js';
import {
    getAdminId, adminKeyboard, adminBackKeyboard,
    broadcastTargetKeyboard, broadcastLinkKeyboard, broadcastActionKeyboard, broadcastTimerKeyboard,
    broadcastSendOrScheduleKeyboard, broadcastDelayKeyboard, scheduledBroadcastsKeyboard,
    tokenTierKeyboard, generateTokenKeyboard,
    topTradersAdminKeyboard, funnelKeyboard, memberManagementKeyboard, activationsKeyboard,
    giveawayTargetKeyboard,
} from './ui/admin.js';
import { checkAffiliate } from './affiliate.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const IQ_SSID   = process.env.IQ_SSID;
const AFFILIATE_LINK   = process.env.AFFILIATE_LINK   ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue';
const ADMIN_CONTACT_LINK = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
const ASSETS_DIR = process.env.ASSETS_DIR ?? '/root/iqbot-v3/assets';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing from .env');

process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });

const bot = new Telegraf(BOT_TOKEN);

// Save Telegram username on every interaction
bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    const username = ctx.from?.username;
    if (id && username) saveUsername(id, username);
    return next();
});

const MAX_ROUNDS       = 6;
const ROUND_COOLDOWN_MS = 5_000;

function escapeMd(s: string): string { return s.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&'); }

const CURRENCY_SYMBOLS: Record<string, string> = {
    USD: '$', NGN: '₦', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$',
};
function fmtBalance(b: { amount: number; currency?: string }): string {
    const sym = (b.currency && CURRENCY_SYMBOLS[b.currency]) || b.currency || '$';
    return `${sym}${b.amount.toFixed(2)}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`SDK timeout${label ? `: ${label}` : ''}`)), ms)
        ),
    ]);
}

function ASSET(f: string): { source: string } {
    return { source: `${ASSETS_DIR}/${f}` };
}

// ─── Session / wizard state ───────────────────────────────────────────────────

const sessionStats = new Map<number, { trades: number; pnl: number }>();
function getSessionStats(uid: number) {
    if (!sessionStats.has(uid)) sessionStats.set(uid, { trades: 0, pnl: 0 });
    return sessionStats.get(uid)!;
}

function makeSessionMap<T>(prefix: string) {
    const cache = new Map<number, T>();
    return {
        get: (k: number): T | undefined => {
            if (cache.has(k)) return cache.get(k);
            const fromDb = getSession<T>(`session:${prefix}:${k}`);
            if (fromDb !== undefined) cache.set(k, fromDb);
            return fromDb;
        },
        set: (k: number, v: T): void => { cache.set(k, v); setSession(`session:${prefix}:${k}`, v); },
        delete: (k: number): void => { cache.delete(k); deleteSession(`session:${prefix}:${k}`); },
        has: (k: number): boolean => cache.has(k) || getSession<T>(`session:${prefix}:${k}`) !== undefined,
    };
}

type WizardStep = 'mode' | 'amount' | 'timeframe' | 'pair' | 'custom_amount';
interface WizardState {
    step: WizardStep;
    mode?: 'demo' | 'live';
    amount?: number;
    timeframe?: number;
    lastImageMsgId?: number;
}
const wizardSessions = makeSessionMap<WizardState>('wizard');

type OnboardStep = 'user_id' | 'create_user_id' | 'connect_email' | 'connect_password';
interface OnboardState {
    step: OnboardStep;
    tier?: string;
    iqUserId?: number;
    email?: string;
    loginFailCount?: number;
}
const onboardSessions = makeSessionMap<OnboardState>('onboard');

type ConnectStep = 'email' | 'password';
interface ConnectState { step: ConnectStep; email?: string; }
const connectSessions = makeSessionMap<ConnectState>('connect');

type AdminStep =
    | 'find_users'
    | 'broadcast_message'
    | 'broadcast_media'
    | 'broadcast_link_url'
    | 'broadcast_link_label'
    | 'broadcast_custom_timer'
    | 'broadcast_schedule_custom'
    | 'manual_add_id'
    | 'manual_add_profit'
    | 'edit_trader_profit'
    | 'funnel_url'
    | 'member_pause'
    | 'member_resume'
    | 'member_remove'
    | 'member_message_id'
    | 'member_message_text'
    | 'member_add'
    | 'giveaway_winners'
    | 'giveaway_prize';

interface AdminSessionState {
    step: AdminStep;
    broadcastTarget?: 'active' | 'inactive' | 'all';
    broadcastLinkUrl?: string;
    manualAddUserId?: number;
    editTraderTelegramId?: number;
    memberMessageUserId?: number;
    giveawayWinners?: number;
    giveawayPrize?: number;
}
const adminSessions = makeSessionMap<AdminSessionState>('admin');

// Users waiting to enter an upgrade token
const upgradeSessionsMap = makeSessionMap<true>('upgrade');
const upgradeSessions = {
    has: (k: number) => upgradeSessionsMap.has(k),
    add: (k: number) => upgradeSessionsMap.set(k, true),
    delete: (k: number) => upgradeSessionsMap.delete(k),
};

interface BroadcastButton {
    text: string;
    type: 'url' | 'callback';
    value: string;
}

// In-flight broadcast payloads keyed by admin chat ID
const pendingBroadcasts = new Map<number, {
    message: string;
    targetIds: number[];
    media?: { type: 'photo' | 'video'; fileId: string };
    button?: BroadcastButton;
    deleteAfterMs?: number;
}>();

interface ScheduledBroadcast {
    id: number;
    message: string;
    targetIds: number[];
    button?: BroadcastButton;
    media?: { type: 'photo' | 'video'; fileId: string };
    deleteAfterMs: number;
    scheduledAt: Date;
    sent: boolean;
    createdAt: Date;
    timerId?: ReturnType<typeof setTimeout>;
}

const scheduledBroadcasts: ScheduledBroadcast[] = [];
let nextScheduledId = 1;

// userId → number of active martingale trades in flight
const activeTradeSessions = new Map<number, number>();
// per-user martingale config (Pro users can adjust)
const userMartingaleSettings = makeSessionMap<{ enabled: boolean; maxRounds: number }>('mg');

// Top picks cache — refreshed every 2 hours
const PICKS_REFRESH_MS = 2 * 60 * 60 * 1000;
let cachedTopPicks: PairWinRate[] = [];
let lastPicksRefresh = 0;
function getTopPicks(): PairWinRate[] {
    const now = Date.now();
    if (cachedTopPicks.length === 0 || now - lastPicksRefresh > PICKS_REFRESH_MS) {
        const rates = calculatePairWinRates();
        cachedTopPicks = selectTopPicks(rates);
        lastPicksRefresh = now;
        if (cachedTopPicks.length > 0)
            console.log('[topPicks] refreshed:', cachedTopPicks.map(p => `${p.pair}=${p.winRate}%`).join(', '));
    }
    return cachedTopPicks;
}

// Balance cache — avoids a fresh WS connection on every /start
const BALANCE_CACHE_TTL = 5 * 60 * 1000;
const balanceCache = new Map<number, { line: string; ts: number }>();

// Messages queued for users who were trading when a broadcast was sent
const pendingDeliveries = new Map<number, Array<{
    message: string;
    button?: BroadcastButton;
    media?: { type: 'photo' | 'video'; fileId: string };
    deleteAfterMs: number;
}>>();

function parseDuration(input: string): number | null {
    const match = input.trim().toLowerCase().match(/^(\d+)\s*(s|m|min|h)?$/);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    const unit = match[2] ?? 'm';
    if (unit === 's') return num * 1_000;
    if (unit === 'm' || unit === 'min') return num * 60_000;
    if (unit === 'h') return num * 3_600_000;
    return null;
}

async function flushPendingDeliveries(userId: number): Promise<void> {
    const queue = pendingDeliveries.get(userId);
    if (!queue || queue.length === 0) return;
    pendingDeliveries.delete(userId);
    for (const p of queue) {
        try {
            const rm = p.button ? { inline_keyboard: [[
                p.button.type === 'url'
                    ? { text: p.button.text, url: p.button.value }
                    : { text: p.button.text, callback_data: p.button.value },
            ]] } : undefined;
            let m;
            if (p.media?.type === 'photo') {
                m = await bot.telegram.sendPhoto(userId, p.media.fileId, { caption: p.message, ...(rm ? { reply_markup: rm } : {}) });
            } else if (p.media?.type === 'video') {
                m = await bot.telegram.sendVideo(userId, p.media.fileId, { caption: p.message, ...(rm ? { reply_markup: rm } : {}) });
            } else {
                m = await bot.telegram.sendMessage(userId, p.message, rm ? { reply_markup: rm } : undefined);
            }
            if (p.deleteAfterMs > 0 && m) {
                const msgId = m.message_id;
                setTimeout(() => bot.telegram.deleteMessage(userId, msgId).catch(() => {}), p.deleteAfterMs);
            }
        } catch {}
    }
}

async function dispatchBroadcastPayload(payload: {
    message: string;
    targetIds: number[];
    button?: BroadcastButton;
    media?: { type: 'photo' | 'video'; fileId: string };
    deleteAfterMs: number;
}): Promise<{ sent: number; deferred: number }> {
    const { message, targetIds, media, button, deleteAfterMs } = payload;
    const replyMarkup = button ? { inline_keyboard: [[
        button.type === 'url'
            ? { text: button.text, url: button.value }
            : { text: button.text, callback_data: button.value },
    ]] } : undefined;
    const sentMsgIds: Array<{ telegramId: number; msgId: number }> = [];
    let deferredCount = 0;

    for (const uid of targetIds) {
        try {
            if ((activeTradeSessions.get(uid) ?? 0) > 0) {
                const q = pendingDeliveries.get(uid) ?? [];
                q.push({ message, button, media, deleteAfterMs });
                pendingDeliveries.set(uid, q);
                deferredCount++;
                continue;
            }
            let m;
            if (media?.type === 'photo') {
                m = await bot.telegram.sendPhoto(uid, media.fileId, { caption: message, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
            } else if (media?.type === 'video') {
                m = await bot.telegram.sendVideo(uid, media.fileId, { caption: message, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
            } else {
                m = await bot.telegram.sendMessage(uid, message, replyMarkup ? { reply_markup: replyMarkup } : undefined);
            }
            sentMsgIds.push({ telegramId: uid, msgId: m.message_id });
        } catch {}
    }

    if (deleteAfterMs > 0) {
        setTimeout(() => {
            for (const { telegramId, msgId } of sentMsgIds) {
                bot.telegram.deleteMessage(telegramId, msgId).catch(() => {});
            }
        }, deleteAfterMs);
    }

    return { sent: sentMsgIds.length, deferred: deferredCount };
}

async function executeScheduledBroadcast(scheduled: ScheduledBroadcast): Promise<void> {
    scheduled.sent = true;
    const { sent, deferred } = await dispatchBroadcastPayload(scheduled);
    const timerLabel = scheduled.deleteAfterMs === 0 ? 'never' :
        scheduled.deleteAfterMs < 60_000 ? `${scheduled.deleteAfterMs / 1_000}s` :
        scheduled.deleteAfterMs < 3_600_000 ? `${scheduled.deleteAfterMs / 60_000}m` : `${scheduled.deleteAfterMs / 3_600_000}h`;
    let msg = `📅 Scheduled broadcast #${scheduled.id} sent to *${sent}/${scheduled.targetIds.length}* users. Auto-delete: ${timerLabel}`;
    if (deferred > 0) msg += `\n⏳ *${deferred}* deferred (active traders — will deliver after trade ends)`;
    try { await bot.telegram.sendMessage(getAdminId(), msg, { parse_mode: 'Markdown' }); } catch {}
}

async function executeBroadcast(chatId: number, deleteAfterMs: number, ctx: Context): Promise<void> {
    const pending = pendingBroadcasts.get(chatId);
    pendingBroadcasts.delete(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }

    const { sent, deferred } = await dispatchBroadcastPayload({ ...pending, deleteAfterMs });

    const timerLabel = deleteAfterMs === 0 ? 'never' :
        deleteAfterMs < 60_000 ? `${deleteAfterMs / 1_000}s` :
        deleteAfterMs < 3_600_000 ? `${deleteAfterMs / 60_000}m` : `${deleteAfterMs / 3_600_000}h`;
    let confirmMsg = `✅ Broadcast sent to *${sent}/${pending.targetIds.length}* users. Auto-delete: ${timerLabel}`;
    if (deferred > 0) confirmMsg += `\n⏳ *${deferred}* deferred (active traders — will deliver after trade ends)`;
    await ctx.reply(confirmMsg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSsidForUser(telegramId: number): string | null {
    const user = getUser(telegramId);
    if (user?.ssid) return user.ssid;
    return IQ_SSID ?? null;
}

async function loginAndCaptureSsid(email: string, password: string): Promise<{ ssid: string; sdk: ClientSdk }> {
    const res = await fetch(`${IQ_AUTH_URL}/v2/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
        body: JSON.stringify({ identifier: email, password }),
    });
    const rawBody = await res.text();
    console.log(`[connect] HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
    let data: { code?: string; message?: string; ssid?: string };
    try { data = JSON.parse(rawBody); } catch {
        throw new Error(`Login response is not JSON (HTTP ${res.status}): ${rawBody.slice(0, 100)}`);
    }
    if (data.code !== 'success' || !data.ssid) throw new Error(data.message ?? 'Login failed');
    const ssid = data.ssid;
    evictSdk(ssid); // ensure a fresh connection for new login
    const sdk = await runSdkOp(() => getSdk(ssid));
    return { ssid, sdk };
}

// ─── Start menu ───────────────────────────────────────────────────────────────

async function sendStartMenu(ctx: Context): Promise<void> {
    const telegramId = ctx.from!.id;

    if (telegramId === getAdminId()) {
        const stats = getApprovalStats();
        await ctx.reply(
            `🛡️ *Admin Dashboard*\n\n` +
            `👥 Users: ${stats.total} total | ✅ ${stats.approved} approved | ⏳ ${stats.pending} pending | 🔔 ${stats.manual} manual | ❌ ${stats.rejected} rejected`,
            { parse_mode: 'Markdown', reply_markup: adminKeyboard() }
        );
        return;
    }

    const user = getUser(telegramId);

    if (!user || user.approval_status === 'pending') { await startOnboarding(ctx); return; }

    if (user.approval_status === 'manual') {
        await ctx.reply('⏳ *Awaiting Approval*\n\nYour IQ Option User ID has been submitted.\nPlease contact the admin for manual approval.', { parse_mode: 'Markdown' });
        return;
    }

    if (user.approval_status === 'rejected') {
        await ctx.reply('❌ Your access has been rejected. Contact the admin if this is a mistake.');
        return;
    }

    // Approved — build rich menu
    const ss  = getSessionStats(telegramId);
    const tier = (user.tier ?? 'DEMO').toUpperCase();
    const tierEmoji = tier === 'PRO' ? '⚡' : tier === 'NEWBIE' ? '🚀' : '🧪';
    const pnlSign   = ss.pnl >= 0 ? '+' : '';

    const ssid = getSsidForUser(telegramId);
    const cached = ssid ? balanceCache.get(telegramId) : undefined;
    const cachedLine = (cached && Date.now() - cached.ts < BALANCE_CACHE_TTL) ? cached.line : '';
    const needsFetch = !!ssid && !cachedLine;

    const buildMenu = (balLine: string) => [
        `10x — Home`, ``,
        `Tier: ${tierEmoji} ${tier}`,
        balLine ? `Balance: ${balLine}` : '',
        `Session: ${ss.trades} trade${ss.trades !== 1 ? 's' : ''} · ${pnlSign}$${Math.abs(ss.pnl).toFixed(2)}`,
        ``, `What now? 👇`,
    ].filter(l => l !== '').join('\n');

    const sentMsg = await ctx.reply(buildMenu(cachedLine), { reply_markup: startKeyboard(user.tier ?? undefined) });

    if (needsFetch) {
        const chatId = ctx.chat!.id;
        const msgId  = sentMsg.message_id;
        const userTier = user.tier ?? undefined;
        setImmediate(async () => {
            try {
                const sdk = await runSdkOp(() => withTimeout(getSdk(ssid!), 3_000, 'balance'));
                const all = (await withTimeout(sdk.balances(), 3_000, 'balance')).getBalances();
                const demo = all.find(b => b.type === BalanceType.Demo);
                const real = all.find(b => b.type === BalanceType.Real);
                if (real?.currency) saveUserCurrency(telegramId, real.currency);
                else if (demo?.currency) saveUserCurrency(telegramId, demo.currency);
                const newLine = [
                    demo ? `Practice ${fmtBalance(demo)}` : '',
                    real ? `Real ${fmtBalance(real)}` : '',
                ].filter(Boolean).join(' | ');
                if (newLine) {
                    balanceCache.set(telegramId, { line: newLine, ts: Date.now() });
                    await ctx.telegram.editMessageText(chatId, msgId, undefined, buildMenu(newLine),
                        { reply_markup: startKeyboard(userTier) });
                }
            } catch {}
        });
    }
}

// ─── Onboarding helpers ───────────────────────────────────────────────────────

async function startOnboarding(ctx: Context): Promise<void> {
    // L1 — welcome
    try { await ctx.replyWithPhoto(ASSET('L1.png')); } catch {}
    await ctx.reply(
        `I'm 10x Special Bot.\n\n` +
        `The smartest semi auto-trading bot for IQ Option OTC pairs.\n\n` +
        `I scan markets. I read signals. I place trades.\n` +
        `You sit back and watch the wins land.`
    );
    // L3 — Link Your Account
    try { await ctx.replyWithPhoto(ASSET('L3.png')); } catch {}
    await ctx.reply(
        `Connect your IQ Option account.\n\n` +
        `Free signup · 60 seconds · Linked instantly.\n` +
        `Bot trades on your account. Money stays yours.\n\n` +
        `Pick what fits 👇`,
        { reply_markup: onboardKeyboard() }
    );
}

async function askAccountConnection(ctx: Context): Promise<void> {
    await ctx.reply(
        `Connect your IQ Option account.\n\n` +
        `Free signup · 60 seconds · Linked instantly.\n` +
        `Bot trades on your account. Money stays yours.\n\n` +
        `Pick what fits 👇`,
        { reply_markup: onboardKeyboard() }
    );
}

async function askCreateAccountUserId(ctx: Context): Promise<void> {
    await ctx.reply(
        `👉 Create your IQ Option account\n` +
        `👉 [Create your IQ Option Account](${AFFILIATE_LINK})\n` +
        `Click Above 👆🏼👾\n\n` +
        `🔢 Once your account is created, enter your User ID here:\n\n` +
        `How to find it:\n` +
        `Open IQ Option → Profile → copy the numeric User ID 🆔\n\n` +
        `Then paste that here 👇👾`,
        { parse_mode: 'Markdown' }
    );
}

// ─── Approval gate ────────────────────────────────────────────────────────────

async function requireApproval(ctx: Context): Promise<boolean> {
    const user = getUser(ctx.from!.id);
    if (!user || user.approval_status === 'pending') { await startOnboarding(ctx); return false; }
    if (user.approval_status === 'approved') return true;
    if (user.approval_status === 'paused') {
        await ctx.reply('⏸️ Your account is temporarily paused. Contact the admin to resume.');
        return false;
    }
    if (user.approval_status === 'manual') {
        await ctx.reply('⏳ Your account is pending manual approval. Contact the admin.');
        return false;
    }
    await ctx.reply('❌ Your access has been rejected. Contact the admin if this is a mistake.');
    return false;
}

// ─── Martingale loop ──────────────────────────────────────────────────────────

async function runMartingale(
    ctx: Context,
    ssid: string,
    pair: string,
    direction: 'call' | 'put',
    amount: number,
    timeframeSec = 60,
    balanceType: 'demo' | 'live' = 'demo',
    martingaleRounds?: number,
    preTradeMessageIds: number[] = [],
): Promise<void> {
    const userId = ctx.from!.id;
    const effectiveRounds = martingaleRounds ?? userMartingaleSettings.get(userId)?.maxRounds ?? MAX_ROUNDS;
    activeTradeSessions.set(userId, (activeTradeSessions.get(userId) ?? 0) + 1);
    try {
    const runId = crypto.randomUUID();
    const roundTimeoutMs = (timeframeSec + 90) * 1000;
    let currentAmount = amount;
    let totalPnl = 0;
    const logLines: string[] = ['✦ Trade session initialized…'];
    const logMsg = await ctx.reply(logLines.join('\n'));
    // Include pre-trade messages so scheduleCleanup covers the entire flow
    const sentMessages: number[] = [...preTradeMessageIds, logMsg.message_id];

    const scheduleCleanup = () => {
        const chatId = ctx.chat!.id;
        // Capture reference (not snapshot) so IDs pushed after this call are included
        setTimeout(() => {
            for (const id of sentMessages) {
                ctx.telegram.deleteMessage(chatId, id).catch(() => {});
            }
        }, 3_600_000);
    };

    // Tracks the latest round image so the previous one can be deleted before the next
    let lastRoundImgId: number | undefined;
    const sendRoundImage = async (f: string) => {
        if (lastRoundImgId) {
            try { await ctx.telegram.deleteMessage(ctx.chat!.id, lastRoundImgId); } catch {}
            lastRoundImgId = undefined;
        }
        try { const m = await ctx.replyWithPhoto(ASSET(f)); lastRoundImgId = m.message_id; sentMessages.push(m.message_id); } catch {}
    };

    const syncLog = async () => {
        try {
            await ctx.telegram.editMessageText(ctx.chat!.id, logMsg.message_id, undefined, logLines.join('\n'));
        } catch {}
    };

    for (let round = 1; round <= effectiveRounds; round++) {
        logLines.push(`⚡ Trade 1|🟡 $${currentAmount.toFixed(2)} → in flight`);
        await syncLog();

        const roundTrade: TradeRequest = { pair, direction, amount: currentAmount, martingaleRunId: runId, timeframeSec, balanceType, telegramId: ctx.from!.id };

        let result: TradeResult;
        try {
            result = await runSdkOp(() => withTimeout(executeTrade(ssid, roundTrade), roundTimeoutMs, 'trade'));
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error';
            logLines[logLines.length - 1] = `⚡ Trade 1|⚠️ $${currentAmount.toFixed(2)} → error`;
            await syncLog();
            
            // FRIENDLY BALANCE ERROR
            const isBalanceError = /4112|investment amount|smaller.*minimum|insufficient.*balance/i.test(errMsg);
            const catchReply = isBalanceError
                ? await ctx.reply(
                    '🚫 *You do not have an active balance*\n\nFund your account now with as little as $10 to start trading.',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [
                            [{ text: '💳 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit' }],
                            [{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }],
                        ]},
                    }
                )
                : await ctx.reply(`⚠️ Stopped: ${errMsg}`, {
                    reply_markup: { inline_keyboard: [[{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }]] },
                });
            sentMessages.push(catchReply.message_id);
            scheduleCleanup();
            return;
        }

        const roundPnl = result.status === 'WIN' ? result.pnl : result.status === 'TIE' ? 0 : -currentAmount;
        totalPnl += roundPnl;

        const lastIdx = logLines.length - 1;
        if (result.status === 'WIN') {
            logLines[lastIdx] = `⚡ Trade 1|🟢 $${currentAmount.toFixed(2)} → +$${result.pnl.toFixed(2)}`;
        } else if (result.status === 'LOSS') {
            logLines[lastIdx] = `⚡ Trade 1|🔴 $${currentAmount.toFixed(2)} → -$${currentAmount.toFixed(2)}`;
        } else if (result.status === 'TIE') {
            logLines[lastIdx] = `⚡ Trade 1|⚪ $${currentAmount.toFixed(2)} → $0.00`;
        } else {
            logLines[lastIdx] = `⚡ Trade 1|⚠️ $${currentAmount.toFixed(2)} → ${result.error ?? result.status}`;
        }
        await syncLog();

        // Update session stats on any settled trade
        if (result.status === 'WIN' || result.status === 'LOSS' || result.status === 'TIE') {
            const ss = getSessionStats(ctx.from!.id);
            ss.trades++;
            ss.pnl += roundPnl;
        }
        if (result.status === 'WIN') {
            updateLeaderboardAuto(ctx.from!.id, result.pnl);
        }

        if (result.status === 'WIN' || result.status === 'TIE') {
            // Round 1 = direct win (L11a); round 2+ = comeback (L11b)
            await sendRoundImage(round === 1 ? 'L11a.png' : 'L11b.png');
            const winReply = await ctx.reply(
                `🏆 +$${result.pnl.toFixed(2)} added to your balance.\n\n` +
                (round > 1 ? `Recovery complete.\n\n` : '') +
                `💸 You just made +$${result.pnl.toFixed(2)}`,
                { reply_markup: { inline_keyboard: [[{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }]] } }
            );
            sentMessages.push(winReply.message_id);
            scheduleCleanup();
            if (balanceType === 'demo') await showDemoUpsell(ctx, sentMessages);
            return;
        }

        if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
            const errMsg = result.error ?? result.status;
            const isBalanceError = /4112|investment amount|smaller.*minimum|insufficient.*balance/i.test(errMsg);
            const errStatusReply = isBalanceError
                ? await ctx.reply(
                    '🚫 *You do not have an active balance*\n\nFund your account now with as little as $10 to start trading.',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [
                            [{ text: '💳 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit' }],
                            [{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }],
                        ]},
                    }
                )
                : await ctx.reply(`⚠️ Stopped: ${errMsg}`, {
                    reply_markup: { inline_keyboard: [[{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }]] },
                });
            sentMessages.push(errStatusReply.message_id);
            scheduleCleanup();
            return;
        }

        // LOSS — next round
        if (round < effectiveRounds) {
            if (round === 1) {
                await sendRoundImage('L10.png');
                const recoveryReply = await ctx.reply('SMART RECOVERY ACTIVATED\nBumping the next stake. Bot fights back.');
                sentMessages.push(recoveryReply.message_id);
            }
            currentAmount = currentAmount * 2;
            await new Promise(r => setTimeout(r, ROUND_COOLDOWN_MS));
        }
    }

    const sign = totalPnl >= 0 ? '+' : '';
    // L11c = LOST, BUT THIS IS NOT THE END; replaces L10 if showing
    await sendRoundImage('L11c.png');
    const lostReply = await ctx.reply(
        `Lost this one 💔! Remain confident! New setup loading 👾\n\nTotal: ${sign}$${totalPnl.toFixed(2)}`,
        { reply_markup: { inline_keyboard: [[{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }]] } }
    );
    sentMessages.push(lostReply.message_id);
    scheduleCleanup();
    const mgPromoSettings = userMartingaleSettings.get(userId);
    if (mgPromoSettings && !mgPromoSettings.enabled) {
        const promoImg = await ctx.replyWithPhoto(ASSET('recovery-promo.png')).catch(() => undefined);
        if (promoImg) sentMessages.push(promoImg.message_id);
        const promoText = await ctx.reply(
            `🏆 90% of trades recover and make more money using SMART RECOVERY 👾\n\nENABLE SMART RECOVERY 👇🔋`,
            { reply_markup: { inline_keyboard: [[{ text: 'Enable Smart Recovery', callback_data: 'martingale:6' }]] } }
        ).catch(() => undefined);
        if (promoText) sentMessages.push(promoText.message_id);
    }
    if (balanceType === 'demo') await showDemoUpsell(ctx, sentMessages);
    } finally {
        const prev = activeTradeSessions.get(userId) ?? 1;
        if (prev <= 1) activeTradeSessions.delete(userId);
        else activeTradeSessions.set(userId, prev - 1);
        await flushPendingDeliveries(userId);
    }
}

async function showDemoUpsell(ctx: Context, messageIds: number[]): Promise<void> {
    const l12 = await ctx.replyWithPhoto(ASSET('L12.png')).catch(() => undefined);
    if (l12) messageIds.push(l12.message_id);
    const t1 = await ctx.reply(
        `WHAT IF THIS WAS REAL?\n\n` +
        `While you read this…\n\n` +
        `real 10x users just banked CASH from the exact same setup.\n\n` +
        `Every minute on demo = real profit lost.`
    ).catch(() => undefined);
    if (t1) messageIds.push(t1.message_id);
    const l13 = await ctx.replyWithPhoto(ASSET('L13.png')).catch(() => undefined);
    if (l13) messageIds.push(l13.message_id);
    const t2 = await ctx.reply(
        `Time to earn real money.\n` +
        `Fund your IQ Option account, wins land in your bank, withdraw anytime.\n\n` +
        `Switch to LIVE in 1 tap 👇`,
        { reply_markup: demoUpsellKeyboard() }
    ).catch(() => undefined);
    if (t2) messageIds.push(t2.message_id);
}

// ─── /start ───────────────────────────────────────────────────────────────────

bot.command('start', sendStartMenu);

// ─── Tier selection ───────────────────────────────────────────────────────────

bot.action(/^tier:(demo|newbie|pro)$/, async ctx => {
    const tier = ctx.match[1].toUpperCase();
    await ctx.answerCbQuery(`✅ ${tier} selected`);
    const chatId = ctx.chat!.id;
    const existing = onboardSessions.get(chatId) ?? { step: 'user_id' as OnboardStep };
    onboardSessions.set(chatId, { ...existing, tier });
    const dbUser = getUser(ctx.from!.id);
    if (dbUser) setUserTier(ctx.from!.id, tier);
});

// ─── Account connection choice ────────────────────────────────────────────────

bot.action('onboard:yes', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const existing = onboardSessions.get(chatId) ?? { step: 'user_id' as OnboardStep };
    onboardSessions.set(chatId, { ...existing, step: 'user_id' });
    await ctx.reply(
        `🔢 Enter your IQ Option User ID\n\n` +
        `How to find it:\n` +
        `Open IQ Option → Profile → copy the numeric User ID 🆔\n\n` +
        `Then paste that here 👇👾`
    );
});

bot.action('onboard:no', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const existing = onboardSessions.get(chatId) ?? { step: 'create_user_id' as OnboardStep };
    onboardSessions.set(chatId, { ...existing, step: 'create_user_id' });
    await askCreateAccountUserId(ctx);
});

// ─── Trade wizard — mode ──────────────────────────────────────────────────────

bot.action(/^mode:(demo|live)$/, async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'mode') return;
    state.mode = ctx.match[1] as 'demo' | 'live';
    state.step = 'amount';
    const modeUser = getUser(ctx.from!.id);
    await ctx.reply('Enter amount', { reply_markup: amountKeyboard(modeUser?.currency ?? 'USD') });
});

// ─── Trade wizard — amount ────────────────────────────────────────────────────

bot.action('wizard:cancel', async ctx => {
    await ctx.answerCbQuery();
    const state = wizardSessions.get(ctx.chat!.id);
    if (state?.lastImageMsgId) {
        try { await ctx.telegram.deleteMessage(ctx.chat!.id, state.lastImageMsgId); } catch {}
    }
    wizardSessions.delete(ctx.chat!.id);
    try { await ctx.editMessageText('❌ Trade cancelled.'); } catch {}
});

bot.action(/^amt:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'amount') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    await ctx.answerCbQuery();

    const val = ctx.match[1];
    if (val === 'custom') {
        state.step = 'custom_amount';
        const curUser = getUser(ctx.from!.id);
        const cur = curUser?.currency || 'USD';
        try { await ctx.editMessageText(`✏️ Enter your custom amount (e.g. 75 ${cur}):`); } catch {}
    } else {
        const amt = parseFloat(val);
        if (state.mode === 'demo' && amt > 20) { await ctx.reply('❌ Demo max is $20 or equivalent.'); return; }
        state.amount = amt;
        state.step = 'timeframe';
        if (state.lastImageMsgId) {
            try { await ctx.telegram.deleteMessage(ctx.chat!.id, state.lastImageMsgId); } catch {}
        }
        try { const m = await ctx.replyWithPhoto(ASSET('L5.png')); state.lastImageMsgId = m.message_id; } catch {}
        try { await ctx.editMessageText(
            '⏱ Pick your expiry timeframe 👇\n⏱ Faster timeframes settle quicker.\n🐢 Longer timeframes ride bigger moves.',
            { reply_markup: timeframeKeyboard() }
        ); } catch {}
    }
});

// ─── Trade wizard — timeframe ─────────────────────────────────────────────────

bot.action(/^tf:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'timeframe') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    await ctx.answerCbQuery(); // stop spinner immediately before slow image upload
    state.timeframe = parseInt(ctx.match[1], 10);
    state.step = 'pair';
    if (state.lastImageMsgId) {
        try { await ctx.telegram.deleteMessage(ctx.chat!.id, state.lastImageMsgId); } catch {}
    }
    try { const m = await ctx.replyWithPhoto(ASSET('L6.png')); state.lastImageMsgId = m.message_id; } catch {}
    const tfUser = getUser(chatId);
    const tfTier = tfUser?.tier ?? 'NEWBIE';
    const picks = getTopPicks();
    const medals = ['🏆', '🥇', '🥈', '🥉', '4️⃣'];
    let picksMsg = 'Top picks ready 🎯\n\nHighest chance to win right now:\n\n';
    if (picks.length > 0) {
        picks.forEach((p, i) => { picksMsg += `${medals[i] ?? `${i + 1}.`} ${p.pair} — Win rate ≈${p.winRate}%\n`; });
    } else {
        picksMsg += '🏆 EUR/USD OTC\n🥇 GBP/USD OTC\n🥈 EUR/JPY OTC\n';
    }
    picksMsg += '\n🚀 Make your choice below 👇';
    try { await ctx.editMessageText(picksMsg, { reply_markup: pairKeyboard(0, tfTier) }); } catch {}
});

// ─── Trade wizard — pair pagination ──────────────────────────────────────────

bot.action(/^page:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    await ctx.answerCbQuery();
    const pageUser = getUser(chatId);
    const pageTier = pageUser?.tier ?? 'NEWBIE';
    try { await ctx.editMessageReplyMarkup(pairKeyboard(parseInt(ctx.match[1], 10), pageTier)); } catch {}
});

// ─── Trade wizard — pair selected → analyze → execute ────────────────────────

bot.action(/^pair:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    await ctx.answerCbQuery();

    const pair = ctx.match[1];
    const { amount, timeframe, mode, lastImageMsgId: prevImgId } = state;
    wizardSessions.delete(chatId);

    if (!amount || !timeframe) { await ctx.reply('❌ Session error — start over.'); return; }

    const ssid = getSsidForUser(ctx.from!.id);
    if (!ssid) { await ctx.reply('❌ Not connected. Use /connect to link your IQ Option account.'); return; }

    // Clean up: delete the pair keyboard message and L6 image
    try { await ctx.deleteMessage(); } catch {}
    if (prevImgId) { try { await ctx.telegram.deleteMessage(chatId, prevImgId); } catch {} }

    // IDs of all pre-trade messages — passed to runMartingale for 1-hour cleanup
    const preTradeMessageIds: number[] = [];

    // Send L7 (analyzing radar) then a progress reply — user sees feedback immediately
    let l7MsgId: number | undefined;
    try { const m = await ctx.replyWithPhoto(ASSET('L7.png')); l7MsgId = m.message_id; } catch {}
    const progressMsg = await ctx.reply(
        `Selected: ${pair}\n\n🔍 Scanning markets...\n⏱ This takes about 10–30 seconds...`
    );
    preTradeMessageIds.push(progressMsg.message_id);

    // Heavy SDK call — progress message is already visible, no dead silence
    let analysis: AnalysisResult;
    try {
        analysis = await analyzePair(ssid, pair, timeframe);
    } catch (err: unknown) {
        if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
        await ctx.telegram.editMessageText(
            chatId, progressMsg.message_id, undefined,
            `❌ Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        ).catch(() => ctx.reply(`❌ Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        return;
    }

    // Replace progress message with completion note, then deliver results
    if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
    await ctx.telegram.editMessageText(
        chatId, progressMsg.message_id, undefined,
        `✅ Market scanned — signal found for ${pair}`
    ).catch(() => {});

    const l8 = await ctx.replyWithPhoto(ASSET('L8.png')).catch(() => undefined);
    if (l8) preTradeMessageIds.push(l8.message_id);
    const signalImg = analysis.direction === 'call' ? 'L9b.png' : 'L9a.png';
    const dirStr = analysis.direction === 'call' ? '🟢 CALL SIGNAL' : '🔴 PUT SIGNAL';
    const l9 = await ctx.replyWithPhoto(ASSET(signalImg)).catch(() => undefined);
    if (l9) preTradeMessageIds.push(l9.message_id);
    const opportunityMsg = await ctx.reply(
        `OPPORTUNITY FOUND\nConfidence: 78% · Bot is ready to execute.\n\n${dirStr}\n\n` +
        `🔷 Trading pair: ${pair}\n🔷 Amount: $${amount.toFixed(2)} USD\n` +
        `🔷 Expiration: ${tfLabel(timeframe)}\n🔷 Strategy: High-Profit ⚡`
    ).catch(() => undefined);
    if (opportunityMsg) preTradeMessageIds.push(opportunityMsg.message_id);

    const tradeUser = getUser(ctx.from!.id);
    const tradeTier = (tradeUser?.tier ?? 'NEWBIE').toUpperCase();
    const maxConcurrent = tradeTier === 'PRO' ? 3 : 1;
    const currentCount = activeTradeSessions.get(ctx.from!.id) ?? 0;
    if (currentCount >= maxConcurrent) {
        await ctx.reply(
            tradeTier === 'NEWBIE'
                ? '⚠️ You already have an active trade. Newbie allows 1 trade at a time. Upgrade to PRO for up to 3 concurrent trades.'
                : `⚠️ You already have ${currentCount} active trade(s). Max 3 concurrent trades reached. Wait for one to finish.`
        );
        return;
    }

    const mgSettings = userMartingaleSettings.get(ctx.from!.id);
    const martingaleRounds = mgSettings ? (mgSettings.enabled ? mgSettings.maxRounds : 1) : undefined;
    try {
        await runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe, mode === 'live' ? 'live' : 'demo', martingaleRounds, preTradeMessageIds);
    } catch (err: unknown) {
        console.error('[pair] runMartingale threw:', err);
        await ctx.reply('⚠️ Trade session ended unexpectedly. Please try again.').catch(() => {});
    }
});

// ─── Demo upsell ──────────────────────────────────────────────────────────────

bot.action('upsell:live', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const state: WizardState = { step: 'amount', mode: 'live' };
    try { const m = await ctx.replyWithPhoto(ASSET('L5.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(chatId, state);
    const upsellLiveUser = getUser(ctx.from!.id);
    await ctx.reply('💰 Enter amount for Live trade:', { reply_markup: amountKeyboard(upsellLiveUser?.currency ?? 'USD') });
});

bot.action('upsell:demo', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const state: WizardState = { step: 'amount', mode: 'demo' };
    try { const m = await ctx.replyWithPhoto(ASSET('L5.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(chatId, state);
    const upsellDemoUser = getUser(ctx.from!.id);
    await ctx.reply('💰 Enter amount for Demo trade:', { reply_markup: amountKeyboard(upsellDemoUser?.currency ?? 'USD') });
});

// ─── User menu actions ────────────────────────────────────────────────────────

bot.action('ui:start', async ctx => { await ctx.answerCbQuery(); await sendStartMenu(ctx); });

bot.action('ui:trade', async ctx => {
    await ctx.answerCbQuery();
    if (!await requireApproval(ctx)) return;
    const state: WizardState = { step: 'mode' };
    try { const m = await ctx.replyWithPhoto(ASSET('L4.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(ctx.chat!.id, state);
    await ctx.reply('Trade live | Trade Demo', { reply_markup: tradeModeKeyboard() });
});

bot.action('ui:history', async ctx => {
    await ctx.answerCbQuery();
    const uid = ctx.from!.id;
    const trades = getRecentTrades(10, uid);
    if (trades.length === 0) { await ctx.reply('No trades yet.', { reply_markup: backKeyboard() }); return; }
    let msg = '📋 *Recent Trades*\n\n';
    for (const t of trades) {
        const emoji = t.status === 'WIN' ? '💚' : t.status === 'LOSS' ? '💔' : t.status === 'TIE' ? '⚪' : '⚠️';
        const pnlStr = t.status === 'WIN' ? `+$${t.pnl.toFixed(2)}` : t.status === 'LOSS' ? `-$${(t.pnl < 0 ? Math.abs(t.pnl) : t.amount).toFixed(2)}` : '$0.00';
        msg += `${emoji} \`${t.pair}\` *${t.direction.toUpperCase()}* $${t.amount} → ${pnlStr}`;
        if (t.martingale_run) msg += ' 🔄';
        msg += '\n';
        if (t.error) msg += `  _${t.error}_\n`;
    }
    const stats = getTradeStats(uid);
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    msg += `\n📊 *Stats*: ${stats.total} trades | ${stats.wins}W / ${stats.losses}L / ${stats.ties}T | PnL: ${pnlSign}$${stats.totalPnl.toFixed(2)}`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
});

bot.action('ui:stats', async ctx => {
    await ctx.answerCbQuery();
    const uid = ctx.from!.id;
    const stats = getTradeStats(uid);
    const ss = getSessionStats(uid);
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    const ssPnlSign = ss.pnl >= 0 ? '+' : '';
    await ctx.reply(
        `📈 *Stats*\n\n` +
        `All time: ${stats.total} trades | ${stats.wins}W / ${stats.losses}L / ${stats.ties}T\n` +
        `Total PnL: ${pnlSign}$${stats.totalPnl.toFixed(2)}\n\n` +
        `This session: ${ss.trades} trades | ${ssPnlSign}$${Math.abs(ss.pnl).toFixed(2)}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:upgrade', async ctx => {
    await ctx.answerCbQuery();
    upgradeSessions.add(ctx.chat!.id);
    await ctx.reply(
        `💡 *Upgrade Your Tier*\n\n` +
        `Enter your upgrade token below to unlock NEWBIE or PRO tier.\n\n` +
        `Don't have a token? Contact support to get your token.`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:martingale_settings', async ctx => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const settings = userMartingaleSettings.get(userId) ?? { enabled: true, maxRounds: 6 };
    await ctx.reply(
        `⚙️ *Smart Recovery Settings*\n\n` +
        `Current: ${settings.enabled ? 'ON' : 'OFF'} · ${settings.maxRounds} rounds max\n\n` +
        `Choose your Smart Recovery strategy:`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [
                    { text: '🔁 Full (6 rounds)',   callback_data: 'martingale:6' },
                    { text: '🔁 Medium (3 rounds)', callback_data: 'martingale:3' },
                ],
                [{ text: '⛔ Disable Smart Recovery', callback_data: 'martingale:off' }],
                [{ text: '🔙 Back',                   callback_data: 'ui:start' }],
            ]},
        }
    );
});

bot.action(/^martingale:(\d+|off)$/, async ctx => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const val = ctx.match[1];
    if (val === 'off') {
        userMartingaleSettings.set(userId, { enabled: false, maxRounds: 1 });
        await ctx.editMessageText('⛔ Smart Recovery disabled. Trades will run a single round with no recovery.').catch(() => {});
    } else {
        const rounds = parseInt(val, 10);
        userMartingaleSettings.set(userId, { enabled: true, maxRounds: rounds });
        await ctx.editMessageText(`✅ Smart Recovery set to ${rounds} rounds.`).catch(() => {});
    }
});

bot.action('ui:leaderboard', async ctx => {
    await ctx.answerCbQuery();
    const entries = getLeaderboard();
    if (entries.length === 0) {
        await ctx.reply('🏆 *Today\'s Leaderboard*\n\nNo trades recorded yet today.', { parse_mode: 'Markdown', reply_markup: backKeyboard() });
        return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    let msg = '🏆 *Today\'s Top Traders*\n\n';
    entries.forEach((e, i) => {
        const medal = medals[i] ?? `${i + 1}.`;
        msg += `${medal} ${maskUserId(e.telegram_id)} — +$${e.profit.toFixed(2)}\n`;
    });
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
});

bot.action('ui:help', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `❓ *Help & FAQ*\n\n` +
        `*How does the bot work?*\nAnalyzes OTC pairs and places trades via Smart Recovery.\n\n` +
        `*What is Smart Recovery?*\nIf a trade loses, the next bet doubles to recover the loss. Up to 6 rounds.\n\n` +
        `*Demo vs Live?*\nDemo uses practice balance. Live uses your real account balance.\n\n` +
        `*How to withdraw?*\nAll funds stay in your IQ Option account — withdraw directly from there.`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:support', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `🔋 *Support*\n\nContact admin for help:\n${ADMIN_CONTACT_LINK}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

// ─── Legacy commands (keep for power users) ───────────────────────────────────

bot.command('trade', async ctx => {
    if (!await requireApproval(ctx)) return;
    const state: WizardState = { step: 'mode' };
    try { const m = await ctx.replyWithPhoto(ASSET('L4.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(ctx.chat.id, state);
    await ctx.reply('Trade live | Trade Demo', { reply_markup: tradeModeKeyboard() });
});

bot.command('history', async ctx => {
    const uid = ctx.from!.id;
    const trades = getRecentTrades(10, uid);
    if (trades.length === 0) return ctx.reply('No trades yet.', { reply_markup: backKeyboard() });
    let msg = '📋 *Recent Trades*\n\n';
    for (const t of trades) {
        const emoji = t.status === 'WIN' ? '💚' : t.status === 'LOSS' ? '💔' : t.status === 'TIE' ? '⚪' : '⚠️';
        const pnlStr = t.status === 'WIN' ? `+$${t.pnl.toFixed(2)}` : t.status === 'LOSS' ? `-$${(t.pnl < 0 ? Math.abs(t.pnl) : t.amount).toFixed(2)}` : '$0.00';
        msg += `${emoji} \`${t.pair}\` *${t.direction.toUpperCase()}* $${t.amount} → ${pnlStr}`;
        if (t.martingale_run) msg += ' 🔄';
        msg += '\n';
        if (t.error) msg += `  _${t.error}_\n`;
    }
    const stats = getTradeStats(uid);
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    msg += `\n📊 *Stats*: ${stats.total} trades | ${stats.wins}W / ${stats.losses}L / ${stats.ties}T | PnL: ${pnlSign}$${stats.totalPnl.toFixed(2)}`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
});

bot.command('balance', async ctx => {
    const uid = ctx.from!.id;
    const ssid = getSsidForUser(uid);
    if (!ssid) { await ctx.reply('❌ Not connected. Use /connect first.', { reply_markup: backKeyboard() }); return; }
    try {
        const sdk = await runSdkOp(() => withTimeout(getSdk(ssid), 5_000, 'balance'));
        const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
        const demo = all.find(b => b.type === BalanceType.Demo);
        const real = all.find(b => b.type === BalanceType.Real);
        if (real?.currency) saveUserCurrency(uid, real.currency);
        else if (demo?.currency) saveUserCurrency(uid, demo.currency);
        let msg = '💰 *Balances*\n\n';
        if (demo) msg += `🎮 Practice: ${fmtBalance(demo)}\n`;
        if (real) msg += `💎 Live: ${fmtBalance(real)}\n`;
        if (!demo && !real) msg += 'No balances found.';
        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
    } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.message.startsWith('SDK timeout');
        await ctx.reply(
            isTimeout ? '⚠️ IQ Option is taking too long. Try again in a moment.' : `❌ Balance fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            { reply_markup: backKeyboard() }
        );
    }
});

// ─── Admin ────────────────────────────────────────────────────────────────────

bot.command('admin', async ctx => {
    if (ctx.from?.id !== getAdminId()) { await ctx.reply('Access denied.'); return; }
    const args = ctx.message.text.split(/\s+/).slice(1);
    const sub  = args[0];

    if (!sub) {
        const stats = getApprovalStats();
        await ctx.reply(
            `🛡️ *Admin Panel*\n\n👥 ${stats.total} users | ✅ ${stats.approved} approved | ⏳ ${stats.pending} pending | 🔔 ${stats.manual} manual | ❌ ${stats.rejected} rejected`,
            { parse_mode: 'Markdown', reply_markup: adminKeyboard() }
        );
        return;
    }

    if (sub === 'users') {
        const users = getAllUsers();
        if (users.length === 0) { await ctx.reply('No users yet.'); return; }
        let msg = `👥 *All Users* (${users.length})\n\n`;
        for (const u of users) {
            const e = u.approval_status === 'approved' ? '✅' : u.approval_status === 'manual' ? '🔔' : u.approval_status === 'rejected' ? '❌' : '⏳';
            msg += `${e} \`${u.telegram_id}\`${u.iq_user_id ? ` · IQ: \`${u.iq_user_id}\`` : ''} — ${u.approval_status}\n`;
        }
        await ctx.reply(msg, { parse_mode: 'Markdown' });
        return;
    }

    if (sub === 'approve' && args[1]) {
        const tid = parseInt(args[1], 10);
        if (isNaN(tid)) { await ctx.reply('Usage: /admin approve <telegram_id>'); return; }
        approveUser(tid);
        await ctx.reply(`✅ User \`${tid}\` approved.`, { parse_mode: 'Markdown' });
        try { await bot.telegram.sendMessage(tid, '✅ *Your account has been approved!* You can now start trading.', { parse_mode: 'Markdown' }); } catch {}
        return;
    }

    if (sub === 'reject' && args[1]) {
        const tid = parseInt(args[1], 10);
        if (isNaN(tid)) { await ctx.reply('Usage: /admin reject <telegram_id>'); return; }
        rejectUser(tid);
        await ctx.reply(`❌ User \`${tid}\` rejected.`, { parse_mode: 'Markdown' });
        try { await bot.telegram.sendMessage(tid, '❌ Your access request has been rejected.'); } catch {}
        return;
    }

    if (sub === 'stats') {
        const ts = getTradeStats(); const as_ = getApprovalStats();
        const pnlSign = ts.totalPnl >= 0 ? '+' : '';
        await ctx.reply(
            `📊 *Admin Stats*\n\n*Users:*\n✅ Approved: ${as_.approved}\n⏳ Pending: ${as_.pending}\n🔔 Manual: ${as_.manual}\n❌ Rejected: ${as_.rejected}\n\n` +
            `*Trades:*\n${ts.total} total | ${ts.wins}W / ${ts.losses}L / ${ts.ties}T | PnL: ${pnlSign}$${ts.totalPnl.toFixed(2)}`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    await ctx.reply('Commands: /admin users | /admin approve <id> | /admin reject <id> | /admin stats');
});

// ─── Admin back ───────────────────────────────────────────────────────────────

bot.action('admin:back', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.delete(ctx.chat!.id);
    const stats = getApprovalStats();
    await ctx.reply(
        `🛡️ *Admin Dashboard*\n\n` +
        `👥 Users: ${stats.total} | ✅ ${stats.approved} | ⏳ ${stats.pending} | 🔔 ${stats.manual} | ❌ ${stats.rejected}`,
        { parse_mode: 'Markdown', reply_markup: adminKeyboard() }
    );
});

// ─── Module 1: Today ─────────────────────────────────────────────────────────

bot.action('admin:today', async ctx => {
    await ctx.answerCbQuery();
    const traders = getTopTradersToday(20);
    if (traders.length === 0) {
        await ctx.reply('📊 *Today\'s Top Traders*\n\nNo trades today yet.', { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
        return;
    }
    let msg = '📊 *Today\'s Top Traders*\n\n';
    traders.forEach((t, i) => {
        const name = t.username ? `@${escapeMd(t.username)}` : `ID: ${maskUserId(t.telegram_id)}`;
        msg += `${i + 1}. ${name} — ${t.trade_count} trades\n`;
    });
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

// ─── Module 2: Activations ────────────────────────────────────────────────────

bot.action('admin:activations', async ctx => {
    await ctx.answerCbQuery();
    const pending = getPendingManualUsers();
    const recent = getRecentApprovals(24);
    let msg = '🔌 *Activations*\n\n';
    if (pending.length > 0) {
        msg += `⏳ *Pending Manual Approval (${pending.length}):*\n`;
        for (const u of pending) {
            const name = u.username ? `@${escapeMd(u.username)}` : `[User ${String(u.telegram_id).slice(-4)}](tg://user?id=${u.telegram_id})`;
            msg += `${name}\n`;
        }
        msg += '\n';
    } else {
        msg += '⏳ *Pending:* None\n\n';
    }
    if (recent.length > 0) {
        msg += '✅ *Recently Approved (24h):*\n';
        for (const u of recent) {
            const name = u.username ? `@${escapeMd(u.username)}` : `ID: ${maskUserId(u.telegram_id)}`;
            msg += `${name}\n`;
        }
    } else {
        msg += '✅ *Approved (24h):* None';
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: activationsKeyboard(pending) });
});

bot.action(/^activation:approve:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const uid = parseInt(ctx.match[1], 10);
    approveUser(uid);
    try { await ctx.editMessageText(`✅ User ${maskUserId(uid)} approved.`); } catch {}
    try {
        await bot.telegram.sendMessage(uid,
            '✅ *Your account has been approved!*\n\n' +
            'Now link your IQ Option account to start trading:\n\n' +
            '1. Use /connect\n' +
            '2. Enter your IQ Option email\n' +
            '3. Enter your IQ Option password (auto-deleted after 10s)\n\n' +
            'Your credentials are safe — we use the official IQ Option API.',
            { parse_mode: 'Markdown' }
        );
    } catch {}
});

bot.action(/^activation:reject:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const uid = parseInt(ctx.match[1], 10);
    rejectUser(uid);
    try { await ctx.editMessageText(`❌ User ${maskUserId(uid)} rejected.`); } catch {}
});

// ─── Module 3: Find Users ─────────────────────────────────────────────────────

bot.action('admin:find_users', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'find_users' });
    await ctx.reply('🔍 Enter a Telegram User ID (number) or username to search:');
});

// ─── Module 4: Tokens ─────────────────────────────────────────────────────────

bot.action('admin:tokens', async ctx => {
    await ctx.answerCbQuery();
    const tokens = getTokens();
    let msg = '🔑 *Token Manager*\n\n';
    if (tokens.length === 0) {
        msg += 'No tokens generated yet.\n';
    } else {
        const now = new Date();
        for (const t of tokens.slice(0, 15)) {
            const expired = new Date(t.expires_at) < now;
            const status = t.used_by ? '✅ Used' : expired ? '❌ Expired' : '⏳ Unused';
            const hoursLeft = expired ? 0 : Math.round((new Date(t.expires_at).getTime() - now.getTime()) / 3_600_000);
            msg += `• \`${t.token}\` — ${t.tier} — ${status}${!t.used_by && !expired ? ` (${hoursLeft}h left)` : ''}\n`;
        }
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: generateTokenKeyboard() });
});

bot.action('admin:generate_token', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('🔑 Select tier for new token:', { reply_markup: tokenTierKeyboard() });
});

bot.action(/^token_tier:(NEWBIE|PRO)$/, async ctx => {
    await ctx.answerCbQuery();
    const tier = ctx.match[1];
    const token = generateToken(tier);
    await ctx.reply(
        `✅ Token generated!\n\n\`${token}\`\n\nTier: *${tier}* · Valid 24 hours\n\nShare this with the user manually.`,
        { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
    );
});

// ─── Module 5: System ─────────────────────────────────────────────────────────

bot.action('admin:system', async ctx => {
    await ctx.answerCbQuery();
    const uptimeSec = Math.floor(process.uptime());
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const mem = (process.memoryUsage().rss / 1_048_576).toFixed(1);
    const as_ = getApprovalStats();
    const ts = getTradeStats();
    await ctx.reply(
        `⚙️ *System Status*\n\n` +
        `🤖 Bot: ✅ Online (uptime: ${h}h ${m}m)\n` +
        `💾 Memory: ${mem} MB\n\n` +
        `👥 Total users: ${as_.total}\n` +
        `✅ Approved: ${as_.approved} | ⏳ Pending: ${as_.pending} | ❌ Rejected: ${as_.rejected}\n\n` +
        `📊 Total trades: ${ts.total}\n` +
        `📦 Database: ✅ OK`,
        { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
    );
});

// ─── Module 6: Broadcast ─────────────────────────────────────────────────────

bot.action('admin:broadcast', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('📢 *Broadcast* — Select target group:', { parse_mode: 'Markdown', reply_markup: broadcastTargetKeyboard() });
});

bot.action(/^broadcast:(active|inactive|all)$/, async ctx => {
    await ctx.answerCbQuery();
    const target = ctx.match[1] as 'active' | 'inactive' | 'all';
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_message', broadcastTarget: target });
    await ctx.reply(`📝 Send your broadcast message for *${target}* users:`, { parse_mode: 'Markdown' });
});

// Button type selection
bot.action('broadcast_btn:url', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_link_url' });
    await ctx.reply('🔗 Enter the link URL (e.g. https://example.com):');
});

bot.action('broadcast_btn:action', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('⚡ Select action for the button:', { reply_markup: broadcastActionKeyboard() });
});

bot.action('broadcast_btn:none', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('⏱ Auto-delete after?', { reply_markup: broadcastTimerKeyboard() });
});

// Action button selection
const ACTION_MAP: Record<string, { text: string; value: string }> = {
    trade:       { text: '🎯 Trade Now',   value: 'ui:trade' },
    stats:       { text: '📊 Stats',       value: 'ui:stats' },
    history:     { text: '📆 History',     value: 'ui:history' },
    leaderboard: { text: '🏆 Leaderboard', value: 'ui:leaderboard' },
    menu:        { text: '📋 Menu',        value: 'ui:start' },
};

bot.action(/^broadcast_action:(trade|stats|history|leaderboard|menu)$/, async ctx => {
    await ctx.answerCbQuery();
    const key = ctx.match[1];
    const action = ACTION_MAP[key];
    const pending = pendingBroadcasts.get(ctx.chat!.id);
    if (!pending || !action) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    pendingBroadcasts.set(ctx.chat!.id, { ...pending, button: { text: action.text, type: 'callback', value: action.value } });
    await ctx.reply(`✅ Button set: *${action.text}*\n\n⏱ Auto-delete after?`, { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() });
});

// Custom timer
bot.action('broadcast:custom_timer', async ctx => {
    await ctx.answerCbQuery();
    if (!pendingBroadcasts.has(ctx.chat!.id)) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_custom_timer' });
    await ctx.reply('⏱ Enter custom duration (e.g. 30m, 2h, 45s):');
});

bot.action(/^bcast_timer:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    adminSessions.delete(ctx.chat!.id);
    const chatId = ctx.chat!.id;
    const deleteAfterMs = parseInt(ctx.match[1], 10);
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    pendingBroadcasts.set(chatId, { ...pending, deleteAfterMs });
    await ctx.reply('⏰ Send now or schedule?', { reply_markup: broadcastSendOrScheduleKeyboard() });
});

bot.action('broadcast:send_now', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    await executeBroadcast(chatId, pending.deleteAfterMs ?? 0, ctx);
});

bot.action('broadcast:schedule', async ctx => {
    await ctx.answerCbQuery();
    if (!pendingBroadcasts.has(ctx.chat!.id)) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    await ctx.reply('📅 When to send?', { reply_markup: broadcastDelayKeyboard() });
});

bot.action(/^bcast_delay:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const delayMs = parseInt(ctx.match[1], 10);
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    const activeCount = scheduledBroadcasts.filter(s => !s.sent).length;
    if (activeCount >= 5) { await ctx.reply('❌ Max 5 scheduled broadcasts. Cancel one first.', { reply_markup: adminBackKeyboard() }); return; }
    pendingBroadcasts.delete(chatId);
    const scheduledAt = new Date(Date.now() + delayMs);
    const id = nextScheduledId++;
    const scheduled: ScheduledBroadcast = {
        id, message: pending.message, targetIds: pending.targetIds,
        button: pending.button, media: pending.media,
        deleteAfterMs: pending.deleteAfterMs ?? 0,
        scheduledAt, sent: false, createdAt: new Date(),
    };
    scheduled.timerId = setTimeout(() => { void executeScheduledBroadcast(scheduled); }, delayMs);
    scheduledBroadcasts.push(scheduled);
    const delayLabel = delayMs < 3_600_000 ? `${delayMs / 60_000}m` : `${delayMs / 3_600_000}h`;
    await ctx.reply(
        `✅ Broadcast scheduled in *${delayLabel}* (${scheduledAt.toLocaleTimeString()}) → ${pending.targetIds.length} users.`,
        { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
    );
});

bot.action('broadcast:custom_schedule', async ctx => {
    await ctx.answerCbQuery();
    if (!pendingBroadcasts.has(ctx.chat!.id)) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_schedule_custom' });
    await ctx.reply('⏱ Enter custom delay (e.g. 45m, 3h, 90m):');
});

bot.action('admin:scheduled', async ctx => {
    await ctx.answerCbQuery();
    const active = scheduledBroadcasts.filter(s => !s.sent);
    if (active.length === 0) {
        await ctx.reply('📅 *Scheduled Broadcasts*\n\nNo pending broadcasts.', { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
        return;
    }
    const now = Date.now();
    let msg = '📅 *Scheduled Broadcasts*\n\n';
    const labels = active.map((s, i) => {
        const msLeft = Math.max(0, s.scheduledAt.getTime() - now);
        const timeLeft = msLeft < 3_600_000 ? `${Math.round(msLeft / 60_000)}m` : `${(msLeft / 3_600_000).toFixed(1)}h`;
        const preview = s.message.length > 20 ? s.message.slice(0, 20) + '…' : s.message;
        msg += `${i + 1}. "${preview}" — in ${timeLeft} (to ${s.targetIds.length} users)\n`;
        const shortPreview = s.message.length > 15 ? s.message.slice(0, 15) + '…' : s.message;
        return { id: s.id, label: `"${shortPreview}" in ${timeLeft}` };
    });
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: scheduledBroadcastsKeyboard(labels) });
});

bot.action(/^bcast_cancel:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const id = parseInt(ctx.match[1], 10);
    const idx = scheduledBroadcasts.findIndex(s => s.id === id && !s.sent);
    if (idx === -1) { await ctx.reply('❌ Broadcast not found or already sent.', { reply_markup: adminBackKeyboard() }); return; }
    const s = scheduledBroadcasts[idx];
    if (s.timerId) clearTimeout(s.timerId);
    scheduledBroadcasts.splice(idx, 1);
    await ctx.reply(`✅ Scheduled broadcast #${id} cancelled.`, { reply_markup: adminBackKeyboard() });
});

// ─── Module 7: Top Traders ────────────────────────────────────────────────────

bot.action('admin:top_traders', async ctx => {
    await ctx.answerCbQuery();
    const detailed = getLeaderboardDetailed();
    let msg = '🏆 *Today\'s Leaderboard*\n\n';
    if (detailed.length === 0) {
        msg += 'No entries yet today.';
    } else {
        const medals = ['🥇', '🥈', '🥉'];
        detailed.forEach((e, i) => {
            const profit = e.manual_profit ?? e.auto_profit;
            const isManual = e.manual_profit !== null;
            msg += `${medals[i] ?? `${i + 1}.`} ${maskUserId(e.telegram_id)} — +$${profit.toFixed(2)}${isManual ? ' ✏️' : ''}\n`;
        });
    }
    const editableEntries = detailed
        .filter(e => e.manual_profit !== null)
        .map(e => ({ telegram_id: e.telegram_id, masked: maskUserId(e.telegram_id) }));
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: topTradersAdminKeyboard(editableEntries) });
});

bot.action('admin:manual_add', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'manual_add_id' });
    await ctx.reply('Enter the Telegram User ID to add to the leaderboard:');
});

bot.action(/^trader_edit:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const telegramId = parseInt(ctx.match[1], 10);
    adminSessions.set(ctx.chat!.id, { step: 'edit_trader_profit', editTraderTelegramId: telegramId });
    await ctx.reply(`Enter new profit amount for user \`${maskUserId(telegramId)}\`:`, { parse_mode: 'Markdown' });
});

// ─── Module 8: Funnel ─────────────────────────────────────────────────────────

bot.action('admin:funnel', async ctx => {
    await ctx.answerCbQuery();
    const url = getConfig('funnel_url') ?? 'Not set';
    const stats = getFunnelStats();
    let msg = `🔻 *Funnel Settings*\n\n🌐 Landing Page: ${url}\n📊 Events Today: ${stats.events}`;
    if (stats.byType.length > 0) {
        msg += '\n' + stats.byType.map(e => `• ${e.event_type}: ${e.cnt}`).join('\n');
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: funnelKeyboard() });
});

bot.action('admin:set_funnel_url', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'funnel_url' });
    await ctx.reply('🌐 Enter the landing page URL:');
});

// ─── Module 9: Audits ─────────────────────────────────────────────────────────

bot.action('admin:audits', async ctx => {
    await ctx.answerCbQuery();
    const r = getAuditReport();
    const pnlSign = r.totalPnl >= 0 ? '+' : '';
    const winPct = r.totalTrades > 0 ? ((r.wins / r.totalTrades) * 100).toFixed(1) : '0.0';
    let msg =
        `📋 *Audit Report (Last 24h)*\n\n` +
        `👥 New Users: ${r.newUsers}\n` +
        `✅ Auto-Approved: ${r.autoApproved}\n` +
        `⏳ Manual Pending: ${r.manualPending}\n\n` +
        `📊 *Trading Activity:*\n` +
        `• Total Trades: ${r.totalTrades}\n` +
        `• Wins: ${r.wins} (${winPct}%)\n` +
        `• Losses: ${r.losses}\n` +
        `• Ties: ${r.ties}\n` +
        `• Total PnL: ${pnlSign}$${r.totalPnl.toFixed(2)}\n\n` +
        `🔄 Martingale Runs: ${r.martingaleRuns}\n` +
        `   - Recovered: ${r.martingaleRecovered}\n` +
        `   - Failed: ${r.martingaleRuns - r.martingaleRecovered}`;
    if (r.topPerformerId) {
        msg += `\n\n🏆 Top Performer: ${maskUserId(r.topPerformerId)} (+$${(r.topPerformerProfit ?? 0).toFixed(2)})`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

// ─── Module 10: Admin member management ───────────────────────────────────────

bot.action('admin:admin', async ctx => {
    await ctx.answerCbQuery();
    const as_ = getApprovalStats();
    const paused = getAllUsers().filter(u => u.approval_status === 'paused').length;
    await ctx.reply(
        `🛡️ *Member Management*\n\n` +
        `👥 Total: ${as_.total} | ✅ Active: ${as_.approved} | ⏸️ Paused: ${paused} | ❌ Rejected: ${as_.rejected}`,
        { parse_mode: 'Markdown', reply_markup: memberManagementKeyboard() }
    );
});

bot.action('member:view', async ctx => {
    await ctx.answerCbQuery();
    const users = getAllUsers();
    if (users.length === 0) { await ctx.reply('No members yet.', { reply_markup: adminBackKeyboard() }); return; }
    let msg = `👥 *All Members* (${users.length})\n\n`;
    for (const u of users.slice(0, 30)) {
        const e = u.approval_status === 'approved' ? '✅' : u.approval_status === 'paused' ? '⏸️' : u.approval_status === 'rejected' ? '❌' : '⏳';
        const name = u.username ? `@${u.username}` : maskUserId(u.telegram_id);
        const tier = (u.tier ?? 'DEMO').toUpperCase();
        msg += `${e} ${name} — ${tier}\n`;
    }
    if (users.length > 30) msg += `\n_…and ${users.length - 30} more_`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

bot.action('member:pause', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'member_pause' });
    await ctx.reply('⏸️ Enter Telegram User ID to pause:');
});

bot.action('member:resume', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'member_resume' });
    await ctx.reply('▶️ Enter Telegram User ID to resume:');
});

bot.action('member:remove', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'member_remove' });
    await ctx.reply('🗑️ Enter Telegram User ID to remove:');
});

bot.action('member:message', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'member_message_id' });
    await ctx.reply('✉️ Enter Telegram User ID to message:');
});

bot.action('member:add', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'member_add' });
    await ctx.reply('➕ Enter Telegram User ID to manually add/approve:');
});

// ─── Module 11: Giveaway ─────────────────────────────────────────────────────

bot.action('admin:giveaway', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'giveaway_winners' });
    await ctx.reply('🎁 *Giveaway Setup*\n\nHow many winners? (e.g. 3):', { parse_mode: 'Markdown' });
});

bot.action(/^giveaway:(all|24h)$/, async ctx => {
    await ctx.answerCbQuery('⏳ Generating…');
    const target = ctx.match[1] as 'all' | '24h';
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as || as.step !== 'giveaway_prize' || !as.giveawayWinners) {
        await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() });
        return;
    }
    adminSessions.delete(chatId);

    const numWinners  = as.giveawayWinners;
    const prizePool   = as.giveawayPrize ?? 0;
    const prizeEach   = prizePool / numWinners;

    const targetIds   = getGiveawayTargetIds(target);
    if (targetIds.length === 0) {
        await ctx.reply('❌ No eligible users found for this target.', { reply_markup: adminBackKeyboard() });
        return;
    }

    const runId       = `giveaway_${Date.now()}`;
    const seedIds     = getTradersIqUserIds(48);
    const generatedIds: string[] = [];

    for (let i = 0; i < numWinners; i++) {
        let gid: string | null = null;
        for (let attempt = 0; attempt < 30 && !gid; attempt++) {
            const seed   = seedIds.length > 0
                ? seedIds[Math.floor(Math.random() * seedIds.length)]
                : Math.floor(Math.random() * 900) + 100;
            const prefix = String(seed).slice(0, 3).padStart(3, '0');
            const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
            const candidate = prefix + suffix;
            if (!isGeneratedIdUsed(candidate)) {
                gid = candidate;
                saveGeneratedGiveawayId(runId, gid, prefix);
            }
        }
        if (!gid) {
            await ctx.reply(`⚠️ Could not generate unique ID for winner ${i + 1}. Try again.`, { reply_markup: adminBackKeyboard() });
            return;
        }
        generatedIds.push(gid);
    }

    const winnerLines = generatedIds
        .map((id, idx) => `🏆 Winner ${idx + 1}: \`${id}\` — *$${prizeEach.toFixed(2)}*`)
        .join('\n');

    const broadcastMsg = [
        `🎉 *CONGRATULATIONS to our ${numWinners} lucky winner${numWinners !== 1 ? 's' : ''}!*`,
        '',
        winnerLines,
        '',
        `💰 *Total Prize Pool: $${prizePool.toFixed(2)}*`,
        '',
        `If your IQ Option User ID matches one of the winning IDs above, contact the admin to claim your prize!`,
    ].join('\n');

    const contactBtn = { inline_keyboard: [[{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }]] };

    let sent = 0;
    let failed = 0;
    for (const tid of targetIds) {
        try {
            await bot.telegram.sendMessage(tid, broadcastMsg, { parse_mode: 'Markdown', reply_markup: contactBtn });
            sent++;
        } catch {
            failed++;
        }
        await new Promise(r => setTimeout(r, 35));
    }

    await ctx.reply(
        `✅ Giveaway broadcast complete!\n\n` +
        `📤 Sent: ${sent} | ❌ Failed: ${failed}\n\n` +
        `*Generated Winner IDs:*\n${generatedIds.map(id => `\`${id}\``).join('\n')}`,
        { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
    );
});

// ─── /connect & /disconnect ───────────────────────────────────────────────────

bot.command('connect', async ctx => {
    connectSessions.set(ctx.chat.id, { step: 'email' });
    await ctx.reply('📧 Enter your IQ Option email:');
});

bot.command('disconnect', async ctx => {
    deleteUser(ctx.from!.id);
    connectSessions.delete(ctx.chat.id);
    await ctx.reply('✅ Disconnected. Your IQ Option session has been removed.');
});

// ─── /pairs debug ─────────────────────────────────────────────────────────────

bot.command('pairs', async ctx => {
    const ssid = getSsidForUser(ctx.from!.id);
    if (!ssid) { await ctx.reply('❌ Not connected. Use /connect first.'); return; }
    try {
        const sdk = await runSdkOp(() => withTimeout(getSdk(ssid), 10_000, 'pairs'));
        const actives = (await withTimeout(sdk.turboOptions(), 10_000, 'pairs')).getActives();
        const normTicker = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
        const otcNorms = OTC_PAIRS.map(p => normTicker(p));
        let msg = '📋 *Turbo Actives*\n\n';
        for (const a of actives) {
            const matched = otcNorms.includes(normTicker(a.ticker)) || otcNorms.includes(normTicker(a.localizationKey));
            msg += `${matched ? '✅' : '  '} \`${a.ticker}\` | \`${a.localizationKey}\`\n`;
        }
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.message.startsWith('SDK timeout');
        await ctx.reply(isTimeout ? '⚠️ IQ Option is taking too long. Try again in a moment.' : `❌ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
});

bot.command('ping', ctx => ctx.reply('pong'));

bot.command('giveaway', async ctx => {
    if (ctx.from?.id !== getAdminId()) return;
    adminSessions.set(ctx.chat.id, { step: 'giveaway_winners' });
    await ctx.reply('🎁 *Giveaway Setup*\n\nHow many winners? (e.g. 3):', { parse_mode: 'Markdown' });
});

bot.command('refresh', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from!.id;
    const refreshSsid = getSsidForUser(userId);
    if (refreshSsid) evictSdk(refreshSsid);
    resetUser(userId);
    balanceCache.delete(userId);
    onboardSessions.delete(chatId);
    wizardSessions.delete(chatId);
    connectSessions.delete(chatId);
    adminSessions.delete(chatId);
    upgradeSessionsMap.delete(chatId);
    userMartingaleSettings.delete(userId);
    await startOnboarding(ctx);
});

// ─── Broadcast media handlers ─────────────────────────────────────────────────

bot.on('photo', async ctx => {
    if (ctx.from?.id !== getAdminId()) return;
    const chatId = ctx.chat.id;
    const as = adminSessions.get(chatId);
    if (!as || as.step !== 'broadcast_media') return;
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.'); return; }
    const photo = ctx.message.photo.at(-1)!;
    pendingBroadcasts.set(chatId, { ...pending, media: { type: 'photo', fileId: photo.file_id } });
    adminSessions.delete(chatId);
    await ctx.reply('📎 Image received! Include a link button?', { reply_markup: broadcastLinkKeyboard() });
});

bot.on('video', async ctx => {
    if (ctx.from?.id !== getAdminId()) return;
    const chatId = ctx.chat.id;
    const as = adminSessions.get(chatId);
    if (!as || as.step !== 'broadcast_media') return;
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.'); return; }
    pendingBroadcasts.set(chatId, { ...pending, media: { type: 'video', fileId: ctx.message.video.file_id } });
    adminSessions.delete(chatId);
    await ctx.reply('📹 Video received! Include a link button?', { reply_markup: broadcastLinkKeyboard() });
});

// ─── Text handler (all wizards) ───────────────────────────────────────────────

bot.on('text', async ctx => {
    if (ctx.message.text.startsWith('/')) return;
    const chatId = ctx.chat.id;
    const text   = ctx.message.text.trim();

    // ── Admin wizard ─────────────────────────────────────────────────────────
    if (ctx.from?.id === getAdminId()) {
        const as = adminSessions.get(chatId);
        if (as) {
            try {
            adminSessions.delete(chatId);

            if (as.step === 'find_users') {
                const byId = parseInt(text, 10);
                let found;
                if (!isNaN(byId)) {
                    const u = getUser(byId);
                    found = u ? [u] : [];
                } else {
                    found = findUsersByUsername(text);
                }
                if (found.length === 0) {
                    await ctx.reply('🔍 No user found.', { reply_markup: adminBackKeyboard() });
                } else {
                    let msg = `🔍 *Found ${found.length} user(s):*\n\n`;
                    for (const u of found) {
                        const statusEmoji = u.approval_status === 'approved' ? '✅' : u.approval_status === 'paused' ? '⏸️' : u.approval_status === 'rejected' ? '❌' : '⏳';
                        const ts = getTradeStats(u.telegram_id);
                        const winRate = ts.total > 0 ? ((ts.wins / ts.total) * 100).toFixed(0) : '0';
                        msg += `Telegram: ${u.username ? `@${u.username}` : 'no username'} (\`${maskUserId(u.telegram_id)}\`)\n`;
                        if (u.iq_user_id) msg += `IQ User ID: \`${maskUserId(u.iq_user_id)}\`\n`;
                        msg += `Status: ${statusEmoji} ${u.approval_status} | Tier: ${u.tier ?? 'DEMO'}\n`;
                        msg += `Trades: ${ts.total} (Win rate: ${winRate}%)\n\n`;
                    }
                    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
                }
                return;
            }

            if (as.step === 'broadcast_message') {
                try {
                    const target = as.broadcastTarget!;
                    let targetIds: number[];
                    if (target === 'active') targetIds = getActiveTraderIds(5);
                    else if (target === 'inactive') targetIds = getInactiveTraderIds(5);
                    else targetIds = getAllUserIds();

                    pendingBroadcasts.set(chatId, { message: text, targetIds });
                    adminSessions.set(chatId, { ...as, step: 'broadcast_media' });
                    await ctx.reply(`📎 Send to *${targetIds.length}* ${target} user(s).\n\nInclude an image or video? Send the file, or type "skip":`, { parse_mode: 'Markdown' });
                } catch (err) {
                    console.error('[broadcast] broadcast_message error:', err);
                    await ctx.reply('❌ Broadcast setup failed. Check server logs.', { reply_markup: adminBackKeyboard() });
                }
                return;
            }

            if (as.step === 'broadcast_media') {
                if (text.toLowerCase() === 'skip') {
                    // adminSessions already deleted at top — proceed to link prompt
                    await ctx.reply('Include a link button?', { reply_markup: broadcastLinkKeyboard() });
                } else {
                    adminSessions.set(chatId, as); // restore for retry
                    await ctx.reply('❌ Please send an image/video file, or type "skip" to continue without media.');
                }
                return;
            }

            if (as.step === 'broadcast_link_url') {
                adminSessions.set(chatId, { ...as, step: 'broadcast_link_label', broadcastLinkUrl: text });
                await ctx.reply('✏️ Enter the button label (e.g. "Open App"):');
                return;
            }

            if (as.step === 'broadcast_link_label') {
                const pending = pendingBroadcasts.get(chatId);
                if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
                pendingBroadcasts.set(chatId, { ...pending, button: { text, type: 'url', value: as.broadcastLinkUrl! } });
                await ctx.reply(
                    `🔗 Button set: *${text}* → ${as.broadcastLinkUrl}\n\nAuto-delete after?`,
                    { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() }
                );
                return;
            }

            if (as.step === 'broadcast_custom_timer') {
                const ms = parseDuration(text);
                if (ms === null) {
                    adminSessions.set(chatId, as); // restore for retry
                    await ctx.reply('❌ Invalid format. Use e.g. 30m, 2h, 45s:');
                    return;
                }
                const pending = pendingBroadcasts.get(chatId);
                if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
                pendingBroadcasts.set(chatId, { ...pending, deleteAfterMs: ms });
                await ctx.reply('⏰ Send now or schedule?', { reply_markup: broadcastSendOrScheduleKeyboard() });
                return;
            }

            if (as.step === 'broadcast_schedule_custom') {
                const delayMs = parseDuration(text);
                if (delayMs === null) {
                    adminSessions.set(chatId, as); // restore for retry
                    await ctx.reply('❌ Invalid format. Use e.g. 45m, 3h, 90m:');
                    return;
                }
                const pending = pendingBroadcasts.get(chatId);
                if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
                const activeCount = scheduledBroadcasts.filter(s => !s.sent).length;
                if (activeCount >= 5) { await ctx.reply('❌ Max 5 scheduled broadcasts. Cancel one first.', { reply_markup: adminBackKeyboard() }); return; }
                pendingBroadcasts.delete(chatId);
                const scheduledAt = new Date(Date.now() + delayMs);
                const id = nextScheduledId++;
                const scheduled: ScheduledBroadcast = {
                    id, message: pending.message, targetIds: pending.targetIds,
                    button: pending.button, media: pending.media,
                    deleteAfterMs: pending.deleteAfterMs ?? 0,
                    scheduledAt, sent: false, createdAt: new Date(),
                };
                scheduled.timerId = setTimeout(() => { void executeScheduledBroadcast(scheduled); }, delayMs);
                scheduledBroadcasts.push(scheduled);
                const delayLabel = delayMs < 3_600_000 ? `${delayMs / 60_000}m` : `${delayMs / 3_600_000}h`;
                await ctx.reply(
                    `✅ Broadcast scheduled in *${delayLabel}* (${scheduledAt.toLocaleTimeString()}) → ${pending.targetIds.length} users.`,
                    { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
                );
                return;
            }

            if (as.step === 'manual_add_id') {
                const uid = parseInt(text, 10);
                if (isNaN(uid)) { await ctx.reply('❌ Invalid user ID.', { reply_markup: adminBackKeyboard() }); return; }
                adminSessions.set(chatId, { step: 'manual_add_profit', manualAddUserId: uid });
                await ctx.reply(`Enter profit amount for user \`${uid}\`:`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'manual_add_profit' && as.manualAddUserId) {
                const profit = parseFloat(text);
                if (isNaN(profit) || profit <= 0) { await ctx.reply('❌ Invalid amount.', { reply_markup: adminBackKeyboard() }); return; }
                const added = addLeaderboardManual(as.manualAddUserId, profit);
                await ctx.reply(
                    added ? `✅ Added \`${maskUserId(as.manualAddUserId)}\` — +$${profit.toFixed(2)} to leaderboard.` : '❌ Leaderboard is full (max 10 entries).',
                    { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
                );
                return;
            }

            if (as.step === 'edit_trader_profit' && as.editTraderTelegramId) {
                const profit = parseFloat(text);
                if (isNaN(profit) || profit <= 0) { await ctx.reply('❌ Invalid amount.', { reply_markup: adminBackKeyboard() }); return; }
                const updated = updateLeaderboardManual(as.editTraderTelegramId, profit);
                await ctx.reply(
                    updated
                        ? `✅ Updated \`${maskUserId(as.editTraderTelegramId)}\` — +$${profit.toFixed(2)}.`
                        : '❌ Entry not found or not a manual entry.',
                    { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
                );
                return;
            }

            if (as.step === 'funnel_url') {
                setConfig('funnel_url', text);
                await ctx.reply(`✅ Landing page URL saved:\n${text}`, { reply_markup: adminBackKeyboard() });
                return;
            }

            if (as.step === 'member_pause') {
                const uid = parseInt(text, 10);
                if (isNaN(uid)) { await ctx.reply('❌ Invalid ID.', { reply_markup: adminBackKeyboard() }); return; }
                pauseUser(uid);
                await ctx.reply(`⏸️ User \`${uid}\` paused.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
                try { await bot.telegram.sendMessage(uid, '⏸️ Your account has been temporarily paused. Contact the admin.'); } catch {}
                return;
            }

            if (as.step === 'member_resume') {
                const uid = parseInt(text, 10);
                if (isNaN(uid)) { await ctx.reply('❌ Invalid ID.', { reply_markup: adminBackKeyboard() }); return; }
                resumeUser(uid);
                await ctx.reply(`▶️ User \`${uid}\` resumed.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
                try { await bot.telegram.sendMessage(uid, '✅ Your account has been resumed. You can now trade again.'); } catch {}
                return;
            }

            if (as.step === 'member_remove') {
                const uid = parseInt(text, 10);
                if (isNaN(uid)) { await ctx.reply('❌ Invalid ID.', { reply_markup: adminBackKeyboard() }); return; }
                deleteUser(uid);
                await ctx.reply(`🗑️ User \`${uid}\` removed.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
                return;
            }

            if (as.step === 'member_message_id') {
                const uid = parseInt(text, 10);
                if (isNaN(uid)) { await ctx.reply('❌ Invalid ID.', { reply_markup: adminBackKeyboard() }); return; }
                adminSessions.set(chatId, { step: 'member_message_text', memberMessageUserId: uid });
                await ctx.reply(`✉️ Enter message to send to user \`${uid}\`:`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'member_message_text' && as.memberMessageUserId) {
                try {
                    await bot.telegram.sendMessage(as.memberMessageUserId, text);
                    await ctx.reply(`✅ Message sent to \`${as.memberMessageUserId}\`.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
                } catch {
                    await ctx.reply('❌ Failed to send message. User may have blocked the bot.', { reply_markup: adminBackKeyboard() });
                }
                return;
            }

            if (as.step === 'member_add') {
                const uid = parseInt(text, 10);
                if (isNaN(uid)) { await ctx.reply('❌ Invalid ID.', { reply_markup: adminBackKeyboard() }); return; }
                approveUser(uid);
                await ctx.reply(`✅ User \`${uid}\` approved and added.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
                try { await bot.telegram.sendMessage(uid, '✅ *Your account has been approved!* You can now start trading.', { parse_mode: 'Markdown' }); } catch {}
                return;
            }

            if (as.step === 'giveaway_winners') {
                const n = parseInt(text, 10);
                if (isNaN(n) || n < 1 || n > 50) {
                    adminSessions.set(chatId, as);
                    await ctx.reply('❌ Enter a number between 1 and 50:');
                    return;
                }
                adminSessions.set(chatId, { ...as, step: 'giveaway_prize', giveawayWinners: n });
                await ctx.reply(`✅ ${n} winner${n !== 1 ? 's' : ''}.\n\n💰 Enter the total prize pool amount in USD (e.g. 500):`);
                return;
            }

            if (as.step === 'giveaway_prize' && as.giveawayWinners) {
                const prize = parseFloat(text);
                if (isNaN(prize) || prize <= 0) {
                    adminSessions.set(chatId, as);
                    await ctx.reply('❌ Enter a valid positive amount (e.g. 500):');
                    return;
                }
                adminSessions.set(chatId, { ...as, giveawayPrize: prize });
                const perWinner = (prize / as.giveawayWinners).toFixed(2);
                await ctx.reply(
                    `✅ Prize pool: *$${prize.toFixed(2)}* → *$${perWinner}* per winner\n\n📡 Who should receive this broadcast?`,
                    { parse_mode: 'Markdown', reply_markup: giveawayTargetKeyboard() }
                );
                return;
            }

            return;
            } catch (err) {
                console.error('[admin-wizard] unhandled error in step', as.step, ':', err);
                await ctx.reply('❌ An error occurred. Check server logs.', { reply_markup: adminBackKeyboard() });
            }
        }
    }

    // ── Upgrade token entry ───────────────────────────────────────────────────
    if (upgradeSessions.has(chatId)) {
        upgradeSessions.delete(chatId);
        const tokenInput = text.toUpperCase().trim();
        const result = validateToken(tokenInput);
        if (!result.valid) {
            await ctx.reply(`❌ ${result.error}. Contact support to get a valid token.`);
            return;
        }
        if (useToken(tokenInput, ctx.from!.id)) {
            setUserTier(ctx.from!.id, result.tier!);
            await ctx.reply(
                `✅ Token accepted! Your tier has been upgraded to *${result.tier}*. 🎉`,
                { parse_mode: 'Markdown', reply_markup: startKeyboard(result.tier!) }
            );
        } else {
            await ctx.reply('❌ Token could not be applied. It may have already been used or expired.');
        }
        return;
    }

    // ── Onboarding wizard ────────────────────────────────────────────────────
    const ob = onboardSessions.get(chatId);
    if (ob) {
        if (ob.step === 'user_id' || ob.step === 'create_user_id') {
            const iqUserId = parseInt(text, 10);
            if (isNaN(iqUserId) || iqUserId <= 0) { await ctx.reply('Please enter a valid numeric IQ Option User ID.'); return; }
            await ctx.reply('🔍 Checking your account...');
            upsertOnboardingUser(ctx.from!.id, iqUserId);
            if (ob.tier) setUserTier(ctx.from!.id, ob.tier);

            try {
                const result = await withTimeout(checkAffiliate(iqUserId), 15_000, 'affiliate')
                    .catch(() => ({ found: false, data: null }));
                if (result.found) {
                    approveUser(ctx.from!.id, result.data ? JSON.stringify(result.data) : undefined);
                    ob.iqUserId = iqUserId;
                    ob.step = 'connect_email';
                    onboardSessions.set(chatId, ob);
                    await ctx.reply('✅ Account verified! You\'re all set.\n\n📧 Enter your IQ Option email:');
                } else {
                    setManualApproval(ctx.from!.id);
                    onboardSessions.delete(chatId);
                    await ctx.reply(
                        '⏳ We were not able to confirm your User ID.\n\n' +
                        'Please consider creating a new account the right way using our link 👇👾\n\n' +
                        'You can as-well contact admin 👇💜',
                        { reply_markup: affiliateFailKeyboard() }
                    );
                    try {
                        const userTag = ctx.from!.username
                            ? `@${escapeMd(ctx.from!.username)}`
                            : `[User](tg://user?id=${ctx.from!.id})`;
                        await bot.telegram.sendMessage(
                            getAdminId(),
                            `🔔 *Manual approval needed*\nTelegram: ${userTag}\nIQ User ID: \`${iqUserId}\`\n\nApprove: /admin approve ${ctx.from!.id}\nReject: /admin reject ${ctx.from!.id}`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch {}
                }
            } catch (err: unknown) {
                console.error('[affiliate check]', err instanceof Error ? err.message : err);
                setManualApproval(ctx.from!.id);
                onboardSessions.delete(chatId);
                await ctx.reply('⏳ Your User ID has been submitted for manual review.\nYou\'ll be notified once the admin approves your account.');
                try {
                    const userTag2 = ctx.from!.username
                        ? `@${escapeMd(ctx.from!.username)}`
                        : `[User](tg://user?id=${ctx.from!.id})`;
                    await bot.telegram.sendMessage(
                        getAdminId(),
                        `🔔 *Manual approval needed* (auto-check unavailable)\nTelegram: ${userTag2}\nIQ User ID: \`${iqUserId}\`\n\nApprove: /admin approve ${ctx.from!.id}\nReject: /admin reject ${ctx.from!.id}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch {}
            }
            return;
        }

        if (ob.step === 'connect_email') {
            ob.email = text;
            ob.step = 'connect_password';
            onboardSessions.set(chatId, ob);
            await ctx.reply('🛡️ Your password is safe\n\nWe use the official IQ Option API.\nWe can\'t read or store it.\nYour message auto-deletes from this chat in 10 seconds.');
            await ctx.reply('🔑 Enter your IQ Option password:');
            return;
        }

        if (ob.step === 'connect_password' && ob.email) {
            const email = ob.email;
            try { await ctx.deleteMessage(); } catch {}
            await ctx.reply('🔐 Logging in...');
            try {
                const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, text), 10_000, 'login');
                saveUser({ telegram_id: ctx.from!.id, ssid });
                const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
                const demo = all.find(b => b.type === BalanceType.Demo);
                const real = all.find(b => b.type === BalanceType.Real);
                if (real?.currency) saveUserCurrency(ctx.from!.id, real.currency);
                else if (demo?.currency) saveUserCurrency(ctx.from!.id, demo.currency);
                let msg = '✅ Connected!\n\n';
                if (demo) msg += `🎮 Practice: ${fmtBalance(demo)}\n`;
                if (real) msg += `💎 Live: ${fmtBalance(real)}\n`;
                onboardSessions.delete(chatId);
                await ctx.reply(msg, { reply_markup: startKeyboard() });
            } catch (err: unknown) {
                console.error('[connect fail]', err instanceof Error ? err.message : err);
                ob.loginFailCount = (ob.loginFailCount ?? 0) + 1;
                onboardSessions.set(chatId, ob);
                if ((ob.loginFailCount ?? 0) >= 2) {
                    onboardSessions.delete(chatId);
                    await ctx.reply(
                        'Seems you\'re having trouble logging into your IQ Options Account 👾😨\n\nNo worries we\'re here to assist you. Contact admin below 👇💜',
                        { reply_markup: { inline_keyboard: [[{ text: '👾 Contact admin', url: ADMIN_CONTACT_LINK }]] } }
                    );
                } else {
                    ob.step = 'connect_email';
                    ob.email = undefined;
                    onboardSessions.set(chatId, ob);
                    await ctx.reply('Sorry we\'re unable to retrieve your account details 😨\n\nPlease re-check your account email or password and try again 👇\n\n📧 Enter your IQ Option email:');
                }
            }
            return;
        }
        return;
    }

    // ── Standalone /connect wizard ────────────────────────────────────────────
    const conn = connectSessions.get(chatId);
    if (conn) {
        if (conn.step === 'email') {
            conn.email = text;
            conn.step = 'password';
            connectSessions.set(chatId, conn);
            await ctx.reply('🔑 Enter your password:');
        } else if (conn.step === 'password' && conn.email) {
            const email = conn.email;
            connectSessions.delete(chatId);
            try { await ctx.deleteMessage(); } catch {}
            await ctx.reply('🔐 Logging in...');
            try {
                const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, text), 10_000, 'login');
                saveUser({ telegram_id: ctx.from!.id, ssid });
                const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
                const demo = all.find(b => b.type === BalanceType.Demo);
                const real = all.find(b => b.type === BalanceType.Real);
                if (real?.currency) saveUserCurrency(ctx.from!.id, real.currency);
                else if (demo?.currency) saveUserCurrency(ctx.from!.id, demo.currency);
                let msg = '✅ *Connected!*\n\n';
                if (demo) msg += `🎮 Practice: ${fmtBalance(demo)}\n`;
                if (real) msg += `💎 Live: ${fmtBalance(real)}\n`;
                await ctx.reply(msg, { parse_mode: 'Markdown' });
            } catch (err: unknown) {
                const isTimeout = err instanceof Error && err.message.startsWith('SDK timeout');
                await ctx.reply(isTimeout
                    ? '⚠️ IQ Option is taking too long. Please try again.'
                    : `❌ Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`
                );
            }
        }
        return;
    }

    // ── Trade wizard — custom amount ──────────────────────────────────────────
    const wiz = wizardSessions.get(chatId);
    if (!wiz || wiz.step !== 'custom_amount') return;

    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) { await ctx.reply('Please enter a valid positive number (e.g. 75).'); return; }
    if (wiz.mode === 'demo' && amount > 20) { await ctx.reply('❌ Demo max is $20 or equivalent. Please enter a smaller amount.'); return; }

    wiz.amount = amount;
    wiz.step = 'timeframe';
    if (wiz.lastImageMsgId) {
        try { await ctx.telegram.deleteMessage(chatId, wiz.lastImageMsgId); } catch {}
    }
    try { const m = await ctx.replyWithPhoto(ASSET('L5.png')); wiz.lastImageMsgId = m.message_id; } catch {}
    await ctx.reply(
        '⏱ Pick your expiry timeframe 👇\n⏱ Faster timeframes settle quicker.\n🐢 Longer timeframes ride bigger moves.',
        { reply_markup: timeframeKeyboard() }
    );
});

bot.catch((err: unknown, ctx) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bot.catch] ${ctx.updateType}:`, msg);
    if (ctx.callbackQuery && msg.includes('query is too old')) {
        ctx.answerCbQuery('⏳ Expired').catch(() => {});
        ctx.editMessageText(
            '⏳ This session expired.\n\nSend /start to continue.',
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Start Over', callback_data: 'ui:start' }]] } }
        ).catch(() => {});
        return;
    }
    if (ctx.callbackQuery) {
        ctx.answerCbQuery('⚠️ Error occurred. Try again.').catch(() => {});
    } else {
        ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
    }
});

cleanStaleSessions();
(bot as any).options.handlerTimeout = 10_000;
bot.launch();
console.log('[iqbot-v3] running');

setInterval(async () => {
    try {
        await bot.telegram.getMe();
    } catch (err) {
        console.error('[keepalive] getMe failed:', err instanceof Error ? err.message : err);
    }
}, 600_000);

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
