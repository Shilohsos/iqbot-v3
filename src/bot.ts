import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { ClientSdk, SsidAuthMethod, BalanceType } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST, IQ_AUTH_URL } from './protocol.js';
import { executeTrade, executeTradeWithSdk, createSdk, type TradeRequest, type TradeResult } from './trade.js';
import { sdkPool } from './sdk-pool.js';
import { getTierConfig, normalizeTier, autoPromoteTier, convertToUsd, TIER_CONFIGS } from './tiers.js';
import {
    getRecentTrades, getTradeStats, getTopTradersToday,
    getUser, saveUser, saveUsername, deleteUser, getAllUsers, getAllUserIds,
    getActiveTraderIds, getInactiveTraderIds, findUsersByUsername,
    getActivatedUserIds, getNonActivatedUserIds,
    getFundedUserIds, getNonFundedUserIds,
    upsertOnboardingUser, approveUser, setManualApproval, rejectUser, resetUser, getApprovalStats,
    getRecentApprovals, getPendingManualUsers,
    setUserTier, saveUserCurrency, pauseUser, resumeUser,
    generateToken, validateToken, useToken, getTokens,
    updateLeaderboardAuto, addLeaderboardManual, getLeaderboard,
    getLeaderboardDetailed, updateLeaderboardManual,
    getFunnelStats, getConfig, setConfig, getTestUserId, setTestUser,
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
    setSsidValid,
    getUsersWithSsid,
    getUsersDueForReconnectPrompt,
    setReconnectPrompt,
    clearReconnectPrompt,
    getPendingGiveawaysDue,
    setGiveawayStatus,
    getGiveawayParticipants,
    deleteGiveaway,
    seedTemplates, seedReengageVariants,
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
    getStuckOnboardingUsers,
    getOnboardingTracking,
    setLastFollowupMsgId,
    setLastFundingAt,
    getDemoTradeCount,
    getConnectedNonTraders,
    getDemoTraders,
    setReengageMsgId,
    getReengageTracking,
    getDailyDemoCount,
    incrementDailyDemoCount,
    cycleReengageVariant,
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
    tradeModeKeyboard, demoUpsellKeyboard, affiliateFailKeyboard,
} from './menu.js';
import { startKeyboard, backKeyboard, onboardKeyboard } from './ui/user.js';
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
import { setupChannelHandlers, startWelcomeFollowUp } from './channel.js';
import { startAutoBroadcast } from './auto-broadcast.js';
import { generatePost, type LlmRequest } from './llm.js';
import { getBrainFlow, type UserContext } from './classifier.js';
import { resolveUsername as resolveUsernameTemplate, applyPidgin } from './pidgin.js';
import {
    startNewOnboarding, handleNewTrader, handleWatchedVideo,
    handleExperiencedTrader, handleHaveAccount, handleNeedAccount,
    handleUserIdVerified, handleUserIdFailed, handleEmailCollected,
    handleConnected, checkFundingSequence, getReengageTemplateKey,
    resumeOnboarding,
} from './onboarding.js';
import { adminAnalyze, type AdminAnalysisResult } from './admin-analysis.js';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT_TOKEN = process.env.BOT_TOKEN;
const IQ_SSID   = process.env.IQ_SSID;
const AFFILIATE_LINK   = process.env.AFFILIATE_LINK   ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue';
const ADMIN_CONTACT_LINK = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';

const FLOW_BUTTONS: Record<string, { text: string; action: string | { url: string } }> = {
    start_trading:        { text: '🚀 Start Trading', action: 'ui:trade' },
    reconnect:            { text: '🔗 Reconnect',     action: 'ui:connect' },
    continue_onboarding:  { text: '▶️ Continue',      action: 'ui:start' },
    verify_user_id:       { text: '👤 Contact Admin', action: { url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' } },
    fund_account:         { text: '💰 Fund Account',  action: { url: 'https://iqoption.com/pwa/payments/deposit' } },
    go_home:              { text: '🏠 Menu',           action: 'ui:start' },
    help_contact:         { text: '👤 Contact Admin', action: { url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' } },
};

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

type WizardStep = 'mode' | 'amount' | 'timeframe' | 'pair' | 'custom_amount';
interface WizardState {
    step: WizardStep;
    mode?: 'demo' | 'live';
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

type ConnectStep = 'email' | 'password' | 'admin_email' | 'admin_password';
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
    | 'compose_image'
    | 'compose_cta'
    | 'compose_tone_guide'
    | 'compose_tone_sample1'
    | 'compose_tone_sample2'
    | 'compose_tone_sample3'
    | 'media_upload';

interface AdminSessionState {
    step: AdminStep;
    broadcastTarget?: 'funded' | 'nonfunded' | 'nonactivated' | 'testuser';
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
    try { await bot.telegram.sendMessage(getAdminId(), msg, { parse_mode: 'Markdown' }); } catch {}
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

async function startOnboarding(ctx: Context): Promise<void> {
    const telegramId = ctx.from!.id;
    const user = getUser(telegramId);
    // If user already has an onboarding state in progress, don't restart from scratch
    if (user?.onboarding_state && user.onboarding_state !== 'entry') {
        await resumeOnboarding(ctx, telegramId);
        return;
    }
    await startNewOnboarding(ctx, telegramId);
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
    existingSdk?: ClientSdk,
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
        logLines.push(`⚡ Trade 1|🟡 $${currentAmount.toFixed(2)} → in flight`);
        await syncLog();

        const roundTrade: TradeRequest = { pair, direction, amount: currentAmount, martingaleRunId: runId, timeframeSec, balanceType, telegramId: ctx.from!.id };

        let result: TradeResult;
        try {
            result = existingSdk
                ? await withTimeout(executeTradeWithSdk(existingSdk, roundTrade), roundTimeoutMs, 'trade')
                : await withTimeout(executeTrade(ssid, roundTrade), roundTimeoutMs, 'trade');
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
        // Capture pre-increment demo count before settling, then increment for all settled trades
        let demoPrevCount = 0;
        if (balanceType === 'demo' && (result.status === 'WIN' || result.status === 'LOSS' || result.status === 'TIE')) {
            demoPrevCount = getDailyDemoCount(ctx.from!.id);
            incrementDailyDemoCount(ctx.from!.id);
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
                `🏆 +$${result.pnl.toFixed(2)} added to your balance.\n\n` +
                (round > 1 ? `Recovery complete.\n\n` : '') +
                `💸 You just made +$${result.pnl.toFixed(2)}`,
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

                checkFundingSequence(ctx.from!.id, async (msg, button, templateKey) => {
                    const fundMedia = getSequenceMedia(templateKey);
                    const btnMarkup = { inline_keyboard: [[{ text: button.text, url: button.url }]] };
                    if (fundMedia?.file_id) {
                        if (fundMedia.media_type === 'video') {
                            await ctx.replyWithVideo(fundMedia.file_id, { caption: msg, reply_markup: btnMarkup });
                        } else {
                            await ctx.replyWithPhoto(fundMedia.file_id, { caption: msg, reply_markup: btnMarkup });
                        }
                    } else {
                        await ctx.reply(msg, { reply_markup: btnMarkup });
                    }
                }).catch(() => {});

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
    await sendRoundImage('L11c.png');
    const lostReply = await ctx.reply(
        `Lost this one 💔! Remain confident! New setup loading 👾\n\nTotal: ${sign}$${totalPnl.toFixed(2)}`,
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

// ─── Account connection choice ────────────────────────────────────────────────

bot.action('onboard:yes', async ctx => {
    if (!isValidCallbackQuery(ctx)) {
        await ctx.answerCbQuery('⏳ This request is no longer valid. Send /start to begin again.').catch(() => {});
        return;
    }
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
    if (!isValidCallbackQuery(ctx)) {
        await ctx.answerCbQuery('⏳ This request is no longer valid. Send /start to begin again.').catch(() => {});
        return;
    }
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const existing = onboardSessions.get(chatId) ?? { step: 'create_user_id' as OnboardStep };
    onboardSessions.set(chatId, { ...existing, step: 'create_user_id' });
    await askCreateAccountUserId(ctx);
});

bot.action('onboard:autocreate', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const existing = onboardSessions.get(chatId) ?? { step: 'auto_create_email' as OnboardStep };
    onboardSessions.set(chatId, { ...existing, step: 'auto_create_email' });
    await ctx.reply(
        '🤖 *Account creation*\n\n' +
        'Send us a fresh email address and we\'ll set up an IQ Option account for you. ' +
        'You\'ll get the login details once it\'s ready.\n\n' +
        '📧 Enter your email:',
        { parse_mode: 'Markdown' }
    );
});

// ─── New onboarding state machine callbacks ───────────────────────────────────

bot.action('onboard:new', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    await handleNewTrader(ctx, telegramId);
});

bot.action('onboard:experienced', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    await handleExperiencedTrader(ctx, telegramId);
});

bot.action('onboard:watched_video', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    await handleWatchedVideo(ctx, telegramId);
});

bot.action('onboard:have_account', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    await handleHaveAccount(ctx, telegramId);
});

bot.action('onboard:need_account', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    await handleNeedAccount(ctx, telegramId);
});

// ─── Trade wizard — mode ──────────────────────────────────────────────────────

bot.action(/^mode:(demo|live)$/, async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'mode') return;
    state.mode = ctx.match[1] as 'demo' | 'live';
    state.step = 'amount';
    await ctx.reply('Enter amount', { reply_markup: amountKeyboard() });
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
    state.timeframe = parseInt(ctx.match[1], 10);
    state.step = 'pair';
    if (state.lastImageMsgId) {
        try { await ctx.telegram.deleteMessage(ctx.chat!.id, state.lastImageMsgId); } catch {}
    }
    try { const m = await ctx.replyWithPhoto(ASSET('L6.png')); state.lastImageMsgId = m.message_id; } catch {}
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

    const pair = ctx.match[1];
    const { amount, timeframe, mode, lastImageMsgId: prevImgId } = state;
    wizardSessions.delete(chatId);

    if (!amount || !timeframe) { await ctx.reply('❌ Session error — start over.'); return; }

    const isAdmin = ctx.from!.id === getAdminId();

    // Block demo trades at daily limit (non-admin only)
    if (!isAdmin && mode === 'demo') {
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
        if (!isAdmin) {
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
        if (isAdmin) {
            // Silent engine swap — admin gets ultra-strict multi-TF analysis
            const adminResult = await adminAnalyze(sdk, pair).catch(err => { throw err; });
            if (adminResult.skipped) {
                if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
                await ctx.telegram.editMessageText(
                    chatId, progressMsg.message_id, undefined,
                    '⚠️ No clear signal right now. Try a different pair or timeframe.'
                ).catch(() => {});
                return;
            }
            analysis = { direction: adminResult.direction, confidence: adminResult.confidence, reason: adminResult.reason };
        } else {
            const analysisTier = normalizeTier(getUser(ctx.from!.id)?.tier);
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
            `🔷 Trading pair: ${pair}\n🔷 Amount: $${amount.toFixed(2)} USD\n` +
            `🔷 Expiration: ${tfLabel(timeframe)}\n🔷 Strategy: High-Profit ⚡`
        ).catch(() => undefined);
        if (opportunityMsg) preTradeMessageIds.push(opportunityMsg.message_id);

        const maxConcurrent = isAdmin ? 999 : getTierConfig(normalizeTier(getUser(ctx.from!.id)?.tier)).maxConcurrentTrades;
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
        const tradePromise = runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe, (mode ?? 'live') as 'demo' | 'live', martingaleRounds, preTradeMessageIds, sdk);
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
    const state: WizardState = { step: 'amount', mode: 'live' };
    try { const m = await ctx.replyWithPhoto(ASSET('L5.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(chatId, state);
    await ctx.reply('💰 Enter amount for Live trade:', { reply_markup: amountKeyboard() });
});

bot.action('upsell:demo', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const state: WizardState = { step: 'amount', mode: 'demo' };
    try { const m = await ctx.replyWithPhoto(ASSET('L5.png')); state.lastImageMsgId = m.message_id; } catch {}
    wizardSessions.set(chatId, state);
    await ctx.reply('💰 Enter amount for Demo trade:', { reply_markup: amountKeyboard() });
});

// ─── User menu actions ────────────────────────────────────────────────────────

bot.action('ui:start', async ctx => { await ctx.answerCbQuery(); await sendStartMenu(ctx); });

bot.action('ui:connect', async ctx => {
    await ctx.answerCbQuery();
    connectSessions.set(ctx.chat!.id, { step: 'email' });
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
    const tier = normalizeTier(getUser(ctx.from!.id)?.tier);
    const nextTier = tier === 'DEMO' ? 'PRO' : 'MASTER';
    const cost = nextTier === 'PRO' ? '$10' : '$50';
    const fundUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
    await ctx.reply(
        `💡 *Upgrade Your Tier*\n\n` +
        `Fund your account with at least *${cost}* to automatically unlock *${nextTier}* tier\\.\n\n` +
        `You'll be upgraded instantly once your balance reaches this threshold\\.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Fund Account', url: fundUrl }],
                    [{ text: '🔓 Upgrade with Token', callback_data: 'ui:upgrade_token' }],
                    [{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }],
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
        wizardSessions.set(ctx.chat.id, { step: 'amount', mode: 'live' });
        await ctx.reply('Enter trade amount (USD):', { reply_markup: amountKeyboard() });
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

bot.action(/^broadcast:(funded|nonfunded|nonactivated|testuser)$/, async ctx => {
    await ctx.answerCbQuery();
    const target = ctx.match[1] as 'funded' | 'nonfunded' | 'nonactivated' | 'testuser';
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_message', broadcastTarget: target });
    const labelMap: Record<string, string> = {
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
    ctx.telegram.sendChatAction(ctx.chat!.id, 'typing').catch(() => {});
    const winners = giveawaySelectWinners(giveawayId);
    if (winners.length === 0) {
        await ctx.reply('❌ No eligible participants found.', { reply_markup: adminBackKeyboard() });
        return;
    }
    const event = getGiveawayEvent(giveawayId);
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
            ? `Participants: ${real + fabricated} total (Real: ${real} | Fabricated: ${fabricated})`
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

bot.action(/^compose_btn:(start|trade|fund|none)$/, async ctx => {
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
        start: { text: '🚀 Start Bot', url: `https://t.me/${botUsername}?start=` },
        trade: { text: '🎯 Trade Now', callback_data: 'ui:trade' },
        fund:  { text: '💰 Fund Account', url: fundUrl },
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
    await startOnboarding(ctx);
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
                    if (target === 'funded') targetIds = getFundedUserIds();
                    else if (target === 'nonfunded') targetIds = getNonFundedUserIds();
                    else if (target === 'nonactivated') targetIds = getNonActivatedUserIds();
                    else if (target === 'testuser') {
                        const tid = getTestUserId();
                        targetIds = tid ? [tid] : [];
                    }
                    else targetIds = [];

                    const segLabelMap: Record<string, string> = {
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
                adminSessions.set(chatId, { ...as, marathonV2Desc: desc });
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
        const iqUserId = parseInt(text, 10);
        if (isNaN(iqUserId) || String(iqUserId).length < 5) {
            await ctx.reply('Please enter a valid IQ Option User ID (numeric).');
            return;
        }
        upsertOnboardingUser(ctx.from!.id, iqUserId);
        try {
            const result = await withTimeout(checkAffiliate(iqUserId), 15_000, 'affiliate').catch(() => ({ found: false, data: null }));
            if (result.found) {
                approveUser(ctx.from!.id, result.data ? JSON.stringify(result.data) : undefined);
                await handleUserIdVerified(ctx, ctx.from!.id);
            } else {
                await handleUserIdFailed(ctx, ctx.from!.id, 1);
                setOnboardingState(ctx.from!.id, 'awaiting_user_id');
            }
        } catch {
            await handleUserIdFailed(ctx, ctx.from!.id, 1);
            setOnboardingState(ctx.from!.id, 'awaiting_user_id');
        }
        return;
    }

    if (onboardingState === 'awaiting_email') {
        touchOnboardingActivity(ctx.from!.id);
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
                await ctx.reply('❌ Login failed. Please double-check your email:\n\n📧 Enter your IQ Option email:');
            }
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
                    const failAffLink = process.env.AFFILIATE_LINK ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue';
                    const failAdminLink = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
                    await ctx.reply(
                        '⏳ We were not able to confirm your User ID.\n\n' +
                        'Please consider creating a new account the right way using our link 👇👾\n\n' +
                        'You can as-well contact admin 👇💜',
                        { reply_markup: { inline_keyboard: [
                            [{ text: '🆕 Create free account (takes 2 min)', url: failAffLink }],
                            [{ text: '🤖 Let us create one for you', callback_data: 'onboard:autocreate' }],
                            [{ text: '👾 Contact admin', url: failAdminLink }],
                        ]}}
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

        if (ob.step === 'auto_create_email') {
            const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
            if (!emailOk) { await ctx.reply('That doesn\'t look like a valid email. Please try again.'); return; }
            onboardSessions.delete(chatId);
            await ctx.reply(
                '✅ Got it! We\'ve received your email.\n\n' +
                'Our team will set up your IQ Option account and message you the login details shortly. ' +
                'This usually takes a few hours during business hours.'
            );
            try {
                const userTag = ctx.from!.username
                    ? `@${escapeMd(ctx.from!.username)}`
                    : `[User](tg://user?id=${ctx.from!.id})`;
                await bot.telegram.sendMessage(
                    getAdminId(),
                    `🤖 *Auto-account request*\nTelegram: ${userTag}\nEmail: \`${escapeMd(text)}\`\n\nManually create an IQ Option account, then DM the user the credentials and approve: /admin approve ${ctx.from!.id}`,
                    { parse_mode: 'Markdown' }
                );
            } catch {}
            console.log(`[auto-create] requested by ${ctx.from!.id}: ${text}`);
            return;
        }

        if (ob.step === 'connect_password' && ob.email) {
            const email = ob.email;
            try { await ctx.deleteMessage(); } catch {}
            await ctx.reply('🔐 Logging in...');
            try {
                const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, text), 10_000, 'login');
                saveUser({ telegram_id: ctx.from!.id, ssid });
                let msg = '✅ Connected!\n\n';
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

    // ── LLM brain — push to flow ──────────────────────────────────────────────
    const brainWiz = wizardSessions.get(chatId);
    if (!brainWiz) {
        const user = getUser(ctx.from!.id);
        const brainCtx: UserContext = {
            onboarding_state: user?.onboarding_state ?? null,
            ssid_valid: user?.ssid_valid ?? null,
            has_ssid: !!user?.ssid,
            demo_trade_count: user ? getDemoTradeCount(user.telegram_id) : null,
            tier: user?.tier ?? 'DEMO',
        };
        const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(() => ({ flow: 'go_home', message: '', shouldReply: true }));
        if (brainResult.shouldReply) {
            const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.go_home;
            const replyText = brainResult.message || btn.text;
            const replyMarkup = typeof btn.action === 'string'
                ? { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] }
                : { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
            await ctx.reply(replyText, { reply_markup: replyMarkup });
        }
        return;
    }

    if (brainWiz.step !== 'custom_amount') return;

    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) { await ctx.reply('Please enter a valid positive number (e.g. 75).'); return; }
    if (brainWiz.mode === 'demo' && amount > 20) { await ctx.reply('❌ Demo max is $20 or equivalent. Please enter a smaller amount.'); return; }

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
seedReengageVariants();

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

bot.launch();
logger.info('bot', 'iqbot-v3 running');
startWelcomeFollowUp(bot);
startAutoBroadcast(bot);

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
            .filter((u): u is NonNullable<typeof u> => !!(u?.ssid) && u.tier !== 'MASTER');
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
                            setUserTier(user.telegram_id, newTier);
                            logger.info('bot', `[periodic] auto-promoted ${user.telegram_id} ${user.tier} → ${newTier} ($${usdAmount.toFixed(2)})`);
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

// ─── Reconnect-prompt loop (hourly tick, 6h cadence per user) ───────────────────
// Users whose SSID is known-expired (and couldn't be auto-reconnected) get a
// reconnect prompt. The first one stays; each follow-up deletes the previous so
// only one is ever visible.
backgroundIntervals.push(setInterval(async () => {
    try {
        const due = getUsersDueForReconnectPrompt(6);
        for (const user of due) {
            try {
                if (user.reconnect_prompt_msg_id) {
                    try { await bot.telegram.deleteMessage(user.telegram_id, user.reconnect_prompt_msg_id); } catch {}
                }
                const sent = await bot.telegram.sendMessage(
                    user.telegram_id,
                    '🔐 Your session expired.\n\nReconnect in 3 steps:\n1️⃣ Tap the 🔗 Reconnect button below\n2️⃣ Enter your IQ Option email and password\n3️⃣ Get back to trading instantly',
                    { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
                );
                setReconnectPrompt(user.telegram_id, sent.message_id);
            } catch {
                // user blocked the bot — stamp the attempt so we back off 6h
                setReconnectPrompt(user.telegram_id, null);
            }
            await new Promise(r => setTimeout(r, 100));
        }
    } catch (err) {
        logger.error('bot', `reconnect-prompt loop error: ${err instanceof Error ? err.message : err}`);
    }
}, 60 * 60_000));

// ─── Re-engagement loop (1h cadence, 3 segments) ──────────────────────────────

backgroundIntervals.push(setInterval(async () => {
    if (getConfig('features_paused') === '1') return;
    try {
        // Segment 1: Non-activated users → onboarding re-engagement templates
        const nonActivated = getStuckOnboardingUsers(1);
        for (const user of nonActivated) {
            try {
                const chatId = user.telegram_id;
                const baseKey = getReengageTemplateKey(user.onboarding_state ?? 'entry_branch_sent');
                const variant = cycleReengageVariant(chatId);
                const suffix = ['_a', '_b', '_c'][variant];
                const key = baseKey + suffix;
                const t = getTemplateByKey(key) ?? getTemplateByKey(baseKey);
                if (!t) continue;
                const msg = resolveUsernameTemplate(t.message, user.username ?? 'there');
                const tracking = getReengageTracking(chatId);
                if (tracking?.last_msg_id) {
                    try { await bot.telegram.deleteMessage(chatId, tracking.last_msg_id); } catch {}
                }
                const mediaKey = key.replace(/^reengage_/, '').replace(/_[abc]$/, '');
                const media = getSequenceMedia(mediaKey);
                const s1BtnMarkup = t.button_text && t.button_url
                    ? { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] }
                    : undefined;
                let sentMsgId: number;
                if (media?.file_id) {
                    if (media.media_type === 'video') {
                        const sent = await bot.telegram.sendVideo(chatId, media.file_id, { caption: msg, ...(s1BtnMarkup ? { reply_markup: s1BtnMarkup } : {}) });
                        sentMsgId = sent.message_id;
                    } else {
                        const sent = await bot.telegram.sendPhoto(chatId, media.file_id, { caption: msg, ...(s1BtnMarkup ? { reply_markup: s1BtnMarkup } : {}) });
                        sentMsgId = sent.message_id;
                    }
                } else {
                    const sent = await bot.telegram.sendMessage(chatId, msg, s1BtnMarkup ? { reply_markup: s1BtnMarkup } : {});
                    sentMsgId = sent.message_id;
                }
                setReengageMsgId(chatId, sentMsgId, 'non_activated');
                touchOnboardingActivity(chatId);
            } catch {}
            await new Promise(r => setTimeout(r, 200));
        }

        // Segment 2: Connected but never traded → re-engagement templates
        const idleConnected = getConnectedNonTraders(1);
        for (const user of idleConnected) {
            try {
                const chatId = user.telegram_id;
                const variant = cycleReengageVariant(chatId);
                const suffix = ['_a', '_b', '_c'][variant];
                const key = 'reengage_never_traded' + suffix;
                const t = getTemplateByKey(key) ?? getTemplateByKey('reengage_never_traded');
                if (!t) continue;
                const msg = resolveUsernameTemplate(t.message, user.username ?? 'there');
                const tracking = getReengageTracking(chatId);
                if (tracking?.last_msg_id) {
                    try { await bot.telegram.deleteMessage(chatId, tracking.last_msg_id); } catch {}
                }
                const mediaKey = key.replace(/^reengage_/, '').replace(/_[abc]$/, '');
                const media = getSequenceMedia(mediaKey);
                const s2BtnMarkup = t.button_text && t.button_url
                    ? { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] }
                    : undefined;
                let sentMsgId: number;
                if (media?.file_id) {
                    if (media.media_type === 'video') {
                        const sent = await bot.telegram.sendVideo(chatId, media.file_id, { caption: msg, ...(s2BtnMarkup ? { reply_markup: s2BtnMarkup } : {}) });
                        sentMsgId = sent.message_id;
                    } else {
                        const sent = await bot.telegram.sendPhoto(chatId, media.file_id, { caption: msg, ...(s2BtnMarkup ? { reply_markup: s2BtnMarkup } : {}) });
                        sentMsgId = sent.message_id;
                    }
                } else {
                    const sent = await bot.telegram.sendMessage(chatId, msg, s2BtnMarkup ? { reply_markup: s2BtnMarkup } : {});
                    sentMsgId = sent.message_id;
                }
                setReengageMsgId(chatId, sentMsgId, 'idle_connected');
            } catch {}
            await new Promise(r => setTimeout(r, 200));
        }

        // Segment 3: Has traded demo → funding sequence
        const traders = getDemoTraders();
        for (const user of traders) {
            try {
                const fundKeys = [
                    'funding_win_screenshot', 'funding_lifestyle_video', 'funding_testimonial',
                    'funding_payout_proof', 'funding_lifestyle_photo', 'funding_user_result',
                    'funding_user_result_video',
                ];
                const key = fundKeys[Math.floor(Math.random() * fundKeys.length)];
                const t = getTemplateByKey(key);
                if (!t) continue;
                const promo = ['10xfirst', '10xsecond'][Math.floor(Math.random() * 2)];
                let msg = t.message.replace(/10xfirst|10xsecond/g, promo);
                msg = resolveUsernameTemplate(msg, user.username ?? 'there');
                const chatId = user.telegram_id;
                const tracking = getReengageTracking(chatId);
                if (tracking?.last_msg_id) {
                    try { await bot.telegram.deleteMessage(chatId, tracking.last_msg_id); } catch {}
                }
                const fundingTracking = getOnboardingTracking(chatId);
                if (fundingTracking?.last_funding_at) {
                    const hoursAgo = (Date.now() - new Date(fundingTracking.last_funding_at).getTime()) / 3_600_000;
                    if (hoursAgo < 6) continue;
                }
                const btnMarkup = t.button_text && t.button_url
                    ? { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] }
                    : { inline_keyboard: [[{ text: '💰 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786' }]] };
                const media = getSequenceMedia(key);
                let sentMsgId: number;
                if (media?.file_id) {
                    if (media.media_type === 'video') {
                        const sent = await bot.telegram.sendVideo(chatId, media.file_id, { caption: msg, reply_markup: btnMarkup });
                        sentMsgId = sent.message_id;
                    } else {
                        const sent = await bot.telegram.sendPhoto(chatId, media.file_id, { caption: msg, reply_markup: btnMarkup });
                        sentMsgId = sent.message_id;
                    }
                } else {
                    const sent = await bot.telegram.sendMessage(chatId, msg, { reply_markup: btnMarkup });
                    sentMsgId = sent.message_id;
                }
                setReengageMsgId(chatId, sentMsgId, 'funding');
                setLastFundingAt(chatId);
            } catch {}
            await new Promise(r => setTimeout(r, 200));
        }
    } catch (err) {
        logger.error('bot', `re-engagement loop error: ${err instanceof Error ? err.message : err}`);
    }
}, 1 * 60 * 60_000));

// ─── Keepalive ────────────────────────────────────────────────────────────────

backgroundIntervals.push(setInterval(async () => {
    try {
        await bot.telegram.getMe();
    } catch (err) {
        console.error('[keepalive] getMe failed:', err instanceof Error ? err.message : err);
    }
}, 600_000));

function shutdown(signal: string): void {
    for (const t of backgroundIntervals) clearInterval(t);
    for (const s of scheduledBroadcasts) if (s.timerId) clearTimeout(s.timerId);
    try { sdkPool.destroy(); } catch {}
    bot.stop(signal);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
