import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { ClientSdk, SsidAuthMethod, BalanceType } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST, IQ_AUTH_URL } from './protocol.js';
import { executeTrade, executeTradeWithSdk, createSdk, type TradeRequest, type TradeResult } from './trade.js';
import { recoverMissedTradeResults } from './tradeRecovery.js';
import { sdkPool } from './sdk-pool.js';
import { getTierConfig, normalizeTier, autoPromoteTier, convertToUsd, TIER_CONFIGS } from './tiers.js';
import {
    getRecentTrades, getTradeStats, getTopTradersToday,
    getUser, saveUser, saveUsername, deleteUser, getAllUsers, getAllUserIds,
    getActiveTraderIds, getInactiveTraderIds, findUsersByUsername, findUsersByIqUserId,
    getActivatedUserIds, getNonActivatedUserIds,
    getFundedUserIds, getNonFundedUserIds,
    upsertOnboardingUser, approveUser, setManualApproval, rejectUser, resetUser, getApprovalStats,
    getRecentApprovals, getPendingManualUsers,
    setUserTier, saveUserCurrency, pauseUser, resumeUser,
    generateToken, validateToken, useToken, getTokens,
    updateLeaderboardAuto, addLeaderboardManual, getLeaderboard,
    getLeaderboardDetailed, updateLeaderboardManual,
    getFunnelStats, insertFunnelEvent, getConfig, setConfig, getTestUserId, setTestUser,
    getAuditReport, maskUserId,
    calculatePairWinRates, selectTopPicks, type PairWinRate,
    setSession, getSession, deleteSession, cleanStaleSessions,
    saveGeneratedGiveawayId, isGeneratedIdUsed, getTradersIqUserIds, getGiveawayTargetIds,
    countFabricatedTraders, seedFabricatedTraders, getFabricatedTradersDueForUpdate,
    updateFabricatedPnl, getAllFabricatedTraders, resetFabricatedPnl, getRealTraderLeaderboard,
    getMarathonFabricantsDueForUpdate, updateMarathonFabricantTrades,
    getGiveawayStats, getGiveawayParticipantCount,
    insertMessage,
    insertBroadcastMessage,
    getUserMartingaleSettings, setUserMartingaleSettings,
    getUserSessionStats, addUserSessionStats,
    getUserBalanceCache, setUserBalanceCache, clearUserBalanceCache,
    getComposeTone, setComposeTone,
    getAdminSsid, setAdminSsid, clearAdminSsid,
    insertScheduledBroadcast, markScheduledBroadcastSent, deleteScheduledBroadcast, getPendingScheduledBroadcasts,
    clearUserSsid,
    saveUserCred,
    saveUserIqUserId,
    setSsidValid,
    getUsersWithSsid,
    getUsersDueForReconnectPrompt,
    setReconnectPrompt,
    clearReconnectPrompt,
    getPendingGiveawaysDue,
    setGiveawayStatus,
    getGiveawayParticipants,
    deleteGiveaway,
    seedTemplates,
    setOnboardingState,
    touchOnboardingActivity,
    setUserPidginEnabled,
    getTemplateByKey,
    getTemplatesByCategory,
    getTemplateCategories,
    updateTemplateMessage,
    getRandomTemplate,
    getTierDistribution,
    getFundedUserCount,
    getRecentBroadcasts,
    getOnboardingFunnelStats,
    getAllSequenceMediaKeys,
    getSequenceMedia,
    setSequenceMedia,
    getOnboardingTracking,
    setLastFollowupMsgId,
    setLastFundingAt,
    getDemoTradeCount,
    getDailyDemoCount,
    incrementDailyDemoCount,
    getUserIdFailCount, incrementUserIdFailCount, resetUserIdFailCount,
    db,
    getFundingCycle, upsertFundingCycle, getFundingCycleDueUsers,
    getDemoUsersWithTrades, getLastTradeTime,
    getReconnectCycle, upsertReconnectCycle, getReconnectCycleDueUsers,
    getSsidExpiredUsers, getUserIdRejectedUsers, getLoginFailedUsers,
    getAbandonedOnboardingUsers, getNeverConnectedUsers,
    getMarketPulseStats,
    getFunnelPipeline,
} from './db.js';
import { friendlyError } from './errors.js';
import { logger } from './logger.js';
import {
    createGiveawayEvent, activateGiveaway, activatePromoCode, activateMarathon,
    participate as giveawayParticipate,
    claimPromoCode, getMarathonLeaderboard, checkMarathonDeadlines, tickPromoFabrication,
    recordTrade as giveawayRecordTrade, selectWinners as giveawaySelectWinners,
    getActiveGiveaways, getGiveawayEvents, getGiveawayEvent, getRealAndFabricatedCounts,
    processUpdateQueue, processNotificationsQueue,
    type GiveawayEventInput,
} from './giveaway.js';
import { analyzePair, analyzePairWithSdk, type AnalysisResult } from './analysis.js';
import {
    amountKeyboard, timeframeKeyboard, pairKeyboard, tfLabel, OTC_PAIRS,
    tradeModeKeyboard, demoUpsellKeyboard, affiliateFailKeyboard, currencyKeyboard,
} from './menu.js';
import { startKeyboard, backKeyboard } from './ui/user.js';
import {
    getAdminId, adminKeyboard, adminBackKeyboard,
    broadcastTargetKeyboard, broadcastLinkKeyboard, broadcastActionKeyboard, broadcastTimerKeyboard,
    broadcastSendOrScheduleKeyboard, broadcastDelayKeyboard, scheduledBroadcastsKeyboard,
    tokenTierKeyboard, generateTokenKeyboard,
    topTradersAdminKeyboard, funnelKeyboard, memberManagementKeyboard, activationsKeyboard,
    giveawayTargetKeyboard,
    giveawayManagerKeyboard, giveawayTypeKeyboard, giveawayCriteriaKeyboard,
    giveawayScheduleKeyboard, activeGiveawaysKeyboard, giveawayViewKeyboard,
    promoScheduleKeyboard, marathonDurationKeyboard, marathonScheduleKeyboard,
    composeTopicKeyboard, composeResultKeyboard, composeDeliveryKeyboard, composeToneKeyboard, composeButtonKeyboard,
    memberFilterKeyboard, userDetailKeyboard, mediaLibraryKeyboard,
    llmCategoryKeyboard, broadcastPreviewKeyboard,
} from './ui/admin.js';
import { checkAffiliate } from './affiliate.js';
import { setupChannelHandlers } from './channel.js';
import { startAutoBroadcast } from './auto-broadcast.js';
import { generatePost, generateDiaryEntry, type LlmRequest } from './llm.js';
import { getBrainFlow, type UserContext } from './classifier.js';
import { resolveUsername as resolveUsernameTemplate, applyPidgin } from './pidgin.js';
import {
    handleUserIdVerified, handleUserIdFailed, handleEmailCollected,
    handleConnected,
} from './onboarding.js';
import { ProxyAgent } from 'undici';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT_TOKEN = process.env.BOT_TOKEN;
const IQ_SSID   = process.env.IQ_SSID;
const AFFILIATE_LINK   = process.env.AFFILIATE_LINK   ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue';
const ADMIN_CONTACT_LINK = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
const LOGIN_PROXY_URL    = process.env.LOGIN_PROXY_URL;

const FLOW_BUTTONS: Record<string, { text: string; action: string | { url: string } }> = {
    start_trading:        { text: '🚀 Start Trading',  action: 'ui:trade' },
    reconnect:            { text: '🔗 Reconnect',      action: 'ui:connect' },
    continue_onboarding:  { text: '▶️ Continue',       action: 'ui:start' },
    verify_user_id:       { text: '👤 Contact Admin',  action: { url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' } },
    fund_account:         { text: '💰 Fund Account',   action: { url: 'https://iqoption.com/pwa/payments/deposit' } },
    go_home:              { text: '🏠 Menu',            action: 'ui:start' },
    help_contact:         { text: '👤 Contact Admin',  action: { url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' } },
    help_user_id:         { text: '🆕 Create Account', action: { url: process.env.AFFILIATE_LINK ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue' } },
    link_account:         { text: '🔗 Connect Account', action: 'ui:connect' },
    create_account:       { text: '🆕 Create Account', action: { url: process.env.AFFILIATE_LINK ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue' } },
};

type UserSegment = 'non_activated' | 'non_funded' | 'funded';

function getUserSegment(telegramId: number): UserSegment {
    const user = getUser(telegramId);
    if (!user) return 'non_activated';
    if (user.tier === 'PRO' || user.tier === 'MASTER') return 'funded';
    if (user.ssid_valid === 1 && user.ssid && user.ssid !== '') return 'non_funded';
    return 'non_activated';
}

const nonActivatedResponseCount = new Map<number, number>();
const MAX_NON_ACTIVATED_RESPONSES = 3;

// Resolve assets dir from env, else from the source layout (src/.. -> assets).
// Warn loudly at startup if the directory doesn't exist so image sends don't
// fail silently every time a wizard step needs to upload a photo.
const __dirname_es = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = process.env.ASSETS_DIR ?? resolve(__dirname_es, '..', 'assets');
if (!existsSync(ASSETS_DIR)) {
    console.error(`[bot] WARNING: assets directory not found at ${ASSETS_DIR} — all photo sends will fail. Set ASSETS_DIR in env.`);
}

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing from .env');

process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });

// ─── Admin notification queue ─────────────────────────────────────────────────
// Defers admin notifications when admin is actively using the portal.
// Notifications are queued and delivered 20 min after the last admin activity.
const adminNotificationQueue: { msg: string; parseMode?: any }[] = [];
let adminNotificationTimer: NodeJS.Timeout | null = null;

function touchAdminActivity(): void {
    if (adminNotificationTimer) clearTimeout(adminNotificationTimer);
    adminNotificationTimer = setTimeout(flushAdminNotifications, 20 * 60 * 1000);
}

async function notifyAdmin(msg: string, parseMode?: any): Promise<void> {
    if (adminNotificationTimer) {
        adminNotificationQueue.push({ msg, parseMode });
        return;
    }
    try { await bot.telegram.sendMessage(getAdminId(), msg, { parse_mode: parseMode ?? 'Markdown' }); } catch {}
}

function flushAdminNotifications(): void {
    adminNotificationTimer = null;
    const queue = adminNotificationQueue.splice(0);
    if (queue.length === 0) return;
    for (const n of queue) {
        bot.telegram.sendMessage(getAdminId(), n.msg, { parse_mode: n.parseMode ?? 'Markdown' }).catch(() => {});
    }
}

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity });

// ─── Channel integration ──────────────────────────────────────────────────────
setupChannelHandlers(bot);

// Save Telegram username on every interaction
bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    const username = ctx.from?.username;
    if (id && username) saveUsername(id, username);
    return next();
});

bot.use(async (ctx, next) => {
    if (!ctx.callbackQuery) return next();
    const start = Date.now();
    const label = (ctx.callbackQuery as { data?: string }).data?.substring(0, 20) ?? 'unknown';
    await next();
    const elapsed = Date.now() - start;
    if (elapsed > 3000) console.log(`[slow] callback ${label}: ${elapsed}ms`);
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
function fmtMoney(n: number, cur = 'USD'): string {
    return `${CURRENCY_SYMBOLS[cur] ?? '$'}${n.toFixed(2)}`;
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

function makeSessionMap<T>(prefix: string) {
    if (!/^[a-z_]+$/.test(prefix)) {
        throw new Error(`makeSessionMap: invalid prefix "${prefix}" — must match /^[a-z_]+$/`);
    }
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
type WizardStep = 'mode' | 'currency' | 'amount' | 'timeframe' | 'pair' | 'custom_amount';

interface WizardState {
    step: WizardStep;
    mode?: 'demo' | 'live';
    currency?: string;
    amount?: number;
    timeframe?: number;
    lastImageMsgId?: number;
}
const wizardSessions = makeSessionMap<WizardState>('wizard');

type OnboardStep = 'user_id' | 'create_user_id' | 'connect_email' | 'connect_password' | 'auto_create_email';
interface OnboardState {
    step: OnboardStep;
    tier?: string;
    iqUserId?: number;
    email?: string;
    loginFailCount?: number;
}
const onboardSessions = makeSessionMap<OnboardState>('onboard');

type ConnectStep = 'email' | 'password' | 'admin_email' | 'admin_password' | 'confirmed_user_id' | 'confirmed_email' | 'confirmed_password';
interface ConnectState { step: ConnectStep; email?: string; iqUserId?: string; }
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
    | 'giveaway_prize'
    | 'giveaway_v2_title'
    | 'giveaway_v2_desc'
    | 'giveaway_v2_criteria_value'
    | 'giveaway_v2_max_winners'
    | 'giveaway_v2_prize'
    | 'promo_v2_title'
    | 'promo_v2_desc'
    | 'promo_v2_code'
    | 'promo_v2_max_claims'
    | 'marathon_v2_title'
    | 'marathon_v2_desc'
    | 'marathon_v2_winners'
    | 'marathon_v2_prize'
    | 'compose_description'
    | 'compose_manual'
    | 'compose_image'
    | 'compose_cta'
    | 'compose_tone_guide'
    | 'compose_tone_sample1'
    | 'compose_tone_sample2'
    | 'compose_tone_sample3'
    | 'media_upload';

interface AdminSessionState {
    step: AdminStep;
    broadcastTarget?: 'all' | 'funded' | 'nonfunded' | 'nonactivated' | 'testuser';
    broadcastLinkUrl?: string;
    manualAddUserId?: number;
    editTraderTelegramId?: number;
    memberMessageUserId?: number;
    giveawayWinners?: number;
    giveawayPrize?: number;
    // Giveaway V2 wizard state
    giveawayV2Type?: 'giveaway' | 'promo_code' | 'marathon';
    giveawayV2Title?: string;
    giveawayV2Desc?: string;
    giveawayV2CriteriaType?: string;
    giveawayV2CriteriaValue?: string;
    giveawayV2MaxWinners?: number;
    giveawayV2Prize?: number;
    // Promo code wizard state
    promoV2Title?: string;
    promoV2Desc?: string;
    promoV2Code?: string;
    promoV2MaxClaims?: number;
    // Marathon wizard state
    marathonV2Title?: string;
    marathonV2Desc?: string;
    marathonV2DurationSec?: number;
    marathonV2Winners?: number;
    marathonV2Prize?: number;
    // Compose post wizard state
    composeTopic?: LlmRequest['topic'];
    composeDescription?: string;
    composeContent?: string;
    composeImageFileIds?: string[];
    composeCta?: 'start' | 'trade' | 'fund' | 'none';
    // Media library upload
    mediaLibraryKey?: string;
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

// Asset file_id cache — avoids re-uploading the same image to Telegram
const assetFileIdCache = new Map<string, string>();
async function sendCachedAsset(ctx: any, assetName: string): Promise<{ message_id: number } | undefined> {
    const cachedId = assetFileIdCache.get(assetName);
    if (cachedId) {
        try { return await ctx.replyWithPhoto(cachedId); } catch {}
    }
    try {
        const m = await ctx.replyWithPhoto(ASSET(assetName));
        assetFileIdCache.set(assetName, m.photo[0].file_id);
        return m;
    } catch { return undefined; }
}

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

// Balance cache TTL — stored in users table (balance_cache / balance_cache_ts columns)
const BALANCE_CACHE_TTL = 5 * 60 * 1000;

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

// Telegram allows ~30 bot messages/sec; deletes count toward the same budget.
// Stagger deletes at ~20/sec to leave headroom for other bot traffic.
async function runStaggeredDeletes(ids: Array<{ telegramId: number; msgId: number }>): Promise<void> {
    const DELETE_INTERVAL_MS = 50;
    for (const { telegramId, msgId } of ids) {
        try { await bot.telegram.deleteMessage(telegramId, msgId); } catch {}
        await new Promise(r => setTimeout(r, DELETE_INTERVAL_MS));
    }
}

async function dispatchBroadcastPayload(payload: {
    message: string;
    targetIds: number[];
    button?: BroadcastButton;
    media?: { type: 'photo' | 'video'; fileId: string };
    deleteAfterMs: number;
}): Promise<{ sent: number; deferred: number }> {
    const testUserId = getTestUserId();
    if (testUserId) {
        console.log(`[test-mode] broadcast gated — sending only to test user ${testUserId}`);
        payload.targetIds = payload.targetIds.filter(id => id === testUserId);
    }

    const { message, targetIds, media, button, deleteAfterMs } = payload;

    const replyMarkup = button ? { inline_keyboard: [[
        button.type === 'url'
            ? { text: button.text, url: button.value }
            : { text: button.text, callback_data: button.value },
    ]] } : undefined;
    const sentMsgIds: Array<{ telegramId: number; msgId: number }> = [];
    let deferredCount = 0;

    const MAX_PENDING_PER_USER = 5;
    for (const uid of targetIds) {
        try {
            if ((activeTradeSessions.get(uid) ?? 0) > 0) {
                const q = pendingDeliveries.get(uid) ?? [];
                q.push({ message, button, media, deleteAfterMs });
                while (q.length > MAX_PENDING_PER_USER) q.shift();
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
        setTimeout(() => { void runStaggeredDeletes(sentMsgIds); }, deleteAfterMs);
    }

    return { sent: sentMsgIds.length, deferred: deferredCount };
}

async function executeScheduledBroadcast(scheduled: ScheduledBroadcast): Promise<void> {
    scheduled.sent = true;
    try { markScheduledBroadcastSent(scheduled.id); } catch (err) { console.error('[schedule] mark sent failed:', err); }
    const { sent, deferred } = await dispatchBroadcastPayload(scheduled);
    const timerLabel = scheduled.deleteAfterMs === 0 ? 'never' :
        scheduled.deleteAfterMs < 60_000 ? `${scheduled.deleteAfterMs / 1_000}s` :
        scheduled.deleteAfterMs < 3_600_000 ? `${scheduled.deleteAfterMs / 60_000}m` : `${scheduled.deleteAfterMs / 3_600_000}h`;
    let msg = `📅 Scheduled broadcast #${scheduled.id} sent to *${sent}/${scheduled.targetIds.length}* users. Auto-delete: ${timerLabel}`;
    if (deferred > 0) msg += `\n⏳ *${deferred}* deferred (active traders — will deliver after trade ends)`;
    try { await notifyAdmin(msg, 'Markdown'); } catch {}
}

function scheduleBroadcastInMemory(scheduled: ScheduledBroadcast, delayMs: number): void {
    scheduled.timerId = setTimeout(() => { void executeScheduledBroadcast(scheduled); }, delayMs);
    scheduledBroadcasts.push(scheduled);
}

function persistAndSchedule(input: Omit<ScheduledBroadcast, 'id' | 'sent' | 'createdAt' | 'timerId'> & { createdAt?: Date }): ScheduledBroadcast {
    const createdAt = input.createdAt ?? new Date();
    const id = insertScheduledBroadcast({
        message: input.message,
        targetIds: input.targetIds,
        button: input.button,
        media: input.media,
        deleteAfterMs: input.deleteAfterMs,
        scheduledAt: input.scheduledAt.toISOString(),
        createdAt: createdAt.toISOString(),
    });
    if (id >= nextScheduledId) nextScheduledId = id + 1;
    const scheduled: ScheduledBroadcast = {
        id,
        message: input.message,
        targetIds: input.targetIds,
        button: input.button,
        media: input.media,
        deleteAfterMs: input.deleteAfterMs,
        scheduledAt: input.scheduledAt,
        sent: false,
        createdAt,
    };
    const delayMs = Math.max(0, input.scheduledAt.getTime() - Date.now());
    scheduleBroadcastInMemory(scheduled, delayMs);
    return scheduled;
}

function rehydrateScheduledBroadcasts(): void {
    let restored = 0, firedImmediately = 0;
    try {
        for (const row of getPendingScheduledBroadcasts()) {
            const scheduledAt = new Date(row.scheduledAt);
            const scheduled: ScheduledBroadcast = {
                id: row.id,
                message: row.message,
                targetIds: row.targetIds,
                button: row.button as BroadcastButton | undefined,
                media: row.media as { type: 'photo' | 'video'; fileId: string } | undefined,
                deleteAfterMs: row.deleteAfterMs,
                scheduledAt,
                sent: false,
                createdAt: new Date(row.createdAt),
            };
            if (row.id >= nextScheduledId) nextScheduledId = row.id + 1;
            const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
            if (delayMs === 0) firedImmediately++;
            scheduleBroadcastInMemory(scheduled, delayMs);
            restored++;
        }
        if (restored > 0) console.log(`[schedule] rehydrated ${restored} scheduled broadcast(s)${firedImmediately ? ` (${firedImmediately} overdue, firing now)` : ''}`);
    } catch (err) {
        console.error('[schedule] rehydrate failed:', err);
    }
}

async function executeBroadcast(chatId: number, deleteAfterMs: number, ctx: Context): Promise<void> {
    const pending = pendingBroadcasts.get(chatId);
    pendingBroadcasts.delete(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }

    const { sent, deferred } = await dispatchBroadcastPayload({ ...pending, deleteAfterMs });

    // Pause auto-broadcasts for 30 minutes after manual broadcast
    const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    setConfig('manual_broadcast_cooldown', cooldownUntil);
    console.log(`[broadcast] manual broadcast cooldown set — auto paused for 30m`);

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

function isAuthExpiredError(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes('authenticate') || msg.includes('authoriz') || msg.includes('unauthor')
        || msg.includes('ssid') || msg.includes('session expired') || msg.includes('not authenticated')
        || msg.includes('invalid token') || msg.includes('login') || msg.includes('401')
        || msg.includes('wrong credentials') || msg.includes('credentials');
}

async function autoReconnect(telegramId: number): Promise<boolean> {
    const user = getUser(telegramId);
    if (!user?.cred) return false;
    try {
        const decoded = Buffer.from(user.cred, 'base64').toString();
        const colonIdx = decoded.indexOf(':');
        if (colonIdx === -1) return false;
        const email = decoded.slice(0, colonIdx);
        const password = decoded.slice(colonIdx + 1);
        const { ssid } = await withTimeout(loginAndCaptureSsid(email, password), 10_000, 'auto_reconnect');
        saveUser({ telegram_id: telegramId, ssid });
        setSsidValid(telegramId, 1);
        clearReconnectPrompt(telegramId);
        logger.info('auth', `auto-reconnected user ${telegramId}`);
        return true;
    } catch {
        logger.warn('auth', `auto-reconnect failed for user ${telegramId}`);
        return false;
    }
}

/** Delete any visible reconnect-prompt message for a user and clear its tracking. */
async function clearReconnectPromptMessage(telegramId: number): Promise<void> {
    const user = getUser(telegramId);
    if (user?.reconnect_prompt_msg_id) {
        try { await bot.telegram.deleteMessage(telegramId, user.reconnect_prompt_msg_id); } catch {}
    }
    clearReconnectPrompt(telegramId);
}

/** Admin equivalent of autoReconnect — uses the base64 cred stored in config (admin_cred). */
async function adminAutoReconnect(): Promise<boolean> {
    const cred = getConfig('admin_cred');
    if (!cred) return false;
    try {
        const decoded = Buffer.from(cred, 'base64').toString();
        const colonIdx = decoded.indexOf(':');
        if (colonIdx === -1) return false;
        const email = decoded.slice(0, colonIdx);
        const password = decoded.slice(colonIdx + 1);
        const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, password), 10_000, 'admin_auto_reconnect');
        sdk.shutdown().catch(() => {});
        setAdminSsid(ssid);
        logger.info('auth', 'auto-reconnected admin account');
        return true;
    } catch {
        logger.warn('auth', 'admin auto-reconnect failed');
        return false;
    }
}

async function handlePossibleAuthExpiry(err: unknown, ctx: Context, isAdmin: boolean): Promise<boolean> {
    if (!isAuthExpiredError(err)) return false;
    // Try a silent re-login first — if creds are stored the user never notices.
    if (isAdmin) {
        if (await adminAutoReconnect()) return true;
        try { clearAdminSsid(); } catch {}
    } else if (ctx.from?.id) {
        if (await autoReconnect(ctx.from.id)) return true;
        try { clearUserSsid(ctx.from.id); } catch {}
        try { setSsidValid(ctx.from.id, 0); } catch {}
    }
    await ctx.reply(
        '🔐 Your session expired.\n\nReconnect in 3 steps:\n1️⃣ Tap the 🔗 Reconnect button below\n2️⃣ Enter your IQ Option email and password\n3️⃣ Get back to trading instantly',
        { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: isAdmin ? 'admin:trade_connect' : 'ui:connect' }]] } }
    ).catch(() => {});
    return true;
}

async function loginAndCaptureSsid(email: string, password: string): Promise<{ ssid: string; sdk: ClientSdk }> {
    const fetchOptions: RequestInit & { dispatcher?: any } = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
        body: JSON.stringify({ identifier: email, password }),
    };
    if (LOGIN_PROXY_URL) {
        fetchOptions.dispatcher = new ProxyAgent(LOGIN_PROXY_URL);
    }
    const res = await fetch(`${IQ_AUTH_URL}/v2/login`, fetchOptions);
    const rawBody = await res.text();
    console.log(`[connect] HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
    let data: { code?: string; message?: string; ssid?: string };
    try { data = JSON.parse(rawBody); } catch {
        throw new Error(`Login response is not JSON (HTTP ${res.status}): ${rawBody.slice(0, 100)}`);
    }
    if (data.code !== 'success' || !data.ssid) throw new Error(data.message ?? 'Login failed');
    const ssid = data.ssid;
    const sdk = await createSdk(ssid);
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

    if (!user || user.approval_status === 'pending' || user.approval_status === 'manual') {
        setOnboardingState(ctx.from!.id, 'awaiting_user_id');
        const img1 = getSequenceMedia('entry_welcome_1');
        if (img1) await ctx.replyWithPhoto(img1.file_id).catch(() => {});
        await ctx.reply(
            "I'm 10x Special Bot 💜\n\n" +
            "The smartest semi auto-trading bot for IQ Option OTC pairs.\n\n" +
            "I scan markets. I read signals. I place trades.\n" +
            "You sit back and watch the wins land."
        );
        const img2 = getSequenceMedia('entry_welcome_2');
        if (img2) await ctx.replyWithPhoto(img2.file_id).catch(() => {});
        await ctx.reply(
            "Connect your IQ Option account.\n\n" +
            "Free signup · 60 seconds · Linked instantly.\n" +
            "Bot trades on your account. Money stays yours.\n\n" +
            "Pick what fits 👇",
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ I have an IQ Option account', callback_data: 'onboard:yes' },
                        { text: '🆕 Create Account', url: AFFILIATE_LINK },
                    ]]
                }
            }
        );
        return;
    }

    if (user.approval_status === 'rejected') {
        await ctx.reply('❌ Your access has been rejected. Contact the admin if this is a mistake.');
        return;
    }

    // Approved — build rich menu
    const ss  = getUserSessionStats(telegramId);
    const tier = normalizeTier(user.tier);
    const tierEmoji = tier === 'MASTER' ? '👑' : tier === 'PRO' ? '⚡' : '🧪';
    const pnlSign   = ss.pnl >= 0 ? '+' : '';

    const ssid = getSsidForUser(telegramId);
    const cached = ssid ? getUserBalanceCache(telegramId) : undefined;
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

    // Show active giveaway card if any
    const activeGiveaways = getActiveGiveaways();
    if (activeGiveaways.length > 0) {
        const giveaway = activeGiveaways[0];
        const prizeText = giveaway.prize_pool != null ? `\nPrize Pool: *$${giveaway.prize_pool.toFixed(2)}*` : '';
        const canParticipate = tier === 'PRO' || tier === 'MASTER';
        const giveawayCard = [
            `🎁 *LIVE GIVEAWAY*`,
            `*${giveaway.title}*`,
            prizeText,
            canParticipate ? `` : `\n🔒 Upgrade to PRO to participate`,
        ].filter(l => l !== '').join('\n');
        const giveawayMarkup = canParticipate
            ? { inline_keyboard: [[{ text: '🎯 Participate', callback_data: `giveaway:participate:${giveaway.id}` }]] }
            : { inline_keyboard: [[{ text: '⚡ Upgrade to PRO', callback_data: 'ui:upgrade' }]] };
        await ctx.reply(giveawayCard, { parse_mode: 'Markdown', reply_markup: giveawayMarkup });
    }

    if (ssid) {
        const chatId = ctx.chat!.id;
        const msgId  = sentMsg.message_id;
        const userTier = user.tier ?? undefined;
        setImmediate(async () => {
            try {
                const sdk = await sdkPool.get(telegramId, ssid!);
                const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
                const demo = all.find(b => b.type === BalanceType.Demo);
                const real = all.find(b => b.type === BalanceType.Real);
                if (real?.currency) saveUserCurrency(telegramId, real.currency);
                else if (demo?.currency) saveUserCurrency(telegramId, demo.currency);
                // Auto-promote tier based on live balance (converted to USD)
                if (real && user.tier !== 'MASTER') {
                    const currency = real.currency ?? 'USD';
                    const usdAmount = await convertToUsd(real.amount, currency, sdk);
                    const newTier = autoPromoteTier(telegramId, usdAmount, user.tier ?? 'DEMO');
                    if (newTier && newTier !== user.tier) {
                        const oldTier = user.tier;
                        setUserTier(telegramId, newTier);
                        user.tier = newTier;
                        if (oldTier === 'DEMO') insertFunnelEvent('user_funded', JSON.stringify({ telegram_id: telegramId }));
                        logger.info('bot', `auto-promoted user ${telegramId} from ${oldTier} to ${newTier} (balance: ${currency} ${real.amount.toFixed(2)} ≈ $${usdAmount.toFixed(2)})`);
                    }
                }
                if (needsFetch) {
                    const newLine = [
                        demo ? `Practice ${fmtBalance(demo)}` : '',
                        real ? `Real ${fmtBalance(real)}` : '',
                    ].filter(Boolean).join(' | ');
                    if (newLine) {
                        setUserBalanceCache(telegramId, newLine);
                        await ctx.telegram.editMessageText(chatId, msgId, undefined, buildMenu(newLine),
                            { reply_markup: startKeyboard(userTier) });
                    }
                }
            } catch (err) {
                if (isAuthExpiredError(err)) {
                    const reconnected = await autoReconnect(telegramId);
                    if (!reconnected) {
                        clearUserSsid(telegramId);
                        setSsidValid(telegramId, 0);
                        logger.warn('bot', `SSID cleared for user ${telegramId} due to auth failure: ${err instanceof Error ? err.message : err}`);
                    }
                }
            } finally {
                sdkPool.release(telegramId);
            }
        });
    }
}

// ─── Onboarding helpers ───────────────────────────────────────────────────────

async function askCreateAccountUserId(ctx: Context): Promise<void> {
    const escapedLink = AFFILIATE_LINK.replace(/_/g, '\\_');
    await ctx.reply(
        `👉 Create your IQ Option account\n` +
        `👉 Create your IQ Option Account: ${escapedLink}\n` +
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
    if (ctx.from!.id === getAdminId()) return true;
    const user = getUser(ctx.from!.id);
    if (!user || user.approval_status === 'pending') { await sendStartMenu(ctx); return false; }
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
    existingSdk?: ClientSdk,
    currency = 'USD',
): Promise<void> {
    const userId = ctx.from!.id;
    const effectiveRounds = martingaleRounds ?? getUserMartingaleSettings(userId).maxRounds;
    activeTradeSessions.set(userId, (activeTradeSessions.get(userId) ?? 0) + 1);
    try {
    const runId = crypto.randomUUID();
    const roundTimeoutMs = (timeframeSec + 90) * 1000 + 180_000;
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

    for (let round = 1; round <= effectiveRounds + 1; round++) {
        logLines.push(`⚡ Trade 1|🟡 ${fmtMoney(currentAmount, currency)} → in flight`);
        await syncLog();

        const roundTrade: TradeRequest = { pair, direction, amount: currentAmount, martingaleRunId: runId, timeframeSec, balanceType, telegramId: ctx.from!.id };

        let result: TradeResult;
        try {
            result = existingSdk
                ? await withTimeout(executeTradeWithSdk(existingSdk, roundTrade), roundTimeoutMs, 'trade')
                : await withTimeout(executeTrade(ssid, roundTrade), roundTimeoutMs, 'trade');
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error';
            logLines[logLines.length - 1] = `⚡ Trade 1|⚠️ ${fmtMoney(currentAmount, currency)} → error`;
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
            logLines[lastIdx] = `⚡ Trade 1|🟢 ${fmtMoney(currentAmount, currency)} → +${fmtMoney(result.pnl, currency)}`;
        } else if (result.status === 'LOSS') {
            logLines[lastIdx] = `⚡ Trade 1|🔴 ${fmtMoney(currentAmount, currency)} → -${fmtMoney(currentAmount, currency)}`;
        } else if (result.status === 'TIE') {
            logLines[lastIdx] = `⚡ Trade 1|⚪ ${fmtMoney(currentAmount, currency)} → ${fmtMoney(0, currency)}`;
        } else {
            logLines[lastIdx] = `⚡ Trade 1|⚠️ ${fmtMoney(currentAmount, currency)} → ${result.error ?? result.status}`;
        }
        await syncLog();

        // Update session stats on any settled trade
        // Capture pre-increment demo count before settling, then increment ONCE per trade sequence (not per martingale round)
        let demoPrevCount = 0;
        let demoCounted = false;
        if (balanceType === 'demo' && !demoCounted && (result.status === 'WIN' || result.status === 'LOSS' || result.status === 'TIE')) {
            demoPrevCount = getDailyDemoCount(ctx.from!.id);
            incrementDailyDemoCount(ctx.from!.id);
            demoCounted = true;
        }

        if (result.status === 'WIN' || result.status === 'LOSS' || result.status === 'TIE') {
            addUserSessionStats(ctx.from!.id, 1, roundPnl);
            giveawayRecordTrade(ctx.from!.id, round > 1);
        }
        if (result.status === 'WIN') {
            updateLeaderboardAuto(ctx.from!.id, result.pnl);
        }

        if (result.status === 'WIN' || result.status === 'TIE') {
            // Round 1 = direct win (L11a); round 2+ = comeback (L11b)
            await sendRoundImage(round === 1 ? 'L11a.png' : 'L11b.png');
            const winReply = await ctx.reply(
                `🏆 +${fmtMoney(result.pnl, currency)} added to your balance.\n\n` +
                (round > 1 ? `Recovery complete.\n\n` : '') +
                `💸 You just made +${fmtMoney(result.pnl, currency)}`,
                { reply_markup: { inline_keyboard: [[{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }]] } }
            );
            sentMessages.push(winReply.message_id);
            scheduleCleanup();
            if (balanceType === 'demo') {
                if (demoPrevCount === 0) {
                    await sendFirstTradeCongrats(ctx);
                }
                const newDailyCount = getDailyDemoCount(ctx.from!.id);
                const remaining = Math.max(0, 10 - newDailyCount);

                if (demoPrevCount > 0) {
                    const counterMsg = remaining > 0
                        ? `📊 Trade ${newDailyCount}/10 — ${remaining} demo trades remaining today`
                        : `📊 Trade 10/10 — Demo limit reached for today`;
                    await ctx.reply(counterMsg).catch(() => {});
                }

                if (demoPrevCount > 0 && newDailyCount < 10) {
                    await showDemoUpsell(ctx, sentMessages);
                }

                if (newDailyCount >= 10) {
                    await showDemoLimitReached(ctx);
                }
            }
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
        if (round <= effectiveRounds) {
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
    const absPnl = Math.abs(totalPnl);
    const pnlSign2 = totalPnl >= 0 ? '+' : '';
    await sendRoundImage('L11c.png');
    const lostReply = await ctx.reply(
        `Lost this one 💔! Remain confident! New setup loading 👾\n\nTotal: ${pnlSign2}${fmtMoney(absPnl, currency)}`,
        { reply_markup: { inline_keyboard: [[{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }]] } }
    );
    sentMessages.push(lostReply.message_id);
    scheduleCleanup();
    const mgPromoSettings = getUserMartingaleSettings(userId);
    if (!mgPromoSettings.enabled) {
        const promoImg = await ctx.replyWithPhoto(ASSET('recovery-promo.png')).catch(() => undefined);
        if (promoImg) sentMessages.push(promoImg.message_id);
        const promoText = await ctx.reply(
            `🏆 90% of trades recover and make more money using SMART RECOVERY 👾\n\nENABLE SMART RECOVERY 👇🔋`,
            { reply_markup: { inline_keyboard: [[{ text: 'Enable Smart Recovery', callback_data: 'martingale:6' }]] } }
        ).catch(() => undefined);
        if (promoText) sentMessages.push(promoText.message_id);
    }
    if (balanceType === 'demo') {
        if (getDailyDemoCount(ctx.from!.id) > 0) await showDemoUpsell(ctx, sentMessages);
    }
    } finally {
        const prev = activeTradeSessions.get(userId) ?? 0;
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

async function sendFirstTradeCongrats(ctx: Context): Promise<void> {
    const name = ctx.from?.first_name ?? 'there';
    await ctx.reply(
        `🎉 Congratulations ${name}! You just won your first trade.\n\n` +
        `This is just the beginning — you're now trading with the 10x Special Bot 💜`
    );
    await ctx.reply(
        `Use the commands below to make use of your 10x bot 👇\n\n` +
        `/start — Main menu\n` +
        `/help — Contact admin\n` +
        `/connect — Reconnect your IQ Option account\n` +
        `/balance — Check your balances\n` +
        `/tiers — View your account tier`
    );
    await sendStartMenu(ctx);
}

async function showDemoLimitReached(ctx: Context): Promise<void> {
    await ctx.reply(
        `🎯 Demo limit reached for today.\n\n` +
        `You've used all 10 demo trades. To keep winning:\n\n` +
        `👉 Fund your IQ Option account and go LIVE\n` +
        `👉 Live trades = real profits you can withdraw\n\n` +
        `⚡ Or wait until tomorrow for a fresh 10 demo trades.`,
        { reply_markup: {
            inline_keyboard: [
                [{ text: '💰 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786' }],
                [{ text: '📊 Check Balance', callback_data: 'ui:balance' }],
            ],
        }}
    );
}

// ─── /start ───────────────────────────────────────────────────────────────────

bot.command('start', sendStartMenu);

bot.command('refresh', async ctx => {
    const telegramId = ctx.from!.id;
    clearUserSsid(telegramId);
    setSsidValid(telegramId, 0);
    resetUser(telegramId);
    setOnboardingState(telegramId, '');
    await ctx.reply('🔄 Reset complete\\.\n\nUse /start to begin again\\.', { parse_mode: 'MarkdownV2' });
});

// ─── Account connection choice ────────────────────────────────────────────────

// ─── Old callback stubs — redirect cached keyboards to new onboarding ─────────

bot.action('onboard:yes', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    setOnboardingState(ctx.from!.id, 'awaiting_user_id');
    await ctx.reply("Bet. Let's link it up.\n\nDrop your IQ Option User ID 👇");
});

bot.action('onboard:no', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await sendStartMenu(ctx);
});

bot.action('onboard:autocreate', async ctx => {
    await ctx.answerCbQuery('Contact admin to create an account 👇💜', { show_alert: true }).catch(() => {});
});

// ─── Onboarding callbacks — all redirect to start menu ───────────────────────

bot.action('onboard:new',           async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendStartMenu(ctx); });
bot.action('onboard:experienced',   async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendStartMenu(ctx); });
bot.action('onboard:watched_video', async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendStartMenu(ctx); });
bot.action('onboard:have_account',  async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendStartMenu(ctx); });
bot.action('onboard:need_account',  async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendStartMenu(ctx); });

// ─── Trade wizard — mode ──────────────────────────────────────────────────────

bot.action(/^mode:(demo|live)$/, async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from!.id === getAdminId()) touchAdminActivity();
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'mode') return;
    const mode = ctx.match[1] as 'demo' | 'live';

    if (mode === 'demo') {
        const todayCount = getDailyDemoCount(ctx.from!.id);
        if (todayCount >= 10) {
            wizardSessions.delete(chatId);
            await showDemoLimitReached(ctx);
            return;
        }
    }

    state.mode = mode;
    state.step = 'currency';
    await ctx.reply('💰 Select your trading currency:', { reply_markup: currencyKeyboard() });
});

// ─── Trade wizard — currency ───────────────────────────────────────────────────

bot.action(/^cur:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'currency') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    await ctx.answerCbQuery();
    if (ctx.from!.id === getAdminId()) touchAdminActivity();
    state.currency = ctx.match[1];
    state.step = 'amount';
    if (state.lastImageMsgId) {
        try { await ctx.telegram.deleteMessage(ctx.chat!.id, state.lastImageMsgId); } catch {}
    }
    try { const m = await sendCachedAsset(ctx, 'L5.png'); state.lastImageMsgId = m?.message_id; } catch {}
    await ctx.reply('💰 Enter amount:', { reply_markup: amountKeyboard(state.currency) });
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
    if (ctx.from!.id === getAdminId()) touchAdminActivity();

    const val = ctx.match[1];
    if (val === 'custom') {
        state.step = 'custom_amount';
        const curUser = getUser(ctx.from!.id);
        const cur = curUser?.currency || 'USD';
        try { await ctx.editMessageText(`✏️ Enter your custom amount (e.g. 75 ${cur}):`); } catch {}
    } else {
        const amt = parseFloat(val);
        if (state.mode === 'demo') {
            const maxAmt = state.currency === 'NGN' ? 20000 : 20;
            if (amt > maxAmt) { await ctx.reply(`❌ Demo max is ${state.currency === 'NGN' ? '₦20,000' : '$20'} or equivalent.`); return; }
        }
        state.amount = amt;
        state.step = 'timeframe';
        if (state.lastImageMsgId) {
            try { await ctx.telegram.deleteMessage(ctx.chat!.id, state.lastImageMsgId); } catch {}
        }
        try { const m = await sendCachedAsset(ctx, 'L5.png'); state.lastImageMsgId = m?.message_id; } catch {}
        const isAdminAmt = ctx.from!.id === getAdminId();
        const tfBtnUser = isAdminAmt ? null : getUser(ctx.from!.id);
        const tfBtnTier = isAdminAmt ? 'MASTER' : tfBtnUser?.tier ?? undefined;
        try { await ctx.editMessageText(
            '⏱ Pick your expiry timeframe 👇\n⏱ Faster timeframes settle quicker.\n🐢 Longer timeframes ride bigger moves.',
            { reply_markup: timeframeKeyboard(tfBtnTier) }
        ); } catch {}
    }
});

// ─── Trade wizard — timeframe ─────────────────────────────────────────────────

bot.action(/^tf:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'timeframe') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    await ctx.answerCbQuery(); // stop spinner immediately before slow image upload
    if (ctx.from!.id === getAdminId()) touchAdminActivity();
    state.timeframe = parseInt(ctx.match[1], 10);
    state.step = 'pair';
    if (state.lastImageMsgId) {
        try { await ctx.telegram.deleteMessage(ctx.chat!.id, state.lastImageMsgId); } catch {}
    }
    try { const m = await sendCachedAsset(ctx, 'L6.png'); state.lastImageMsgId = m?.message_id; } catch {}
    const tfTier = ctx.from!.id === getAdminId() ? 'MASTER' : normalizeTier(getUser(chatId)?.tier);
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
    const pageTier = normalizeTier(pageUser?.tier);
    try { await ctx.editMessageReplyMarkup(pairKeyboard(parseInt(ctx.match[1], 10), pageTier)); } catch {}
});

// ─── Locked feature upgrade prompts ──────────────────────────────────────────

bot.action(/^upgrade:tf:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const tier = normalizeTier(getUser(ctx.from!.id)?.tier);
    const nextTier = tier === 'DEMO' ? 'PRO' : 'MASTER';
    const cost = nextTier === 'PRO' ? '$10' : '$50';
    const fundUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
    await ctx.reply(
        `🔒 *${ctx.match[1]}s Timeframe — ${nextTier} Tier Required*\n\n` +
        `Fund your account with at least ${cost} to automatically unlock this tier and faster trades.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `💰 Fund Account`, url: fundUrl }],
                    [{ text: `🔓 Upgrade with Token`, callback_data: 'ui:upgrade' }],
                    [{ text: '🔙 Back', callback_data: 'wizard:cancel' }],
                ],
            },
        }
    );
});

bot.action(/^upgrade:pair:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const tier = normalizeTier(getUser(ctx.from!.id)?.tier);
    const nextTier = tier === 'DEMO' ? 'PRO' : 'MASTER';
    const cost = nextTier === 'PRO' ? '$10' : '$50';
    const fundUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
    await ctx.reply(
        `🔒 *${ctx.match[1]} — ${nextTier} Tier Required*\n\n` +
        `Fund your account with at least ${cost} to automatically unlock more pairs.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `💰 Fund Account`, url: fundUrl }],
                    [{ text: `🔓 Upgrade with Token`, callback_data: 'ui:upgrade' }],
                    [{ text: '🔙 Back', callback_data: 'wizard:cancel' }],
                ],
            },
        }
    );
});

// ─── Trade wizard — pair selected → analyze → execute ────────────────────────

bot.action(/^pair:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    await ctx.answerCbQuery();
    if (ctx.from!.id === getAdminId()) touchAdminActivity();

    const pair = ctx.match[1];
    const { amount, timeframe, mode, currency, lastImageMsgId: prevImgId } = state;
    wizardSessions.delete(chatId);

    if (!amount || !timeframe) { await ctx.reply('❌ Session error — start over.'); return; }

    const useCur = currency || 'USD';

    const isAdmin = ctx.from!.id === getAdminId();
    const isPrivileged = isAdmin || ctx.from!.id === 6622587977;

    // Block demo trades at daily limit (non-admin/non-privileged only)
    if (!isPrivileged && mode === 'demo') {
        const dailyCount = getDailyDemoCount(ctx.from!.id);
        if (dailyCount >= 10) {
            await ctx.answerCbQuery('🎯 Demo limit reached. Fund to go live or wait until tomorrow.', { show_alert: true });
            await ctx.reply(
                `🎯 You've used all 10 demo trades for today.\n\n` +
                `Fund your account to go live and keep trading 👇`,
                { reply_markup: {
                    inline_keyboard: [
                        [{ text: '💰 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786' }],
                        [{ text: '📊 Check Balance', callback_data: 'ui:balance' }],
                    ],
                }}
            );
            return;
        }
    }

    const ssid = isAdmin ? getAdminSsid() : getSsidForUser(ctx.from!.id);
    if (!ssid) {
        await ctx.reply(isAdmin
            ? '⚠️ No trading account connected. Use /connect first.'
            : '❌ Not connected. Use /connect to link your IQ Option account.'
        );
        return;
    }

    // Clean up: delete the pair keyboard message and L6 image
    try { await ctx.deleteMessage(); } catch {}
    if (prevImgId) { try { await ctx.telegram.deleteMessage(chatId, prevImgId); } catch {} }

    // IDs of all pre-trade messages — passed to runMartingale for 1-hour cleanup
    const preTradeMessageIds: number[] = [];

    // Send L7 (analyzing radar) then a progress reply — user sees feedback immediately
    let l7MsgId: number | undefined;
    try { const m = await ctx.replyWithPhoto(ASSET('L7.png')); l7MsgId = m.message_id; } catch {}
    const progressMsg = await ctx.reply(
        `Selected: ${pair}\n\n🔌 Connecting to IQ Option...\n⏱ Usually instant if you traded recently`
    );
    preTradeMessageIds.push(progressMsg.message_id);

    let sdk: ClientSdk;
    try {
        sdk = isAdmin ? await createSdk(ssid) : await sdkPool.get(ctx.from!.id, ssid);
        await ctx.telegram.editMessageText(
            chatId, progressMsg.message_id, undefined,
            `✅ Connected! Analyzing market data for ${pair}...`
        ).catch(() => {});
    } catch (err: unknown) {
        if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
        await ctx.telegram.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
        if (await handlePossibleAuthExpiry(err, ctx, isAdmin)) return;
        if (!isAdmin && ctx.from?.id) {
            try { setSsidValid(ctx.from.id, 0); } catch {}
        }
        await ctx.reply(
            '🔌 Could not connect to IQ Option.\n\n' +
            'Your session may have expired. Reconnect in 3 steps:\n' +
            '1️⃣ Tap the 🔗 Reconnect button below\n' +
            '2️⃣ Enter your IQ Option email and password\n' +
            '3️⃣ Get back to trading instantly',
            { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
        ).catch(() => {});
        return;
    }

    let tradeStarted = false;
    try {
        // Tier validation — skip for admin (unrestricted access)
        if (!isPrivileged) {
            const analysisUser = getUser(ctx.from!.id);
            const analysisTier = normalizeTier(analysisUser?.tier);
            const tierCfg = getTierConfig(analysisTier);
            if (!tierCfg.allowedTimeframes.includes(timeframe)) {
                if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
                await ctx.telegram.editMessageText(
                    chatId, progressMsg.message_id, undefined,
                    `⚠️ ${tfLabel(timeframe)} is not available on the ${tierCfg.label} tier. Upgrade for access.`
                ).catch(() => {});
                return;
            }
            if (!tierCfg.pairs.includes(pair)) {
                if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
                await ctx.telegram.editMessageText(
                    chatId, progressMsg.message_id, undefined,
                    `⚠️ ${pair} is not available on the ${tierCfg.label} tier. Upgrade for access.`
                ).catch(() => {});
                return;
            }
        }

        ctx.telegram.sendChatAction(chatId, 'typing').catch(() => {});

        let analysis: AnalysisResult;
        const analysisTier = normalizeTier(getUser(ctx.from!.id)?.tier);
        if (isPrivileged || analysisTier === 'DEMO') {
            const candlesFacade = await sdk.candles();
            const turboOpts = await sdk.turboOptions();
            const norm = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');
            const normalizedPair = norm(pair);
            const active = turboOpts.getActives().find(
                a => norm(a.ticker) === normalizedPair || norm(a.localizationKey) === normalizedPair
            );
            if (!active) throw new Error(`Unknown pair: ${pair}`);
            const history = await candlesFacade.getCandles(active.id, timeframe, { count: 200 }) as AdminCandle[];
            if (history.length < 30) throw new Error('Not enough candle data');
            analysis = runAdminAnalysis(history);
        } else {
            try {
                analysis = await analyzePairWithSdk(sdk, pair, timeframe, analysisTier);
            } catch (err: unknown) {
                if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
                const errMsg = friendlyError(err, '⚠️ Could not analyze market. Please try again.');
                await ctx.telegram.editMessageText(chatId, progressMsg.message_id, undefined, errMsg)
                    .catch(() => ctx.reply(errMsg));
                return;
            }
        }

        // Replace progress message with completion note, then deliver results
        if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
        await ctx.telegram.editMessageText(
            chatId, progressMsg.message_id, undefined,
            `✅ Market scanned — signal found`
        ).catch(() => {});

        const l8 = await ctx.replyWithPhoto(ASSET('L8.png')).catch(() => undefined);
        if (l8) preTradeMessageIds.push(l8.message_id);
        const signalImg = analysis.direction === 'call' ? 'L9b.png' : 'L9a.png';
        const dirStr = analysis.direction === 'call' ? '🟢 CALL SIGNAL' : '🔴 PUT SIGNAL';
        const l9 = await ctx.replyWithPhoto(ASSET(signalImg)).catch(() => undefined);
        if (l9) preTradeMessageIds.push(l9.message_id);
        const opportunityMsg = await ctx.reply(
            `OPPORTUNITY FOUND\nConfidence: ${Math.round(analysis.confidence)}% · Bot is ready to execute.\n\n${dirStr}\n\n` +
            `🔷 Trading pair: ${pair}\n🔷 Amount: ${fmtMoney(amount, useCur)} ${useCur}\n` +
            `🔷 Expiration: ${tfLabel(timeframe)}\n🔷 Strategy: High-Profit ⚡`
        ).catch(() => undefined);
        if (opportunityMsg) preTradeMessageIds.push(opportunityMsg.message_id);

        const maxConcurrent = isPrivileged ? 999 : getTierConfig(normalizeTier(getUser(ctx.from!.id)?.tier)).maxConcurrentTrades;
        const currentCount = activeTradeSessions.get(ctx.from!.id) ?? 0;
        if (currentCount >= maxConcurrent) {
            const tradeCfg = getTierConfig(normalizeTier(getUser(ctx.from!.id)?.tier));
            await ctx.reply(
                maxConcurrent === 1
                    ? `⚠️ You already have an active trade. ${tradeCfg.label} allows 1 trade at a time. Upgrade for more concurrent trades.`
                    : `⚠️ You already have ${currentCount} active trade(s). Max ${maxConcurrent} concurrent trades reached. Wait for one to finish.`
            );
            return;
        }

        // Fire trade in background — don't block the update pipeline.
        const mgSettings = getUserMartingaleSettings(ctx.from!.id);
        const martingaleRounds = mgSettings.enabled ? mgSettings.maxRounds : 1;
        logger.trade('executing', pair, ctx.from!.id, `$${amount} ${tfLabel(timeframe)} ${mode}`);
        const tradePromise = runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe, (mode ?? 'live') as 'demo' | 'live', martingaleRounds, preTradeMessageIds, sdk, useCur)
            .catch(err => {
                logger.error('trade', `Unhandled trade error: ${err instanceof Error ? err.message : String(err)}`);
            });
        tradeStarted = true;
        if (isAdmin) {
            tradePromise.finally(() => sdk.shutdown().catch(() => {}));
        } else {
            tradePromise.finally(() => sdkPool.release(ctx.from!.id));
        }
    } finally {
        // Release SDK on any early return. If trade was launched, tradePromise.finally() handles it.
        if (!tradeStarted) {
            if (isAdmin) sdk.shutdown().catch(() => {}); else sdkPool.release(ctx.from!.id);
        }
    }
});

// ─── Demo upsell ──────────────────────────────────────────────────────────────

bot.action('upsell:live', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const state: WizardState = { step: 'currency', mode: 'live' };
    wizardSessions.set(chatId, state);
    await ctx.reply('💰 Select your currency for Live trade:', { reply_markup: currencyKeyboard() });
});

bot.action('upsell:demo', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const state: WizardState = { step: 'currency', mode: 'demo' };
    wizardSessions.set(chatId, state);
    await ctx.reply('💰 Select your currency for Demo trade:', { reply_markup: currencyKeyboard() });
});

// ─── User menu actions ────────────────────────────────────────────────────────

bot.action('ui:start', async ctx => { await ctx.answerCbQuery(); await sendStartMenu(ctx); });

bot.action('ui:connect', async ctx => {
    await ctx.answerCbQuery();
    connectSessions.set(ctx.chat!.id, { step: 'email' });
    setOnboardingState(ctx.from!.id, 'awaiting_email');
    await ctx.reply('📧 Enter your IQ Option email:');
});

bot.action('ui:trade', async ctx => {
    await ctx.answerCbQuery();
    if (!await requireApproval(ctx)) return;

    const user = getUser(ctx.from!.id);
    const hasValidSsid = user?.ssid && user.ssid_valid !== 0;
    if (!hasValidSsid) {
        const isExpired = !!user?.ssid;
        const msg = isExpired
            ? '🔌 Your IQ Option session expired. Reconnect to continue trading 👇'
            : '⚠️ You need to connect your IQ Option account first.\nTap Connect below to get started 👇';
        const btnText = isExpired ? '🔗 Reconnect' : '🔗 Connect Account';
        await ctx.reply(msg, { reply_markup: { inline_keyboard: [[{ text: btnText, callback_data: 'ui:connect' }]] } });
        return;
    }

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
    const ss = getUserSessionStats(uid);
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
    connectSessions.delete(ctx.chat!.id);
    const fundUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
    await ctx.reply(
        `💡 *Tiers & Upgrade*\n\n` +
        `🧪 *DEMO* — Practice mode\\. Max 10 trades\\/day\\.\n` +
        `⚡ *PRO* — Live trading \\- Fund *\\$10\\+* into IQ Option\\.\n` +
        `👑 *MASTER* — Live trading \\- Fund *\\$50\\+* into IQ Option\\.\n\n` +
        `Your tier upgrades automatically once your balance hits the threshold\\.`,
        {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Fund Account', url: fundUrl }],
                    [{ text: '🔑 Enter Token', callback_data: 'ui:upgrade_token' }],
                    [{ text: '🔙 Back', callback_data: 'ui:start' }],
                ],
            },
        }
    );
});

bot.action('ui:upgrade_token', async ctx => {
    await ctx.answerCbQuery();
    upgradeSessions.add(ctx.chat!.id);
    await ctx.reply(
        `🔑 *Upgrade with Token*\n\n` +
        `Enter your upgrade token below to unlock *PRO* tier\\. ⚡\n\n` +
        `Don't have a token? Contact support\\.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👤 Contact Support', url: ADMIN_CONTACT_LINK }],
                    [{ text: '🔙 Back', callback_data: 'ui:upgrade' }],
                ],
            },
        }
    );
});

bot.action('ui:martingale_settings', async ctx => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const settings = getUserMartingaleSettings(userId);
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
        setUserMartingaleSettings(userId, false, 1);
        await ctx.editMessageText('⛔ Smart Recovery disabled. Trades will run a single round with no recovery.').catch(() => {});
    } else {
        const rounds = parseInt(val, 10);
        setUserMartingaleSettings(userId, true, rounds);
        await ctx.editMessageText(`✅ Smart Recovery set to ${rounds} rounds.`).catch(() => {});
    }
});

bot.action('ui:leaderboard', async ctx => {
    await ctx.answerCbQuery();
    const fab  = getAllFabricatedTraders();
    const real = getRealTraderLeaderboard();

    type LBEntry = { label: string; pnl: number };
    const combined: LBEntry[] = [
        ...fab.map(f => ({ label: `\`${f.display_name}\``, pnl: f.current_pnl })),
        ...real.map(r => ({ label: `\`${maskUserId(r.telegram_id)}\``, pnl: r.total_pnl })),
    ];
    combined.sort((a, b) => b.pnl - a.pnl);
    const top10 = combined.filter(e => e.pnl > 0).slice(0, 10);

    if (top10.length === 0) {
        await ctx.reply('🏆 *Today\'s Leaderboard*\n\nNo trades recorded yet today.', { parse_mode: 'Markdown', reply_markup: backKeyboard() });
        return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    let msg = '🏆 *Today\'s Top Traders*\n\n';
    top10.forEach((e, i) => {
        msg += `${medals[i] ?? `${i + 1}.`} ${e.label} — +$${e.pnl.toFixed(2)}\n`;
    });
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
});

bot.action('ui:help', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `❓ *Help & FAQ*\n\n` +
        `*📹 How to trade with 10x Bot*\\\n` +
        `[Watch video](https://youtu.be/b0s1lnZgqAI?si=bGWHTnsA7qIujtMc)\n\n` +
        `*📹 How to fund & withdraw*\\\n` +
        `[Watch video](https://youtu.be/b0s1lnZgqAI?si=bGWHTnsA7qIujtMc)\n\n` +
        `*Q: What is Smart Recovery?*\\\n` +
        `If a trade loses, the bot doubles the next stake to recover the loss\\. Up to 6 rounds\\.\n\n` +
        `*Q: Demo vs Live?*\\\n` +
        `Demo uses practice balance\\. Live uses your real IQ Option balance\\.\n\n` +
        `*Q: How do I withdraw?*\\\n` +
        `All funds stay in your IQ Option account — withdraw directly from there\\.\n\n` +
        `*Q: Why is my session expired?*\\\n` +
        `IQ Option sessions expire after inactivity\\. Use /connect to reconnect\\.\n\n` +
        `*Q: How do I upgrade my tier?*\\\n` +
        `Deposit \\$10\\+ for PRO or \\$50\\+ for MASTER\\. Your tier upgrades automatically\\.`,
        { parse_mode: 'MarkdownV2', reply_markup: backKeyboard() }
    );
});

bot.action('ui:support', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `🔋 *Support*\n\nContact admin for help:\n${ADMIN_CONTACT_LINK}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:giveaways', async ctx => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    const user = getUser(telegramId);
    const tier = normalizeTier(user?.tier);
    const canAct = tier === 'PRO' || tier === 'MASTER';
    const activeGiveaways = getActiveGiveaways();

    if (activeGiveaways.length === 0) {
        await ctx.reply(
            '🎁 *Giveaways & Promos*\n\nNo active events right now. Check back soon!',
            { parse_mode: 'Markdown', reply_markup: backKeyboard() }
        );
        return;
    }

    for (const g of activeGiveaways) {
        let header: string;
        let details: string;
        let btnText: string;
        let btnData: string;

        if (g.event_type === 'promo_code') {
            header = `🏷️ *PROMO CODE*`;
            details = [
                `*${g.title}*`,
                g.description ?? '',
                g.max_winners != null ? `${g.max_winners} claims available` : '',
            ].filter(Boolean).join('\n');
            btnText = '🎁 Claim Code';
            btnData = `promo:claim:${g.id}`;
        } else if (g.event_type === 'marathon') {
            const prizeText = g.prize_pool != null ? `Prize Pool: *$${g.prize_pool.toFixed(2)}*` : '';
            const endsText = g.ends_at ? `Ends: ${g.ends_at.split(' ')[0]}` : '';
            header = `🏃 *MARATHON*`;
            details = [
                `*${g.title}*`,
                g.description ?? '',
                prizeText,
                `Top ${g.max_winners} traders win`,
                endsText,
            ].filter(Boolean).join('\n');
            btnText = '🏃 Join Marathon';
            btnData = `giveaway:participate:${g.id}`;
        } else {
            const prizeText = g.prize_pool != null ? `Prize: *$${g.prize_pool.toFixed(2)}*` : '';
            header = `🎁 *GIVEAWAY*`;
            details = [
                `*${g.title}*`,
                g.description ?? '',
                prizeText,
            ].filter(Boolean).join('\n');
            btnText = '🎯 Participate';
            btnData = `giveaway:participate:${g.id}`;
        }

        const msg = `${header}\n\n${details}`;
        const markup = canAct
            ? { inline_keyboard: [[{ text: btnText, callback_data: btnData }], [{ text: '🔙 Back', callback_data: 'ui:start' }]] }
            : { inline_keyboard: [[{ text: '⚡ Upgrade to PRO', callback_data: 'ui:upgrade' }], [{ text: '🔙 Back', callback_data: 'ui:start' }]] };

        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: markup });
    }
});

// ─── Legacy commands (keep for power users) ───────────────────────────────────

bot.command('trade', async ctx => {
    const telegramId = ctx.from!.id;
    if (telegramId === getAdminId()) {
        const ssid = getAdminSsid();
        if (!ssid) {
            await ctx.reply(
                '⚠️ No IQ Option account connected.\nUse /connect to link your trading account.',
                { reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'admin:trade_connect' }]] } }
            );
            return;
        }
        wizardSessions.set(ctx.chat.id, { step: 'currency', mode: 'live' });
        await ctx.reply('💰 Select currency:', { reply_markup: currencyKeyboard() });
        return;
    }
    if (!await requireApproval(ctx)) return;

    const user = getUser(telegramId);
    const hasValidSsid = user?.ssid && user.ssid_valid !== 0;
    if (!hasValidSsid) {
        const isExpired = !!user?.ssid;
        const msg = isExpired
            ? '🔌 Your IQ Option session expired. Reconnect to continue trading 👇'
            : '⚠️ You need to connect your IQ Option account first.\nTap Connect below to get started 👇';
        const btnText = isExpired ? '🔗 Reconnect' : '🔗 Connect Account';
        await ctx.reply(msg, { reply_markup: { inline_keyboard: [[{ text: btnText, callback_data: 'ui:connect' }]] } });
        return;
    }

    const state: WizardState = { step: 'mode' };
    try { const m = await ctx.replyWithPhoto(ASSET('L4.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(ctx.chat.id, state);
    await ctx.reply('Trade live | Trade Demo', { reply_markup: tradeModeKeyboard() });
});

bot.action('admin:trade_connect', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from!.id !== getAdminId()) return;
    connectSessions.set(ctx.chat!.id, { step: 'admin_email' });
    await ctx.reply('👑 *Admin Trading Account*\n\nEnter your IQ Option email:', { parse_mode: 'Markdown' });
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
        const sdk = await sdkPool.get(uid, ssid);
        const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
        const demo = all.find(b => b.type === BalanceType.Demo);
        const real = all.find(b => b.type === BalanceType.Real);
        if (real?.currency) saveUserCurrency(uid, real.currency);
        else if (demo?.currency) saveUserCurrency(uid, demo.currency);
        // Auto-promote tier based on live balance (converted to USD)
        const user = getUser(uid);
        if (real && user && user.tier !== 'MASTER') {
            const currency = real.currency ?? 'USD';
            const usdAmount = await convertToUsd(real.amount, currency, sdk);
            const newTier = autoPromoteTier(uid, usdAmount, user.tier ?? 'DEMO');
            if (newTier && newTier !== user.tier) {
                const oldTier = user.tier;
                setUserTier(uid, newTier);
                if (oldTier === 'DEMO') insertFunnelEvent('user_funded', JSON.stringify({ telegram_id: uid }));
                logger.info('bot', `auto-promoted user ${uid} from ${oldTier} to ${newTier} via /balance (${currency} ${real.amount.toFixed(2)} ≈ $${usdAmount.toFixed(2)})`);
            }
        }
        let msg = '💰 *Balances*\n\n';
        if (demo) msg += `🎮 Practice: ${fmtBalance(demo)}\n`;
        if (real) msg += `💎 Live: ${fmtBalance(real)}\n`;
        if (!demo && !real) msg += 'No balances found.';
        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
    } catch (err: unknown) {
        if (isAuthExpiredError(err)) {
            const reconnected = await autoReconnect(uid);
            if (reconnected) {
                await ctx.reply('🔄 Session refreshed. Please try again.', { reply_markup: backKeyboard() });
            } else {
                clearUserSsid(uid);
                setSsidValid(uid, 0);
                logger.warn('bot', `SSID cleared for user ${uid} due to auth failure: ${err instanceof Error ? err.message : err}`);
                await ctx.reply('⚠️ Your IQ Option session has expired. Please reconnect using /connect.', { reply_markup: backKeyboard() });
            }
        } else {
            const isTimeout = err instanceof Error && err.message.startsWith('SDK timeout');
            await ctx.reply(
                isTimeout ? '⚠️ IQ Option is taking too long. Try again in a moment.' : `❌ Balance fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                { reply_markup: backKeyboard() }
            );
        }
    } finally {
        sdkPool.release(uid);
    }
});

bot.command('status', async ctx => {
    const uid = ctx.from!.id;
    const user = getUser(uid);
    if (!user || user.approval_status !== 'approved') {
        await ctx.reply('🟢 *10x Bot Online*\n\nConnect your account to see full status.', { parse_mode: 'Markdown' });
        return;
    }
    const tier = normalizeTier(user.tier);
    const tierEmoji = tier === 'MASTER' ? '👑' : tier === 'PRO' ? '⚡' : '🧪';
    const ssid = getSsidForUser(uid);
    const stats = getTradeStats(uid);
    const ss = getUserSessionStats(uid);
    const ssPnlSign = ss.pnl >= 0 ? '+' : '';
    const cached = getUserBalanceCache(uid);
    const balLine = (cached && Date.now() - cached.ts < BALANCE_CACHE_TTL)
        ? cached.line
        : 'Tap /balance to refresh';
    await ctx.reply(
        `🟢 *10x Bot Online*\n\n` +
        `Tier: ${tierEmoji} ${tier} Trader\n` +
        `IQ Option: ${ssid ? '✅ Connected' : '❌ Not connected'}\n` +
        `Balance: ${balLine}\n` +
        `Total Trades: ${stats.total} (${stats.wins}W / ${stats.losses}L)\n` +
        `Session PnL: ${ssPnlSign}$${Math.abs(ss.pnl).toFixed(2)}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.command('support', async ctx => {
    await ctx.reply(
        `🔋 *Support*\n\nNeed help? Contact the admin directly:`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '💬 Contact Support', url: ADMIN_CONTACT_LINK }],
                [{ text: '🔙 Back', callback_data: 'ui:start' }],
            ]},
        }
    );
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

    if (sub === 'migrate_states') {
        const result = db.prepare(`
            UPDATE users
            SET onboarding_state = 'awaiting_user_id'
            WHERE onboarding_state IN ('entry', 'entry_branch_sent', 'new_user_watch_video', 'returning_user_ask_account')
        `).run();
        await ctx.reply(`✅ Migrated ${result.changes} users to awaiting_user_id state.`);
        return;
    }

    await ctx.reply('Commands: /admin users | /admin approve <id> | /admin reject <id> | /admin stats | /admin migrate_states');
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

bot.action(/^token_tier:(DEMO|PRO|MASTER)$/, async ctx => {
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

// ─── Test Mode ────────────────────────────────────────────────────────────────

bot.action(/^admin:testmode:(on|off)$/, async ctx => {
    await ctx.answerCbQuery();
    const action = ctx.match[1];
    if (action === 'on') {
        setTestUser(6622587977);
        await ctx.reply('🔴 *Test mode ON*\n\nAll mass sends will go only to Shara (6622587977).', {
            parse_mode: 'Markdown',
            reply_markup: adminBackKeyboard(),
        });
    } else {
        setTestUser(null);
        await ctx.reply('🟢 *Test mode OFF*\n\nMass sends will go to the full audience.', {
            parse_mode: 'Markdown',
            reply_markup: adminBackKeyboard(),
        });
    }
});

// ─── Module 6: Broadcast ─────────────────────────────────────────────────────

bot.action('admin:broadcast', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('📢 *Broadcast* — Select target group:', { parse_mode: 'Markdown', reply_markup: broadcastTargetKeyboard() });
});

bot.action(/^broadcast:(all|funded|nonfunded|nonactivated|testuser)$/, async ctx => {
    await ctx.answerCbQuery();
    const target = ctx.match[1] as 'all' | 'funded' | 'nonfunded' | 'nonactivated' | 'testuser';
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_message', broadcastTarget: target });
    const labelMap: Record<string, string> = {
        all: 'All Users',
        funded: 'Funded users (PRO/MASTER)',
        nonfunded: 'Non-Funded users (connected, no deposit)',
        nonactivated: 'Non-Activated users',
        testuser: 'test user (Shara)',
    };
    await ctx.reply(`📝 Send your broadcast message for *${labelMap[target] ?? target}*:`, { parse_mode: 'Markdown' });
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

bot.action(/^broadcast_action:(trade|stats|history|leaderboard|menu|start)$/, async ctx => {
    await ctx.answerCbQuery();
    const key = ctx.match[1];
    const pending = pendingBroadcasts.get(ctx.chat!.id);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    if (key === 'start') {
        const botUsername = process.env.BOT_USERNAME ?? 'Shiloh10xbot';
        pendingBroadcasts.set(ctx.chat!.id, { ...pending, button: { text: '🚀 Start Bot', type: 'url', value: `https://t.me/${botUsername}?start=` } });
        await ctx.reply(`✅ Button set: *🚀 Start Bot*\n\n⏱ Auto-delete after?`, { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() });
    } else {
        const action = ACTION_MAP[key];
        if (!action) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
        pendingBroadcasts.set(ctx.chat!.id, { ...pending, button: { text: action.text, type: 'callback', value: action.value } });
        await ctx.reply(`✅ Button set: *${action.text}*\n\n⏱ Auto-delete after?`, { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() });
    }
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
    persistAndSchedule({
        message: pending.message,
        targetIds: pending.targetIds,
        button: pending.button,
        media: pending.media,
        deleteAfterMs: pending.deleteAfterMs ?? 0,
        scheduledAt,
    });
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
    try { deleteScheduledBroadcast(id); } catch (err) { console.error('[schedule] delete failed:', err); }
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
    const p = getFunnelPipeline();

    const pct = (num: number, den: number) =>
        den > 0 ? ((num / den) * 100).toFixed(1) : '0.0';

    const recentLines = p.recent_events.slice(0, 5).map(e =>
        `• ${e.event_type.replace(/_/g, ' ')}${e.source ? ` (${e.source.replace(/_/g, ' ')})` : ''} — ${e.created_at.slice(11, 16)}`
    ).join('\n');

    const msg = [
        `🔻 *Conversion Funnel*`,
        `🌐 Landing Page: ${url}`,
        ``,
        `*📈 Today*`,
        `👁️ Page Views: ${p.page_views_today}`,
        `📥 Channel Joins: ${p.channel_joins_today}`,
        `🔗 Connects: ${p.connects_today}`,
        `💰 Funded: ${p.funded_today}`,
        ``,
        `*📊 Conversion Rates*`,
        `Views → Joins: ${pct(p.channel_joins_today, p.page_views_today)}%`,
        `Joins → Connects: ${pct(p.connects_today, p.channel_joins_today)}%`,
        `Connects → Funded: ${pct(p.funded_today, p.connects_today)}%`,
        ``,
        `*📅 This Week*`,
        `👁️ Views: ${p.page_views_this_week}`,
        `📥 Joins: ${p.channel_joins_this_week}`,
        `🔗 Connects: ${p.connects_this_week}`,
        `💰 Funded: ${p.funded_this_week}`,
        ``,
        `*🕐 Recent Activity*`,
        recentLines || '— none yet',
    ].join('\n');

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

// ─── Module 11b: Giveaway V2 ─────────────────────────────────────────────────

bot.action('admin:giveaways', async ctx => {
    await ctx.answerCbQuery();
    const stats = getGiveawayStats();
    await ctx.reply(
        `🎁 *Giveaway Manager*\n\nActive: ${stats.active} | Scheduled: ${stats.scheduled} | Completed: ${stats.completed}`,
        { parse_mode: 'Markdown', reply_markup: giveawayManagerKeyboard(stats) }
    );
});

bot.action('giveaway_v2:create', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('🎁 *New Giveaway — Step 1*\n\nSelect the giveaway type:', {
        parse_mode: 'Markdown',
        reply_markup: giveawayTypeKeyboard(),
    });
});

bot.action(/^giveaway_type:(giveaway|promo_code|marathon)$/, async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const type = ctx.match[1] as 'giveaway' | 'promo_code' | 'marathon';
    if (type === 'giveaway') {
        adminSessions.set(chatId, { step: 'giveaway_v2_title', giveawayV2Type: 'giveaway' });
        await ctx.reply(`✅ Type: *Giveaway* (9-step)\n\nStep 2: Enter a *title*:`, { parse_mode: 'Markdown' });
    } else if (type === 'promo_code') {
        adminSessions.set(chatId, { step: 'promo_v2_title', giveawayV2Type: 'promo_code' });
        await ctx.reply(`✅ Type: *Promo Code* (5-step)\n\nStep 1: Enter a *title* (e.g. "150% BONUS CODE"):`, { parse_mode: 'Markdown' });
    } else {
        adminSessions.set(chatId, { step: 'marathon_v2_title', giveawayV2Type: 'marathon' });
        await ctx.reply(`✅ Type: *Marathon* (6-step)\n\nStep 1: Enter a *title* (e.g. "7-Day Trading Marathon"):`, { parse_mode: 'Markdown' });
    }
});

bot.action('giveaway_v2:active', async ctx => {
    await ctx.answerCbQuery();
    const giveaways = getGiveawayEvents('active');
    if (giveaways.length === 0) {
        await ctx.reply('📋 No active giveaways.', { reply_markup: adminBackKeyboard() });
        return;
    }
    await ctx.reply('📋 *Active Giveaways*', {
        parse_mode: 'Markdown',
        reply_markup: activeGiveawaysKeyboard(giveaways, 'view'),
    });
});

bot.action('giveaway_v2:scheduled', async ctx => {
    await ctx.answerCbQuery();
    const giveaways = getGiveawayEvents('pending');
    if (giveaways.length === 0) {
        await ctx.reply('📅 No scheduled giveaways.', { reply_markup: adminBackKeyboard() });
        return;
    }
    const lines = giveaways.map(g => `• *${g.title}* — starts: ${g.starts_at ?? 'now'}`).join('\n');
    await ctx.reply(`📅 *Scheduled Giveaways*\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

bot.action('giveaway_v2:pick_winners', async ctx => {
    await ctx.answerCbQuery();
    const giveaways = getGiveawayEvents('active');
    if (giveaways.length === 0) {
        await ctx.reply('📋 No active giveaways to pick winners from.', { reply_markup: adminBackKeyboard() });
        return;
    }
    await ctx.reply('🏆 *Pick Winners — Select a giveaway:*', {
        parse_mode: 'Markdown',
        reply_markup: activeGiveawaysKeyboard(giveaways, 'winners'),
    });
});

bot.action(/^giveaway_winners:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const giveawayId = parseInt(ctx.match[1], 10);
    const event = getGiveawayEvent(giveawayId);
    if (!event) { await ctx.reply('❌ Giveaway not found.', { reply_markup: adminBackKeyboard() }); return; }
    const { real, fabricated } = event.event_type === 'giveaway'
        ? getRealAndFabricatedCounts(giveawayId)
        : { real: getGiveawayParticipantCount(giveawayId), fabricated: 0 };
    const participantCount = event.event_type === 'giveaway' ? real + fabricated : real;
    if (participantCount === 0) {
        await ctx.reply('❌ No eligible participants found.', { reply_markup: giveawayViewKeyboard(event) });
        return;
    }
    await ctx.reply(
        `🏆 *Pick Winners?*\n\n` +
        `Giveaway: *${escapeMd(event.title)}*\n` +
        `Max winners: ${event.max_winners}\n` +
        `Participants: ${participantCount}\n\n` +
        `This will select up to ${event.max_winners} winner${event.max_winners !== 1 ? 's' : ''} and notify them\\.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `✅ Confirm — Pick ${event.max_winners} Winners`, callback_data: `giveaway_winners_confirm:${giveawayId}` }],
                    [{ text: '🔙 Cancel', callback_data: `giveaway_view:${giveawayId}` }],
                ],
            },
        }
    );
});

bot.action(/^giveaway_winners_confirm:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('🏆 Selecting winners…');
    const giveawayId = parseInt(ctx.match[1], 10);
    const event = getGiveawayEvent(giveawayId);
    if (event && event.status === 'completed') {
        await ctx.answerCbQuery('This giveaway already has winners.');
        await ctx.reply('❌ This giveaway already has winners selected.', { reply_markup: adminBackKeyboard() });
        return;
    }
    ctx.telegram.sendChatAction(ctx.chat!.id, 'typing').catch(() => {});
    const winners = giveawaySelectWinners(giveawayId);
    if (winners.length === 0) {
        await ctx.reply('❌ No eligible participants found.', { reply_markup: adminBackKeyboard() });
        return;
    }
    await ctx.reply(
        `✅ *${winners.length} winner${winners.length !== 1 ? 's' : ''} selected* for *${escapeMd(event?.title ?? 'giveaway')}*\\!\n\nWinner notifications queued\\. They will be notified shortly\\.`,
        { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
    );
});

bot.action(/^giveaway_end:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('⏹ Ending giveaway…');
    const giveawayId = parseInt(ctx.match[1], 10);
    setGiveawayStatus(giveawayId, 'completed');
    await ctx.reply(`✅ Giveaway #${giveawayId} ended.`, { reply_markup: adminBackKeyboard() });
});

bot.action(/^giveaway_delete:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('🗑️ Deleting…');
    const giveawayId = parseInt(ctx.match[1], 10);
    deleteGiveaway(giveawayId);
    await ctx.reply(`✅ Giveaway #${giveawayId} deleted.`, { reply_markup: adminBackKeyboard() });
});

bot.action(/^giveaway_participants:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const giveawayId = parseInt(ctx.match[1], 10);
    const participants = getGiveawayParticipants(giveawayId, false);
    if (participants.length === 0) {
        await ctx.reply('📭 No participants yet.', { reply_markup: adminBackKeyboard() });
        return;
    }
    const lines = participants.map((p, i) =>
        `${i + 1}. ${p.fabricated ? '🤖' : '👤'} ${p.telegram_id} — ${p.winner ? '🏆 Winner' : p.eligible ? '✅ Eligible' : '❌ Disqualified'}`
    );
    const chunks = [];
    for (let i = 0; i < lines.length; i += 50) chunks.push(lines.slice(i, i + 50));
    for (let c = 0; c < chunks.length; c++) {
        const header = c === 0 ? `👥 *Participants (${participants.length})*\n\n` : '';
        await ctx.reply(header + chunks[c].join('\n'), {
            parse_mode: 'Markdown',
            reply_markup: c === chunks.length - 1 ? adminBackKeyboard() : undefined,
        });
    }
});

bot.action(/^giveaway_view:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const giveawayId = parseInt(ctx.match[1], 10);
    const event = getGiveawayEvent(giveawayId);
    if (!event) { await ctx.reply('❌ Giveaway not found.', { reply_markup: adminBackKeyboard() }); return; }
    const { real, fabricated } = event.event_type === 'giveaway'
        ? getRealAndFabricatedCounts(giveawayId)
        : { real: getGiveawayParticipantCount(giveawayId), fabricated: 0 };
    const info = [
        `🎁 *${escapeMd(event.title)}*`,
        event.description ? escapeMd(event.description) : '',
        `Type: ${escapeMd(event.event_type)}`,
        `Status: ${escapeMd(event.status)}`,
        event.event_type === 'giveaway'
            ? `Participants: ${real + fabricated} total (${real} real | ${fabricated} system)`
            : `Participants: ${real}`,
        event.prize_pool != null ? `Prize Pool: $${event.prize_pool.toFixed(2)}` : '',
        `Max Winners: ${event.max_winners}`,
        event.criteria_type ? `Criteria: ${escapeMd(event.criteria_type)} = ${escapeMd(event.criteria_value ?? '')}` : '',
    ].filter(Boolean).join('\n');
    await ctx.reply(info, { parse_mode: 'Markdown', reply_markup: giveawayViewKeyboard(event) });
});

bot.action(/^giveaway_criteria:(none|new_user|min_balance|top_traders)$/, async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as || !as.giveawayV2Title) {
        await ctx.reply('❌ Session expired. Start over.', { reply_markup: adminBackKeyboard() });
        return;
    }
    const criteria = ctx.match[1];
    if (criteria === 'none') {
        adminSessions.set(chatId, { ...as, step: 'giveaway_v2_max_winners', giveawayV2CriteriaType: 'none' });
        await ctx.reply('✅ No criteria.\n\nStep 5: How many *winners*? (e.g. 3):', { parse_mode: 'Markdown' });
    } else {
        adminSessions.set(chatId, { ...as, step: 'giveaway_v2_criteria_value', giveawayV2CriteriaType: criteria });
        const hint = criteria === 'new_user' ? 'days (e.g. 7)' : criteria === 'min_balance' ? 'minimum $ amount (e.g. 20)' : 'number of trades (e.g. 10)';
        await ctx.reply(`✅ Criteria: *${criteria}*\n\nStep 4b: Enter the criteria value — ${hint}:`, { parse_mode: 'Markdown' });
    }
});

bot.action(/^giveaway_schedule:(now|\d+)$/, async ctx => {
    await ctx.answerCbQuery('⏳ Creating giveaway…');
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as || !as.giveawayV2Type || !as.giveawayV2Title || !as.giveawayV2MaxWinners) {
        await ctx.reply('❌ Session expired. Start over.', { reply_markup: adminBackKeyboard() });
        return;
    }
    adminSessions.delete(chatId);

    const scheduleArg = ctx.match[1];
    const startsAt = scheduleArg === 'now'
        ? null
        : new Date(Date.now() + parseInt(scheduleArg, 10) * 1000).toISOString().replace('T', ' ').split('.')[0];

    const input: GiveawayEventInput = {
        event_type: as.giveawayV2Type,
        title: as.giveawayV2Title,
        description: as.giveawayV2Desc,
        criteria_type: as.giveawayV2CriteriaType !== 'none' ? as.giveawayV2CriteriaType : undefined,
        criteria_value: as.giveawayV2CriteriaValue,
        prize_pool: as.giveawayV2Prize,
        max_winners: as.giveawayV2MaxWinners,
        starts_at: startsAt ?? undefined,
    };

    const giveawayId = createGiveawayEvent(input);

    if (scheduleArg === 'now') {
        await activateGiveaway(giveawayId);
        await ctx.reply(
            `✅ *Giveaway created and activated!*\n\nID: ${giveawayId}\nTitle: *${input.title}*\nWinners: ${input.max_winners}\n\nAnnouncement queued to all approved users.`,
            { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
        );
    } else {
        await ctx.reply(
            `✅ *Giveaway scheduled!*\n\nID: ${giveawayId}\nTitle: *${input.title}*\nStarts: ${startsAt}`,
            { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
        );
    }
});

// User participate handler
bot.action(/^giveaway:participate:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('⏳ Processing…');
    const telegramId = ctx.from!.id;
    const giveawayId = parseInt(ctx.match[1], 10);
    const result = await giveawayParticipate(giveawayId, telegramId);
    const event = getGiveawayEvent(giveawayId);
    const markup = event?.event_type === 'marathon' && result.success
        ? { inline_keyboard: [[{ text: '📊 Leaderboard', callback_data: `marathon:leaderboard:${giveawayId}` }]] }
        : result.replyMarkup;
    await ctx.reply(result.message, {
        parse_mode: 'Markdown',
        ...(markup ? { reply_markup: markup } : {}),
    });
});

bot.action(/^giveaway_activate:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('⏳ Activating…');
    const giveawayId = parseInt(ctx.match[1], 10);
    const event = getGiveawayEvent(giveawayId);
    if (!event) {
        await ctx.reply('❌ Giveaway not found.', { reply_markup: adminBackKeyboard() });
        return;
    }
    if (event.status !== 'pending') {
        await ctx.reply('❌ This giveaway is not in pending status.', { reply_markup: adminBackKeyboard() });
        return;
    }
    if (event.event_type === 'giveaway') await activateGiveaway(giveawayId);
    else if (event.event_type === 'promo_code') await activatePromoCode(giveawayId);
    else if (event.event_type === 'marathon') await activateMarathon(giveawayId);
    await ctx.reply(`✅ ${event.event_type} #${giveawayId} activated!`, { reply_markup: adminBackKeyboard() });
});

// Promo code schedule handler
bot.action(/^promo_schedule:(now|\d+)$/, async ctx => {
    await ctx.answerCbQuery('⏳ Creating promo code…');
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as || !as.promoV2Title || !as.promoV2Code) {
        await ctx.reply('❌ Session expired. Start over.', { reply_markup: adminBackKeyboard() });
        return;
    }
    adminSessions.delete(chatId);

    const scheduleArg = ctx.match[1];
    const startsAt = scheduleArg === 'now'
        ? undefined
        : new Date(Date.now() + parseInt(scheduleArg, 10) * 1000).toISOString().replace('T', ' ').split('.')[0];

    const input: GiveawayEventInput = {
        event_type: 'promo_code',
        title: as.promoV2Title,
        description: as.promoV2Desc,
        criteria_value: as.promoV2Code,
        max_winners: as.promoV2MaxClaims ?? 9999,
        starts_at: startsAt,
    };

    const promoId = createGiveawayEvent(input);

    if (scheduleArg === 'now') {
        await activatePromoCode(promoId);
        await ctx.reply(
            `✅ *Promo code created and activated!*\n\nID: ${promoId}\nTitle: *${input.title}*\nCode: \`${as.promoV2Code}\`${as.promoV2MaxClaims ? `\nMax claims: ${as.promoV2MaxClaims}` : ''}\n\nAnnouncement queued to all approved users.`,
            { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
        );
    } else {
        await ctx.reply(
            `✅ *Promo code scheduled!*\n\nID: ${promoId}\nTitle: *${input.title}*\nStarts: ${startsAt}`,
            { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
        );
    }
});

// Marathon duration selection handler
bot.action(/^marathon_duration:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as || !as.marathonV2Title) {
        await ctx.reply('❌ Session expired. Start over.', { reply_markup: adminBackKeyboard() });
        return;
    }
    const durationSec = parseInt(ctx.match[1], 10);
    const durationLabel = durationSec < 86400 ? `${durationSec / 3600}h`
        : durationSec === 86400 ? '24 hours'
        : durationSec === 259200 ? '3 days'
        : durationSec === 604800 ? '7 days'
        : '14 days';
    adminSessions.set(chatId, { ...as, step: 'marathon_v2_winners', marathonV2DurationSec: durationSec });
    await ctx.reply(`✅ Duration: *${durationLabel}*\n\nStep 4: How many *top winners*? (e.g. 10):`, { parse_mode: 'Markdown' });
});

// Marathon schedule handler
bot.action(/^marathon_schedule:(now|\d+)$/, async ctx => {
    await ctx.answerCbQuery('⏳ Creating marathon…');
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as || !as.marathonV2Title || !as.marathonV2Winners || !as.marathonV2DurationSec) {
        await ctx.reply('❌ Session expired. Start over.', { reply_markup: adminBackKeyboard() });
        return;
    }
    adminSessions.delete(chatId);

    const scheduleArg = ctx.match[1];
    const startMs = scheduleArg === 'now' ? Date.now() : Date.now() + parseInt(scheduleArg, 10) * 1000;
    const startsAt = scheduleArg === 'now'
        ? undefined
        : new Date(startMs).toISOString().replace('T', ' ').split('.')[0];
    const endsAt = new Date(startMs + as.marathonV2DurationSec * 1000).toISOString().replace('T', ' ').split('.')[0];

    const input: GiveawayEventInput = {
        event_type: 'marathon',
        title: as.marathonV2Title,
        description: as.marathonV2Desc,
        criteria_type: 'top_traders',
        max_winners: as.marathonV2Winners,
        prize_pool: as.marathonV2Prize,
        starts_at: startsAt,
        ends_at: endsAt,
    };

    const marathonId = createGiveawayEvent(input);

    if (scheduleArg === 'now') {
        await activateMarathon(marathonId);
        await ctx.reply(
            `✅ *Marathon created and started!*\n\nID: ${marathonId}\nTitle: *${input.title}*\nTop ${input.max_winners} winners\nEnds: ${endsAt}\n\nAnnouncement queued to all approved users.`,
            { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
        );
    } else {
        await ctx.reply(
            `✅ *Marathon scheduled!*\n\nID: ${marathonId}\nTitle: *${input.title}*\nStarts: ${startsAt}\nEnds: ${endsAt}`,
            { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
        );
    }
});

// Promo claim handler
bot.action(/^promo:claim:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('⏳ Claiming…');
    const telegramId = ctx.from!.id;
    const giveawayId = parseInt(ctx.match[1], 10);
    const result = await claimPromoCode(giveawayId, telegramId);
    await ctx.reply(result.message, {
        parse_mode: 'Markdown',
        ...(result.replyMarkup ? { reply_markup: result.replyMarkup } : {}),
    });
});

// Marathon leaderboard handler
bot.action(/^marathon:leaderboard:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    const giveawayId = parseInt(ctx.match[1], 10);
    const event = getGiveawayEvent(giveawayId);
    if (!event) { await ctx.reply('❌ Marathon not found.'); return; }

    const board = getMarathonLeaderboard(giveawayId);
    if (board.length === 0) {
        await ctx.reply(`🏃 *${event.title}*\n\nNo participants yet. Be the first to trade!`, { parse_mode: 'Markdown' });
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = board.slice(0, 10).map(e => {
        const medal = medals[e.rank - 1] ?? `${e.rank}.`;
        const trades = `${e.trade_count} trade${e.trade_count !== 1 ? 's' : ''}`;
        if (e.telegram_id === telegramId) {
            return `${medal} ${trades} ← you`;
        }
        // fabricated entries have display_name; real others get same-style mask from telegram_id
        const name = e.display_name ?? (() => {
            const id = String(e.telegram_id);
            return `${id.slice(0, 3)}***${id.slice(-3)}`;
        })();
        return `${medal} ${name} — ${trades}`;
    });

    const userRank = board.find(e => e.telegram_id === telegramId);
    let msg = `🏃 *${event.title} — Leaderboard*\n\n${lines.join('\n')}`;
    if (userRank && userRank.rank > 10) {
        msg += `\n\n📍 *Your rank: #${userRank.rank}* (${userRank.trade_count} trades)`;
    }
    if (!userRank) {
        msg += `\n\n💡 Join the marathon to compete!`;
    }
    if (event.ends_at) {
        const remaining = new Date(event.ends_at).getTime() - Date.now();
        if (remaining > 0) {
            const hours = Math.floor(remaining / 3_600_000);
            const mins = Math.floor((remaining % 3_600_000) / 60_000);
            msg += `\n\n⏱️ Ends in: ${hours}h ${mins}m — top ${event.max_winners} win`;
        }
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ─── Module 12: Compose Post (LLM-Powered) ───────────────────────────────────

bot.action('admin:compose', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('✍️ *Compose Motivational Post*\n\nChoose the post topic:', {
        parse_mode: 'Markdown',
        reply_markup: composeTopicKeyboard(),
    });
});

bot.action(/^compose_topic:(reviews|motivation|trade_win|life_win)$/, async ctx => {
    await ctx.answerCbQuery();
    const topic = ctx.match[1] as LlmRequest['topic'];
    adminSessions.set(ctx.chat!.id, { step: 'compose_description', composeTopic: topic });
    const hints: Record<string, string> = {
        reviews:    '"made $263 within 2 weeks of trading"',
        motivation: '"just hit 10 wins in a row"',
        trade_win:  '"turned $50 into $400 in one session"',
        life_win:   '"just bought his first car from profits"',
    };
    await ctx.reply(
        `✅ Topic: *${topic}*\n\nDescribe in ≤10 words:\ne.g. ${hints[topic] ?? '""'}`,
        { parse_mode: 'Markdown' }
    );
});

bot.action('compose:regenerate', async ctx => {
    await ctx.answerCbQuery('🔄 Regenerating…');
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as?.composeTopic || !as.composeDescription) {
        await ctx.reply('❌ Session expired. Start over.', { reply_markup: adminBackKeyboard() });
        return;
    }
    try {
        const loading = await ctx.reply('⏳ Generating with AI…');
        const result = await generatePost({ topic: as.composeTopic, description: as.composeDescription });
        await ctx.telegram.deleteMessage(chatId, loading.message_id).catch(() => {});
        adminSessions.set(chatId, { ...as, composeContent: result.content });
        await ctx.reply(
            `✍️ *Generated Post:*\n\n"${result.content}"`,
            { parse_mode: 'Markdown', reply_markup: composeResultKeyboard() }
        );
    } catch (err) {
        await ctx.reply(`❌ AI error: ${err instanceof Error ? err.message : 'unknown'}`, { reply_markup: adminBackKeyboard() });
    }
});

bot.action('compose:edit', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as?.composeTopic) {
        await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() });
        return;
    }
    adminSessions.set(chatId, { ...as, step: 'compose_description' });
    await ctx.reply('✏️ Enter a new description (≤10 words):');
});

bot.action('compose:manual', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'compose_manual' });
    await ctx.reply('✏️ Paste or type the text you want to send:');
});

bot.action('compose:approve', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as?.composeContent) {
        await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() });
        return;
    }
    adminSessions.set(chatId, { ...as, step: 'compose_image' });
    await ctx.reply('📎 Send an image to attach, or type *skip* to send text-only:', { parse_mode: 'Markdown' });
});

bot.action(/^compose_btn:(start|trade|fund|contact|none)$/, async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as?.composeContent) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    adminSessions.set(chatId, { ...as, composeCta: ctx.match[1] as AdminSessionState['composeCta'] });
    await ctx.reply('📤 *Send to:*', { parse_mode: 'Markdown', reply_markup: composeDeliveryKeyboard() });
});

bot.action(/^compose_delivery:(bot|channel|both)$/, async ctx => {
    await ctx.answerCbQuery('📤 Sending…');
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as?.composeContent) {
        await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() });
        return;
    }
    adminSessions.delete(chatId);

    const target = ctx.match[1] as 'bot' | 'channel' | 'both';
    const content = as.composeContent;
    const imageFileIds = as.composeImageFileIds ?? [];
    const CHANNEL_ID = process.env.CHANNEL_ID ?? '-1002766084283';

    let botSent = 0, botFailed = 0;
    let channelOk = false;
    let channelError = '';
    const fundUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
    const botUsername = process.env.BOT_USERNAME ?? '';
    const ctaBtnMap: Record<string, { text: string; callback_data?: string; url?: string }> = {
        start:   { text: '🚀 Start Bot', url: `https://t.me/${botUsername}?start=` },
        trade:   { text: '🎯 Trade Now', callback_data: 'ui:trade' },
        fund:    { text: '💰 Fund Account', url: fundUrl },
        contact: { text: '📞 Contact Admin', url: ADMIN_CONTACT_LINK },
    };
    const cta = as.composeCta;
    const ctaBtn = cta && cta !== 'none' ? ctaBtnMap[cta] : { text: '🚀 Trade Now', callback_data: 'ui:trade' };
    const replyMarkup = { inline_keyboard: [[ctaBtn as { text: string; callback_data: string }]] };

    const sendToUser = async (uid: number | string) => {
        if (imageFileIds.length > 1) {
            const media = imageFileIds.map((fid, i) => ({
                type: 'photo' as const,
                media: fid,
                ...(i === 0 ? { caption: content, parse_mode: 'Markdown' as const } : {}),
            }));
            await bot.telegram.sendMediaGroup(uid, media);
            await bot.telegram.sendMessage(uid, '📌', { reply_markup: replyMarkup });
        } else if (imageFileIds.length === 1) {
            await bot.telegram.sendPhoto(uid, imageFileIds[0], { caption: content, reply_markup: replyMarkup });
        } else {
            await bot.telegram.sendMessage(uid, content, { reply_markup: replyMarkup });
        }
    };

    if (target === 'bot' || target === 'both') {
        const allIds = getAllUserIds();
        for (const uid of allIds) {
            try { await sendToUser(uid); botSent++; } catch { botFailed++; }
            await new Promise(r => setTimeout(r, 40));
        }
    }

    if (target === 'channel' || target === 'both') {
        try {
            await sendToUser(CHANNEL_ID);
            channelOk = true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            channelError = msg;
            console.error('[compose] channel send failed:', msg);
            try {
                const me = await bot.telegram.getMe();
                const member = await bot.telegram.getChatMember(CHANNEL_ID, me.id);
                console.error(`[compose] bot status in channel: ${member.status}, can_post_messages: ${(member as any).can_post_messages ?? 'n/a'}`);
            } catch (diagErr) {
                console.error('[compose] could not diagnose channel permissions:', diagErr instanceof Error ? diagErr.message : diagErr);
            }
        }
    }

    insertBroadcastMessage('approved', content, as.composeTopic, imageFileIds[0] ?? null);

    let summary: string;
    if (target === 'channel') {
        summary = channelOk
            ? `✅ Post sent to channel.`
            : `❌ Channel send failed: ${channelError}\n\nMake sure the bot is an admin in the channel with *can\\_post\\_messages* enabled.`;
    } else if (target === 'both') {
        const channelStatus = channelOk ? ' + channel ✅' : ` + channel ❌ (${channelError})`;
        summary = `✅ Sent to *${botSent}* users (${botFailed} failed)${channelStatus}`;
    } else {
        summary = `✅ Sent to *${botSent}* users (${botFailed} failed).`;
    }

    await ctx.reply(summary, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

// ─── Module 13: Compose Tone Settings ────────────────────────────────────────

bot.action('admin:compose_tone', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('🎭 *Tone Settings*\n\nTrain the AI to match your voice.', {
        parse_mode: 'Markdown',
        reply_markup: composeToneKeyboard(),
    });
});

bot.action('compose_tone:guide', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'compose_tone_guide' });
    await ctx.reply('📝 Enter your style guide (e.g. "Streetwise, aggressive, use slang, short punchy sentences"):');
});

bot.action('compose_tone:sample1', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'compose_tone_sample1' });
    await ctx.reply('📄 Paste *Sample Post 1* — an example in the exact voice you want:', { parse_mode: 'Markdown' });
});

bot.action('compose_tone:sample2', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'compose_tone_sample2' });
    await ctx.reply('📄 Paste *Sample Post 2* — another example in your voice:', { parse_mode: 'Markdown' });
});

bot.action('compose_tone:sample3', async ctx => {
    await ctx.answerCbQuery();
    adminSessions.set(ctx.chat!.id, { step: 'compose_tone_sample3' });
    await ctx.reply('📄 Paste *Sample Post 3* — one more example:', { parse_mode: 'Markdown' });
});

bot.action('compose_tone:view', async ctx => {
    await ctx.answerCbQuery();
    const tone = getComposeTone();
    const truncate = (s: string, n = 200) => s.length > n ? s.slice(0, n) + '…' : s;
    let msg = '🎭 *Current Tone Profile*\n\n';
    msg += tone.styleGuide ? `*Style Guide:*\n${truncate(tone.styleGuide)}\n\n` : '*Style Guide:* _(not set)_\n\n';
    msg += tone.sample1   ? `*Sample 1:*\n${truncate(tone.sample1)}\n\n` : '*Sample 1:* _(not set)_\n\n';
    msg += tone.sample2   ? `*Sample 2:*\n${truncate(tone.sample2)}\n\n` : '*Sample 2:* _(not set)_\n\n';
    msg += tone.sample3   ? `*Sample 3:*\n${truncate(tone.sample3)}` : '*Sample 3:* _(not set)_';
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: composeToneKeyboard() });
});

// ─── Admin Diary ──────────────────────────────────────────────────────────────

bot.action('admin:diary', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from?.id !== getAdminId()) return;
    await ctx.reply(
        '📔 *Admin Diary*\n\nWhat would you like to generate?',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎁 Giveaway',    callback_data: 'diary:giveaway' }],
                    [{ text: '⭐ Review',       callback_data: 'diary:review' }],
                    [{ text: '📝 Post',         callback_data: 'diary:post' }],
                    [{ text: '🎙️ Live Topics', callback_data: 'diary:live_topics' }],
                    [{ text: '📊 Market Pulse', callback_data: 'diary:market_pulse' }],
                    [{ text: '🔙 Back',         callback_data: 'admin:back' }],
                ],
            },
        },
    );
});

bot.action('diary:giveaway', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from?.id !== getAdminId()) return;
    const loading = await ctx.reply('⏳ Generating giveaway idea...');
    try {
        const result = await generateDiaryEntry('giveaway');
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(`🎁 *Giveaway Idea*\n\n${result.content}`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`);
    }
});

bot.action('diary:review', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from?.id !== getAdminId()) return;
    const loading = await ctx.reply('⏳ Generating client review...');
    try {
        const result = await generateDiaryEntry('review');
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(`⭐ *Client Review*\n\n${result.content}`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`);
    }
});

bot.action('diary:post', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from?.id !== getAdminId()) return;
    const loading = await ctx.reply('⏳ Generating post...');
    try {
        const result = await generateDiaryEntry('post');
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(`📝 *Post Idea*\n\n${result.content}`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`);
    }
});

bot.action('diary:live_topics', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from?.id !== getAdminId()) return;
    const loading = await ctx.reply('⏳ Generating live topics...');
    try {
        const result = await generateDiaryEntry('live_topics');
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(`🎙️ *Live Topics*\n\n${result.content}`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`);
    }
});

bot.action('diary:market_pulse', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from?.id !== getAdminId()) return;
    const loading = await ctx.reply('⏳ Analyzing market pulse...');
    try {
        const stats = getMarketPulseStats();
        const result = await generateDiaryEntry('market_pulse', stats);
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(`📊 *Market Pulse*\n\n${result.content}`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`);
    }
});

// ─── Go Live broadcast ────────────────────────────────────────────────────────

bot.action('admin:golive', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from?.id !== getAdminId()) return;

    const LIVE_MSG_APPROVED =
        `🟣 *10x Shiloh is LIVE right now!*\n\n` +
        `I'm trading live with 10x AI 💜\n\n` +
        `👇 Tap below to join`;

    const LIVE_MSG_PENDING =
        `🟣 *10x Shiloh is LIVE right now!*\n\nI'm trading live with 10x AI 💜\n\n` +
        `⏳ Your account is still being reviewed — but you can still watch the live session!\n\n👇 Tap below to join`;

    const LIVE_BTN = { inline_keyboard: [[{ text: '🔴 Join Live', url: 'https://t.me/+rPvBi_BnG5s5Zjg0' }]] };

    // Test mode: send only to test user
    const testUserId = getTestUserId();
    if (testUserId) {
        await bot.telegram.sendMessage(testUserId, LIVE_MSG_APPROVED, { parse_mode: 'Markdown', reply_markup: LIVE_BTN }).catch(() => {});
        await ctx.reply('🧪 Test mode: sent to test user only.', { reply_markup: adminBackKeyboard() });
        return;
    }

    const users = getAllUsers();
    const approved = users.filter(u => u.approval_status === 'approved');
    const pending  = users.filter(u => u.approval_status === 'pending' || u.approval_status === 'manual');

    let sent = 0; let failed = 0;
    for (const u of approved) {
        try {
            await bot.telegram.sendMessage(u.telegram_id, LIVE_MSG_APPROVED, { parse_mode: 'Markdown', reply_markup: LIVE_BTN });
            sent++;
        } catch { failed++; }
        if (sent % 30 === 0) await new Promise(r => setTimeout(r, 1_000));
    }
    for (const u of pending) {
        try {
            await bot.telegram.sendMessage(u.telegram_id, LIVE_MSG_PENDING, { parse_mode: 'Markdown', reply_markup: LIVE_BTN });
            sent++;
        } catch { failed++; }
        if (sent % 30 === 0) await new Promise(r => setTimeout(r, 1_000));
    }

    await ctx.reply(
        `🟢 Go Live broadcast sent.\n✅ Sent: ${sent} | ❌ Failed: ${failed}`,
        { reply_markup: adminBackKeyboard() }
    );
});

// ─── C1 Fix: admin:trade_connect ─────────────────────────────────────────────

bot.action('admin:trade_connect', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    connectSessions.set(chatId, { step: 'admin_email' });
    await ctx.reply('👑 *Admin Trading Account Setup*\n\nEnter your IQ Option email:', { parse_mode: 'Markdown' });
});

// ─── Module 14: SSID Health ───────────────────────────────────────────────────

bot.action('admin:ssid_health', async ctx => {
    await ctx.answerCbQuery();
    const all = getUsersWithSsid();
    const valid = all.filter(u => u.ssid_valid === 1).length;
    const expired = all.filter(u => u.ssid_valid === 0).length;
    const unknown = all.length - valid - expired;
    await ctx.reply(
        `🔑 *SSID Health*\n\n` +
        `Total with SSID: ${all.length}\n` +
        `✅ Valid: ${valid}\n` +
        `❌ Expired/Invalid: ${expired}\n` +
        `⏳ Unknown: ${unknown}\n\n` +
        `Tap below to re-prompt expired users.`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '🔔 Prompt Expired Users', callback_data: 'admin:ssid_expired' }],
                [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
            ]},
        }
    );
});

bot.action('admin:ssid_expired', async ctx => {
    await ctx.answerCbQuery();
    const due = getUsersDueForReconnectPrompt(0);
    if (due.length === 0) {
        await ctx.reply('✅ No users with expired SSIDs right now.', { reply_markup: adminBackKeyboard() });
        return;
    }
    let sent = 0;
    for (const user of due) {
        try {
            if (user.reconnect_prompt_msg_id) {
                try { await bot.telegram.deleteMessage(user.telegram_id, user.reconnect_prompt_msg_id); } catch {}
            }
            const m = await bot.telegram.sendMessage(
                user.telegram_id,
                '🔐 Your session expired.\n\nReconnect in 3 steps:\n1️⃣ Tap the 🔗 Reconnect button below\n2️⃣ Enter your IQ Option email and password\n3️⃣ Get back to trading instantly',
                { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
            );
            setReconnectPrompt(user.telegram_id, m.message_id);
            sent++;
        } catch { setReconnectPrompt(user.telegram_id, null); }
    }
    await ctx.reply(`✅ Sent reconnect prompts to *${sent}* user(s).`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

// ─── Module 15: Onboarding Funnel ────────────────────────────────────────────

bot.action('admin:onboarding_funnel', async ctx => {
    await ctx.answerCbQuery();
    const stats = getOnboardingFunnelStats();
    const dist = getTierDistribution();
    let msg = '👣 *Onboarding Funnel*\n\n';
    for (const [state, count] of Object.entries(stats)) {
        msg += `• ${state}: ${count}\n`;
    }
    msg += '\n*Tier Distribution:*\n';
    for (const row of dist) {
        msg += `• ${row.tier}: ${row.count} (${row.pct.toFixed(1)}%)\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

// ─── Module 16: LLM Template Browser ─────────────────────────────────────────

bot.action('admin:llm_templates', async ctx => {
    await ctx.answerCbQuery();
    const cats = getTemplateCategories();
    if (cats.length === 0) {
        await ctx.reply('No LLM templates seeded yet.', { reply_markup: adminBackKeyboard() });
        return;
    }
    await ctx.reply('🧠 *LLM Templates* — pick a category:', { parse_mode: 'Markdown', reply_markup: llmCategoryKeyboard(cats) });
});

bot.action(/^llm:cat:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const category = ctx.match[1];
    const templates = getTemplatesByCategory(category, 'brain');
    if (templates.length === 0) {
        await ctx.reply(`No templates for category *${category}*.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
        return;
    }
    let msg = `🧠 *${category}* — ${templates.length} template(s)\n\n`;
    for (const t of templates.slice(0, 10)) {
        msg += `• \`${t.key}\`\n  ${t.message.slice(0, 80)}…\n\n`;
    }
    if (templates.length > 10) msg += `_…and ${templates.length - 10} more_`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

// ─── Module 17: Broadcast History ────────────────────────────────────────────

bot.action('admin:broadcast_history', async ctx => {
    await ctx.answerCbQuery();
    const history = getRecentBroadcasts(10);
    if (history.length === 0) {
        await ctx.reply('📈 No broadcast history yet.', { reply_markup: adminBackKeyboard() });
        return;
    }
    let msg = '📈 *Recent Broadcasts* (last 10)\n\n';
    for (const row of history) {
        const date = new Date(row.created_at).toLocaleDateString();
        const preview = row.content.slice(0, 50);
        msg += `• [${date}] ${preview}…\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

// ─── Module 18: Media Library ─────────────────────────────────────────────────

bot.action('admin:media_library', async ctx => {
    await ctx.answerCbQuery();
    const keys = getAllSequenceMediaKeys();
    if (keys.length === 0) {
        await ctx.reply('📁 No sequence media uploaded yet.\n\nUpload a photo/video and it will be listed here.', { reply_markup: adminBackKeyboard() });
        return;
    }
    await ctx.reply('📁 *Media Library* — tap a key to update:', { parse_mode: 'Markdown', reply_markup: mediaLibraryKeyboard(keys) });
});

bot.action(/^media:select:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const templateKey = ctx.match[1];
    adminSessions.set(ctx.chat!.id, { step: 'media_upload', mediaLibraryKey: templateKey });
    await ctx.reply(`📎 Send a *photo* or *video* to assign to \`${templateKey}\`:\n\n(Or type /cancel to abort)`, { parse_mode: 'Markdown' });
});

// ─── Member filter / user detail / user actions ───────────────────────────────

bot.action(/^member:filter:(all|DEMO|PRO|MASTER)$/, async ctx => {
    await ctx.answerCbQuery();
    const filter = ctx.match[1];
    const all = getAllUsers();
    const filtered = filter === 'all' ? all : all.filter(u => (u.tier ?? 'DEMO').toUpperCase() === filter);
    if (filtered.length === 0) {
        await ctx.reply(`No ${filter} members found.`, { reply_markup: adminBackKeyboard() });
        return;
    }
    let msg = `👥 *Members — ${filter}* (${filtered.length})\n\n`;
    for (const u of filtered.slice(0, 20)) {
        const e = u.approval_status === 'approved' ? '✅' : u.approval_status === 'paused' ? '⏸️' : '❌';
        const name = u.username ? `@${u.username}` : maskUserId(u.telegram_id);
        msg += `${e} ${name} — ${(u.tier ?? 'DEMO').toUpperCase()}\n`;
    }
    if (filtered.length > 20) msg += `\n_…and ${filtered.length - 20} more_`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

bot.action(/^user_detail:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const uid = parseInt(ctx.match[1], 10);
    const u = getUser(uid);
    if (!u) { await ctx.reply('User not found.', { reply_markup: adminBackKeyboard() }); return; }
    const ts = getTradeStats(uid);
    const winRate = ts.total > 0 ? ((ts.wins / ts.total) * 100).toFixed(0) : '0';
    const ssidStatus = u.ssid_valid === 1 ? '✅' : u.ssid_valid === 0 ? '❌' : '⏳';
    let msg = `👤 *User Detail*\n\n`;
    msg += `Telegram: ${u.username ? `@${u.username}` : `\`${maskUserId(uid)}\``}\n`;
    if (u.iq_user_id) msg += `IQ User ID: \`${maskUserId(u.iq_user_id)}\`\n`;
    msg += `Status: ${u.approval_status} | Tier: ${(u.tier ?? 'DEMO').toUpperCase()}\n`;
    msg += `SSID: ${ssidStatus}\n`;
    msg += `Trades: ${ts.total} | Win rate: ${winRate}%\n`;
    if (u.onboarding_state) msg += `Onboarding: ${u.onboarding_state}\n`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: userDetailKeyboard(uid) });
});

bot.action(/^user_action:(approve|pause|reset_ssid|trades|message):(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const action = ctx.match[1];
    const uid = parseInt(ctx.match[2], 10);
    if (action === 'approve') {
        approveUser(uid);
        await ctx.reply(`✅ User \`${maskUserId(uid)}\` approved.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
        try { await bot.telegram.sendMessage(uid, '✅ Your account has been approved! Send /start to begin.'); } catch {}
    } else if (action === 'pause') {
        pauseUser(uid);
        await ctx.reply(`⏸️ User \`${maskUserId(uid)}\` paused.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
        try { await bot.telegram.sendMessage(uid, '⏸️ Your account has been temporarily paused.'); } catch {}
    } else if (action === 'reset_ssid') {
        clearUserSsid(uid);
        setSsidValid(uid, 0);
        await ctx.reply(`🔄 SSID cleared for \`${maskUserId(uid)}\`.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
    } else if (action === 'trades') {
        const ts = getTradeStats(uid);
        const recent = getRecentTrades(5, uid);
        let msg = `📊 *Trade Stats — ${maskUserId(uid)}*\n\nTotal: ${ts.total} | Wins: ${ts.wins} | Losses: ${ts.losses}\n\n*Recent:*\n`;
        for (const t of recent) {
            msg += `• ${t.status ?? '?'} ${t.pair} $${t.amount}\n`;
        }
        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
    } else if (action === 'message') {
        adminSessions.set(ctx.chat!.id, { step: 'member_message_text', memberMessageUserId: uid });
        await ctx.reply(`✉️ Enter message to send to user \`${maskUserId(uid)}\`:`, { parse_mode: 'Markdown' });
    }
});

// ─── /connect & /disconnect ───────────────────────────────────────────────────

bot.command('connect', async ctx => {
    upgradeSessions.delete(ctx.chat.id);
    onboardSessions.delete(ctx.chat.id);
    if (ctx.from!.id === getAdminId()) {
        connectSessions.set(ctx.chat.id, { step: 'admin_email' });
        await ctx.reply('👑 *Admin Trading Account*\n\nEnter your IQ Option email:', { parse_mode: 'Markdown' });
        return;
    }
    connectSessions.set(ctx.chat.id, { step: 'email' });
    await ctx.reply('📧 Enter your IQ Option email:');
});

bot.command('confirmed', async ctx => {
    const chatId = ctx.chat!.id;
    console.log(`[confirmed] user ${ctx.from!.id} started /confirmed flow`);
    if (!getUser(ctx.from!.id)) saveUser({ telegram_id: ctx.from!.id, ssid: '' });
    connectSessions.set(chatId, { step: 'confirmed_user_id' });
    await ctx.reply(
        '🟢 *You\'ve been pre-approved*\n\n' +
        'Step 1: Send your IQ Option User ID.\n' +
        '_(The number under your profile name in the IQ Option app)_',
        { parse_mode: 'Markdown' }
    );
});

bot.command('disconnect', async ctx => {
    if (ctx.from!.id === getAdminId()) {
        clearAdminSsid();
        connectSessions.delete(ctx.chat.id);
        await ctx.reply('✅ Admin trading account disconnected.');
        return;
    }
    deleteUser(ctx.from!.id);
    connectSessions.delete(ctx.chat.id);
    await ctx.reply('✅ Disconnected. Your IQ Option session has been removed.');
});

// ─── /pairs debug ─────────────────────────────────────────────────────────────

bot.command('pairs', async ctx => {
    const uid = ctx.from!.id;
    const ssid = getSsidForUser(uid);
    if (!ssid) { await ctx.reply('❌ Not connected. Use /connect first.'); return; }
    try {
        const sdk = await sdkPool.get(uid, ssid);
        const actives = (await withTimeout(sdk.turboOptions(), 60_000, 'pairs')).getActives();
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
    } finally {
        sdkPool.release(uid);
    }
});

bot.command('ping', ctx => ctx.reply('pong'));

bot.command('pidgin', async ctx => {
    const uid = ctx.from!.id;
    const user = getUser(uid);
    if (!user) return;
    const next = !user.pidgin_enabled;
    setUserPidginEnabled(uid, next);
    await ctx.reply(next
        ? '🇳🇬 Pidgin mode on! Messages go come for Pidgin English.'
        : '🌍 Pidgin mode off. Back to standard English.');
});

bot.command('giveaway', async ctx => {
    if (ctx.from?.id !== getAdminId()) return;
    adminSessions.set(ctx.chat.id, { step: 'giveaway_winners' });
    await ctx.reply('🎁 *Giveaway Setup*\n\nHow many winners? (e.g. 3):', { parse_mode: 'Markdown' });
});

bot.command('refresh', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from!.id;
    resetUser(userId);
    clearUserBalanceCache(userId);
    onboardSessions.delete(chatId);
    wizardSessions.delete(chatId);
    connectSessions.delete(chatId);
    adminSessions.delete(chatId);
    upgradeSessionsMap.delete(chatId);
    await sendStartMenu(ctx);
});

// ─── Broadcast media handlers ─────────────────────────────────────────────────

bot.on('photo', async ctx => {
    const topPhoto = ctx.message.photo.at(-1)!;
    console.log(`[photo] file_id=${topPhoto.file_id} from=${ctx.from?.id}`);
    if (ctx.from?.id !== getAdminId()) return;
    const chatId = ctx.chat.id;
    const as = adminSessions.get(chatId);
    if (!as) return;

    const photo = ctx.message.photo.at(-1)!;

    if (as.step === 'compose_image' && as.composeContent) {
        const existing = as.composeImageFileIds ?? [];
        const fileId = photo.file_id;
        if (!existing.includes(fileId)) existing.push(fileId);
        adminSessions.set(chatId, { ...as, composeImageFileIds: existing, step: 'compose_image' });
        const count = existing.length;
        await ctx.reply(
            `✅ Image ${count} attached${count > 1 ? ` (${count} total)` : ''}\\.\n` +
            `Send more images, or type *done* to continue, or *skip* for no images\\.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (as.step === 'media_upload' && as.mediaLibraryKey) {
        setSequenceMedia(as.mediaLibraryKey, 'photo', photo.file_id);
        adminSessions.delete(chatId);
        await ctx.reply(`✅ Photo saved for \`${as.mediaLibraryKey}\`.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
        return;
    }

    if (as.step !== 'broadcast_media') return;
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.'); return; }
    pendingBroadcasts.set(chatId, { ...pending, media: { type: 'photo', fileId: photo.file_id } });
    adminSessions.delete(chatId);
    await ctx.reply('📎 Image received! Include a link button?', { reply_markup: broadcastLinkKeyboard() });
});

bot.on('video', async ctx => {
    if (ctx.from?.id !== getAdminId()) return;
    const chatId = ctx.chat.id;
    const as = adminSessions.get(chatId);
    if (!as) return;

    if (as.step === 'media_upload' && as.mediaLibraryKey) {
        setSequenceMedia(as.mediaLibraryKey, 'video', ctx.message.video.file_id);
        adminSessions.delete(chatId);
        await ctx.reply(`✅ Video saved for \`${as.mediaLibraryKey}\`.`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
        return;
    }

    if (as.step !== 'broadcast_media') return;
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.'); return; }
    pendingBroadcasts.set(chatId, { ...pending, media: { type: 'video', fileId: ctx.message.video.file_id } });
    adminSessions.delete(chatId);
    await ctx.reply('📹 Video received! Include a link button?', { reply_markup: broadcastLinkKeyboard() });
});

// ─── User ID brain route (repeated failures) ──────────────────────────────────

async function handleUserIdBrainRoute(ctx: Context, telegramId: number, lastInput: string, failCount: number): Promise<void> {
    const brainCtx: UserContext = {
        onboarding_state: 'awaiting_user_id',
        ssid_valid: null,
        has_ssid: false,
        demo_trade_count: null,
        tier: 'DEMO',
        user_id_fail_count: failCount,
        is_activated: false,
    };
    try {
        // Bypass the SSID pre-check by calling classifyFlow directly — user has no SSID by definition here
        const brainResult = await getBrainFlow(telegramId, lastInput, brainCtx).catch(
            () => ({ flow: 'help_contact', message: '', shouldReply: true })
        );
        if (brainResult.shouldReply && brainResult.flow) {
            const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
            const replyText = brainResult.message || 'Having trouble? Contact admin for help 👇💜';
            const replyMarkup = typeof btn.action === 'string'
                ? { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] }
                : { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
            await ctx.reply(replyText, { reply_markup: replyMarkup });
        } else {
            await ctx.reply(
                "Still having trouble with your User ID? Let's get you sorted 💜\n\n👇 You can:",
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🆕 Create a new account', url: AFFILIATE_LINK }],
                            [{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }],
                            [{ text: '🔄 Try again', callback_data: 'ui:connect' }],
                        ],
                    },
                }
            );
        }
    } catch {
        await ctx.reply(
            'Having trouble connecting? Contact admin for help 👇💜',
            { reply_markup: { inline_keyboard: [[{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }]] } }
        );
    }
    setOnboardingState(telegramId, 'awaiting_user_id');
}

// ─── Text handler (all wizards) ───────────────────────────────────────────────

bot.on('text', async ctx => {
    if (ctx.message.text.startsWith('/')) return;
    const chatId = ctx.chat.id;
    const text   = ctx.message.text.trim();
    insertMessage(ctx.from!.id, 'incoming');

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
                    const byTelegram = getUser(byId);
                    const byIq = findUsersByIqUserId(byId);
                    found = [];
                    if (byTelegram) found.push(byTelegram);
                    for (const u of byIq) {
                        if (!found.find(f => f.telegram_id === u.telegram_id)) found.push(u);
                    }
                } else {
                    const cleanText = text.replace(/^@/, '').trim();
                    found = findUsersByUsername(cleanText);
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
                    if (target === 'all') targetIds = getAllUserIds();
                    else if (target === 'funded') targetIds = getFundedUserIds();
                    else if (target === 'nonfunded') targetIds = getNonFundedUserIds();
                    else if (target === 'nonactivated') targetIds = getNonActivatedUserIds();
                    else if (target === 'testuser') {
                        const tid = getTestUserId();
                        targetIds = tid ? [tid] : [];
                    }
                    else targetIds = [];

                    const segLabelMap: Record<string, string> = {
                        all: 'All Users',
                        funded: 'Funded (PRO/MASTER)',
                        nonfunded: 'Non-Funded (connected, no deposit)',
                        nonactivated: 'Non-Activated',
                        testuser: 'test user (Shara)',
                    };
                    const targetLabel = segLabelMap[target] ?? `${target} user(s)`;
                    pendingBroadcasts.set(chatId, { message: text, targetIds });
                    adminSessions.set(chatId, { ...as, step: 'broadcast_media' });
                    await ctx.reply(`📎 Send to *${targetIds.length}* ${targetLabel}.\n\nInclude an image or video? Send the file, or type "skip":`, { parse_mode: 'Markdown' });
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
                persistAndSchedule({
                    message: pending.message,
                    targetIds: pending.targetIds,
                    button: pending.button,
                    media: pending.media,
                    deleteAfterMs: pending.deleteAfterMs ?? 0,
                    scheduledAt,
                });
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

            // ── Promo Code wizard text steps ─────────────────────────────────
            if (as.step === 'promo_v2_title') {
                if (!text.trim()) { await ctx.reply('❌ Please enter a title:'); return; }
                adminSessions.set(chatId, { ...as, step: 'promo_v2_desc', promoV2Title: text.trim() });
                await ctx.reply(`✅ Title: *${text.trim()}*\n\nStep 2: Enter a *description* (or type \`skip\`):`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'promo_v2_desc') {
                const desc = text.trim().toLowerCase() === 'skip' ? undefined : text.trim();
                adminSessions.set(chatId, { ...as, step: 'promo_v2_code', promoV2Desc: desc });
                await ctx.reply(`✅ Description set.\n\nStep 3: Enter the *promo code* string (e.g. \`10xfirst\`):`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'promo_v2_code') {
                if (!text.trim()) { await ctx.reply('❌ Please enter the code:'); return; }
                adminSessions.set(chatId, { ...as, step: 'promo_v2_max_claims', promoV2Code: text.trim() });
                await ctx.reply(`✅ Code: \`${text.trim()}\`\n\nStep 4: Enter *max claims* (e.g. 50), or type \`unlimited\`:`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'promo_v2_max_claims') {
                const isUnlimited = text.trim().toLowerCase() === 'unlimited';
                const n = isUnlimited ? undefined : parseInt(text.trim(), 10);
                if (!isUnlimited && (isNaN(n!) || n! < 1)) { await ctx.reply('❌ Enter a number (e.g. 50) or type unlimited:'); return; }
                adminSessions.set(chatId, { ...as, promoV2MaxClaims: n });
                const claimsLabel = n != null ? `${n} max claims` : 'unlimited';
                await ctx.reply(
                    `✅ Claims: *${claimsLabel}*\n\nStep 5: When should it go live?`,
                    { parse_mode: 'Markdown', reply_markup: promoScheduleKeyboard() }
                );
                return;
            }

            // ── Marathon wizard text steps ────────────────────────────────────
            if (as.step === 'marathon_v2_title') {
                if (!text.trim()) { await ctx.reply('❌ Please enter a title:'); return; }
                adminSessions.set(chatId, { ...as, step: 'marathon_v2_desc', marathonV2Title: text.trim() });
                await ctx.reply(`✅ Title: *${text.trim()}*\n\nStep 2: Enter a *description* (or type \`skip\`):`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'marathon_v2_desc') {
                const desc = text.trim().toLowerCase() === 'skip' ? undefined : text.trim();
                adminSessions.set(chatId, { ...as, marathonV2Desc: desc, step: 'marathon_v2_winners' });
                await ctx.reply(`✅ Description set.\n\nStep 3: Select the *marathon duration*:`, {
                    parse_mode: 'Markdown',
                    reply_markup: marathonDurationKeyboard(),
                });
                return;
            }

            if (as.step === 'marathon_v2_winners') {
                const n = parseInt(text.trim(), 10);
                if (isNaN(n) || n < 1 || n > 100) { await ctx.reply('❌ Enter a number between 1 and 100:'); return; }
                adminSessions.set(chatId, { ...as, step: 'marathon_v2_prize', marathonV2Winners: n });
                await ctx.reply(`✅ *${n}* winner${n !== 1 ? 's' : ''}.\n\nStep 5: Enter the *total prize pool* in USD (e.g. 500), or \`0\` to skip:`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'marathon_v2_prize' && as.marathonV2Winners) {
                const prize = parseFloat(text.trim());
                if (isNaN(prize) || prize < 0) { await ctx.reply('❌ Enter a valid amount (e.g. 500) or 0:'); return; }
                const prizeVal = prize > 0 ? prize : undefined;
                adminSessions.set(chatId, { ...as, marathonV2Prize: prizeVal });
                const perWinner = prizeVal ? ` ($${(prizeVal / as.marathonV2Winners).toFixed(2)} per winner)` : '';
                await ctx.reply(
                    `✅ Prize pool: *${prizeVal ? `$${prizeVal.toFixed(2)}${perWinner}` : 'none'}*\n\nStep 6: When should the marathon start?`,
                    { parse_mode: 'Markdown', reply_markup: marathonScheduleKeyboard() }
                );
                return;
            }

            // ── Giveaway V2 wizard text steps ────────────────────────────────
            if (as.step === 'giveaway_v2_title') {
                if (!text.trim()) { await ctx.reply('❌ Please enter a title:'); return; }
                adminSessions.set(chatId, { ...as, step: 'giveaway_v2_desc', giveawayV2Title: text.trim() });
                await ctx.reply(`✅ Title: *${text.trim()}*\n\nStep 3: Enter a *description* (or type \`skip\`):`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'giveaway_v2_desc') {
                const desc = text.trim().toLowerCase() === 'skip' ? undefined : text.trim();
                adminSessions.set(chatId, { ...as, step: 'giveaway_v2_criteria_value', giveawayV2Desc: desc });
                await ctx.reply('Step 4: Select *eligibility criteria*:', {
                    parse_mode: 'Markdown',
                    reply_markup: giveawayCriteriaKeyboard(),
                });
                return;
            }

            if (as.step === 'giveaway_v2_criteria_value') {
                if (!text.trim()) { await ctx.reply('❌ Enter a value:'); return; }
                adminSessions.set(chatId, { ...as, step: 'giveaway_v2_max_winners', giveawayV2CriteriaValue: text.trim() });
                await ctx.reply(`✅ Criteria value: *${text.trim()}*\n\nStep 5: How many *winners*? (e.g. 3):`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'giveaway_v2_max_winners') {
                const n = parseInt(text, 10);
                if (isNaN(n) || n < 1 || n > 100) { await ctx.reply('❌ Enter a number between 1 and 100:'); return; }
                adminSessions.set(chatId, { ...as, step: 'giveaway_v2_prize', giveawayV2MaxWinners: n });
                await ctx.reply(`✅ *${n}* winner${n !== 1 ? 's' : ''}.\n\nStep 6: Enter the *total prize pool* in USD (e.g. 500), or \`0\` to skip:`, { parse_mode: 'Markdown' });
                return;
            }

            if (as.step === 'giveaway_v2_prize' && as.giveawayV2MaxWinners) {
                const prize = parseFloat(text);
                if (isNaN(prize) || prize < 0) { await ctx.reply('❌ Enter a valid amount (e.g. 500) or 0:'); return; }
                const prizeVal = prize > 0 ? prize : undefined;
                adminSessions.set(chatId, { ...as, giveawayV2Prize: prizeVal });
                const perWinner = prizeVal ? ` ($${(prizeVal / as.giveawayV2MaxWinners).toFixed(2)} per winner)` : '';
                await ctx.reply(
                    `✅ Prize pool: *${prizeVal ? `$${prizeVal.toFixed(2)}${perWinner}` : 'none'}*\n\nStep 7: When should it start?`,
                    { parse_mode: 'Markdown', reply_markup: giveawayScheduleKeyboard() }
                );
                return;
            }

            // ── Compose post wizard text steps ────────────────────────────────
            if (as.step === 'compose_manual') {
                if (!text.trim()) { await ctx.reply('❌ Please enter some text:'); return; }
                adminSessions.set(chatId, { ...as, composeContent: text, step: 'compose_image' });
                await ctx.reply(
                    `✍️ *Your text:*\n\n"${text}"\n\n📎 Send an image to attach, or type *skip* to send text-only:`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            if (as.step === 'compose_description' && as.composeTopic) {
                if (!text.trim()) { await ctx.reply('❌ Please enter a description:'); return; }
                const desc = text.trim();
                adminSessions.set(chatId, { ...as, composeDescription: desc });
                const loading = await ctx.reply('⏳ Generating with AI…');
                try {
                    const result = await generatePost({ topic: as.composeTopic, description: desc });
                    await ctx.telegram.deleteMessage(chatId, loading.message_id).catch(() => {});
                    adminSessions.set(chatId, { ...as, composeDescription: desc, composeContent: result.content });
                    await ctx.reply(
                        `✍️ *Generated Post:*\n\n"${result.content}"`,
                        { parse_mode: 'Markdown', reply_markup: composeResultKeyboard() }
                    );
                } catch (err) {
                    await ctx.telegram.deleteMessage(chatId, loading.message_id).catch(() => {});
                    await ctx.reply(`❌ AI error: ${err instanceof Error ? err.message : 'unknown'}`, { reply_markup: adminBackKeyboard() });
                }
                return;
            }

            if (as.step === 'compose_image' && as.composeContent) {
                const lower = text.toLowerCase();
                if (lower === 'skip') {
                    adminSessions.set(chatId, { ...as, composeImageFileIds: [], step: 'compose_cta' });
                    await ctx.reply('Add a CTA button?', { reply_markup: composeButtonKeyboard() });
                } else if (lower === 'done') {
                    adminSessions.set(chatId, { ...as, step: 'compose_cta' });
                    await ctx.reply('Add a CTA button?', { reply_markup: composeButtonKeyboard() });
                } else {
                    await ctx.reply('❌ Send photos, or type *done* when finished, or *skip* for no images:', { parse_mode: 'Markdown' });
                }
                return;
            }

            // ── Compose tone wizard text steps ────────────────────────────────
            if (as.step === 'compose_tone_guide') {
                if (!text.trim()) { await ctx.reply('❌ Please enter a style guide:'); return; }
                setComposeTone({ styleGuide: text.trim() });
                adminSessions.delete(chatId);
                await ctx.reply('✅ Style guide saved!', { reply_markup: composeToneKeyboard() });
                return;
            }

            if (as.step === 'compose_tone_sample1') {
                if (!text.trim()) { await ctx.reply('❌ Please paste a sample post:'); return; }
                setComposeTone({ sample1: text.trim() });
                adminSessions.delete(chatId);
                await ctx.reply('✅ Sample 1 saved!', { reply_markup: composeToneKeyboard() });
                return;
            }

            if (as.step === 'compose_tone_sample2') {
                if (!text.trim()) { await ctx.reply('❌ Please paste a sample post:'); return; }
                setComposeTone({ sample2: text.trim() });
                adminSessions.delete(chatId);
                await ctx.reply('✅ Sample 2 saved!', { reply_markup: composeToneKeyboard() });
                return;
            }

            if (as.step === 'compose_tone_sample3') {
                if (!text.trim()) { await ctx.reply('❌ Please paste a sample post:'); return; }
                setComposeTone({ sample3: text.trim() });
                adminSessions.delete(chatId);
                await ctx.reply('✅ Sample 3 saved!', { reply_markup: composeToneKeyboard() });
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
    if (upgradeSessions.has(chatId) && !connectSessions.get(chatId)) {
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

    // ── New onboarding state machine text handling ────────────────────────────
    const telegramUser = getUser(ctx.from!.id);
    const onboardingState = telegramUser?.onboarding_state;


    if (onboardingState === 'awaiting_user_id') {
        touchOnboardingActivity(ctx.from!.id);

        // Strip common prefixes (#) before checking
        const userIdText = text.trim().replace(/^#/, '');
        // If it doesn't look like a User ID, let the brain handle it
        if (!/^\d{5,}$/.test(userIdText)) {
            const brainUser = getUser(ctx.from!.id);
            const brainIsActivated = brainUser?.ssid_valid === 1 && !!brainUser?.ssid;
            const brainCtx: UserContext = {
                onboarding_state: 'awaiting_user_id',
                ssid_valid: brainUser?.ssid_valid ?? null,
                has_ssid: !!brainUser?.ssid,
                demo_trade_count: brainUser ? getDemoTradeCount(brainUser.telegram_id) : null,
                tier: brainUser?.tier ?? 'DEMO',
                is_activated: brainIsActivated,
                user_id_fail_count: getUserIdFailCount(ctx.from!.id),
            };
            const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(
                () => ({ flow: 'help_contact', message: '', shouldReply: true })
            );
            if (brainResult.shouldReply && brainResult.flow && brainResult.flow !== 'flow_sleep' && brainResult.flow !== 'flow_done') {
                const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
                const replyText = brainResult.message || btn.text;
                const replyMarkup = typeof btn.action === 'string'
                    ? { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] }
                    : { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
                await ctx.reply(replyText, { reply_markup: replyMarkup });
            }
            return;
        }

        const iqUserId = parseInt(userIdText, 10);
        upsertOnboardingUser(ctx.from!.id, iqUserId);
        try {
            const result = await withTimeout(checkAffiliate(iqUserId), 15_000, 'affiliate').catch(() => ({ found: false, data: null }));
            if (result.found) {
                resetUserIdFailCount(ctx.from!.id);
                approveUser(ctx.from!.id, result.data ? JSON.stringify(result.data) : undefined);
                await handleUserIdVerified(ctx, ctx.from!.id);
            } else {
                const failCount = incrementUserIdFailCount(ctx.from!.id);
                const adminId = getAdminId();
                if (adminId) {
                    notifyAdmin(
                        `⚠️ *User ID verification failed*\n\nUser: ${ctx.from!.id} (@${ctx.from!.username ?? 'no username'})\nAttempt: ${failCount}\nLast input: \`${text}\``
                    );
                }
                if (failCount >= 3) {
                    await ctx.reply(
                        '❌ *Couldn\'t verify your User ID*\\.\n\nContact admin for manual verification 👇\nThey\'ll help you get set up\\.',
                        { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }]] } }
                    );
                } else {
                    await handleUserIdFailed(ctx, ctx.from!.id, failCount);
                    setOnboardingState(ctx.from!.id, 'awaiting_user_id');
                }
            }
        } catch {
            const failCount = incrementUserIdFailCount(ctx.from!.id);
            const adminId = getAdminId();
            if (adminId) {
                notifyAdmin(
                    `⚠️ *User ID verification failed*\n\nUser: ${ctx.from!.id} (@${ctx.from!.username ?? 'no username'})\nAttempt: ${failCount}\nLast input: \`${text}\``
                );
            }
            if (failCount >= 3) {
                await ctx.reply(
                    '❌ *Couldn\'t verify your User ID*\\.\n\nContact admin for manual verification 👇\nThey\'ll help you get set up\\.',
                    { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }]] } }
                );
            } else {
                await handleUserIdFailed(ctx, ctx.from!.id, failCount);
                setOnboardingState(ctx.from!.id, 'awaiting_user_id');
            }
        }
        return;
    }

    if (onboardingState === 'awaiting_email') {
        touchOnboardingActivity(ctx.from!.id);
        connectSessions.delete(chatId);
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
        if (!emailOk) { await ctx.reply('That doesn\'t look like a valid email address. Try again 👇'); return; }
        // Store email in session for password step
        onboardSessions.set(chatId, { step: 'connect_email', email: text.trim() });
        await handleEmailCollected(ctx, ctx.from!.id);
        return;
    }

    if (onboardingState === 'awaiting_password') {
        touchOnboardingActivity(ctx.from!.id);
        const emailSession = onboardSessions.get(chatId);
        const email = emailSession?.email ?? telegramUser?.email;
        if (!email) {
            setOnboardingState(ctx.from!.id, 'awaiting_email');
            await ctx.reply('📧 Please enter your IQ Option email first:');
            return;
        }
        try { await ctx.deleteMessage(); } catch {}
        await ctx.reply('🔐 Logging in...');
        try {
            const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, text), 12_000, 'login');
            saveUser({ telegram_id: ctx.from!.id, ssid });
            saveUserCred(ctx.from!.id, Buffer.from(`${email}:${text}`).toString('base64'), email);
            setSsidValid(ctx.from!.id, 1);
            await clearReconnectPromptMessage(ctx.from!.id);
            let balanceText: string | undefined;
            try {
                const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
                const real = all.find(b => b.type === BalanceType.Real);
                const demo = all.find(b => b.type === BalanceType.Demo);
                if (real?.currency) saveUserCurrency(ctx.from!.id, real.currency);
                else if (demo?.currency) saveUserCurrency(ctx.from!.id, demo.currency);
                const parts: string[] = [];
                if (demo) parts.push(`🎮 Practice: ${fmtBalance(demo)}`);
                if (real) parts.push(`💎 Live: ${fmtBalance(real)}`);
                if (parts.length) balanceText = parts.join('\n');
            } finally {
                sdk.shutdown().catch(() => {});
            }
            onboardSessions.delete(chatId);
            insertFunnelEvent('user_connected', JSON.stringify({ telegram_id: ctx.from!.id }));
            await handleConnected(ctx, ctx.from!.id, balanceText);
        } catch (err) {
            const loginFails = ((onboardSessions.get(chatId) as any)?.loginFailCount ?? 0) + 1;
            onboardSessions.set(chatId, { step: 'connect_email', loginFailCount: loginFails } as any);
            if (loginFails >= 2) {
                setOnboardingState(ctx.from!.id, 'awaiting_email');
                onboardSessions.delete(chatId);
                const vf3 = getTemplateByKey('verify_fail_3');
                if (vf3) {
                    const markup3 = vf3.button_text && vf3.button_url
                        ? { reply_markup: { inline_keyboard: [[{ text: vf3.button_text, url: vf3.button_url }]] } }
                        : undefined;
                    await ctx.reply(vf3.message || 'Having trouble connecting? Contact admin for help 👇💜', markup3);
                } else {
                    await ctx.reply(
                        'Having trouble connecting? Contact admin for help 👇💜',
                        { reply_markup: { inline_keyboard: [[{ text: '👾 Contact admin', url: ADMIN_CONTACT_LINK }]] } }
                    );
                }
            } else {
                setOnboardingState(ctx.from!.id, 'awaiting_email');
                const errMsg = err instanceof Error ? err.message : 'Login failed';
                await ctx.reply(`❌ ${errMsg}\n\n📧 Enter your IQ Option email again:`);
            }
        }
        return;
    }

    // ── Standalone /connect wizard ────────────────────────────────────────────
    const conn = connectSessions.get(chatId);
    if (conn) {
        // /confirmed flow — collect User ID first
        if (conn.step === 'confirmed_user_id') {
            const userId = text.trim();
            if (!/^\d{6,12}$/.test(userId)) {
                const failCount = incrementUserIdFailCount(ctx.from!.id);
                const brainUser = getUser(ctx.from!.id);
                const brainCtx: UserContext = {
                    onboarding_state: 'awaiting_user_id',
                    ssid_valid: null,
                    has_ssid: false,
                    demo_trade_count: null,
                    tier: brainUser?.tier ?? 'DEMO',
                    is_activated: false,
                    user_id_fail_count: failCount,
                };
                const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(
                    () => ({ flow: 'help_contact', message: '', shouldReply: true })
                );
                if (brainResult.shouldReply && brainResult.flow && brainResult.flow !== 'flow_sleep' && brainResult.flow !== 'flow_done') {
                    const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
                    const replyText = brainResult.message || btn.text;
                    const replyMarkup = typeof btn.action === 'string'
                        ? { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] }
                        : { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
                    await ctx.reply(replyText, { reply_markup: replyMarkup });
                }
                return;
            }
            console.log(`[confirmed] user ${ctx.from!.id} submitted User ID: ${userId}`);
            conn.iqUserId = userId;
            conn.step = 'confirmed_email';
            saveUserIqUserId(ctx.from!.id, userId);
            connectSessions.set(chatId, conn);
            await ctx.reply('✅ User ID saved.\n\nStep 2: Enter your IQ Option email address.');
            return;
        }
        if (conn.step === 'confirmed_email') {
            console.log(`[confirmed] user ${ctx.from!.id} submitted email`);
            conn.email = text.trim();
            conn.step = 'confirmed_password';
            connectSessions.set(chatId, conn);
            await ctx.reply('Step 3: Enter your IQ Option password.');
            return;
        }
        if (conn.step === 'confirmed_password') {
            const email = conn.email!;
            connectSessions.delete(chatId);
            console.log(`[confirmed] user ${ctx.from!.id} attempting login`);
            await ctx.reply('🔐 Logging in...');
            try {
                const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, text), 15_000, 'login');
                saveUser({ telegram_id: ctx.from!.id, ssid });
                saveUserCred(ctx.from!.id, Buffer.from(`${email}:${text}`).toString('base64'), email);
                setSsidValid(ctx.from!.id, 1);
                await clearReconnectPromptMessage(ctx.from!.id);
                console.log(`[confirmed] user ${ctx.from!.id} login SUCCESS`);
                let msg = '✅ *Connected!*\n\n';
                try {
                    const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
                    const demo = all.find(b => b.type === BalanceType.Demo);
                    const real = all.find(b => b.type === BalanceType.Real);
                    if (real?.currency) saveUserCurrency(ctx.from!.id, real.currency);
                    else if (demo?.currency) saveUserCurrency(ctx.from!.id, demo.currency);
                    if (demo) msg += `🎮 Practice: ${fmtBalance(demo)}\n`;
                    if (real) msg += `💎 Live: ${fmtBalance(real)}\n`;
                } finally {
                    sdk.shutdown().catch(() => {});
                }
                await ctx.reply(msg, { parse_mode: 'Markdown' });
            } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : 'Unknown error';
                console.log(`[confirmed] user ${ctx.from!.id} login FAILED: ${errMsg}`);
                const isTimeout = err instanceof Error && err.message.startsWith('SDK timeout');
                await ctx.reply(isTimeout
                    ? '⚠️ IQ Option is taking too long. Please try again.'
                    : `❌ Connection failed: ${errMsg}`
                );
            }
            return;
        }
        // Admin connect flow
        if (conn.step === 'admin_email') {
            conn.email = text.trim();
            conn.step = 'admin_password';
            connectSessions.set(chatId, conn);
            await ctx.reply('🔑 Enter your IQ Option password:');
            return;
        }
        if (conn.step === 'admin_password' && conn.email) {
            connectSessions.delete(chatId);
            try { await ctx.deleteMessage(); } catch {}
            await ctx.reply('⏳ Logging in to IQ Option...');
            try {
                const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(conn.email, text.trim()), 15_000, 'admin_login');
                setAdminSsid(ssid);
                setConfig('admin_email', conn.email);
                setConfig('admin_cred', Buffer.from(`${conn.email}:${text.trim()}`).toString('base64'));
                let msg = '✅ *Admin trading account connected!*\n\n';
                try {
                    const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
                    const real = all.find(b => b.type === BalanceType.Real);
                    const demo = all.find(b => b.type === BalanceType.Demo);
                    if (real) msg += `💎 Live: ${fmtBalance(real)}\n`;
                    if (demo) msg += `🎮 Practice: ${fmtBalance(demo)}\n`;
                } finally {
                    sdk.shutdown().catch(() => {});
                }
                msg += `\nUse /trade to start trading with ultra-strict analysis.`;
                await ctx.reply(msg, { parse_mode: 'Markdown' });
            } catch (err) {
                await ctx.reply(`❌ Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
            return;
        }
        // Regular user connect flow
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
                saveUserCred(ctx.from!.id, Buffer.from(`${email}:${text}`).toString('base64'), email);
                setSsidValid(ctx.from!.id, 1);
                await clearReconnectPromptMessage(ctx.from!.id);
                let msg = '✅ *Connected!*\n\n';
                try {
                    const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
                    const demo = all.find(b => b.type === BalanceType.Demo);
                    const real = all.find(b => b.type === BalanceType.Real);
                    if (real?.currency) saveUserCurrency(ctx.from!.id, real.currency);
                    else if (demo?.currency) saveUserCurrency(ctx.from!.id, demo.currency);
                    if (demo) msg += `🎮 Practice: ${fmtBalance(demo)}\n`;
                    if (real) msg += `💎 Live: ${fmtBalance(real)}\n`;
                } finally {
                    sdk.shutdown().catch(() => {});
                }
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

    // ── LLM brain — all users ────────────────────────────────────────────────
    const user = getUser(ctx.from!.id);
    const state = user?.onboarding_state;
    let brainWiz = wizardSessions.get(chatId);
    const isActivated = user?.ssid_valid === 1 && !!user?.ssid;

    // Clear stale wizard sessions so brain can respond to text messages
    if (brainWiz && brainWiz.step !== 'custom_amount') {
        wizardSessions.delete(chatId);
        brainWiz = undefined;
    }
    // Non-numeric text to custom_amount step means user isn't entering an amount
    if (brainWiz && brainWiz.step === 'custom_amount' && isNaN(parseFloat(text))) {
        wizardSessions.delete(chatId);
        brainWiz = undefined;
    }

    if (!isActivated) {
        const count = (nonActivatedResponseCount.get(ctx.from!.id) ?? 0) + 1;
        nonActivatedResponseCount.set(ctx.from!.id, count);
        if (count > MAX_NON_ACTIVATED_RESPONSES) return;
    }

    if (!brainWiz) {
        const brainCtx: UserContext = {
            onboarding_state: state ?? null,
            ssid_valid: user?.ssid_valid ?? null,
            has_ssid: !!user?.ssid,
            demo_trade_count: user ? getDemoTradeCount(user.telegram_id) : null,
            tier: user?.tier ?? 'DEMO',
            is_activated: isActivated,
        };
        const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(
            () => ({ flow: 'go_home', message: '', shouldReply: false })
        );
        if (brainResult.flow === 'flow_sleep' || brainResult.flow === 'flow_done') return;
        if (brainResult.shouldReply && brainResult.flow) {
            if (!isActivated && !['link_account', 'verify_user_id', 'create_account'].includes(brainResult.flow)) {
                await ctx.reply(
                    "You're almost there! Let's get your account connected so you can start trading 💜\n\n👇 Tap below:",
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔗 Connect Account', callback_data: 'ui:connect' }],
                            ],
                        },
                    }
                );
                return;
            }
            const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
            const replyText = brainResult.message || btn.text;
            const replyMarkup = typeof btn.action === 'string'
                ? { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] }
                : { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
            await ctx.reply(replyText, { reply_markup: replyMarkup });
        }
        return;
    }

    if (!brainWiz || brainWiz.step !== 'custom_amount') return;

    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) { await ctx.reply('Please enter a valid positive number (e.g. 75).'); return; }
    if (brainWiz.mode === 'demo') {
        const maxAmt = brainWiz.currency === 'NGN' ? 20000 : 20;
        if (amount > maxAmt) { await ctx.reply(`❌ Demo max is ${brainWiz.currency === 'NGN' ? '₦20,000' : '$20'} or equivalent. Please enter a smaller amount.`); return; }
    }

    brainWiz.amount = amount;
    brainWiz.step = 'timeframe';
    if (brainWiz.lastImageMsgId) {
        try { await ctx.telegram.deleteMessage(chatId, brainWiz.lastImageMsgId); } catch {}
    }
    try { const m = await ctx.replyWithPhoto(ASSET('L5.png')); brainWiz.lastImageMsgId = m.message_id; } catch {}
    const isWizAdmin = ctx.from!.id === getAdminId();
    const tfWizUser = isWizAdmin ? null : getUser(ctx.from!.id);
    const tfWizTier = isWizAdmin ? 'MASTER' : (tfWizUser?.tier ?? undefined);
    await ctx.reply(
        '⏱ Pick your expiry timeframe 👇\n⏱ Faster timeframes settle quicker.\n🐢 Longer timeframes ride bigger moves.',
        { reply_markup: timeframeKeyboard(tfWizTier) }
    );
});

function isValidCallbackQuery(ctx: Context): boolean {
    if (!ctx.callbackQuery) return false;
    if (!ctx.callbackQuery.id) return false;
    if (!ctx.chat?.id) return false;
    return true;
}

bot.catch((err: unknown, ctx) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bot.catch] Update: ${ctx.updateType}, ChatID: ${ctx.chat?.id}, UserID: ${ctx.from?.id}, Message: ${msg}`);

    if (ctx.callbackQuery && msg.includes('query is too old')) {
        ctx.answerCbQuery('⏳ This button expired. Send /start to get a fresh menu.').catch(() => {});
        ctx.editMessageText(
            '⏳ This session expired.\n\nSend /start to continue.',
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Start Over', callback_data: 'ui:start' }]] } }
        ).catch(() => {});
        return;
    }

    if (ctx.callbackQuery && (msg.includes('Forbidden: bot can\'t initiate conversation') || msg.includes('403'))) {
        return;
    }

    if (ctx.callbackQuery && msg.includes('timed out')) {
        ctx.answerCbQuery('⏳ Request timed out. Please try again.').catch(() => {});
        ctx.reply(
            '⏳ *Request timed out*\n\nThis can happen under heavy load. Please try again.\n\nSend /start to restart.',
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 Start Over', callback_data: 'ui:start' }]] } }
        ).catch(() => {});
        if (ctx.from?.id) {
            wizardSessions.delete(ctx.chat!.id);
            const prev = activeTradeSessions.get(ctx.from.id) ?? 0;
            if (prev <= 1) activeTradeSessions.delete(ctx.from.id);
            else activeTradeSessions.set(ctx.from.id, prev - 1);
        }
        return;
    }

    if (ctx.callbackQuery) {
        ctx.answerCbQuery('❌ Something went wrong. Please try again or send /start.').catch(() => {});
        return;
    }

    ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
});

cleanStaleSessions();
rehydrateScheduledBroadcasts();
seedTemplates();

// Activate any giveaways/promos that were due during downtime
(async () => {
    const due = getPendingGiveawaysDue();
    for (const event of due) {
        console.log(`[scheduler] startup: activating ${event.event_type} #${event.id} "${event.title}" (due ${event.starts_at})`);
        if (event.event_type === 'giveaway') await activateGiveaway(event.id);
        else if (event.event_type === 'promo_code') await activatePromoCode(event.id);
        else if (event.event_type === 'marathon') await activateMarathon(event.id);
    }
    if (due.length > 0) console.log(`[scheduler] startup: activated ${due.length} overdue event(s)`);
})();

// ─── Funding 3-hour loop ──────────────────────────────────────────────────────

const FUNDING_TEMPLATES = [
    'funding_win_screenshot', 'funding_lifestyle_video', 'funding_testimonial',
    'funding_payout_proof', 'funding_lifestyle_photo', 'funding_user_result',
    'funding_user_result_video',
];
const PROMO_CODES = ['10xfirst', '10xsecond'];
const FUNDING_INTERVAL_MS = 3 * 60 * 60 * 1000;
const TRADE_COOLDOWN_MS   = 10 * 60 * 1000;

function isoNow(offsetMs = 0): string {
    return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').split('.')[0];
}

async function fireFundingCycle(bot: Telegraf): Promise<void> {
    if (getConfig('features_paused') === '1') return;
    const users = getDemoUsersWithTrades();
    const now = Date.now();
    for (const { telegram_id } of users) {
        try {
            const cycle = getFundingCycle(telegram_id);
            if (getUserSegment(telegram_id) !== 'non_funded') {
                upsertFundingCycle(telegram_id, cycle?.last_sent_at ?? null, cycle?.last_msg_id ?? null, isoNow(7 * 24 * 3_600_000));
                continue;
            }
            if (cycle?.next_run_at && new Date(cycle.next_run_at).getTime() > now) continue;

            const lastTrade = getLastTradeTime(telegram_id);
            if (lastTrade && (now - lastTrade.getTime()) < TRADE_COOLDOWN_MS) {
                upsertFundingCycle(telegram_id, cycle?.last_sent_at ?? null, cycle?.last_msg_id ?? null,
                    new Date(lastTrade.getTime() + TRADE_COOLDOWN_MS).toISOString().replace('T', ' ').split('.')[0]);
                continue;
            }

            const templateKey = FUNDING_TEMPLATES[Math.floor(Math.random() * FUNDING_TEMPLATES.length)];
            const template = getTemplateByKey(templateKey);
            if (!template) continue;

            const promo = PROMO_CODES[Math.floor(Math.random() * PROMO_CODES.length)];
            const msg = (template.message ?? '').replace(/10xfirst|10xsecond/g, promo);
            const btnMarkup = { inline_keyboard: [[{ text: template.button_text ?? '💎 Fund now', url: template.button_url ?? 'https://iqoption.com/pwa/payments/deposit' }]] };
            const fundMedia = getSequenceMedia(templateKey);

            if (cycle?.last_msg_id) {
                bot.telegram.deleteMessage(telegram_id, cycle.last_msg_id).catch(() => {});
            }

            let newMsgId: number | undefined;
            if (fundMedia?.file_id) {
                if (fundMedia.media_type === 'video') {
                    const m = await bot.telegram.sendVideo(telegram_id, fundMedia.file_id, { caption: msg, reply_markup: btnMarkup }).catch(() => undefined);
                    newMsgId = m?.message_id;
                } else {
                    const m = await bot.telegram.sendPhoto(telegram_id, fundMedia.file_id, { caption: msg, reply_markup: btnMarkup }).catch(() => undefined);
                    newMsgId = m?.message_id;
                }
            } else {
                const m = await bot.telegram.sendMessage(telegram_id, msg, { reply_markup: btnMarkup }).catch(() => undefined);
                newMsgId = m?.message_id;
            }

            if (newMsgId) {
                upsertFundingCycle(telegram_id, isoNow(), newMsgId, isoNow(FUNDING_INTERVAL_MS));
            }
        } catch (err) {
            console.error(`[funding] error for ${telegram_id}:`, err instanceof Error ? err.message : err);
        }
    }
}

function seedFundingCycle(): void {
    const users = getDemoUsersWithTrades();
    for (const { telegram_id } of users) {
        if (!getFundingCycle(telegram_id)) {
            upsertFundingCycle(telegram_id, null, null, isoNow(300_000));
        }
    }
}

function startFundingLoop(bot: Telegraf): void {
    const dueNow = getFundingCycleDueUsers();
    if (dueNow.length > 0) {
        console.log(`[funding] startup: ${dueNow.length} users due`);
        fireFundingCycle(bot);
    }
    setInterval(() => { fireFundingCycle(bot); }, 60_000);
}

// ─── Unified reconnect flow (1h cadence, DB-persistent) ──────────────────────

type ReconnectState = 'ssid_expired' | 'user_id_rejected' | 'login_failed' | 'onboarding_abandoned' | 'never_connected';
type ReconnectBtn = { text: string; callback_data: string } | { text: string; url: string };

function getReconnectMessage(state: ReconnectState): { text: string; button: ReconnectBtn } | null {
    switch (state) {
        case 'ssid_expired':
            return {
                text: '🟣 *Your session expired*\n\nNo panic. Just reconnect.\n\n1️⃣ Tap 🔗 Reconnect below\n2️⃣ Enter your email and password\n3️⃣ Back to winning 💜',
                button: { text: '🔗 Reconnect', callback_data: 'ui:connect' },
            };
        case 'user_id_rejected':
            return {
                text: '🟣 *We couldn\'t verify that User ID*\n\n✅ Make sure it\'s the number under your profile name in IQ Option\n✅ Copy and paste it — no spaces, no dashes\n\nTry again 👇',
                button: { text: '📝 Send User ID', callback_data: 'ui:start' },
            };
        case 'login_failed':
            return {
                text: '🟣 *Login didn\'t go through*\n\nDouble-check your IQ Option email and password.\n\n1️⃣ Tap 🔗 Connect below\n2️⃣ Enter the correct email and password\n3️⃣ We\'ll handle the rest',
                button: { text: '🔗 Connect', callback_data: 'ui:connect' },
            };
        case 'onboarding_abandoned':
            return {
                text: '🟣 *You didn\'t finish setting up*\n\nYour account is waiting. Takes 60 seconds.\n\n1️⃣ Tap ▶️ Continue below\n2️⃣ Pick up where you stopped',
                button: { text: '▶️ Continue', callback_data: 'ui:start' },
            };
        case 'never_connected':
            return {
                text: '🟣 *You\'re approved but not connected*\n\nLink your IQ Option account to start trading with 10x Bot 💜\n\n1️⃣ Tap 🔗 Connect below\n2️⃣ Enter your IQ Option email and password\n3️⃣ Let the bot work',
                button: { text: '🔗 Connect', callback_data: 'ui:connect' },
            };
        default:
            return null;
    }
}

async function fireReconnectCycle(bot: Telegraf): Promise<void> {
    if (getConfig('features_paused') === '1') return;
    const now = Date.now();
    const all: Array<{ telegram_id: number; state: ReconnectState }> = [
        ...getSsidExpiredUsers().map(u => ({ telegram_id: u.telegram_id, state: 'ssid_expired' as ReconnectState })),
        ...getUserIdRejectedUsers().map(u => ({ telegram_id: u.telegram_id, state: 'user_id_rejected' as ReconnectState })),
        ...getLoginFailedUsers().map(u => ({ telegram_id: u.telegram_id, state: 'login_failed' as ReconnectState })),
        ...getAbandonedOnboardingUsers().map(u => ({ telegram_id: u.telegram_id, state: 'onboarding_abandoned' as ReconnectState })),
        ...getNeverConnectedUsers().map(u => ({ telegram_id: u.telegram_id, state: 'never_connected' as ReconnectState })),
    ];
    const seen = new Set<number>();
    const unique = all.filter(u => { if (seen.has(u.telegram_id)) return false; seen.add(u.telegram_id); return true; });

    for (const { telegram_id, state } of unique) {
        try {
            const cycle = getReconnectCycle(telegram_id);
            if (getUserSegment(telegram_id) !== 'non_activated') {
                upsertReconnectCycle(telegram_id, cycle?.last_state ?? null, cycle?.last_msg_id ?? null, isoNow(7 * 24 * 3_600_000));
                continue;
            }
            if (cycle?.next_run_at && new Date(cycle.next_run_at).getTime() > now) continue;

            const msg = getReconnectMessage(state);
            if (!msg) continue;

            if (cycle?.last_msg_id) {
                bot.telegram.deleteMessage(telegram_id, cycle.last_msg_id).catch(() => {});
            }

            const sent = await bot.telegram.sendMessage(telegram_id, msg.text, {
                reply_markup: { inline_keyboard: [[msg.button]] },
                parse_mode: 'Markdown',
            }).catch(() => undefined);

            if (sent) {
                upsertReconnectCycle(telegram_id, state, sent.message_id, isoNow(3_600_000));
            }
        } catch (err) {
            console.error(`[reconnect] error for ${telegram_id}:`, err instanceof Error ? err.message : err);
        }
    }
}

function seedReconnectCycle(): void {
    const all = [
        ...getSsidExpiredUsers(),
        ...getUserIdRejectedUsers(),
        ...getLoginFailedUsers(),
        ...getAbandonedOnboardingUsers(),
        ...getNeverConnectedUsers(),
    ];
    const seen = new Set<number>();
    for (const { telegram_id } of all) {
        if (seen.has(telegram_id)) continue;
        seen.add(telegram_id);
        if (!getReconnectCycle(telegram_id)) {
            upsertReconnectCycle(telegram_id, null, null, isoNow(300_000));
        }
    }
}

function startReconnectLoop(bot: Telegraf): void {
    const dueNow = getReconnectCycleDueUsers();
    if (dueNow.length > 0) {
        console.log(`[reconnect] startup: ${dueNow.length} users due`);
        fireReconnectCycle(bot);
    }
    setInterval(() => { fireReconnectCycle(bot); }, 60_000);
}

// Wait 3s before launching to let any lingering polling connection from a
// previous instance time out and release its Telegram lock.
await new Promise(r => setTimeout(r, 3_000));

// Launch polling with auto-retry on 409 Conflict (duplicate getUpdates instance).
async function ensurePolling(): Promise<void> {
    const retryDelay = 5_000;
    while (true) {
        try {
            await bot.launch();
            break;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('409') || msg.includes('Conflict')) {
                console.warn(`[polling] 409 Conflict — retrying in ${retryDelay}ms`);
                await new Promise(r => setTimeout(r, retryDelay));
                continue;
            }
            throw err;
        }
    }
}
ensurePolling().catch(err => {
    console.error('[polling] Fatal error:', err);
    process.exit(1);
});
logger.info('bot', 'iqbot-v3 running');
recoverMissedTradeResults().catch(err => {
    console.error('[RECOVERY] Failed to recover missed trades:', err);
});
startAutoBroadcast(bot);
seedFundingCycle();
startFundingLoop(bot);
seedReconnectCycle();
startReconnectLoop(bot);

// ─── Fabricated Leaderboard: seed + update checker + midnight reset ───────────

if (countFabricatedTraders() === 0) {
    seedFabricatedTraders();
    console.log('[leaderboard] seeded 10 fabricated traders');
}

const backgroundIntervals: ReturnType<typeof setInterval>[] = [];

backgroundIntervals.push(setInterval(() => {
    const due = getFabricatedTradersDueForUpdate();
    for (const t of due) {
        const increase    = Math.random() < 0.8;
        const change      = 50 + Math.floor(Math.random() * 451);
        const newPnl      = increase ? t.current_pnl + change : Math.max(0, t.current_pnl - change);
        const intervalSec = 3600 + Math.floor(Math.random() * 32401);
        const nextUpdateAt = new Date(Date.now() + intervalSec * 1000).toISOString().replace('T', ' ').split('.')[0];
        updateFabricatedPnl(t.id, newPnl, nextUpdateAt);
    }
}, 60_000));

backgroundIntervals.push(setInterval(() => {
    const due = getMarathonFabricantsDueForUpdate();
    for (const f of due) {
        if (Math.random() < 0.2) continue; // 20% chance: no change this tick
        const increase = 1 + Math.floor(Math.random() * 5);
        const newCount = f.trade_count + increase;
        const intervalSec = 3600 + Math.floor(Math.random() * 18001); // 1-6h
        const nextUpdateAt = new Date(Date.now() + intervalSec * 1000).toISOString().replace('T', ' ').split('.')[0];
        updateMarathonFabricantTrades(f.id, newCount, nextUpdateAt);
    }
}, 60_000));

function scheduleMidnightReset(): void {
    const now      = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    setTimeout(() => {
        resetFabricatedPnl();
        console.log('[leaderboard] midnight PnL reset');
        scheduleMidnightReset();
    }, midnight.getTime() - now.getTime());
}
scheduleMidnightReset();

// ─── Giveaway V2: update queue + notifications queue ─────────────────────────

backgroundIntervals.push(setInterval(async () => {
    try { await processUpdateQueue(bot.telegram); } catch (err) {
        console.error('[giveaway] processUpdateQueue error:', err instanceof Error ? err.message : err);
    }
}, 30_000));

backgroundIntervals.push(setInterval(async () => {
    try { await processNotificationsQueue(bot.telegram); } catch (err) {
        console.error('[giveaway] processNotificationsQueue error:', err instanceof Error ? err.message : err);
    }
}, 30_000));

backgroundIntervals.push(setInterval(async () => {
    try { await checkMarathonDeadlines(bot.telegram); } catch (err) {
        console.error('[marathon] deadline check error:', err instanceof Error ? err.message : err);
    }
}, 5 * 60_000));

backgroundIntervals.push(setInterval(async () => {
    try { await tickPromoFabrication(); } catch (err) {
        console.error('[promo] fabrication tick error:', err instanceof Error ? err.message : err);
    }
}, 10 * 60_000));

backgroundIntervals.push(setInterval(async () => {
    try {
        const due = getPendingGiveawaysDue();
        for (const event of due) {
            console.log(`[scheduler] activating ${event.event_type} #${event.id} "${event.title}" (due ${event.starts_at})`);
            if (event.event_type === 'giveaway') await activateGiveaway(event.id);
            else if (event.event_type === 'promo_code') await activatePromoCode(event.id);
            else if (event.event_type === 'marathon') await activateMarathon(event.id);
        }
        if (due.length > 0) console.log(`[scheduler] activated ${due.length} pending event(s)`);
    } catch (err) {
        console.error('[scheduler] auto-activate error:', err instanceof Error ? err.message : err);
    }
}, 60_000));

backgroundIntervals.push(setInterval(async () => {
    try {
        const candidates = getAllUserIds()
            .map(id => getUser(id))
            .filter((u): u is NonNullable<typeof u> => !!(u?.ssid));
        for (const user of candidates) {
            try {
                const sdk = await sdkPool.get(user.telegram_id, user.ssid!);
                try {
                    const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
                    const real = all.find(b => b.type === BalanceType.Real);
                    if (real) {
                        const usdAmount = await convertToUsd(real.amount, real.currency ?? 'USD', sdk);
                        const newTier = autoPromoteTier(user.telegram_id, usdAmount, user.tier ?? 'DEMO');
                        if (newTier && newTier !== user.tier) {
                            const oldTier = user.tier;
                            setUserTier(user.telegram_id, newTier);
                            if (oldTier === 'DEMO') insertFunnelEvent('user_funded', JSON.stringify({ telegram_id: user.telegram_id }));
                            if (newTier === 'DEMO' && oldTier !== 'DEMO') insertFunnelEvent('user_unfunded', JSON.stringify({ telegram_id: user.telegram_id }));
                            logger.info('bot', `[periodic] tier changed ${user.telegram_id} ${oldTier} → ${newTier} ($${usdAmount.toFixed(2)})`);
                        }
                    }
                } finally {
                    sdkPool.release(user.telegram_id);
                }
            } catch (err) {
                if (isAuthExpiredError(err)) {
                    const reconnected = await autoReconnect(user.telegram_id);
                    if (!reconnected) {
                        clearUserSsid(user.telegram_id);
                        setSsidValid(user.telegram_id, 0);
                        logger.warn('bot', `SSID cleared for user ${user.telegram_id} due to auth failure: ${err instanceof Error ? err.message : err}`);
                    }
                }
            }
            await new Promise(r => setTimeout(r, 500)); // 2 SDK calls/sec
        }
    } catch (err) {
        logger.error('bot', `periodic auto-promote error: ${err instanceof Error ? err.message : err}`);
    }
}, 30 * 60_000));

// ─── SSID health check (hourly) ─────────────────────────────────────────────────
// Proactively probe every stored SSID. Expired ones are silently re-logged-in when
// creds exist; otherwise marked invalid so broadcasts are suppressed and the
// reconnect-prompt loop takes over.
backgroundIntervals.push(setInterval(async () => {
    try {
        const users = getUsersWithSsid();
        const BATCH = 5;
        for (let i = 0; i < users.length; i += BATCH) {
            const batch = users.slice(i, i + BATCH);
            await Promise.all(batch.map(async user => {
                try {
                    const sdk = await sdkPool.get(user.telegram_id, user.ssid!);
                    try {
                        await withTimeout(sdk.balances(), 15_000, 'balance');
                        setSsidValid(user.telegram_id, 1);
                    } finally {
                        sdkPool.release(user.telegram_id);
                    }
                } catch (err) {
                    if (isAuthExpiredError(err)) {
                        const reconnected = await autoReconnect(user.telegram_id);
                        if (!reconnected) {
                            clearUserSsid(user.telegram_id);
                            setSsidValid(user.telegram_id, 0);
                            logger.warn('bot', `[health] SSID expired for user ${user.telegram_id} (no cred to auto-reconnect)`);
                        }
                    }
                    // Non-auth errors (timeouts etc.) leave ssid_valid untouched.
                }
            }));
            await new Promise(r => setTimeout(r, 1_000)); // pause between batches
        }
    } catch (err) {
        logger.error('bot', `SSID health check error: ${err instanceof Error ? err.message : err}`);
    }
}, 60 * 60_000));



// ─── Keepalive ────────────────────────────────────────────────────────────────

backgroundIntervals.push(setInterval(async () => {
    try {
        await bot.telegram.getMe();
    } catch (err) {
        console.error('[keepalive] getMe failed:', err instanceof Error ? err.message : err);
    }
}, 600_000));

// ─── Admin Analysis (single-timeframe, 6-indicator, 70 candles) ───────────────

interface AdminCandle { close: number; max: number; min: number; }

function _adminEMA(closes: number[], period: number): number {
    if (closes.length < period) return closes[closes.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
    return ema;
}

function _adminRSI(closes: number[], period: number): number {
    const changes: number[] = [];
    for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period && i < changes.length; i++) {
        if (changes[i] > 0) avgGain += changes[i]; else avgLoss += -changes[i];
    }
    avgGain /= period; avgLoss /= period;
    for (let i = period; i < changes.length; i++) {
        const g = changes[i] > 0 ? changes[i] : 0;
        const l = changes[i] < 0 ? -changes[i] : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
}

function _adminMACD(closes: number[], fast: number, slow: number, signalPeriod: number): { macd: number; signal: number; histogram: number } {
    const macdLine = _adminEMA(closes, fast) - _adminEMA(closes, slow);
    const macdSeries: number[] = [];
    for (let i = slow - 1; i < closes.length; i++) {
        macdSeries.push(_adminEMA(closes.slice(0, i + 1), fast) - _adminEMA(closes.slice(0, i + 1), slow));
    }
    const signal = _adminEMA(macdSeries, signalPeriod);
    return { macd: macdLine, signal, histogram: macdLine - signal };
}

function _adminBollinger(closes: number[], period: number, mult: number): { mid: number; upper: number; lower: number } {
    const slice = closes.slice(-period);
    const mid = slice.reduce((s, v) => s + v, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length) * mult;
    return { mid, upper: mid + sd, lower: mid - sd };
}

function _adminStochastic(highs: number[], lows: number[], closes: number[], kPeriod: number): { k: number; d: number } {
    const kValues: number[] = [];
    for (let offset = 2; offset >= 0; offset--) {
        const end = closes.length - offset;
        if (end < kPeriod) continue;
        const lowest = lows.slice(end - kPeriod, end).reduce((a, b) => Math.min(a, b), Infinity);
        const highest = highs.slice(end - kPeriod, end).reduce((a, b) => Math.max(a, b), -Infinity);
        const range = highest - lowest;
        kValues.push(range === 0 ? 50 : ((closes[end - 1] - lowest) / range) * 100);
    }
    const k = kValues[kValues.length - 1] ?? 50;
    const d = kValues.length > 0 ? kValues.reduce((s, v) => s + v, 0) / kValues.length : k;
    return { k, d };
}

function _adminATR(highs: number[], lows: number[], closes: number[], period: number): number {
    const trs: number[] = [];
    for (let i = 1; i < Math.min(closes.length, period + 1); i++) {
        trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    return trs.length > 0 ? trs.reduce((s, v) => s + v, 0) / trs.length : 0;
}

function runAdminAnalysis(candles: AdminCandle[]): { direction: 'call' | 'put'; confidence: number; reason: string } {
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.max);
    const lows   = candles.map(c => c.min);
    const lastClose = closes[closes.length - 1];

    const rsi = _adminRSI(closes, 14);
    const rsiBull = rsi > 58, rsiBear = rsi < 42;

    const ema9  = _adminEMA(closes, 9);
    const ema21 = _adminEMA(closes, 21);
    const ema50 = _adminEMA(closes, 50);
    const ema200 = _adminEMA(closes, 200);
    const emaBull = ema9 > ema21, emaBear = ema9 < ema21;
    const emaStrongBull = ema50 > ema200, emaStrongBear = ema50 < ema200;

    const { macd, signal: macdSig, histogram } = _adminMACD(closes, 12, 26, 9);
    const macdBull = macd > macdSig && histogram > 0;
    const macdBear = macd < macdSig && histogram < 0;

    const { mid, upper, lower } = _adminBollinger(closes, 20, 2);
    const bbBull = lastClose > mid && lastClose < upper;
    const bbBear = lastClose < mid && lastClose > lower;

    const { k, d } = _adminStochastic(highs, lows, closes, 14);
    const stochBull = k > d && k > 20;
    const stochBear = k < d && k < 80;

    const atr = _adminATR(highs, lows, closes, 14);
    const avgPrice = closes.reduce((s, v) => s + v, 0) / closes.length;
    const hasVolatility = avgPrice > 0 && (atr / avgPrice) * 100 > 0.03;

    let bullVotes = 0, bearVotes = 0;
    if (rsiBull) bullVotes++; else if (rsiBear) bearVotes++;
    if (emaBull && emaStrongBull) bullVotes += 2; else if (emaBear && emaStrongBear) bearVotes += 2;
    else if (emaBull) bullVotes++; else if (emaBear) bearVotes++;
    if (macdBull) bullVotes++; else if (macdBear) bearVotes++;
    if (bbBull) bullVotes++; else if (bbBear) bearVotes++;
    if (stochBull) bullVotes++; else if (stochBear) bearVotes++;
    if (hasVolatility) { if (bullVotes >= bearVotes) bullVotes++; else bearVotes++; }

    const totalVotes = bullVotes + bearVotes;
    const direction: 'call' | 'put' = bullVotes >= bearVotes ? 'call' : 'put';
    const confidence = totalVotes > 0 ? Math.round((Math.max(bullVotes, bearVotes) / totalVotes) * 100) : 65;

    return { direction, confidence: Math.max(confidence, 65), reason: `${direction === 'call' ? 'BULLISH' : 'BEARISH'} (${confidence}%)` };
}

function shutdown(signal: string): void {
    for (const t of backgroundIntervals) clearInterval(t);
    for (const s of scheduledBroadcasts) if (s.timerId) clearTimeout(s.timerId);
    try { sdkPool.destroy(); } catch {}
    bot.stop(signal);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
