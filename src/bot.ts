import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { ClientSdk, SsidAuthMethod, BalanceType, setWsProxyResolver } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST, IQ_AUTH_URL } from './protocol.js';
import { executeTrade, executeTradeWithSdk, createSdk, type TradeRequest, type TradeResult } from './trade.js';
import { recoverMissedTradeResults } from './tradeRecovery.js';
import { sdkPool } from './sdk-pool.js';
import {
    resolveAccess, getProductConfig, hasAccess, getProduct, convertToUsd, tokenToAccess,
    type Product,
    AI_TRADING_MIN_USD, AUTO_TRADING_MIN_USD, FREE_SIGNALS_PER_DAY, ALL_PAIRS,
    PRODUCT_LIMITS, SIGNALS_PREMIUM_COUNT,
    clampDisplayConfidence,
    TOKEN_ACCESS_DURATION_MS,
    godModeStakePct, godModeTimeframe, godModeGaleRounds, martingaleWorstCase, godModePickWorstAssets,
} from './access.js';
import { autoEngine, initAutoEngine } from './auto-trading.js';
import { resumeH20Sessions } from './h20.js';
import {
    setUserFundedBalance, getSignalUsage, incrementSignalUsage, getTotalSignalCount, incrementTotalSignalCount, getTotalSignalsToday,
    upsertAutoSession, getAutoSession,
    insertSignalTrack, getExpiredActiveSignals, updateSignalTrackResult, updateSignalTrackCard, getAllActiveSignalTracks, cancelActiveSignalTracks,
    getRecentTrades, getTradeStats, getTopTradersToday,
    getUser, saveUser, saveUsername, deleteUser, getAllUsers, getAllUserIds,
    getActiveTraderIds, getInactiveTraderIds, findUsersByUsername, findUsersByIqUserId,
    getActivatedUserIds, getNonActivatedUserIds,
    getFundedUserIds, getNonFundedUserIds,
    upsertOnboardingUser, approveUser, rejectUser, resetUser, getApprovalStats,
    getRecentApprovals, getPendingManualUsers,
    setUserAccessLevel, saveUserCurrency, pauseUser, resumeUser,
    generateToken, validateToken, useToken, getTokens,
    downgradeExpiredAccess,
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
    getAccessDistribution,
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
    getProductUsage, incrementProductUsage,
    getLiveSignalsUsed, incrementLiveSignalsUsed, resetLiveSignalsUsed,
    addProductMinutes, setProductMinutes,
    getUserIdFailCount, incrementUserIdFailCount, resetUserIdFailCount,
    db,
    getFundingCycle, upsertFundingCycle, getFundingCycleDueUsers,
    getDemoUsersWithTrades, getLastTradeTime,
    getReconnectCycle, upsertReconnectCycle, getReconnectCycleDueUsers,
    getSsidExpiredUsers, getUserIdRejectedUsers, getLoginFailedUsers,
    getAbandonedOnboardingUsers, getNeverConnectedUsers,
    getMarketPulseStats,
    getFunnelPipeline,
    getAwaitingUserIdUsers, getPendingPrompt, upsertPendingPrompt, getPendingPromptDueUsers,
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
    setGiveawayReconnect,
    type GiveawayEventInput,
} from './giveaway.js';
import { analyzePairWithSdk, type AnalysisResult } from './analysis.js';
import { applyFLODrain } from './flo-drain.js';
import { applyGLKDrain } from './glk-drain.js';
import { runAdminAnalysis, type AdminCandle, type AdminAnalysisResult } from './admin-analysis.js';
import {
    amountKeyboard, timeframeKeyboard, pairKeyboard, signalPairKeyboard, signalTimeframeKeyboard, tfLabel, OTC_PAIRS,
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
    reviewsKeyboard, reviewResultKeyboard,
} from './ui/admin.js';
import { checkAffiliate } from './affiliate.js';
import { setupChannelHandlers } from './channel.js';
import { startAutoBroadcast } from './auto-broadcast.js';
import { generatePost, generateDiaryEntry, type LlmRequest } from './llm.js';
import { getBrainFlow, type UserContext } from './classifier.js';
import { generateReviews, SCENARIO_PRESETS } from './reviews.js';
import { resolveUsername as resolveUsernameTemplate, applyPidgin } from './pidgin.js';
import {
    handleUserIdVerified, handleUserIdFailed, handleEmailCollected,
    handleConnected,
} from './onboarding.js';
import { ProxyAgent } from 'undici';
import { getProxyUrl, triggerProxyRotation } from './proxy.js';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT_TOKEN = process.env.BOT_TOKEN;
const IQ_SSID   = process.env.IQ_SSID;
const AFFILIATE_LINK   = process.env.AFFILIATE_LINK   ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue';
const ADMIN_CONTACT_LINK = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';

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

const FALLBACK_MESSAGES: Record<string, string> = {
    reconnect:            "Your session expired — tap Reconnect to sign back in.",
    link_account:         "Tap Connect to link your IQ Option account.",
    start_trading:        "Ready? Tap Start Trading to begin.",
    go_home:              "How can I help you?",
    help_contact:         "Contact admin below for help.",
    create_account:       "Create a free IQ Option account to start.",
    fund_account:         "Fund your account to trade live.",
    help_user_id:         "Your User ID is under your name in IQ Option Profile.",
    verify_user_id:       "Enter your User ID number to continue.",
    continue_onboarding:  "Let's continue where you left off.",
};
const FALLBACK_DEFAULT = "Tap below to get started 💜";

type UserSegment = 'non_activated' | 'non_funded' | 'funded';

function getUserSegment(telegramId: number): UserSegment {
    const user = getUser(telegramId);
    if (!user) return 'non_activated';
    if ((user.funded_balance_usd ?? 0) > 0 || hasAccess(user.access_level, 'ai_trading')) return 'funded';
    if (user.ssid_valid === 1 && user.ssid && user.ssid !== '') return 'non_funded';
    return 'non_activated';
}

const nonActivatedResponseCount = new Map<number, number>();
const MAX_NON_ACTIVATED_RESPONSES = 3;
// Reset daily — otherwise a non-activated user who hits the cap is silenced
// forever (the counter never cleared, so the bot ignored all their texts until
// a restart). Daily reset gives them a fresh window each day.
setInterval(() => nonActivatedResponseCount.clear(), 24 * 60 * 60 * 1000);

// Resolve assets dir from env, else from the source layout (src/.. -> assets).
// Warn loudly at startup if the directory doesn't exist so image sends don't
// fail silently every time a wizard step needs to upload a photo.
const __dirname_es = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = process.env.ASSETS_DIR ?? resolve(__dirname_es, '..', 'assets');
if (!existsSync(ASSETS_DIR)) {
    console.error(`[bot] WARNING: assets directory not found at ${ASSETS_DIR} — all photo sends will fail. Set ASSETS_DIR in env.`);
}

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing from .env');

process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    // The SDK's WebSocket teardown ("connection closed unexpectedly", "is closing",
    // "not open") surfaces as background rejections. Log them cleanly — the pool
    // health check + reconnect paths handle recovery; they must not crash the bot.
    if (/websocket|is closing|not open|connection closed/i.test(msg)) {
        console.error('[ws] unhandled WebSocket rejection (non-fatal):', msg);
        return;
    }
    console.error('[unhandledRejection]', reason);
});

// ─── Admin notification queue ─────────────────────────────────────────────────
// Defers admin notifications when admin is actively using the portal.
// Notifications are queued and delivered 20 min after the last admin activity.
const adminNotificationQueue: { msg: string; parseMode?: any }[] = [];
let adminNotificationTimer: NodeJS.Timeout | null = null;

function touchAdminActivity(): void {
    if (adminNotificationTimer) clearTimeout(adminNotificationTimer);
    adminNotificationTimer = setTimeout(flushAdminNotifications, 20 * 60 * 1000);
}

/** Send to admin; if the dynamic content breaks Markdown entity parsing, retry
 *  as plain text so the message still lands and the error log stays clean. */
async function sendAdminMessage(msg: string, parseMode: any): Promise<void> {
    try {
        await bot.telegram.sendMessage(getAdminId(), msg, { parse_mode: parseMode ?? 'Markdown' });
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (/can't parse entities|can't find end of the entity|reserved/i.test(errMsg)) {
            try { await bot.telegram.sendMessage(getAdminId(), msg); return; } catch { /* fall through to log */ }
        }
        console.error(`[notifyAdmin] send failed: ${errMsg}`);
    }
}

async function notifyAdmin(msg: string, parseMode?: any): Promise<void> {
    if (adminNotificationTimer) {
        adminNotificationQueue.push({ msg, parseMode });
        return;
    }
    await sendAdminMessage(msg, parseMode);
}

function flushAdminNotifications(): void {
    adminNotificationTimer = null;
    const queue = adminNotificationQueue.splice(0);
    if (queue.length === 0) return;
    for (const n of queue) {
        sendAdminMessage(n.msg, n.parseMode).catch(() => {});
    }
}

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity });

// ── Central send guard: topic-aware 400 handling + per-chat backoff (fixes #4/#5)
// All send* calls funnel through telegram.callApi. A chat that returns repeated
// 400s (e.g. a forum/topic channel needing message_thread_id, or a bad chat) is
// suppressed for 5 minutes after >5 errors in 60s — stopping the retry/log spam
// that was contributing to the event-loop backlog. We can't know the right
// thread id, so per the directive we skip the chat rather than retry.
const sendErrWindow = new Map<string, number[]>();
const sendSuppressedUntil = new Map<string, number>();
{
    const origCallApi = bot.telegram.callApi.bind(bot.telegram) as (...args: any[]) => Promise<any>;
    (bot.telegram as any).callApi = async (method: string, payload: any, ...rest: any[]) => {
        const chatId = (method?.startsWith('send') && payload?.chat_id != null) ? String(payload.chat_id) : null;
        if (chatId) {
            const until = sendSuppressedUntil.get(chatId) ?? 0;
            if (Date.now() < until) {
                throw new Error(`[send-guard] chat ${chatId} suppressed after repeated 400s`);
            }
        }
        try {
            return await origCallApi(method, payload, ...rest);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (chatId && /\b400\b|bad request|topic must be specified|thread not found|chat not found/i.test(msg)) {
                const now = Date.now();
                const arr = (sendErrWindow.get(chatId) ?? []).filter(t => now - t < 60_000);
                arr.push(now);
                sendErrWindow.set(chatId, arr);
                if (arr.length > 5 && (sendSuppressedUntil.get(chatId) ?? 0) < now) {
                    sendSuppressedUntil.set(chatId, now + 5 * 60_000);
                    console.error(`[send-guard] suppressing chat ${chatId} for 5min after ${arr.length} 400s in 60s: ${msg}`);
                }
            }
            throw err;
        }
    };
}

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
    const cbUser = ctx.from?.id;
    const label = (ctx.callbackQuery as { data?: string }).data?.substring(0, 20) ?? 'unknown';
    if (cbUser) console.log(`[callback] uid=${cbUser} data=${label}`);
    await next();
    const elapsed = Date.now() - start;
    if (elapsed > 3000) console.log(`[slow] callback ${label}: ${elapsed}ms`);
});

// Admin gate: callback_data is client-supplied — anyone can craft an admin:* query
// even though the buttons are only rendered for the admin. Block privileged
// prefixes centrally; per-handler guards remain as defence in depth.
// NOT gated (user-facing): giveaway:participate:*, promo:claim:*, marathon:leaderboard:*,
// page:*, ui:*, onboard:*, wizard:*, mode/amt/cur/pair/tf/martingale/upsell/upgrade.
const ADMIN_CALLBACK_PREFIXES = [
    'admin:', 'member:', 'broadcast:', 'broadcast_btn:', 'broadcast_action:',
    'bcast_cancel:', 'bcast_delay:', 'bcast_timer:',
    'compose:', 'compose_tone:', 'compose_btn:', 'compose_delivery:', 'compose_topic:',
    'diary:', 'activation:', 'trader_edit:', 'user_action:', 'user_detail:',
    'giveaway_v2:', 'giveaway_activate:', 'giveaway_criteria:', 'giveaway_delete:',
    'giveaway_end:', 'giveaway_participants:', 'giveaway_schedule:', 'giveaway_type:',
    'giveaway_view:', 'giveaway_winners:', 'giveaway_winners_confirm:',
    'giveaway:all', 'giveaway:24h',
    'marathon_duration:', 'marathon_schedule:', 'promo_schedule:',
    'llm:cat:', 'media:select:', 'token_tier:',
    'reviews:',
];
bot.use(async (ctx, next) => {
    const data = (ctx.callbackQuery as { data?: string } | undefined)?.data;
    if (data && ADMIN_CALLBACK_PREFIXES.some(p => data.startsWith(p)) && ctx.from?.id !== getAdminId()) {
        console.warn(`[security] blocked admin callback "${data.slice(0, 40)}" from non-admin ${ctx.from?.id}`);
        await ctx.answerCbQuery('⛔ Not authorized.').catch(() => {});
        return;
    }
    return next();
});

// UI-disabled gate — blocks all interactions for users flagged ui_disabled=1
bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid || uid === getAdminId()) return next();
    const user = getUser(uid);
    if (user?.ui_disabled) {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('⚠️ Error: Something went wrong. Please try again later.').catch(() => {});
        }
        return;
    }
    return next();
});

// Non-private chat guard — ignore text messages from supergroups/channels
// (prevents 400 "topic must be specified" errors from onboarding channel).
// Callbacks still pass through so inline buttons work everywhere.
bot.use(async (ctx, next) => {
    if (ctx.message && ctx.chat?.type !== 'private') {
        return;
    }
    return next();
});

const MAX_ROUNDS       = 6;
const ROUND_COOLDOWN_MS = 5_000;

// The whole bot sends parse_mode:'Markdown' (legacy), where only _ * ` [ are
// escapable. A V2-style escape (also escaping . ! - = etc.) renders literal
// backslashes under legacy and — if the bot's default parse mode is V2 — can
// trigger "Character '-' is reserved" parse errors. So escapeMd == legacy escape.
function escapeMd(s: string): string { return s.replace(/[_*`[]/g, '\\$&'); }
function escapeMdLegacy(s: string): string { return s.replace(/[_*`[]/g, '\\$&'); }

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
type WizardStep = 'mode' | 'currency' | 'amount' | 'timeframe' | 'pair' | 'gale' | 'custom_amount';

interface WizardState {
    step: WizardStep;
    mode?: 'demo' | 'live';
    currency?: string;
    amount?: number;
    timeframe?: number;
    pair?: string;
    gale?: number;
    lastImageMsgId?: number;
}
const wizardSessions = makeSessionMap<WizardState>('wizard');

type OnboardStep = 'user_id' | 'create_user_id' | 'connect_email' | 'connect_password' | 'auto_create_email' | 'verify';
interface OnboardState {
    step: OnboardStep;
    tier?: string;
    iqUserId?: number;
    email?: string;
    loginFailCount?: number;
    // 2FA verification flow (email / SMS / push)
    password?: string;
    verifyToken?: string;
    verifyMethod?: string;
    verifyMethods?: string[];
    verifyUseProxy?: boolean;
    verifyTarget?: 'user' | 'admin';
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
    composeCta?: 'start' | 'trade' | 'fund' | 'contact' | 'yacht' | 'none';
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
    media?: Array<{ type: 'photo' | 'video' | 'video_note' | 'voice'; fileId: string }>;
    button?: BroadcastButton;
    deleteAfterMs?: number;
    createdAt?: number;
}>();
// Abandoned broadcast drafts (admin starts a flow, never sends) otherwise sit in
// memory forever — sweep anything older than 1 hour.
setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [chatId, p] of pendingBroadcasts) {
        if ((p.createdAt ?? 0) < cutoff) pendingBroadcasts.delete(chatId);
    }
}, 10 * 60 * 1000);

interface ScheduledBroadcast {
    id: number;
    message: string;
    targetIds: number[];
    button?: BroadcastButton;
    media?: Array<{ type: 'photo' | 'video' | 'video_note' | 'voice'; fileId: string }>;
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
    media?: Array<{ type: 'photo' | 'video' | 'video_note' | 'voice'; fileId: string }>;
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
            if (p.media && p.media.length > 1) {
                const tgMedia = p.media.map((med, i) => ({
                    type: med.type as 'photo' | 'video' | 'video_note',
                    media: med.fileId,
                    ...(i === 0 ? { caption: p.message, parse_mode: 'Markdown' as const } : {}),
                }));
                m = (await bot.telegram.sendMediaGroup(userId, tgMedia as any))[0];
                if (p.button) {
                    await bot.telegram.sendMessage(userId, '📌', { reply_markup: rm }).catch(() => {});
                }
            } else if (p.media?.[0]?.type === 'photo') {
                m = await bot.telegram.sendPhoto(userId, p.media[0].fileId, { caption: p.message, ...(rm ? { reply_markup: rm } : {}) });
            } else if (p.media?.[0]?.type === 'video') {
                m = await bot.telegram.sendVideo(userId, p.media[0].fileId, { caption: p.message, ...(rm ? { reply_markup: rm } : {}) });
            } else if (p.media?.[0]?.type === 'video_note') {
                m = await bot.telegram.sendVideoNote(userId, p.media[0].fileId);
                if (p.message.trim()) {
                    await bot.telegram.sendMessage(userId, p.message, rm ? { reply_markup: rm } : undefined).catch(() => {});
                } else if (rm) {
                    await bot.telegram.sendMessage(userId, '📌', { reply_markup: rm }).catch(() => {});
                }
            } else if (p.media?.[0]?.type === 'voice') {
                m = await bot.telegram.sendVoice(userId, p.media[0].fileId);
                if (p.message.trim()) {
                    await bot.telegram.sendMessage(userId, p.message, rm ? { reply_markup: rm } : undefined).catch(() => {});
                } else if (rm) {
                    await bot.telegram.sendMessage(userId, '📌', { reply_markup: rm }).catch(() => {});
                }
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
    media?: Array<{ type: 'photo' | 'video' | 'video_note' | 'voice'; fileId: string }>;
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
            // Resolve @username placeholder to actual first name
            const name = await resolveUsernameForId(bot, uid);
            const personalized = resolveUsernameTemplate(message, name);
            if ((activeTradeSessions.get(uid) ?? 0) > 0) {
                const q = pendingDeliveries.get(uid) ?? [];
                q.push({ message: personalized, button, media, deleteAfterMs });
                while (q.length > MAX_PENDING_PER_USER) q.shift();
                pendingDeliveries.set(uid, q);
                deferredCount++;
                continue;
            }
            let m;
            if (media && media.length > 1) {
                const tgMedia = media.map((med, i) => ({
                    type: med.type as 'photo' | 'video' | 'video_note' | 'voice',
                    media: med.fileId,
                    ...(i === 0 ? { caption: personalized, parse_mode: 'Markdown' as const } : {}),
                }));
                m = (await bot.telegram.sendMediaGroup(uid, tgMedia as any))[0];
                if (replyMarkup) {
                    await bot.telegram.sendMessage(uid, '📌', { reply_markup: replyMarkup }).catch(() => {});
                }
            } else if (media?.[0]?.type === 'photo') {
                m = await bot.telegram.sendPhoto(uid, media[0].fileId, { caption: personalized, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
            } else if (media?.[0]?.type === 'video') {
                m = await bot.telegram.sendVideo(uid, media[0].fileId, { caption: personalized, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
            } else if (media?.[0]?.type === 'video_note') {
                m = await bot.telegram.sendVideoNote(uid, media[0].fileId);
                if (personalized.trim()) {
                    await bot.telegram.sendMessage(uid, personalized, replyMarkup ? { reply_markup: replyMarkup } : undefined).catch(() => {});
                } else if (replyMarkup) {
                    await bot.telegram.sendMessage(uid, '📌', { reply_markup: replyMarkup }).catch(() => {});
                }
            } else if (media?.[0]?.type === 'voice') {
                m = await bot.telegram.sendVoice(uid, media[0].fileId);
                if (personalized.trim()) {
                    await bot.telegram.sendMessage(uid, personalized, replyMarkup ? { reply_markup: replyMarkup } : undefined).catch(() => {});
                } else if (replyMarkup) {
                    await bot.telegram.sendMessage(uid, '📌', { reply_markup: replyMarkup }).catch(() => {});
                }
            } else {
                m = await bot.telegram.sendMessage(uid, personalized, replyMarkup ? { reply_markup: replyMarkup } : undefined);
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
                media: row.media as Array<{ type: 'photo' | 'video' | 'video_note' | 'voice'; fileId: string }> | undefined,
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

/**
 * Recompute and persist a user's product access from their live real balance.
 * Replaces the old tier auto-promotion. Returns the resolved access level (or
 * null when no conversion rate was available — caller should not re-gate then).
 * Fires user_funded / user_unfunded funnel events on the funded transition.
 */
async function syncAccessFromBalance(
    telegramId: number,
    realAmount: number,
    currency: string,
    sdk: ClientSdk,
): Promise<string | null> {
    const usdAmount = await convertToUsd(realAmount, currency, sdk);
    if (usdAmount === null) return null; // unknown rate — never re-gate
    const prev = getUser(telegramId);
    const wasFunded = (prev?.funded_balance_usd ?? 0) > 0;
    // Only a live (non-expired) upgrade token should override the balance. Without
    // an active token the current access_level is balance-derived, so we pass NO
    // token grant — letting the balance purely decide (and allowing a drop to
    // downgrade the user). Passing the current level here would make access a
    // one-way ratchet that can never be lowered.
    const hasActiveToken = !!prev?.access_expires_at && new Date(prev.access_expires_at) > new Date();
    const tokenGrant = hasActiveToken ? getProduct(prev?.access_level) : undefined;
    const newAccess = resolveAccess(usdAmount, tokenGrant, prev?.access_expires_at);
    // Preserve the expiry only for an active token; otherwise clear any stale one.
    setUserFundedBalance(telegramId, usdAmount, newAccess, hasActiveToken ? prev?.access_expires_at : null);
    if (!wasFunded && usdAmount > 0) insertFunnelEvent('user_funded', JSON.stringify({ telegram_id: telegramId }));
    if (wasFunded && usdAmount <= 0) insertFunnelEvent('user_unfunded', JSON.stringify({ telegram_id: telegramId }));
    return newAccess;
}

/** Best-effort: query the user's LIVE IQ Option balance and refresh their
 *  funded_balance_usd + access_level in the DB. Silent no-op on any failure
 *  (no SSID, timeout, network) so callers can fall back to the cached value.
 *  Handles auth expiry with one reconnect+retry. */
async function refreshFundedBalanceFromLive(uid: number): Promise<void> {
    let ssid = getSsidForUser(uid);
    if (!ssid) return; // never connected — nothing to refresh
    const fetchAndSync = async (sid: string): Promise<void> => {
        const sdk = await sdkPool.get(uid, sid);
        try {
            const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
            const real = all.find(b => b.type === BalanceType.Real);
            // No real balance → treat as $0; syncAccessFromBalance will keep them gated.
            await syncAccessFromBalance(uid, real?.amount ?? 0, real?.currency ?? 'USD', sdk);
        } finally {
            sdkPool.release(uid);
        }
    };
    try {
        await fetchAndSync(ssid);
    } catch (err) {
        if (isAuthExpiredError(err)) {
            if (await autoReconnect(uid)) {
                ssid = getSsidForUser(uid);
                if (ssid) { try { await fetchAndSync(ssid); } catch (e) { logger.warn('bot', `balance refresh retry failed for ${uid}: ${e instanceof Error ? e.message : e}`); } }
            } else {
                // Reconnect failed (bad creds / decode error): invalidate the SSID so
                // the user is routed to reconnect instead of silently stuck.
                clearUserSsid(uid);
                setSsidValid(uid, 0);
                logger.warn('bot', `SSID cleared for user ${uid} after failed reconnect during balance refresh`);
            }
        } else {
            // Timeout/network: keep the cached value but record why (C6).
            logger.warn('bot', `balance refresh failed for ${uid} (using cached): ${err instanceof Error ? err.message : err}`);
        }
    }
}

// Per-user in-flight guard so rapid button mashing doesn't fire parallel SDK
// balance calls (C3). Concurrent callers await the same refresh promise.
const balanceRefreshInFlight = new Map<number, Promise<void>>();

/** Access gate that refreshes the live balance FIRST if the user currently lacks
 *  access — so a deposit made after connecting unlocks them immediately instead
 *  of being blocked by a stale DB cache. Admin and token holders short-circuit. */
async function hasAccessLive(uid: number, need: Product): Promise<boolean> {
    if (uid === getAdminId()) return true;
    if (hasAccess(getUser(uid)?.access_level, need)) return true;
    // Coalesce concurrent refreshes for the same user into one SDK call (C3).
    let refresh = balanceRefreshInFlight.get(uid);
    if (!refresh) {
        refresh = refreshFundedBalanceFromLive(uid).finally(() => balanceRefreshInFlight.delete(uid));
        balanceRefreshInFlight.set(uid, refresh);
    }
    await refresh;
    return hasAccess(getUser(uid)?.access_level, need);
}

function isAuthExpiredError(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes('authenticat') || msg.includes('authoriz') || msg.includes('unauthor')
        || msg.includes('ssid') || msg.includes('session expired') || msg.includes('not authenticated')
        || msg.includes('invalid token') || msg.includes('401')
        || msg.includes('wrong credentials') || msg.includes('invalid_credentials');
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
        const { ssid } = await loginAndCaptureSsid(email, password);
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
        const { ssid, sdk } = await loginAndCaptureSsid(email, password);
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
        try { clearUserSsid(ctx.from.id); } catch (e) { console.error(`[auth] clearUserSsid failed for ${ctx.from.id}:`, e instanceof Error ? e.message : e); }
        try { setSsidValid(ctx.from.id, 0); } catch (e) { console.error(`[auth] setSsidValid failed for ${ctx.from.id}:`, e instanceof Error ? e.message : e); }
    }
    await ctx.reply(
        '🔐 Your session expired.\n\nReconnect in 3 steps:\n1️⃣ Tap the 🔗 Reconnect button below\n2️⃣ Enter your IQ Option email and password\n3️⃣ Get back to trading instantly',
        { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: isAdmin ? 'admin:trade_connect' : 'ui:connect' }]] } }
    ).catch(() => {});
    return true;
}

/** Thrown when IQ Option requires email 2FA before issuing an SSID. Carries the
 *  verify token + method and which transport (proxy/direct) the login used, so the
 *  follow-up verify call goes over the SAME path. */
class VerifyRequiredError extends Error {
    token: string;
    method: string;
    availableMethods: string[];
    useProxy: boolean;
    constructor(token: string, method: string, useProxy: boolean, availableMethods: string[] = []) {
        super('VERIFY_REQUIRED');
        this.name = 'VerifyRequiredError';
        this.token = token;
        this.method = method;
        this.availableMethods = availableMethods;
        this.useProxy = useProxy;
    }
}

/** Human description of where IQ Option sent the 2FA code, so the prompt matches
 *  reality (email vs SMS vs push) instead of always saying "email". */
function verifyMethodLabel(method: string): string {
    switch ((method || '').toLowerCase()) {
        case 'sms':   return '📱 A verification code has been sent to your phone (SMS).';
        case 'push':  return '🔔 Approve the login from the IQ Option push notification, then enter the code shown (if any).';
        case 'email': return '📧 A verification code has been sent to your email.';
        default:      return `📧 A verification code has been sent via ${method || 'email'}.`;
    }
}

/** Single login attempt. Builds the request, optionally through the proxy, and returns the SSID + ready SDK. */
async function attemptLogin(email: string, password: string, useProxy: boolean): Promise<{ ssid: string; sdk: ClientSdk }> {
    const fetchOptions: RequestInit & { dispatcher?: any } = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
        body: JSON.stringify({ identifier: email, password }),
    };
    const proxyUrl = getProxyUrl();
    if (useProxy && proxyUrl) {
        fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
    }
    const res = await fetch(`${IQ_AUTH_URL}/v2/login`, fetchOptions);
    const rawBody = await res.text();
    console.log(`[connect] (${useProxy ? 'proxy' : 'direct'}) HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
    let data: { code?: string; message?: string; ssid?: string; token?: string; method?: string; available_methods?: string[] };
    try { data = JSON.parse(rawBody); } catch {
        throw new Error(`Login response is not JSON (HTTP ${res.status}): ${rawBody.slice(0, 100)}`);
    }
    // IQ Option asks for a 2FA code — surface a typed error carrying the actual
    // delivery method and the available methods so the prompt matches where the
    // code was really sent (email/SMS/push), not a hardcoded "email".
    if (data.code === 'verify' && data.token) {
        throw new VerifyRequiredError(data.token, data.method ?? 'email', useProxy, data.available_methods ?? []);
    }
    if (data.code !== 'success' || !data.ssid) throw new Error(data.message ?? 'Login failed');
    const ssid = data.ssid;
    const sdk = await createSdk(ssid);
    return { ssid, sdk };
}

/** Submit the 6-digit email code to complete a 2FA login. Uses the same transport
 *  (proxy/direct) as the originating login so the verify token stays valid. */
async function verify2FA(code: string, token: string, method: string, useProxy: boolean): Promise<{ ssid: string }> {
    const fetchOptions: RequestInit & { dispatcher?: any } = {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Referer': 'https://iqoption.com/en/login',
            'Sec-Fetch-Mode': 'cors',
            'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36',
        },
        body: JSON.stringify({ code, token, method }),
    };
    const proxyUrl = getProxyUrl();
    if (useProxy && proxyUrl) {
        fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
    }
    const res = await fetch(`${IQ_AUTH_URL}/v2/verify/2fa`, fetchOptions);
    const rawBody = await res.text();
    console.log(`[verify] HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
    let data: { code?: string; message?: string; ssid?: string };
    try { data = JSON.parse(rawBody); } catch {
        throw new Error(`Verify response is not JSON (HTTP ${res.status})`);
    }
    if (data.code === 'invalid_code') {
        throw new Error('Invalid verification code. Please check your email and try again.');
    }
    if (data.code !== 'success' || !data.ssid) {
        throw new Error(data.message ?? 'Verification failed');
    }
    return { ssid: data.ssid };
}

/** Park a login that needs a 2FA code: stash the session and prompt for the code,
 *  telling the user the ACTUAL delivery method (email/SMS/push). A "Resend code"
 *  button re-runs the login to trigger a fresh code. The awaiting_verification
 *  text handler completes it (user or admin). */
async function routeToVerification(
    ctx: Context, chatId: number, email: string, password: string,
    err: VerifyRequiredError, target: 'user' | 'admin',
): Promise<void> {
    onboardSessions.set(chatId, {
        step: 'verify', email, password,
        verifyToken: err.token, verifyMethod: err.method, verifyMethods: err.availableMethods,
        verifyUseProxy: err.useProxy, verifyTarget: target,
    });
    setOnboardingState(ctx.from!.id, 'awaiting_verification');
    await ctx.reply(
        `${verifyMethodLabel(err.method)}\n\nPlease enter the 6-digit code below:`,
        { reply_markup: { inline_keyboard: [[{ text: '🔄 Resend code', callback_data: 'verify:resend' }]] } },
    );
}


// Proxy fallback chain: try proxy → on failure fall back to a direct connection
// immediately (user never waits) and rotate the proxy in the background so the
// next login uses a fresh IP. Bad credentials short-circuit — no fallback/rotate.
async function loginAndCaptureSsid(email: string, password: string): Promise<{ ssid: string; sdk: ClientSdk }> {
    if (getProxyUrl()) {
        try {
            return await attemptLogin(email, password, true);
        } catch (err) {
            // 2FA required: login itself succeeded up to the code step — do NOT
            // rotate the proxy or fall back to direct (the verify token is bound to
            // this transport). Pass the typed error straight to the caller.
            if (err instanceof VerifyRequiredError) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('invalid_credentials') || msg.includes('wrong credentials')) throw err;
            console.warn(`[connect] proxy login failed (${msg}) — falling back to direct + rotating proxy`);
            triggerProxyRotation().catch(() => {});
            // fall through to direct
        }
    }
    return attemptLogin(email, password, false);
}

// ─── Start menu ───────────────────────────────────────────────────────────────

async function sendStartMenu(ctx: Context): Promise<void> {
    const telegramId = ctx.from!.id;

    if (telegramId === getAdminId()) {
        const stats = getApprovalStats();
        await ctx.reply(
            `🛡️ *Admin Dashboard*\n\n` +
            `👥 Users: ${stats.total} total | ✅ ${stats.approved} approved | ⏳ ${stats.pending} pending | ❌ ${stats.rejected} rejected\n` +
            `📡 Signals used today: ${getTotalSignalsToday()}`,
            { parse_mode: 'Markdown', reply_markup: adminKeyboard() }
        );
        return;
    }

    const user = getUser(telegramId);

    if (!user || user.approval_status === 'pending') {
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
    const access = getProduct(user.access_level);
    const productLabel = getProductConfig(user.access_level).label;
    const accessEmoji = access === 'auto_trading' ? '🚀' : access === 'ai_trading' ? '🤖' : '⚡';
    const pnlSign   = ss.pnl >= 0 ? '+' : '';

    // Daily signal quota line — only shown to unfunded users on Signals access.
    let signalsLine = '';
    if (access === 'signals' && (user.funded_balance_usd ?? 0) <= 0) {
        const { used } = getSignalUsage(telegramId);
        signalsLine = `${Math.max(0, FREE_SIGNALS_PER_DAY - used)} signals remaining today`;
    }

    const ssid = getSsidForUser(telegramId);
    const cached = ssid ? getUserBalanceCache(telegramId) : undefined;
    const cachedLine = (cached && Date.now() - cached.ts < BALANCE_CACHE_TTL) ? cached.line : '';
    const needsFetch = !!ssid && !cachedLine;

    const buildMenu = (balLine: string) => [
        `10x — Home`, ``,
        `Access: ${accessEmoji} ${productLabel}`,
        balLine ? `Balance: ${balLine}` : '',
        signalsLine,
        `Session: ${ss.trades} trade${ss.trades !== 1 ? 's' : ''} · ${pnlSign}$${Math.abs(ss.pnl).toFixed(2)}`,
        ``, `What now? 👇`,
    ].filter(l => l !== '').join('\n');

    const sentMsg = await ctx.reply(buildMenu(cachedLine), { reply_markup: startKeyboard(user.access_level ?? undefined) });

    // Show active giveaway card if any
    const activeGiveaways = getActiveGiveaways();
    if (activeGiveaways.length > 0) {
        const giveaway = activeGiveaways[0];
        const prizeText = giveaway.prize_pool != null ? `\nPrize Pool: *$${giveaway.prize_pool.toFixed(2)}*` : '';
        // All users can participate in giveaways now (directive §8.1).
        const giveawayCard = [
            `🎁 *LIVE GIVEAWAY*`,
            `*${escapeMdLegacy(giveaway.title)}*`,
            prizeText,
        ].filter(l => l !== '').join('\n');
        const giveawayMarkup = { inline_keyboard: [[{ text: '🎯 Participate', callback_data: `giveaway:participate:${giveaway.id}` }]] };
        await ctx.reply(giveawayCard, { parse_mode: 'Markdown', reply_markup: giveawayMarkup });
    }

    if (ssid) {
        const chatId = ctx.chat!.id;
        const msgId  = sentMsg.message_id;
        let accessForKbd = user.access_level ?? undefined;
        setImmediate(async () => {
            try {
                const sdk = await sdkPool.get(telegramId, ssid!);
                const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
                const demo = all.find(b => b.type === BalanceType.Demo);
                const real = all.find(b => b.type === BalanceType.Real);
                if (real?.currency) saveUserCurrency(telegramId, real.currency);
                else if (demo?.currency) saveUserCurrency(telegramId, demo.currency);
                // Recompute product access from the funded (real) balance in USD.
                // Routed through syncAccessFromBalance so the token/downgrade and
                // funnel-event logic lives in exactly one place (A3).
                if (real) {
                    const currency = real.currency ?? 'USD';
                    const newAccess = await syncAccessFromBalance(telegramId, real.amount, currency, sdk);
                    if (newAccess) {
                        if (newAccess !== getProduct(user.access_level)) {
                            logger.info('bot', `user ${telegramId} access → ${newAccess} (balance ${currency} ${real.amount.toFixed(2)})`);
                        }
                        accessForKbd = newAccess;
                        user.access_level = newAccess;
                        user.funded_balance_usd = getUser(telegramId)?.funded_balance_usd ?? user.funded_balance_usd;
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
                            { reply_markup: startKeyboard(accessForKbd) });
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
    // Declared out here so the finally can shut it down (see auth-retry below).
    let createdAdminSdk: ClientSdk | undefined;
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

    // SDK can drop between analysis and execution (or between rounds). Keep a
    // mutable handle so an auth-expiry reconnect can swap in a fresh connection
    // for the rest of the run. authRetried bounds it to one reconnect per run.
    let activeSdk = existingSdk;
    let activeSsid = ssid;
    let authRetried = false;
    const isAdminUser = userId === getAdminId();

    // Render the standard "trade could not be placed" message (used when a trade
    // fails for good, including after an exhausted auth retry).
    const showTradeError = async (err: unknown): Promise<void> => {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        logLines[logLines.length - 1] = `⚡ Trade 1|⚠️ ${fmtMoney(currentAmount, currency)} → error`;
        await syncLog();
        const isBalanceError = /4112|investment amount|smaller.*minimum|insufficient.*balance/i.test(errMsg);
        const catchReply = isBalanceError
            ? await ctx.reply(
                '🚫 *You do not have an active balance*\n\nFund your account now with as little as $10 to start trading.',
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                    [{ text: '💳 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit' }],
                    [{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }],
                ] } }
            )
            : await ctx.reply(friendlyError(err, '⚠️ Trade could not be placed. Try again.'), {
                reply_markup: { inline_keyboard: [[{ text: '🔄 New Opportunity', callback_data: 'ui:trade' }]] },
            });
        sentMessages.push(catchReply.message_id);
        scheduleCleanup();
    };

    for (let round = 1; round <= effectiveRounds + 1; round++) {
        logLines.push(`⚡ Trade 1|🟡 ${fmtMoney(currentAmount, currency)} → in flight`);
        await syncLog();

        const roundTrade: TradeRequest = { pair, direction, amount: currentAmount, martingaleRunId: runId, timeframeSec, balanceType, telegramId: ctx.from!.id };

        const execRound = (): Promise<TradeResult> =>
            activeSdk
                ? withTimeout(executeTradeWithSdk(activeSdk, roundTrade), roundTimeoutMs, 'trade')
                : withTimeout(executeTrade(activeSsid, roundTrade), roundTimeoutMs, 'trade');

        let result: TradeResult = { status: 'ERROR', error: '', pnl: 0, tradeId: 0, pair: '', direction: '', amount: 0 };
        try {
            result = await execRound();
        } catch (err: unknown) {
            // Auth expiry mid-trade: reconnect once and rebuild the SDK with a
            // fresh SSID, then retry this round (directive Fix 1). Only retry once
            // per run, and only for auth errors.
            if (isAuthExpiredError(err) && !authRetried) {
                authRetried = true;
                const reconnected = isAdminUser ? await adminAutoReconnect() : await autoReconnect(userId);
                const freshSsid = isAdminUser ? getAdminSsid() : getSsidForUser(userId);
                if (reconnected && freshSsid) {
                    activeSsid = freshSsid;
                    try {
                        if (isAdminUser) {
                            createdAdminSdk = await createSdk(freshSsid);
                            activeSdk = createdAdminSdk;
                        } else {
                            activeSdk = await sdkPool.get(userId, freshSsid);
                        }
                    } catch { /* keep prior handle; execRound falls back to ssid path */ }
                    try {
                        result = await execRound();
                    } catch (err2: unknown) {
                        await showTradeError(err2);
                        return;
                    }
                } else {
                    await showTradeError(err);
                    return;
                }
            } else if (/WebSocket.*clos|ws.*clos|socket.*clos/i.test(err instanceof Error ? err.message : String(err)) && !authRetried) {
                // WebSocket died mid-trade — rebuild SDK and treat as a loss.
                // Don't abandon the chain just because the connection dropped.
                authRetried = true;
                const errMsg = err instanceof Error ? err.message : String(err);
                const freshSsid = isAdminUser ? getAdminSsid() : getSsidForUser(userId);
                if (freshSsid) {
                    try {
                        if (isAdminUser) {
                            createdAdminSdk = await createSdk(freshSsid);
                            activeSdk = createdAdminSdk;
                        } else {
                            activeSdk = await sdkPool.get(userId, freshSsid);
                        }
                        activeSsid = freshSsid;
                    } catch { /* rebuild failed */ }
                }
                // Synthetic loss result — the fall-through (roundPnl, session stats,
                // log line, and the ERROR block below) does all the accounting ONCE.
                // Don't deduct totalPnl / record stats here or it double-counts.
                result = { status: 'ERROR', error: errMsg, pnl: 0, tradeId: 0, pair: '', direction: '', amount: 0 };
                // Fall through to LOSS path below
            } else {
                await showTradeError(err);
                return;
            }
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
        } else if (result.status === 'ERROR') {
            const errMsg = result.error ?? '';
            if (/4100|4112|4113|insufficient.*(funds|balance)|balance.*(insufficient|low|empty)|amount.*(higher|smaller).*allowed|minimum|smaller.*minimum/i.test(errMsg)) {
                logLines[lastIdx] = `⚡ Trade 1|🚫 ${fmtMoney(currentAmount, currency)} → insufficient balance`;
                await syncLog();
                await ctx.reply(
                    '🚫 *Insufficient balance*\\n\\nFund your account to continue trading.',
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                        [{ text: '💳 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit' }],
                    ] } }
                ).catch(() => {});
                return;
            }
            logLines[lastIdx] = `⚡ Trade 1|⚠️ ${fmtMoney(currentAmount, currency)} → ${result.error ?? result.status}`;
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
            incrementProductUsage(ctx.from!.id, 'ai_trading'); // new product-level tracking
            demoCounted = true;
        }

        if (result.status === 'WIN' || result.status === 'LOSS' || result.status === 'TIE') {
            addUserSessionStats(ctx.from!.id, 1, roundPnl);
            giveawayRecordTrade(ctx.from!.id, round > 1);
        }

        if (result.status === 'WIN') {
            updateLeaderboardAuto(ctx.from!.id, result.pnl);
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

        if (result.status === 'TIE') {
            // OTC Blitz ties are common — price didn't move enough. Instead of
            // killing the martingale chain (old behaviour), treat it as a neutral
            // round and continue the recovery. Stake doubles, bot fights on.
            logLines[logLines.length - 1] = `⚡ Trade 1|⚪ ${fmtMoney(currentAmount, currency)} → tied`;
            await syncLog();
            // Fall through to recovery continuation below
        }

        if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
            // Treat timeout/error like a loss — continue the recovery chain instead
            // of abandoning the user. The trade may have actually resolved on IQ's
            // side; we just didn't get the result in time. Doubling down keeps the
            // martingale engine running rather than leaving the user stranded.
            logLines[logLines.length - 1] = `⚡ Trade 1|🔴 ${fmtMoney(currentAmount, currency)} → ${result.error ?? result.status}`;
            await syncLog();
            // totalPnl was already reduced by roundPnl (= -currentAmount) above; only
            // record the session stat here (the WIN/LOSS/TIE block skips ERROR).
            addUserSessionStats(ctx.from!.id, 1, -currentAmount);

            // If the SDK WebSocket died (common after timeouts), rebuild it before
            // the next round. Otherwise every subsequent round fails the same way.
            const errMsg = result.error ?? '';
            if (/WebSocket.*clos|ws.*clos|socket.*clos/i.test(errMsg) && !authRetried) {
                authRetried = true;
                const freshSsid = isAdminUser ? getAdminSsid() : getSsidForUser(userId);
                if (freshSsid) {
                    try {
                        if (isAdminUser) {
                            createdAdminSdk = await createSdk(freshSsid);
                            activeSdk = createdAdminSdk;
                        } else {
                            activeSdk = await sdkPool.get(userId, freshSsid);
                        }
                        activeSsid = freshSsid;
                    } catch { /* SDK rebuild failed — continue with dead handle, will exhaust */ }
                }
            }
            // Fall through to LOSS path below — continue recovery
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
        // Shut down a replacement admin SDK created during an auth retry (the
        // caller's finally only knows about the original handle).
        if (createdAdminSdk) { try { await createdAdminSdk.shutdown(); } catch {} }
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
        `/help — Help & FAQ\n` +
        `/connect — Reconnect your IQ Option account\n` +
        `/balance — Check your balances\n` +
        `/access — View your product access`
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
    await ctx.reply('🔄 Reset complete.\n\nUse /start to begin again.');
});

// ─── Account connection choice ────────────────────────────────────────────────

// ─── Old callback stubs — redirect cached keyboards to new onboarding ─────────

bot.action('onboard:yes', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    upgradeSessions.delete(ctx.chat!.id);
    connectSessions.delete(ctx.chat!.id);
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
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.from!.id === getAdminId()) touchAdminActivity();
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'mode') return;
    const mode = ctx.match[1] as 'demo' | 'live';

    if (mode === 'demo') {
        const { used } = getProductUsage(ctx.from!.id, 'ai_trading');
        const cap = PRODUCT_LIMITS.ai_trading.dailyCap;
        if (used >= cap) {
            wizardSessions.delete(chatId);
            await ctx.reply(
                `🎯 You've used all ${cap} demo trades for today.\n\nFund $${PRODUCT_LIMITS.ai_trading.unlockBalance}+ to unlock unlimited live trading 👇`,
                { reply_markup: { inline_keyboard: [
                    [{ text: '💰 Fund Account', url: DEPOSIT_URL }],
                    [{ text: '🔙 Back', callback_data: 'ui:start' }],
                ]}}
            );
            return;
        }
        state.mode = mode;
        state.step = 'currency';
        await ctx.reply(
            `🟣 *Demo Mode* — ${cap} trades/day\n\nFund $${PRODUCT_LIMITS.ai_trading.unlockBalance}+ for unlimited live trading.\n\nSelect your trading currency:`,
            { parse_mode: 'Markdown', reply_markup: currencyKeyboard() }
        );
        return;
    }

    // Live — requires ai_trading access (funded $30+ or token). Unfunded users get
    // the lock here; Demo Mode above stays open to them (Issue 4).
    if (!await hasAccessLive(ctx.from!.id, 'ai_trading')) {
        wizardSessions.delete(chatId);
        await sendAiTradingLock(ctx);
        return;
    }
    // Just verify they have a valid SSID before proceeding
    const user = getUser(ctx.from!.id);
    const hasValidSsid = user?.ssid && user.ssid_valid !== 0;
    if (!hasValidSsid) {
        const isExpired = !!user?.ssid;
        await ctx.reply(
            isExpired
                ? '🔌 Your IQ Option session expired. Reconnect to continue trading 👇'
                : '⚠️ You need to connect your IQ Option account first.\nTap Connect below to get started 👇',
            { reply_markup: { inline_keyboard: [[{ text: isExpired ? '🔗 Reconnect' : '🔗 Connect Account', callback_data: 'ui:connect' }]] } }
        );
        return;
    }

    state.mode = mode;
    state.step = 'currency';
    await ctx.reply('💰 Select your trading currency:', { reply_markup: currencyKeyboard() });
});

// ─── Trade wizard — currency ───────────────────────────────────────────────────

bot.action(/^cur:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'currency') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    if (!state || state.step !== 'amount') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
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
    if (!state || state.step !== 'timeframe') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {}); // stop spinner immediately before slow image upload
    if (ctx.from!.id === getAdminId()) touchAdminActivity();
    state.timeframe = parseInt(ctx.match[1], 10);
    state.step = 'pair';
    if (state.lastImageMsgId) {
        try { await ctx.telegram.deleteMessage(ctx.chat!.id, state.lastImageMsgId); } catch {}
    }
    try { const m = await sendCachedAsset(ctx, 'L6.png'); state.lastImageMsgId = m?.message_id; } catch {}
    const picks = getTopPicks();
    const medals = ['🏆', '🥇', '🥈', '🥉', '4️⃣'];
    let picksMsg = 'Top picks ready 🎯\n\nHighest chance to win right now:\n\n';
    if (picks.length > 0) {
        picks.forEach((p, i) => { picksMsg += `${medals[i] ?? `${i + 1}.`} ${p.pair} — Win rate ≈${clampDisplayConfidence(p.winRate)}%\n`; });
    } else {
        picksMsg += '🏆 EUR/USD OTC\n🥇 GBP/USD OTC\n🥈 EUR/JPY OTC\n';
    }
    picksMsg += '\n🚀 Make your choice below 👇';
    try { await ctx.editMessageText(picksMsg, { reply_markup: pairKeyboard(0) }); } catch {}
});

// ─── Trade wizard — pair pagination ──────────────────────────────────────────

bot.action(/^page:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try { await ctx.editMessageReplyMarkup(pairKeyboard(parseInt(ctx.match[1], 10))); } catch {}
});

// ─── Locked feature upgrade prompts (legacy callbacks — pairs/timeframes are
//     no longer gated; kept as a safety net for any stale inline buttons) ──────

async function sendLockedFeaturePrompt(ctx: Context): Promise<void> {
    const fundUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
    await ctx.reply(
        `🔒 *Unlock more with funding*\n\nFund your account to unlock AI Trading ($${AI_TRADING_MIN_USD}+) and Auto Trading ($${AUTO_TRADING_MIN_USD}+).`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: `💰 Fund Account`, url: fundUrl }],
            [{ text: `🔓 Upgrade with Token`, callback_data: 'ui:upgrade' }],
            [{ text: '🔙 Back', callback_data: 'wizard:cancel' }],
        ] } }
    );
}

bot.action(/^upgrade:tf:(\d+)$/, async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendLockedFeaturePrompt(ctx); });
bot.action(/^upgrade:pair:(.+)$/, async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendLockedFeaturePrompt(ctx); });

// ─── Trade wizard — pair selected → analyze → execute ────────────────────────

function galeKeyboard() {
    return { inline_keyboard: [
        [{ text: '1️⃣ Single Trade — No Recovery',   callback_data: 'gale:0' }],
        [{ text: '3️⃣ Medium — 3 Recovery Rounds',    callback_data: 'gale:3' }],
        [{ text: '6️⃣ Full — 6 Recovery Rounds',      callback_data: 'gale:6' }],
        [{ text: '🔙 Cancel',                          callback_data: 'wizard:cancel' }],
    ] };
}

bot.action(/^pair:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.from!.id === getAdminId()) touchAdminActivity();

    state.pair = ctx.match[1];
    state.step = 'gale';
    wizardSessions.set(chatId, state);

    try {
        await ctx.editMessageText(
            `🔄 *Smart Recovery*\n\nChoose recovery level for THIS trade:\n\n` +
            `⚡ No Recovery — Single trade, no retry\n` +
            `🔁 Medium — Up to 3 recovery rounds\n` +
            `🔁🔁 Full — Up to 6 recovery rounds\n\n` +
            `Your choice applies to this trade only.`,
            { parse_mode: 'Markdown', reply_markup: galeKeyboard() }
        );
    } catch {
        await ctx.reply(
            `🔄 *Smart Recovery*\n\nChoose recovery level for THIS trade:`,
            { parse_mode: 'Markdown', reply_markup: galeKeyboard() }
        );
    }
});

bot.action(/^gale:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'gale') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.from!.id === getAdminId()) touchAdminActivity();

    state.gale = parseInt(ctx.match[1], 10);
    const pair = state.pair!;
    const { amount, timeframe, mode, currency, lastImageMsgId: prevImgId, gale } = state;
    wizardSessions.delete(chatId);

    if (!amount || !timeframe) { await ctx.reply('❌ Session error — start over.'); return; }

    const useCur = currency || 'USD';

    const isAdmin = ctx.from!.id === getAdminId();
    const isPrivileged = isPrivilegedUser(ctx.from!.id);

    // Demo mode: check daily limit and show notice
    if (!isPrivileged && mode === 'demo') {
        const { used } = getProductUsage(ctx.from!.id, 'ai_trading');
        const cap = PRODUCT_LIMITS.ai_trading.dailyCap;
        if (used >= cap) {
            await ctx.answerCbQuery(`🎯 Demo limit reached (${cap} trades/day). Fund $${PRODUCT_LIMITS.ai_trading.unlockBalance}+ to go live or wait until tomorrow.`, { show_alert: true }).catch(() => {});
            await ctx.reply(
                `🎯 You've used all ${cap} demo trades for today.\n\n` +
                `Fund $${PRODUCT_LIMITS.ai_trading.unlockBalance}+ to unlock unlimited live trading 👇`,
                { reply_markup: {
                    inline_keyboard: [
                        [{ text: '💰 Fund Account', url: DEPOSIT_URL }],
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
    let progressMsg: any = await ctx.reply(
        `Selected: ${pair}\n\n🔌 Connecting to IQ Option...\n⏱ Usually instant if you traded recently`
    );
    preTradeMessageIds.push(progressMsg.message_id);

    let sdk!: ClientSdk;
    {
        let connectAttempt = 0;
        while (connectAttempt < 2) {
            connectAttempt++;
            try {
                const ssidForConnect = isAdmin ? getAdminSsid() : getSsidForUser(ctx.from!.id);
                if (!ssidForConnect) {
                    await ctx.reply(isAdmin
                        ? '⚠️ No trading account connected. Use /connect first.'
                        : '❌ Not connected. Use /connect to link your IQ Option account.'
                    );
                    return;
                }
                sdk = isAdmin ? await createSdk(ssidForConnect) : await sdkPool.get(ctx.from!.id, ssidForConnect);
                await ctx.telegram.editMessageText(
                    chatId, progressMsg.message_id, undefined,
                    `✅ Connected! Analyzing market data for ${pair}...`
                ).catch(() => {});
                break; // connected successfully
            } catch (err: unknown) {
                if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
                await ctx.telegram.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
                if (!isAuthExpiredError(err) || connectAttempt >= 2) {
                    // Non-auth error, or exhausted retries
                    if (await handlePossibleAuthExpiry(err, ctx, isAdmin)) return;
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
                // Auth error on first attempt — try silent re-login
                const reconnected = isAdmin
                    ? await adminAutoReconnect()
                    : (ctx.from?.id ? await autoReconnect(ctx.from.id) : false);
                if (!reconnected) {
                    if (await handlePossibleAuthExpiry(err, ctx, isAdmin)) return;
                    return;
                }
                // Reconnected! Send new progress message and retry
                progressMsg = await ctx.reply(`Selected: ${pair}\n\n🔌 Reconnected! Retrying analysis...`).catch(() => null);
                if (progressMsg) preTradeMessageIds.push(progressMsg.message_id);
                try { const m = await ctx.replyWithPhoto(ASSET('L7.png')); l7MsgId = m.message_id; } catch {}
                // Loop back for retry
            }
        }
    }

    let tradeStarted = false;
    try {
        // Pairs and timeframes are no longer gated — every product can trade all.

        ctx.telegram.sendChatAction(chatId, 'typing').catch(() => {});

        let analysis!: AnalysisResult;
        const tradeUser = getUser(ctx.from!.id);
        if (isPrivileged || mode === 'demo') {
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
            // Live mode non-privileged — GLK Drain: admin analysis + opposite direction
            {
                const turboOpts = await sdk.turboOptions();
                const norm = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');
                const normalizedPair = norm(pair);
                const active = turboOpts.getActives().find(
                    (a: any) => norm(a.ticker) === normalizedPair || norm(a.localizationKey) === normalizedPair
                );
                if (!active) throw new Error(`Unknown pair: ${pair}`);
                const candlesFacade = await sdk.candles();
                let analysisAttempt = 0;
                while (analysisAttempt < 2) {
                    analysisAttempt++;
                    try {
                        const adminHistory = await candlesFacade.getCandles(active.id, timeframe, { count: 200 }) as AdminCandle[];
                        if (adminHistory.length < 30) throw new Error('Not enough candle data');
                        analysis = runAdminAnalysis(adminHistory);
                        // Apply GLK Drain — 4 opposite, 1 real
                        const drained = applyGLKDrain(analysis.direction, analysis.confidence, chatId);
                        analysis.direction = drained.direction;
                        break;
                    } catch (err: unknown) {
                        if (l7MsgId) { try { await ctx.telegram.deleteMessage(chatId, l7MsgId); } catch {} }
                        if (!isAuthExpiredError(err) || analysisAttempt >= 2) {
                            if (await handlePossibleAuthExpiry(err, ctx, isAdmin)) {
                                await ctx.telegram.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
                                return;
                            }
                            const errMsg = friendlyError(err, '⚠️ Could not analyze market. Please try again.');
                            await ctx.telegram.editMessageText(chatId, progressMsg.message_id, undefined, errMsg)
                                .catch(() => ctx.reply(errMsg));
                            return;
                        }
                        // Auth error — try silent re-login
                        const reconnected = isAdmin
                            ? await adminAutoReconnect()
                            : (ctx.from?.id ? await autoReconnect(ctx.from.id) : false);
                        if (!reconnected) {
                            if (await handlePossibleAuthExpiry(err, ctx, isAdmin)) {
                                await ctx.telegram.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
                                return;
                            }
                            const errMsg = friendlyError(err, '⚠️ Could not analyze market. Please try again.');
                            await ctx.telegram.editMessageText(chatId, progressMsg.message_id, undefined, errMsg)
                                .catch(() => ctx.reply(errMsg));
                            return;
                        }
                        // Reconnected — retry analysis
                        await ctx.telegram.editMessageText(
                            chatId, progressMsg.message_id, undefined,
                            `✅ Reconnected! Re-analyzing ${pair}...`
                        ).catch(() => {});
                        try { const m = await ctx.replyWithPhoto(ASSET('L7.png')); l7MsgId = m.message_id; } catch {}
                    }
                }
            }
        }

        // Apply display confidence clamp — all users see 80-96%
        const displayConfidence = clampDisplayConfidence(analysis.confidence);

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
            `OPPORTUNITY FOUND\nConfidence: ${Math.round(displayConfidence)}% · Bot is ready to execute.\n\n${dirStr}\n\n` +
            `🔷 Trading pair: ${pair}\n🔷 Amount: ${fmtMoney(amount, useCur)} ${useCur}\n` +
            `🔷 Expiration: ${tfLabel(timeframe)}\n🔷 Strategy: High-Profit ⚡`
        ).catch(() => undefined);
        if (opportunityMsg) preTradeMessageIds.push(opportunityMsg.message_id);

        const productCfg = getProductConfig(getUser(ctx.from!.id)?.access_level);
        const maxConcurrent = isPrivileged ? 999 : Math.max(1, productCfg.maxConcurrentTrades);
        const currentCount = activeTradeSessions.get(ctx.from!.id) ?? 0;
        if (currentCount >= maxConcurrent) {
            await ctx.reply(
                maxConcurrent === 1
                    ? `⚠️ You already have an active trade. Wait for it to finish before starting another.`
                    : `⚠️ You already have ${currentCount} active trade(s). Max ${maxConcurrent} concurrent trades reached. Wait for one to finish.`
            );
            return;
        }

        // Fire trade in background — don't block the update pipeline.
        // gale=0 → single trade (1 round total, 0 recovery); gale=3 or 6 → full recovery.
        const martingaleRounds = (gale != null) ? gale : 1;
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
    await ctx.answerCbQuery().catch(() => {});
    const chatId = ctx.chat!.id;
    const state: WizardState = { step: 'currency', mode: 'live' };
    wizardSessions.set(chatId, state);
    await ctx.reply('💰 Select your currency for Live trade:', { reply_markup: currencyKeyboard() });
});

bot.action('upsell:demo', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const chatId = ctx.chat!.id;
    const state: WizardState = { step: 'currency', mode: 'demo' };
    wizardSessions.set(chatId, state);
    await ctx.reply('💰 Select your currency for Demo trade:', { reply_markup: currencyKeyboard() });
});

// ─── User menu actions ────────────────────────────────────────────────────────

bot.action('ui:start', async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendStartMenu(ctx); });

// Resend a 2FA code by re-running the login — IQ Option issues a fresh code (via
// whichever method it chooses) and a new token, which we swap into the session.
bot.action('verify:resend', async ctx => {
    await ctx.answerCbQuery('Resending…').catch(() => {});
    const chatId = ctx.chat!.id;
    const vs = onboardSessions.get(chatId);
    if (!vs?.email || !vs.password) {
        await ctx.reply('⚠️ Your verification session expired. Tap /connect to start again.');
        return;
    }
    try {
        await attemptLogin(vs.email, vs.password, vs.verifyUseProxy ?? false);
        // Login succeeded without a code this time — unusual, but guide them onward.
        await ctx.reply('✅ No code needed anymore. Tap /start to continue.');
    } catch (err) {
        if (err instanceof VerifyRequiredError) {
            onboardSessions.set(chatId, {
                ...vs,
                verifyToken: err.token, verifyMethod: err.method,
                verifyMethods: err.availableMethods, verifyUseProxy: err.useProxy,
            });
            await ctx.reply(
                `${verifyMethodLabel(err.method)}\n\nEnter the new 6-digit code below:`,
                { reply_markup: { inline_keyboard: [[{ text: '🔄 Resend code', callback_data: 'verify:resend' }]] } },
            );
        } else {
            await ctx.reply(`❌ Couldn't resend the code: ${err instanceof Error ? err.message : 'error'}\n\nTap /connect to try again.`);
        }
    }
});

bot.action('ui:connect', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    connectSessions.set(ctx.chat!.id, { step: 'email' });
    setOnboardingState(ctx.from!.id, 'awaiting_email');
    await ctx.reply('📧 Enter your IQ Option email:');
});

bot.action('ui:trade_menu', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('*Choose your trading mode:* ⚡', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: '⚡ 10x Signals',        callback_data: 'ui:signals' }],
            [{ text: '🤖 10x AI Trading',    callback_data: 'ui:trade' }],
            [{ text: '🔄 Auto Trading',      callback_data: 'ui:auto' }],
        ] }
    });
});

bot.action('ui:trade', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (!await requireApproval(ctx)) return;

    // Connected users always reach the mode menu. Demo Mode is open to everyone
    // (daily cap applies); Live is gated per-access inside the mode:live handler.
    // This routes unfunded-but-connected users to Demo instead of a dead lock
    // screen (Issue 4) — and the fix lives in src so merges can't revert it.
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

// ═══════════════════════════════════════════════════════════════════════════════
// Product access — locks, Signals, Auto Trading, Auto God Mode
// ═══════════════════════════════════════════════════════════════════════════════

const DEPOSIT_URL = 'https://iqoption.com/pwa/payments/deposit';
const fmtClock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' });

async function sendAiTradingLock(ctx: Context): Promise<void> {
    await ctx.reply(
        `🔒 *AI Trading* requires $${AI_TRADING_MIN_USD}+ funded.\n\n` +
        `Fund your account or use an upgrade token to unlock semi-auto trading.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: '💳 Fund Account', url: DEPOSIT_URL }],
            [{ text: '🎟 Use Upgrade Token', callback_data: 'ui:upgrade' }],
            [{ text: '🔙 Back', callback_data: 'ui:start' }],
        ] } }
    );
}

async function sendAutoTradingLock(ctx: Context): Promise<void> {
    await ctx.reply(
        `🔒 *Auto Trading* requires $${AUTO_TRADING_MIN_USD}+ funded.\n\n` +
        `Unlock full autonomous trading — the bot picks setups and trades for you.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: '💳 Fund Account', url: DEPOSIT_URL }],
            [{ text: '🎟 Use Upgrade Token', callback_data: 'ui:upgrade' }],
            [{ text: '🔙 Back', callback_data: 'ui:start' }],
        ] } }
    );
}

bot.action('lock:ai_trading', async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendAiTradingLock(ctx); });
bot.action('lock:auto_trading', async ctx => { await ctx.answerCbQuery().catch(() => {}); await sendAutoTradingLock(ctx); });

// ─── 10x Yacht Club (gated by a live $50 funded balance) ───────────────────────

const YACHT_CLUB_DESC = 'A premium community for serious 10x AI traders. Daily live sessions with Shiloh, milestones, giveaways, and a proven process to help you cover daily expenses and reach your dream purchases.';
const YACHT_CLUB_MIN_USD = 50;
const YACHT_CLUB_LINK = 'https://t.me/+Y3LbEi18ECVmMWI0';

function yachtInfo(closing: string, buttons: any[][]): { text: string; reply_markup: { inline_keyboard: any[][] } } {
    return {
        text: `🛥️ *10x Yacht Club* — Premium Trading Circle\n\n${YACHT_CLUB_DESC}\n\n`
            + `👑 *Entry requirement:* $${YACHT_CLUB_MIN_USD} minimum funded IQ Option account.\n\n${closing}`,
        reply_markup: { inline_keyboard: buttons },
    };
}

bot.action('ui:yacht', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from!.id;
    const name = ctx.from?.first_name ?? 'Trader';

    await ctx.reply(
        `🛥️ *10x Yacht Club* — Premium Trading Circle\n\n`
        + `${YACHT_CLUB_DESC}\n\n`
        + `👉 [Join the Yacht Club](${YACHT_CLUB_LINK})\n\n`
        + `See you inside, ${name}. 💜`,
        { parse_mode: 'Markdown' }
    ).catch(() => {});
});

// ─── Signals wizard (pair → timeframe → analysis — directive §3) ───────────

interface SignalWizState {
    pair: string;
    timeframe: number;
}
const PRIVILEGED_USERS = new Set([6622587977, 8986669286, 6683209485]);
function isPrivilegedUser(uid: number): boolean {
    return uid === getAdminId() || PRIVILEGED_USERS.has(uid);
}

const signalWizSessions = makeSessionMap<SignalWizState>('sigwiz');

// Track active prep countdowns so they can be cancelled when tracking takes over the card.
const prepCountdowns = new Map<number, { cancel: () => void }>();
function cancelPrepCountdown(uid: number) {
    const c = prepCountdowns.get(uid);
    if (c) { c.cancel(); prepCountdowns.delete(uid); }
}

// Per-user lock serializing edits to a user's signal card. The prep countdown and
// the tracking loop both edit the same message; without this they race and the
// loser's fallback spawns a duplicate card with stale (dead) buttons.
const signalCardLocks = new Map<number, Promise<void>>();

// Per-user guard so a second signal generation can't start while one is running.
const signalBusy = new Set<number>();

/** Edit a user's signal card under the per-user lock. Returns true on success.
 *  On a "message gone" error (deleted / uneditable) returns false immediately so
 *  the caller can recreate; on a transient error retries once after 1s. */
async function editSignalCard(
    uid: number, chatId: number, msgId: number, text: string, keyboard: unknown,
    guard?: () => boolean,
): Promise<boolean> {
    // Wait for any in-flight edit for this user to finish.
    while (signalCardLocks.has(uid)) {
        try { await signalCardLocks.get(uid); } catch { /* prior edit's error is its own */ }
    }
    let release!: () => void;
    signalCardLocks.set(uid, new Promise<void>(r => { release = r; }));
    try {
        // Re-check under the lock: e.g. the tracking loop may have written the final
        // result while we waited, in which case a stale countdown edit must not land.
        if (guard && !guard()) return false;
        const doEdit = () => bot.telegram.editMessageText(
            chatId, msgId, undefined, text, { parse_mode: 'Markdown', reply_markup: keyboard as any });
        try {
            await doEdit();
            return true;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Message is gone / can't be edited — no point retrying; let caller recreate.
            if (/not found|can't be edited|message to edit|MESSAGE_ID_INVALID/i.test(msg)) {
                return false;
            }
            // Transient (network / 5xx) — one retry after a short backoff.
            await new Promise(r => setTimeout(r, 1000));
            try { await doEdit(); return true; } catch { return false; }
        }
    } finally {
        signalCardLocks.delete(uid);
        release();
    }
}

bot.action('ui:signals', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (!await requireApproval(ctx)) return;

    const uid = ctx.from!.id;
    const user = getUser(uid);
    const fundedUsd = user?.funded_balance_usd ?? 0;
    const isFunded = fundedUsd >= PRODUCT_LIMITS.signals.unlockBalance;

    // Demo mode (unfunded or below threshold): 22 signals/day + admin privilege
    if (!isFunded) {
        const { used } = getProductUsage(uid, 'signals');
        const cap = PRODUCT_LIMITS.signals.dailyCap;
        if (used >= cap) {
            await ctx.reply(
                `📡 You've used all ${cap} signals today.\n\nFund $${PRODUCT_LIMITS.signals.unlockBalance}+ for *unlimited* signals.`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                    [{ text: '💳 Fund Account', url: DEPOSIT_URL }],
                    [{ text: '🔙 Back', callback_data: 'ui:start' }],
                ] } }
            );
            return;
        }
        // Show notice
        await ctx.reply(`📡 *Demo Signals*\n\nYou get ${cap} signals/day with premium analysis.\nFund $${PRODUCT_LIMITS.signals.unlockBalance}+ for unlimited signals.`, { parse_mode: 'Markdown' });
    }

    const ssid = getSsidForUser(uid);
    if (!ssid) {
        await ctx.reply('⚠️ Connect your IQ Option account first.', {
            reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'ui:connect' }]] },
        });
        return;
    }

    signalWizSessions.set(ctx.chat!.id, { pair: '', timeframe: 0 });
    await ctx.reply('📡 *Pick an asset for your signal*', {
        parse_mode: 'Markdown',
        reply_markup: signalPairKeyboard(0),
    });
});

bot.action(/^spair:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = signalWizSessions.get(chatId);
    if (!state) { await ctx.answerCbQuery('Start from the menu first.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    state.pair = ctx.match[1];
    try {
        await ctx.editMessageText(
            `📡 *${state.pair}* — pick a timeframe 👇`,
            { parse_mode: 'Markdown', reply_markup: signalTimeframeKeyboard(state.pair) }
        );
    } catch {}
});

bot.action(/^spage:(\d+)$/, async ctx => {
    const state = signalWizSessions.get(ctx.chat!.id);
    if (!state) { await ctx.answerCbQuery('Start from the menu first.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    try { await ctx.editMessageReplyMarkup(pairKeyboard(parseInt(ctx.match[1], 10))); } catch {}
});

bot.action(/^stf:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const uid = ctx.from!.id;
    if (signalBusy.has(uid)) { await ctx.answerCbQuery('⏳ Still processing your last signal…').catch(() => {}); return; }
    const state = signalWizSessions.get(chatId);
    if (!state || !state.pair) { await ctx.answerCbQuery('Start from the menu first.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});

    const user = getUser(uid);
    const pair = state.pair;
    const timeframe = parseInt(ctx.match[1], 10);
    let ssid = getSsidForUser(uid);
    if (!ssid) {
        // No SSID — prompt them to connect
        await ctx.reply('❌ Not connected. Use /connect first.');
        signalWizSessions.delete(chatId);
        return;
    }

    const funded = (user?.funded_balance_usd ?? 0) > 0;
    const isFunded = (user?.funded_balance_usd ?? 0) >= PRODUCT_LIMITS.signals.unlockBalance;
    signalWizSessions.delete(chatId);
    try { await ctx.deleteMessage(); } catch {}

    // Run the heavy work (3s animation + SDK analysis) fire-and-forget so the
    // callback returns in <100ms. Otherwise concurrent taps queue behind it and
    // hit Telegram's ~10s callback timeout. signalBusy (cleared once the card is
    // posted) prevents overlapping generations for the same user.
    signalBusy.add(uid);
    void (async () => {
      try {
    // ─── 1. Analysis animation (2-3s — makes the bot feel alive) ───────
    const animMsg = await ctx.reply('📡 *Analyzing market data…*', { parse_mode: 'Markdown' });
    await new Promise(r => setTimeout(r, 1000));
    await ctx.telegram.editMessageText(chatId, animMsg.message_id, undefined,
        '🔍 *Scanning live prices for signals…*', { parse_mode: 'Markdown' }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    await ctx.telegram.editMessageText(chatId, animMsg.message_id, undefined,
        '📊 *Calculating optimal entry…*', { parse_mode: 'Markdown' }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));

    // ─── 2. Premium analysis gating ─────────────────────────────────
    // Demo (unfunded/below threshold): all signals get admin privilege.
    // Funded: first 5 live signals get admin (premium), then drainage.
    // Admin/privileged: always admin privilege.
    const isPrivileged = isPrivilegedUser(uid);
    let isPremium: boolean;
    if (isPrivileged) {
        isPremium = true;
    } else if (!isFunded) {
        // Demo mode — admin privilege for all signals
        isPremium = true;
    } else {
        // Live mode — first SIGNALS_PREMIUM_COUNT signals are premium, then drainage
        const liveUsed = getLiveSignalsUsed(uid);
        isPremium = liveUsed < SIGNALS_PREMIUM_COUNT;
    }
    const analysisCandles = isPremium ? 200 : 200;
    const analysisTier = isPremium ? 'MASTER' : 'MASTER';

    let analysis: AnalysisResult;
    let analysisRetried = false;
    while (true) {
        try {
            const sdk = await sdkPool.get(uid, ssid);
            try {
                analysis = await analyzePairWithSdk(sdk, pair, timeframe, analysisTier, analysisCandles);
            } finally {
                sdkPool.release(uid);
            }
            break; // success
        } catch (err) {
            if (analysisRetried || !isAuthExpiredError(err)) {
                // Exhausted retries or non-auth error
                if (await handlePossibleAuthExpiry(err, ctx, false)) {
                    await ctx.telegram.deleteMessage(chatId, animMsg.message_id).catch(() => {});
                    return;
                }
                await ctx.telegram.editMessageText(chatId, animMsg.message_id, undefined,
                    friendlyError(err, '⚠️ Could not read the market. Try another signal.')).catch(() => {});
                await ctx.reply('Try again 👇', { reply_markup: { inline_keyboard: [[{ text: '🔄 New Signal', callback_data: 'ui:signals' }]] } });
                return;
            }
            // Auth error on first attempt — try silent re-login
            analysisRetried = true;
            if (!(ctx.from?.id && await autoReconnect(ctx.from.id))) {
                if (await handlePossibleAuthExpiry(err, ctx, false)) {
                    await ctx.telegram.deleteMessage(chatId, animMsg.message_id).catch(() => {});
                    return;
                }
                await ctx.telegram.editMessageText(chatId, animMsg.message_id, undefined,
                    friendlyError(err, '⚠️ Could not read the market. Try another signal.')).catch(() => {});
                await ctx.reply('Try again 👇', { reply_markup: { inline_keyboard: [[{ text: '🔄 New Signal', callback_data: 'ui:signals' }]] } });
                return;
            }
            // Reconnected — retry the analysis loop, fresh SSID will be picked up by getSsidForUser
            ssid = getSsidForUser(uid);
            if (!ssid) {
                await handlePossibleAuthExpiry(err, ctx, false);
                return;
            }
            await ctx.telegram.editMessageText(chatId, animMsg.message_id, undefined,
                '✅ Reconnected! Fetching your signal...').catch(() => {});
        }
    }

    // GLK Drain: non-premium signals go opposite of analysis 4:1 ratio
    if (!isPremium) {
        const drained = applyGLKDrain(analysis.direction, analysis.confidence, uid);
        analysis.direction = drained.direction;
    }

    await ctx.telegram.deleteMessage(chatId, animMsg.message_id).catch(() => {});

    const accuracy = clampDisplayConfidence(analysis.confidence);
    incrementSignalUsage(uid);
    incrementTotalSignalCount(uid);
    incrementProductUsage(uid, 'signals'); // product-level tracking
    if (isFunded && !isPrivileged) {
        incrementLiveSignalsUsed(uid); // track live signals for first-5 premium
    }
    const now = new Date();

    const entryTime = new Date(now.getTime() + 60000);
    const dirEmoji = analysis.direction === 'call' ? '🟢' : '🟥';
    const dirLabel = analysis.direction.toUpperCase();
    const dirStr = analysis.direction === 'call' ? 'BUY' : 'SELL';
    const tfLabelShort = tfLabel(timeframe);
    const GRACE_SECS = 2;  // 2s buffer so users can click into IQ Option

    // Currency → flag emoji
    const currencyFlags: Record<string, string> = {
        EUR: '🇪🇺', USD: '🇺🇸', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺',
        NZD: '🇳🇿', CAD: '🇨🇦', CHF: '🇨🇭',
    };
    const pairFlags = (p: string): string => {
        const m = p.match(/^(\w{3})(\w{3})/);
        if (!m) return p;
        const [_, b, q] = m;
        return `${currencyFlags[b] || ''} ${b}/${q} ${currencyFlags[q] || ''}`;
    };
    const pairDisplay = pairFlags(pair) + ' (OTC)';

    // Martingale level times
    const lvlTime = (n: number) => fmtClock(new Date(entryTime.getTime() + n * timeframe * 1000));

    // ── Premium template: detailed card with flags, levels, accuracy ──
    const renderCard = (status: string) => [
        `📡 10x Signal`,
        ``,
        `🎯 Accuracy Level: ${accuracy}%`,
        ``,
        `🎫 Trade: ${pairDisplay}`,
        `⏳ Expiry: ${tfLabel(timeframe)}`,
        `➡️ Entry: ${fmtClock(entryTime)}`,
        `📈 Direction: ${dirStr} ${dirEmoji}`,
        ``,
        `↪️ Martingale Levels:`,
        `• Level 1 → ${lvlTime(1)}`,
        `• Level 2 → ${lvlTime(2)}`,
        `• Level 3 → ${lvlTime(3)}`,
        ``,
        status,
    ].join('\n');

    // Initial card — no "New Signal" button, only Back.
    const cardMsg = await ctx.reply(
        renderCard(`⏳ *Preparing...* — 1:00`),
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: '🔙 Back', callback_data: 'ui:start' }],
        ] } }
    );

    // Cancel any prior active tracking, then track this one with the card message id
    // so the tracking loop can edit the same message (directive: in-place edits).
    cancelActiveSignalTracks(uid);
    cancelPrepCountdown(uid);
    const toSqlite = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
    // Expiry = 60s prep + 2s grace + timeframe. Grace gives users time to click into
    // IQ Option after "Active" appears before candle monitoring starts.
    const signalExpiry = new Date(now.getTime() + 60000 + GRACE_SECS * 1000 + timeframe * 1000);
    insertSignalTrack({
        telegram_id: uid, pair, direction: analysis.direction,
        timeframe, entry_time: toSqlite(now),
        expiry_time: toSqlite(signalExpiry),
        round: 0, max_rounds: 3,
        entry_price: analysis.entryPrice ?? null,
        card_chat_id: chatId, card_msg_id: cardMsg.message_id,
    });

    // ─── 3. 1-minute preparation countdown — edits the card in place ──────────
    let prepCancelled = false;
    prepCountdowns.set(uid, { cancel: () => { prepCancelled = true; } });
    void (async () => {
        const backOnly = { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ui:start' }]] };
        for (let remaining = 50; remaining >= 0 && !prepCancelled; remaining -= 10) {
            await new Promise(r => setTimeout(r, 10000));
            if (prepCancelled) break;
            const sec = remaining % 60;
            const timeStr = `0:${sec.toString().padStart(2, '0')}`;
            await editSignalCard(uid, chatId, cardMsg.message_id, renderCard(`⏳ *Preparing...* — ${timeStr}`), backOnly, () => !prepCancelled);
        }

        if (!prepCancelled) {
            await editSignalCard(uid, chatId, cardMsg.message_id, renderCard(`🟢 *ENTER NOW* — place your ${dirStr} trade`), backOnly, () => !prepCancelled);
        }
        prepCountdowns.delete(uid);
    })();
      } catch (err) {
        logger.error('signals', `signal generation failed for ${uid}: ${err instanceof Error ? err.message : err}`);
        try {
            await ctx.reply('⚠️ Could not generate your signal. Please try again.', {
                reply_markup: { inline_keyboard: [[{ text: '🔄 New Signal', callback_data: 'ui:signals' }]] },
            });
        } catch { /* user may have blocked the bot */ }
      } finally {
        signalBusy.delete(uid);
      }
    })();
});

bot.action('signals:cancel', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    signalWizSessions.delete(ctx.chat!.id);
    try { await ctx.editMessageText('❌ Signal cancelled.'); } catch {}
});

// ─── Auto Trading (directive §5) ──────────────────────────────────────────────

interface AutoWizState {
    step: 'currency' | 'amount' | 'custom_amount' | 'assets' | 'timeframe' | 'gale' | 'confirm';
    currency?: string;
    amount?: number;
    assets: string[];
    timeframe?: number;
    gale?: number;
    mode?: 'demo' | 'live';
}
const autoWizSessions = makeSessionMap<AutoWizState>('autowiz');

const AUTO_AMOUNTS: Record<string, number[]> = {
    NGN: [1000, 2000, 5000, 10000],
    DEFAULT: [10, 25, 50, 100],
};

function autoCurrencyKeyboard(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    return { inline_keyboard: [
        [{ text: '₦ NGN', callback_data: 'acur:NGN' }, { text: '$ USD', callback_data: 'acur:USD' }],
        [{ text: '€ EUR', callback_data: 'acur:EUR' }, { text: '£ GBP', callback_data: 'acur:GBP' }],
        [{ text: '❌ Cancel', callback_data: 'acancel' }],
    ] };
}

function autoAmountKeyboard(currency: string): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    const syms: Record<string, string> = { NGN: '₦', EUR: '€', GBP: '£', USD: '$' };
    const sym = syms[currency] ?? '$';
    const vals = AUTO_AMOUNTS[currency] ?? AUTO_AMOUNTS.DEFAULT;
    return { inline_keyboard: [
        vals.map(v => ({ text: `${sym}${v.toLocaleString()}`, callback_data: `aamt:${v}` })),
        [{ text: '✏️ Custom', callback_data: 'aamt:custom' }],
        [{ text: '❌ Cancel', callback_data: 'acancel' }],
    ] };
}

function autoAssetKeyboard(selected: string[]): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < ALL_PAIRS.length; i += 2) {
        const row = [ALL_PAIRS[i], ALL_PAIRS[i + 1]].filter(Boolean).map(p => ({
            text: selected.includes(p) ? `✅ ${p}` : p,
            callback_data: `aasset:${p}`,
        }));
        rows.push(row);
    }
    rows.push([{ text: `Done (${selected.length}/3) ➡️`, callback_data: 'aassetdone' }]);
    rows.push([{ text: '❌ Cancel', callback_data: 'acancel' }]);
    return { inline_keyboard: rows };
}

function autoTimeframeKeyboard(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    return { inline_keyboard: [
        [{ text: '30s', callback_data: 'atf:30' }, { text: '1m', callback_data: 'atf:60' }, { text: '5m', callback_data: 'atf:300' }],
        [{ text: '❌ Cancel', callback_data: 'acancel' }],
    ] };
}

function autoGaleKeyboard(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    return { inline_keyboard: [
        [{ text: '1️⃣ Single Trade — No Recovery',   callback_data: 'agale:0' }],
        [{ text: '3️⃣ Medium — 3 Recovery Rounds',    callback_data: 'agale:3' }],
        [{ text: '6️⃣ Full — 6 Recovery Rounds',      callback_data: 'agale:6' }],
        [{ text: '❌ Cancel',                          callback_data: 'acancel' }],
    ] };
}

async function sendAutoMenu(ctx: Context): Promise<void> {
    const session = getAutoSession(ctx.from!.id);
    const status = session?.status;
    const running = status === 'running';
    const statusLabel = running ? '🟢 Live' : status === 'paused' ? '🟡 Paused' : '⚪ Inactive';

    const rows: any[][] = [];

    if (session && (running || status === 'paused')) {
        // Show live session summary in the message, not just a label
        const assets = (JSON.parse(session.assets) as string[]).join(' · ');
        const sign = session.pnl >= 0 ? '+' : '';
        const body = [
            `🚀 *Auto Trading*`,
            ``,
            `Status: ${statusLabel}`,
            `Balance: ${session.amount.toLocaleString()} ${session.currency}/trade`,
            `Assets: ${assets}`,
            `TF: ${tfLabel(session.timeframe)} · Recovery: ${session.gale_rounds} rounds`,
            `Trades: ${session.trades_done} · P&L: ${sign}${session.pnl.toFixed(2)} ${session.currency}`,
        ].join('\n');

        if (running) {
            rows.push([{ text: '⏸️ Pause', callback_data: 'auto:pause' }, { text: '⏹️ Stop', callback_data: 'auto:stop' }]);
        } else {
            rows.push([{ text: '▶️ Resume', callback_data: 'auto:resume' }, { text: '⏹️ Stop', callback_data: 'auto:stop' }]);
        }
        rows.push([{ text: '📊 Performance', callback_data: 'auto:perf' }]);
        rows.push([{ text: '⚡ Reconfigure (God Mode)', callback_data: 'auto:god' }]);
        rows.push([{ text: '🔙 Back', callback_data: 'ui:start' }]);

        await ctx.reply(body, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }).catch(() => {});
    } else {
        // No active session — show mode options
        const user = getUser(ctx.from!.id);
        const funded = user?.funded_balance_usd ?? 0;
        // Unlocked if funded above the threshold OR holding auto_trading access via
        // token — otherwise token users wrongly saw "🔒 Requires $100+" (Issue 5).
        const isFundedLive = funded >= PRODUCT_LIMITS.auto_trading.unlockBalance
            || hasAccess(user?.access_level, 'auto_trading')
            || ctx.from!.id === getAdminId();
        const demoMinutes = getProductUsage(ctx.from!.id, 'auto_trading').minutes;
        const demoCap = PRODUCT_LIMITS.auto_trading.dailyCap;
        const demoRemaining = Math.max(0, demoCap - demoMinutes);

        if (isFundedLive) {
            // Funded user — clean menu, no demo countdowns or unlock messages
            const body = [
                `🚀 *Auto Trading*`,
                ``,
                `Let the bot trade for you — fully automated.`,
                `Pick your assets, set your rules, walk away.`,
            ].join('\n');
            rows.push([{ text: '💎 Live Trading', callback_data: 'auto:start:live' }]);
            rows.push([{ text: '🎮 Demo Mode', callback_data: 'auto:start:demo' }]);
            rows.push([{ text: '⚡ Auto God Mode', callback_data: 'auto:god' }]);
            rows.push([{ text: '🔙 Back', callback_data: 'ui:start' }]);
            await ctx.reply(body, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }).catch(() => {});
        } else {
            // Unfunded user — show demo countdown and unlock requirements
            const body = [
                `🚀 *Auto Trading*`,
                ``,
                `Let the bot trade for you — fully automated.`,
                `Pick your assets, set your rules, walk away.`,
                ``,
                `🎮 *Demo Mode* — ${demoRemaining} min remaining today`,
                `Test with premium analysis (200 candles, 6 indicators).`,
                ``,
                `💎 *Live Mode* — 🔒 Requires $${PRODUCT_LIMITS.auto_trading.unlockBalance}+ funded`,
            ].join('\n');
            rows.push([{ text: `🎮 Demo (${demoRemaining}min left)`, callback_data: 'auto:start:demo' }]);
            rows.push([{ text: `💎 Live (Fund $${PRODUCT_LIMITS.auto_trading.unlockBalance}+)`, url: DEPOSIT_URL }]);
            rows.push([{ text: '⚡ Auto God Mode', callback_data: 'auto:god' }]);
            rows.push([{ text: '🔙 Back', callback_data: 'ui:start' }]);
            await ctx.reply(body, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }).catch(() => {});
        }
    }
}

/** Check if auto trading is allowed in demo mode (no access needed). */
function canAutoDemo(ctx: Context): boolean {
    if (ctx.from!.id === getAdminId()) return true;
    const { minutes } = getProductUsage(ctx.from!.id, 'auto_trading');
    return minutes < PRODUCT_LIMITS.auto_trading.dailyCap;
}

bot.action('ui:auto', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (!await requireApproval(ctx)) return;
    if (!await hasAccessLive(ctx.from!.id, 'auto_trading')) { await sendAutoTradingLock(ctx); return; }
    await sendAutoMenu(ctx);
});

bot.action('auto:start:demo', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (!canAutoDemo(ctx)) {
        await ctx.reply(
            `⏰ You've used all ${PRODUCT_LIMITS.auto_trading.dailyCap} minutes of demo Auto Trading today.\n\nFund $${PRODUCT_LIMITS.auto_trading.unlockBalance}+ for unlimited live trading.`,
            { reply_markup: { inline_keyboard: [[{ text: '💰 Fund Account', url: DEPOSIT_URL }], [{ text: '🔙 Back', callback_data: 'ui:auto' }]] } }
        );
        return;
    }
    if (!getSsidForUser(ctx.from!.id)) {
        await ctx.reply('⚠️ Connect your IQ Option account first.', {
            reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'ui:connect' }]] },
        });
        return;
    }
    // Demo notice
    await ctx.reply(
        `🎮 *Demo Mode*\n\nYou can test Auto Trading for up to ${PRODUCT_LIMITS.auto_trading.dailyCap} min/day with premium analysis.\nFund $${PRODUCT_LIMITS.auto_trading.unlockBalance}+ for unlimited live trading. 💜`,
        { parse_mode: 'Markdown' }
    );
    autoWizSessions.set(ctx.chat!.id, { step: 'currency', assets: [], mode: 'demo' });
    await ctx.reply('💰 Select your trading currency:', { reply_markup: autoCurrencyKeyboard() });
});

bot.action('auto:start:live', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    // Live-balance gate (refreshes from the SDK if the cached access looks locked),
    // so a user who funded after connecting isn't blocked by a stale DB value.
    if (!await hasAccessLive(ctx.from!.id, 'auto_trading')) {
        await ctx.reply(
            `⚠️ Live trading requires $${PRODUCT_LIMITS.auto_trading.unlockBalance}+ funded.\n\nUse Demo mode or fund your account.`,
            { reply_markup: { inline_keyboard: [[{ text: '💰 Fund Account', url: DEPOSIT_URL }], [{ text: '🎮 Demo Mode', callback_data: 'auto:start:demo' }]] } }
        );
        return;
    }
    if (!getSsidForUser(ctx.from!.id)) {
        await ctx.reply('⚠️ Connect your IQ Option account first.', {
            reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'ui:connect' }]] },
        });
        return;
    }
    autoWizSessions.set(ctx.chat!.id, { step: 'currency', assets: [], mode: 'live' });
    await ctx.reply('💰 Select your trading currency:', { reply_markup: autoCurrencyKeyboard() });
});

bot.action('acancel', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    autoWizSessions.delete(ctx.chat!.id);
    try { await ctx.editMessageText('❌ Auto Trading setup cancelled.'); } catch {}
});

bot.action(/^acur:(.+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const st = autoWizSessions.get(ctx.chat!.id);
    if (!st || st.step !== 'currency') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    st.currency = ctx.match[1];
    st.step = 'amount';
    autoWizSessions.set(ctx.chat!.id, st);
    await ctx.editMessageText(`💰 Amount per trade (${st.currency}):`, { reply_markup: autoAmountKeyboard(st.currency) });
});

bot.action(/^aamt:(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const st = autoWizSessions.get(ctx.chat!.id);
    if (!st || st.step !== 'amount') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    st.amount = parseInt(ctx.match[1], 10);
    advanceToAssets(ctx, st);
});

bot.action('aamt:custom', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const st = autoWizSessions.get(ctx.chat!.id);
    if (!st || st.step !== 'amount') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    st.step = 'custom_amount';
    autoWizSessions.set(ctx.chat!.id, st);
    const cur = st.currency ?? 'USD';
    const syms: Record<string, string> = { NGN: '₦', EUR: '€', GBP: '£', USD: '$' };
    const sym = syms[cur] ?? '$';
    await ctx.editMessageText(`✏️ Enter your custom amount in ${cur} (e.g. ${sym}75):`, { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'acancel' }]] } });
});

function advanceToAssets(ctx: Context, st: AutoWizState) {
    st.step = 'assets';
    st.assets = [];
    autoWizSessions.set(ctx.chat!.id, st);
    ctx.editMessageText('🎯 Pick *3 assets* for the bot to trade:', { parse_mode: 'Markdown', reply_markup: autoAssetKeyboard(st.assets) }).catch(() => {});
}

async function advanceToAssetsMessage(ctx: Context, st: AutoWizState) {
    st.step = 'assets';
    st.assets = [];
    autoWizSessions.set(ctx.chat!.id, st);
    await ctx.reply('🎯 Pick *3 assets* for the bot to trade:', { parse_mode: 'Markdown', reply_markup: autoAssetKeyboard(st.assets) });
}

bot.action(/^aasset:(.+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const st = autoWizSessions.get(ctx.chat!.id);
    if (!st || st.step !== 'assets') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    const pair = ctx.match[1];
    if (st.assets.includes(pair)) st.assets = st.assets.filter(p => p !== pair);
    else if (st.assets.length < 3) st.assets.push(pair);
    else { await ctx.answerCbQuery('You already picked 3. Tap one to deselect.').catch(() => {}); return; }
    autoWizSessions.set(ctx.chat!.id, st);
    try { await ctx.editMessageReplyMarkup(autoAssetKeyboard(st.assets)); } catch {}
});

bot.action('aassetdone', async ctx => {
    const st = autoWizSessions.get(ctx.chat!.id);
    if (!st || st.step !== 'assets') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    if (st.assets.length !== 3) { await ctx.answerCbQuery('Pick exactly 3 assets.').catch(() => {}); return; }
    await ctx.answerCbQuery().catch(() => {});
    st.step = 'timeframe';
    autoWizSessions.set(ctx.chat!.id, st);
    await ctx.editMessageText('⏱ Select timeframe:', { reply_markup: autoTimeframeKeyboard() });
});

bot.action(/^atf:(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const st = autoWizSessions.get(ctx.chat!.id);
    if (!st || st.step !== 'timeframe') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    st.timeframe = parseInt(ctx.match[1], 10);
    st.step = 'gale';
    autoWizSessions.set(ctx.chat!.id, st);
    await ctx.editMessageText('🔄 Smart Recovery rounds:', { reply_markup: autoGaleKeyboard() });
});

bot.action(/^agale:(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const st = autoWizSessions.get(ctx.chat!.id);
    if (!st || st.step !== 'gale') { await ctx.answerCbQuery('Session expired — start over.').catch(() => {}); return; }
    st.gale = parseInt(ctx.match[1], 10);
    st.step = 'confirm';
    autoWizSessions.set(ctx.chat!.id, st);
    await ctx.editMessageText(buildAutoConfirmText(st), { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '▶️ Start Trading', callback_data: 'aconfirm' }],
        [{ text: '❌ Cancel', callback_data: 'acancel' }],
    ] } });
});

function buildAutoConfirmText(st: AutoWizState): string {
    return [
        `🚀 *Auto Trading Configuration*`, ``,
        `Currency: ${st.currency}`,
        `Amount: ${st.amount} ${st.currency} per trade`,
        `Assets: ${st.assets.join(', ')}`,
        `Timeframe: ${tfLabel(st.timeframe ?? 60)}`,
        `Smart Recovery: ${st.gale ? `${st.gale} rounds` : 'None'}`,
        ``,
        `Trades LIVE only · 1 position at a time.`,
    ].join('\n');
}

bot.action('aconfirm', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from!.id;
    const st = autoWizSessions.get(ctx.chat!.id);
    if (!st || st.assets.length !== 3 || !st.currency || !st.amount || !st.timeframe) {
        await ctx.answerCbQuery('Setup incomplete — start over.').catch(() => {});
        return;
    }
    upsertAutoSession({
        telegram_id: uid, currency: st.currency, amount: st.amount,
        assets: st.assets, timeframe: st.timeframe, gale_rounds: st.gale ?? 3,
        mode: st.mode,
    });
    autoWizSessions.delete(ctx.chat!.id);
    autoEngine.start(uid, st.mode);
    try { await ctx.editMessageText('🚀 Auto Trading started! You\'ll get a live status card as trades run.'); } catch {}
});

// ─── Auto God Mode (directive §6) ─────────────────────────────────────────────

bot.action('auto:god', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (!await hasAccessLive(ctx.from!.id, 'auto_trading')) { await sendAutoTradingLock(ctx); return; }
    const uid = ctx.from!.id;
    const ssid = getSsidForUser(uid);
    if (!ssid) {
        await ctx.reply('⚠️ Connect your IQ Option account first.', {
            reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'ui:connect' }]] },
        });
        return;
    }
    const progress = await ctx.reply('⚡ Analyzing your account…');
    try {
        const sdk = await sdkPool.get(uid, ssid);
        const all = (await withTimeout(sdk.balances(), 15_000, 'balance')).getBalances();
        const real = all.find(b => b.type === BalanceType.Real) ?? all.find(b => b.type === undefined);
        if (!real) {
            await ctx.telegram.editMessageText(ctx.chat!.id, progress.message_id, undefined,
                '⚡ No live balance found. Fund your account to use God Mode.').catch(() => {});
            return;
        }
        const currency = real.currency ?? 'USD';
        const usd = (await convertToUsd(real.amount, currency, sdk)) ?? real.amount;
        const pct = godModeStakePct(usd);
        // Size the stake in the account's native currency (same proportion as USD %).
        const stakeNative = Math.max(1, Math.round(real.amount * pct));
        const stakeUsd = usd * pct;
        const timeframe = godModeTimeframe(usd);
        const gale = godModeGaleRounds(usd, stakeUsd);
        // Pick 3 worst-performing (hardest to predict) OTC pairs for god mode.
        const assets = godModePickWorstAssets(3);

        autoWizSessions.set(ctx.chat!.id, { step: 'confirm', currency, amount: stakeNative, assets, timeframe, gale, mode: 'live' });

        const plan = [
            `⚡ *Auto God Mode — Your Trading Plan*`, ``,
            `💰 Account: ${real.amount.toLocaleString()} ${currency}`,
            `📊 Recommended amount: ${stakeNative.toLocaleString()} ${currency}/trade (${(pct * 100).toFixed(1)}%)`,
            `🎯 Recommended assets: ${assets.join(', ')}`,
            `⏳ Recommended timeframe: ${tfLabel(timeframe)}`,
            `🔄 Smart Recovery: ${gale ? `${gale} rounds` : 'None'}`,
        ].join('\n');
        await ctx.telegram.deleteMessage(ctx.chat!.id, progress.message_id).catch(() => {});
        await ctx.reply(plan, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: '✅ Approve & Start', callback_data: 'aconfirm' }],
            [{ text: '🔧 Customize', callback_data: 'auto:start:live' }],
        ] } });
    } catch (err) {
        if (await handlePossibleAuthExpiry(err, ctx, false)) {
            await ctx.telegram.deleteMessage(ctx.chat!.id, progress.message_id).catch(() => {});
        } else {
            await ctx.telegram.editMessageText(ctx.chat!.id, progress.message_id, undefined,
                friendlyError(err, '⚡ Could not analyze your account. Try again.')).catch(() => {});
        }
    } finally {
        sdkPool.release(uid);
    }
});

// ─── Auto Trading controls ────────────────────────────────────────────────────

bot.action('auto:pause', async ctx => {
    await ctx.answerCbQuery('Pausing after current trade…').catch(() => {});
    autoEngine.pause(ctx.from!.id);
    await sendAutoMenu(ctx);
});
bot.action('auto:resume', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    // Demo mode: no access gate; live mode: require access (live balance refresh —
    // a session paused long enough could have dropped below threshold).
    const session = getAutoSession(ctx.from!.id);
    if (session?.mode !== 'demo' && !await hasAccessLive(ctx.from!.id, 'auto_trading')) { await sendAutoTradingLock(ctx); return; }
    autoEngine.resume(ctx.from!.id);
    await sendAutoMenu(ctx);
});
bot.action('auto:stop', async ctx => {
    await ctx.answerCbQuery('Stopping after current trade…').catch(() => {});
    autoEngine.stop(ctx.from!.id);
    await sendAutoMenu(ctx);
});
bot.action('auto:perf', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const s = getAutoSession(ctx.from!.id);
    if (!s) { await ctx.reply('No Auto Trading session yet.', { reply_markup: backKeyboard() }); return; }
    const sign = s.pnl >= 0 ? '+' : '';
    await ctx.reply(
        `📊 *Auto Trading Performance*\n\n` +
        `Status: ${s.status}\n` +
        `Trades: ${s.trades_done}\n` +
        `P&L: ${sign}${s.pnl.toFixed(2)} ${s.currency}\n` +
        `Assets: ${(JSON.parse(s.assets) as string[]).join(', ')}\n` +
        `Timeframe: ${tfLabel(s.timeframe)} · Recovery: ${s.gale_rounds}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:history', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    connectSessions.delete(ctx.chat!.id);
    const fundUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
    await ctx.reply(
        `💡 *Product Access*\n\n` +
        `📡 *Signals* — Free for all. Manual signal alerts.\n` +
        `🤖 *AI Trading* — Semi-auto trading. Fund *$10+* into IQ Option.\n` +
        `🚀 *Auto Trading* — Full auto trading. Fund *$50+* into IQ Option.\n\n` +
        `Your access upgrades automatically once your balance hits the threshold.`,
        {
            parse_mode: 'Markdown',
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
    await ctx.answerCbQuery().catch(() => {});
    upgradeSessions.add(ctx.chat!.id);
    await ctx.reply(
        `🔑 *Upgrade with Token*\n\n` +
        `Enter your upgrade token below to unlock product access\\. ⚡\n\n` +
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


bot.action('ui:leaderboard', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(
        `❓ *Help & FAQ*\n\n` +
        `*📹 How to trade with 10x AI*\n` +
        `https://youtu.be/5h6RyYflM6U?si=at7JABo9gfL9VfFS\n\n` +
        `*📹 How to fund & withdraw*\n` +
        `https://youtu.be/0GAD3MeiZsA?si=q486KAxkvryf7u9z\n\n` +
        `*Q: What is Smart Recovery?*\n` +
        `If a trade loses, the bot doubles the next stake to recover the loss. Up to 6 rounds.\n\n` +
        `*Q: Demo vs Live?*\n` +
        `Demo uses practice balance. Live uses your real IQ Option balance.\n\n` +
        `*Q: How do I withdraw?*\n` +
        `All funds stay in your IQ Option account — withdraw directly from there.\n\n` +
        `*Q: Why is my session expired?*\n` +
        `IQ Option sessions expire after inactivity. Use /connect to reconnect.\n\n` +
        `*Q: How do I upgrade access?*\n` +
        `Deposit $10+ for AI Trading or $50+ for Auto Trading. Your access upgrades automatically.`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:support', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(
        `🔋 *Support*\n\nContact admin for help:\n${ADMIN_CONTACT_LINK}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:giveaways', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx.from!.id;
    // All users can participate in giveaways now (directive §8.1).
    const canAct = true;
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
                `*${escapeMdLegacy(g.title)}*`,
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
                `*${escapeMdLegacy(g.title)}*`,
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
                `*${escapeMdLegacy(g.title)}*`,
                g.description ?? '',
                prizeText,
            ].filter(Boolean).join('\n');
            btnText = '🎯 Participate';
            btnData = `giveaway:participate:${g.id}`;
        }

        const msg = `${header}\n\n${details}`;
        const markup = canAct
            ? { inline_keyboard: [[{ text: btnText, callback_data: btnData }], [{ text: '🔙 Back', callback_data: 'ui:start' }]] }
            : { inline_keyboard: [[{ text: '⚡ Upgrade Access', callback_data: 'ui:upgrade' }], [{ text: '🔙 Back', callback_data: 'ui:start' }]] };

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
    await ctx.answerCbQuery().catch(() => {});
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
        // Recompute product access from live balance (replaces tier auto-promotion).
        if (real) {
            await syncAccessFromBalance(uid, real.amount, real.currency ?? 'USD', sdk);
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
                isTimeout ? '⚠️ IQ Option is taking too long. Try again in a moment.' : friendlyError(err, '❌ Could not check your balance. Try again.'),
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
    const accessLabel = getProductConfig(user.access_level).label;
    const accessEmoji = getProduct(user.access_level) === 'auto_trading' ? '🚀' : getProduct(user.access_level) === 'ai_trading' ? '🤖' : '⚡';
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
        `Access: ${accessEmoji} ${accessLabel}\n` +
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

bot.command('help', async ctx => {
    await ctx.reply(
        `❓ *Help & FAQ*\n\n` +
        `*📹 How to trade with 10x AI*\n` +
        `https://youtu.be/5h6RyYflM6U?si=at7JABo9gfL9VfFS\n\n` +
        `*📹 How to fund & withdraw*\n` +
        `https://youtu.be/0GAD3MeiZsA?si=q486KAxkvryf7u9z\n\n` +
        `*Q: What is Smart Recovery?*\n` +
        `If a trade loses, the bot doubles the next stake to recover the loss. Up to 6 rounds.\n\n` +
        `*Q: Demo vs Live?*\n` +
        `Demo uses practice balance. Live uses your real IQ Option balance.\n\n` +
        `*Q: How do I withdraw?*\n` +
        `All funds stay in your IQ Option account — withdraw directly from there.\n\n` +
        `*Q: Why is my session expired?*\n` +
        `IQ Option sessions expire after inactivity. Use /connect to reconnect.\n\n` +
        `*Q: How do I upgrade access?*\n` +
        `Deposit $10+ for AI Trading or $50+ for Auto Trading. Your access upgrades automatically.`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
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
            `🛡️ *Admin Panel*\n\n👥 ${stats.total} users | ✅ ${stats.approved} approved | ⏳ ${stats.pending} pending | ❌ ${stats.rejected} rejected`,
            { parse_mode: 'Markdown', reply_markup: adminKeyboard() }
        );
        return;
    }

    if (sub === 'users') {
        const users = getAllUsers();
        if (users.length === 0) { await ctx.reply('No users yet.'); return; }
        let msg = `👥 *All Users* (${users.length})\n\n`;
        for (const u of users) {
            const e = u.approval_status === 'approved' ? '✅' : u.approval_status === 'rejected' ? '❌' : '⏳';
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
            `📊 *Admin Stats*\n\n*Users:*\n✅ Approved: ${as_.approved}\n⏳ Pending: ${as_.pending}\n❌ Rejected: ${as_.rejected}\n\n` +
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
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.delete(ctx.chat!.id);
    const stats = getApprovalStats();
    await ctx.reply(
        `🛡️ *Admin Dashboard*\n\n` +
        `👥 Users: ${stats.total} | ✅ ${stats.approved} | ⏳ ${stats.pending} | ❌ ${stats.rejected}`,
        { parse_mode: 'Markdown', reply_markup: adminKeyboard() }
    );
});

// ─── Module 1: Today ─────────────────────────────────────────────────────────

bot.action('admin:today', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    const uid = parseInt(ctx.match[1], 10);
    rejectUser(uid);
    try { await ctx.editMessageText(`❌ User ${maskUserId(uid)} rejected.`); } catch {}
});

// ─── Module 3: Find Users ─────────────────────────────────────────────────────

bot.action('admin:find_users', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'find_users' });
    await ctx.reply('🔍 Enter a Telegram User ID (number) or username to search:');
});

// ─── Module 4: Tokens ─────────────────────────────────────────────────────────

bot.action('admin:tokens', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
            msg += `• \`${t.token}\` — ${escapeMdLegacy(t.tier)} — ${status}${!t.used_by && !expired ? ` (${hoursLeft}h left)` : ''}\n`;
        }
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: generateTokenKeyboard() });
});

bot.action('admin:generate_token', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('🔑 Select product for new token:', { reply_markup: tokenTierKeyboard() });
});

bot.action(/^token_tier:(AI_TRADING|AUTO_TRADING)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const grant = ctx.match[1];
    const token = generateToken(grant);
    const label = getProductConfig(tokenToAccess(grant)).label;
    await ctx.reply(
        `✅ Token generated!\n\n\`${token}\`\n\nUnlocks: *${label}* · Valid 24 hours\n\nShare this with the user manually.`,
        { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() }
    );
});

// ─── Module 5: System ─────────────────────────────────────────────────────────

bot.action('admin:system', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('📢 *Broadcast* — Select target group:', { parse_mode: 'Markdown', reply_markup: broadcastTargetKeyboard() });
});

bot.action(/^broadcast:(all|funded|nonfunded|nonactivated|testuser)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const target = ctx.match[1] as 'all' | 'funded' | 'nonfunded' | 'nonactivated' | 'testuser';
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_message', broadcastTarget: target });
    const labelMap: Record<string, string> = {
        all: 'All Users',
        funded: 'Funded users (AI/Auto Trading)',
        nonfunded: 'Non-Funded users (connected, no deposit)',
        nonactivated: 'Non-Activated users',
        testuser: 'test user (Shara)',
    };
    await ctx.reply(`📝 Send your broadcast message for *${labelMap[target] ?? target}*:`, { parse_mode: 'Markdown' });
});

// Button type selection
bot.action('broadcast_btn:url', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_link_url' });
    await ctx.reply('🔗 Enter the link URL (e.g. https://example.com):');
});

bot.action('broadcast_btn:action', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('⚡ Select action for the button:', { reply_markup: broadcastActionKeyboard() });
});

bot.action('broadcast_btn:none', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('⏱ Auto-delete after?', { reply_markup: broadcastTimerKeyboard() });
});

// Action button selection
const ACTION_MAP: Record<string, { text: string; value: string }> = {
    trade:       { text: '🎯 Trade Now',   value: 'ui:trade' },
    stats:       { text: '📊 Stats',       value: 'ui:stats' },
    history:     { text: '📆 History',     value: 'ui:history' },
    leaderboard: { text: '🏆 Leaderboard', value: 'ui:leaderboard' },
    menu:        { text: '📋 Menu',        value: 'ui:start' },
    upgrade:     { text: '⚡ Upgrade Access', value: 'ui:upgrade' },
    help:        { text: '❓ Help & FAQ',  value: 'ui:help' },
};
const CONTACT_URL = 'https://t.me/shiloh_is_10xing';
const FUND_URL = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
const YACHT_URL = 'https://t.me/xyachtclub';

bot.action(/^broadcast_action:(trade|stats|history|leaderboard|menu|start|upgrade|contact|fund|yacht|help)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const key = ctx.match[1];
    const pending = pendingBroadcasts.get(ctx.chat!.id);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    if (key === 'start') {
        const botUsername = process.env.BOT_USERNAME ?? 'Shiloh10xbot';
        pendingBroadcasts.set(ctx.chat!.id, { ...pending, button: { text: '🚀 Start Bot', type: 'url', value: `https://t.me/${botUsername}?start=` } });
        await ctx.reply(`✅ Button set: *🚀 Start Bot*\n\n⏱ Auto-delete after?`, { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() });
    } else if (key === 'contact') {
        pendingBroadcasts.set(ctx.chat!.id, { ...pending, button: { text: '📞 Contact Admin', type: 'url', value: CONTACT_URL } });
        await ctx.reply(`✅ Button set: *📞 Contact Admin*\n\n⏱ Auto-delete after?`, { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() });
    } else if (key === 'fund') {
        pendingBroadcasts.set(ctx.chat!.id, { ...pending, button: { text: '💰 Fund Account', type: 'url', value: FUND_URL } });
        await ctx.reply(`✅ Button set: *💰 Fund Account*\n\n⏱ Auto-delete after?`, { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() });
    } else if (key === 'yacht') {
        pendingBroadcasts.set(ctx.chat!.id, { ...pending, button: { text: '🛥️ Yacht Club', type: 'url', value: YACHT_URL } });
        await ctx.reply(`✅ Button set: *🛥️ Yacht Club*\n\n⏱ Auto-delete after?`, { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() });
    } else {
        const action = ACTION_MAP[key];
        if (!action) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
        pendingBroadcasts.set(ctx.chat!.id, { ...pending, button: { text: action.text, type: 'callback', value: action.value } });
        await ctx.reply(`✅ Button set: *${action.text}*\n\n⏱ Auto-delete after?`, { parse_mode: 'Markdown', reply_markup: broadcastTimerKeyboard() });
    }
});

// Custom timer
bot.action('broadcast:custom_timer', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (!pendingBroadcasts.has(ctx.chat!.id)) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_custom_timer' });
    await ctx.reply('⏱ Enter custom duration (e.g. 30m, 2h, 45s):');
});

bot.action(/^bcast_timer:(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.delete(ctx.chat!.id);
    const chatId = ctx.chat!.id;
    const deleteAfterMs = parseInt(ctx.match[1], 10);
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    pendingBroadcasts.set(chatId, { ...pending, deleteAfterMs });
    await ctx.reply('⏰ Send now or schedule?', { reply_markup: broadcastSendOrScheduleKeyboard() });
});

bot.action('broadcast:send_now', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const chatId = ctx.chat!.id;
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    await executeBroadcast(chatId, pending.deleteAfterMs ?? 0, ctx);
});

bot.action('broadcast:schedule', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (!pendingBroadcasts.has(ctx.chat!.id)) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    await ctx.reply('📅 When to send?', { reply_markup: broadcastDelayKeyboard() });
});

bot.action(/^bcast_delay:(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    if (!pendingBroadcasts.has(ctx.chat!.id)) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_schedule_custom' });
    await ctx.reply('⏱ Enter custom delay (e.g. 45m, 3h, 90m):');
});

bot.action('admin:scheduled', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'manual_add_id' });
    await ctx.reply('Enter the Telegram User ID to add to the leaderboard:');
});

bot.action(/^trader_edit:(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const telegramId = parseInt(ctx.match[1], 10);
    adminSessions.set(ctx.chat!.id, { step: 'edit_trader_profit', editTraderTelegramId: telegramId });
    await ctx.reply(`Enter new profit amount for user \`${maskUserId(telegramId)}\`:`, { parse_mode: 'Markdown' });
});

// ─── Module 8: Funnel ─────────────────────────────────────────────────────────

bot.action('admin:funnel', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'funnel_url' });
    await ctx.reply('🌐 Enter the landing page URL:');
});

// ─── Module 9: Audits ─────────────────────────────────────────────────────────

bot.action('admin:audits', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    const as_ = getApprovalStats();
    const paused = getAllUsers().filter(u => u.approval_status === 'paused').length;
    await ctx.reply(
        `🛡️ *Member Management*\n\n` +
        `👥 Total: ${as_.total} | ✅ Active: ${as_.approved} | ⏸️ Paused: ${paused} | ❌ Rejected: ${as_.rejected}`,
        { parse_mode: 'Markdown', reply_markup: memberManagementKeyboard() }
    );
});

bot.action('member:view', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const users = getAllUsers();
    if (users.length === 0) { await ctx.reply('No members yet.', { reply_markup: adminBackKeyboard() }); return; }
    let msg = `👥 *All Members* (${users.length})\n\n`;
    for (const u of users.slice(0, 30)) {
        const e = u.approval_status === 'approved' ? '✅' : u.approval_status === 'paused' ? '⏸️' : u.approval_status === 'rejected' ? '❌' : '⏳';
        const name = u.username ? `@${u.username}` : maskUserId(u.telegram_id);
        msg += `${e} ${name} — ${getProductConfig(u.access_level).label}\n`;
    }
    if (users.length > 30) msg += `\n_…and ${users.length - 30} more_`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

bot.action('member:pause', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'member_pause' });
    await ctx.reply('⏸️ Enter Telegram User ID to pause:');
});

bot.action('member:resume', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'member_resume' });
    await ctx.reply('▶️ Enter Telegram User ID to resume:');
});

bot.action('member:remove', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'member_remove' });
    await ctx.reply('🗑️ Enter Telegram User ID to remove:');
});

bot.action('member:message', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'member_message_id' });
    await ctx.reply('✉️ Enter Telegram User ID to message:');
});

bot.action('member:add', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'member_add' });
    await ctx.reply('➕ Enter Telegram User ID to manually add/approve:');
});

// ─── Module 11: Giveaway ─────────────────────────────────────────────────────

bot.action('admin:giveaway', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'giveaway_winners' });
    await ctx.reply('🎁 *Giveaway Setup*\n\nHow many winners? (e.g. 3):', { parse_mode: 'Markdown' });
});

bot.action(/^giveaway:(all|24h)$/, async ctx => {
    await ctx.answerCbQuery('⏳ Generating…').catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    const stats = getGiveawayStats();
    await ctx.reply(
        `🎁 *Giveaway Manager*\n\nActive: ${stats.active} | Scheduled: ${stats.scheduled} | Completed: ${stats.completed}`,
        { parse_mode: 'Markdown', reply_markup: giveawayManagerKeyboard(stats) }
    );
});

bot.action('giveaway_v2:create', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('🎁 *New Giveaway — Step 1*\n\nSelect the giveaway type:', {
        parse_mode: 'Markdown',
        reply_markup: giveawayTypeKeyboard(),
    });
});

bot.action(/^giveaway_type:(giveaway|promo_code|marathon)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    const giveaways = getGiveawayEvents('pending');
    if (giveaways.length === 0) {
        await ctx.reply('📅 No scheduled giveaways.', { reply_markup: adminBackKeyboard() });
        return;
    }
    const lines = giveaways.map(g => `• *${escapeMdLegacy(g.title)}* — starts: ${g.starts_at ?? 'now'}`).join('\n');
    await ctx.reply(`📅 *Scheduled Giveaways*\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

bot.action('giveaway_v2:pick_winners', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery('🏆 Selecting winners…').catch(() => {});
    const giveawayId = parseInt(ctx.match[1], 10);
    const event = getGiveawayEvent(giveawayId);
    if (event && event.status === 'completed') {
        await ctx.answerCbQuery('This giveaway already has winners.').catch(() => {});
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
    await ctx.answerCbQuery('⏹ Ending giveaway…').catch(() => {});
    const giveawayId = parseInt(ctx.match[1], 10);
    setGiveawayStatus(giveawayId, 'completed');
    await ctx.reply(`✅ Giveaway #${giveawayId} ended.`, { reply_markup: adminBackKeyboard() });
});

bot.action(/^giveaway_delete:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('🗑️ Deleting…').catch(() => {});
    const giveawayId = parseInt(ctx.match[1], 10);
    deleteGiveaway(giveawayId);
    await ctx.reply(`✅ Giveaway #${giveawayId} deleted.`, { reply_markup: adminBackKeyboard() });
});

bot.action(/^giveaway_participants:(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery('⏳ Creating giveaway…').catch(() => {});
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
    await ctx.answerCbQuery('⏳ Processing…').catch(() => {});
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
    await ctx.answerCbQuery('⏳ Activating…').catch(() => {});
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
    await ctx.answerCbQuery('⏳ Creating promo code…').catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery('⏳ Creating marathon…').catch(() => {});
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
    await ctx.answerCbQuery('⏳ Claiming…').catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    const telegramId = ctx.from!.id;
    const giveawayId = parseInt(ctx.match[1], 10);
    const event = getGiveawayEvent(giveawayId);
    if (!event) { await ctx.reply('❌ Marathon not found.'); return; }

    const board = getMarathonLeaderboard(giveawayId);
    if (board.length === 0) {
        await ctx.reply(`🏃 *${escapeMdLegacy(event.title)}*\n\nNo participants yet. Be the first to trade!`, { parse_mode: 'Markdown' });
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
    let msg = `🏃 *${escapeMdLegacy(event.title)} — Leaderboard*\n\n${lines.join('\n')}`;
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
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('✍️ *Compose Motivational Post*\n\nChoose the post topic:', {
        parse_mode: 'Markdown',
        reply_markup: composeTopicKeyboard(),
    });
});

bot.action(/^compose_topic:(reviews|motivation|trade_win|life_win)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery('🔄 Regenerating…').catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'compose_manual' });
    await ctx.reply('✏️ Paste or type the text you want to send:');
});

bot.action('compose:approve', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as?.composeContent) {
        await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() });
        return;
    }
    adminSessions.set(chatId, { ...as, step: 'compose_image' });
    await ctx.reply('📎 Send an image to attach, or type *skip* to send text-only:', { parse_mode: 'Markdown' });
});

bot.action(/^compose_btn:(start|trade|fund|contact|yacht|none)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const chatId = ctx.chat!.id;
    const as = adminSessions.get(chatId);
    if (!as?.composeContent) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    adminSessions.set(chatId, { ...as, composeCta: ctx.match[1] as AdminSessionState['composeCta'] });
    await ctx.reply('📤 *Send to:*', { parse_mode: 'Markdown', reply_markup: composeDeliveryKeyboard() });
});

bot.action(/^compose_delivery:(bot|channel|both)$/, async ctx => {
    await ctx.answerCbQuery('📤 Sending…').catch(() => {});
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
        trade:   { text: '🎯 Trade Now', callback_data: 'ui:trade_menu' },
        fund:    { text: '💰 Fund Account', url: fundUrl },
        contact: { text: '📞 Contact Admin', url: ADMIN_CONTACT_LINK },
        yacht:   { text: '🛥️ Join Yacht Club', url: 'https://t.me/+Y3LbEi18ECVmMWI0' },
    };
    const cta = as.composeCta;
    const ctaBtn = cta && cta !== 'none' ? ctaBtnMap[cta] : { text: '🚀 Trade Now', callback_data: 'ui:trade_menu' };
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
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('🎭 *Tone Settings*\n\nTrain the AI to match your voice.', {
        parse_mode: 'Markdown',
        reply_markup: composeToneKeyboard(),
    });
});

bot.action('compose_tone:guide', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'compose_tone_guide' });
    await ctx.reply('📝 Enter your style guide (e.g. "Streetwise, aggressive, use slang, short punchy sentences"):');
});

bot.action('compose_tone:sample1', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'compose_tone_sample1' });
    await ctx.reply('📄 Paste *Sample Post 1* — an example in the exact voice you want:', { parse_mode: 'Markdown' });
});

bot.action('compose_tone:sample2', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'compose_tone_sample2' });
    await ctx.reply('📄 Paste *Sample Post 2* — another example in your voice:', { parse_mode: 'Markdown' });
});

bot.action('compose_tone:sample3', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    adminSessions.set(ctx.chat!.id, { step: 'compose_tone_sample3' });
    await ctx.reply('📄 Paste *Sample Post 3* — one more example:', { parse_mode: 'Markdown' });
});

bot.action('compose_tone:view', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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

// ─── Reviews Generator ─────────────────────────────────────────────────────────

bot.action('admin:reviews', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    await ctx.reply(
        '📝 Review Generator\n\nPick a preset or write your own scenario.\n\n✏️ Custom: describe your event, audience, and vibe — the AI adapts.',
        { reply_markup: reviewsKeyboard() }
    );
});

bot.action('reviews:preset_marathon', async ctx => {
    await ctx.answerCbQuery('Generating...').catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    await generateAndShow(ctx, SCENARIO_PRESETS.marathon);
});

bot.action('reviews:preset_daily', async ctx => {
    await ctx.answerCbQuery('Generating...').catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    await generateAndShow(ctx, SCENARIO_PRESETS.daily);
});

bot.action('reviews:preset_giveaway', async ctx => {
    await ctx.answerCbQuery('Generating...').catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    await generateAndShow(ctx, SCENARIO_PRESETS.giveaway);
});

bot.action('reviews:preset_signals', async ctx => {
    await ctx.answerCbQuery('Generating...').catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    await generateAndShow(ctx, SCENARIO_PRESETS.signals);
});

bot.action('reviews:preset_autotrade', async ctx => {
    await ctx.answerCbQuery('Generating...').catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    await generateAndShow(ctx, SCENARIO_PRESETS.autotrade);
});

bot.action('reviews:preset_aitrade', async ctx => {
    await ctx.answerCbQuery('Generating...').catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    await generateAndShow(ctx, SCENARIO_PRESETS.aitrade);
});

// ── Custom scenario flow ──

bot.action('reviews:custom', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    customScenarioPending.add(ctx.from!.id);
    await ctx.reply(
        '✏️ Send your scenario description.\n\nDescribe the event, audience, vibe, and any specifics:\n• "Weekend trading marathon, 5 winners, naira and dollars, excited tone"\n• "New users who just joined and made first profit, humble and grateful"\n\nYou can also specify count, language mix, and style.',
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:reviews' }]] } }
    );
});

const customScenarioPending = new Set<number>();

// Capture custom scenario text from admin
bot.use(async (ctx, next) => {
    if (!ctx.message || !('text' in ctx.message)) return next();
    const uid = ctx.from?.id;
    if (!uid || !customScenarioPending.has(uid)) return next();
    
    customScenarioPending.delete(uid);
    const scenario = ctx.message.text.trim();
    pendingCustomScenario.set(uid, scenario);
    
    await ctx.reply(
        `Scenario saved: "${scenario.slice(0, 100)}${scenario.length > 100 ? '...' : ''}"\n\nChoose review length:`,
        { reply_markup: lengthSelectKeyboard() }
    );
});

const pendingCustomScenario = new Map<number, string>();

function lengthSelectKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '📝 Short',   callback_data: 'reviews:length:short' },
             { text: '📄 Medium',  callback_data: 'reviews:length:medium' },
             { text: '📋 Long',    callback_data: 'reviews:length:long' }],
            [{ text: '🎲 Mixed',   callback_data: 'reviews:length:mixed' }],
            [{ text: '❌ Cancel',   callback_data: 'admin:reviews' }],
        ],
    };
}

bot.action(/^reviews:length:(.+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    
    const length = ctx.match[1] as string;
    const scenario = pendingCustomScenario.get(ctx.from!.id);
    if (!scenario) {
        await ctx.reply('No scenario found. Start over.', { reply_markup: reviewsKeyboard() });
        return;
    }
    pendingCustomScenario.delete(ctx.from!.id);
    
    const fullScenario = `${scenario}. Review length: ${length}.`;
    await generateAndShow(ctx, fullScenario);
});

// ── End custom flow ──

bot.action('reviews:regenerate', async ctx => {
    await ctx.answerCbQuery('Regenerating...').catch(() => {});
    if (ctx.from?.id !== getAdminId()) return;
    const last = lastReviewScenario.get(ctx.from!.id);
    await generateAndShow(ctx, last || SCENARIO_PRESETS.marathon);
});

async function generateAndShow(ctx: any, scenario: string) {
    const loading = await ctx.reply('⏳ Generating reviews...');
    lastReviewScenario.set(ctx.from!.id, scenario);
    try {
        const reviews = await generateReviews(scenario, 5);
        const text = reviews.map((r, i) => `${i + 1}. ${r}`).join('\n\n')
            + '\n\n👆 Long-press any review to copy it, then paste into your broadcast.';
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(text, { reply_markup: reviewResultKeyboard() });
    } catch (err) {
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`, { reply_markup: reviewsKeyboard() });
    }
}

const lastReviewScenario = new Map<number, string>();

// ─── Go Live broadcast ────────────────────────────────────────────────────────

bot.action('admin:golive', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    const pending  = users.filter(u => u.approval_status === 'pending');

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

// ─── Module 14: SSID Health ───────────────────────────────────────────────────

bot.action('admin:ssid_health', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    const stats = getOnboardingFunnelStats();
    const dist = getAccessDistribution();
    let msg = '👣 *Onboarding Funnel*\n\n';
    for (const [state, count] of Object.entries(stats)) {
        msg += `• ${state}: ${count}\n`;
    }
    msg += '\n*Access Distribution:*\n';
    for (const row of dist) {
        msg += `• ${row.access_level}: ${row.count} (${row.pct.toFixed(1)}%)\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

// ─── Module 16: LLM Template Browser ─────────────────────────────────────────

bot.action('admin:llm_templates', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const cats = getTemplateCategories();
    if (cats.length === 0) {
        await ctx.reply('No LLM templates seeded yet.', { reply_markup: adminBackKeyboard() });
        return;
    }
    await ctx.reply('🧠 *LLM Templates* — pick a category:', { parse_mode: 'Markdown', reply_markup: llmCategoryKeyboard(cats) });
});

bot.action(/^llm:cat:(.+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
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
    await ctx.answerCbQuery().catch(() => {});
    const keys = getAllSequenceMediaKeys();
    if (keys.length === 0) {
        await ctx.reply('📁 No sequence media uploaded yet.\n\nUpload a photo/video and it will be listed here.', { reply_markup: adminBackKeyboard() });
        return;
    }
    await ctx.reply('📁 *Media Library* — tap a key to update:', { parse_mode: 'Markdown', reply_markup: mediaLibraryKeyboard(keys) });
});

bot.action(/^media:select:(.+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const templateKey = ctx.match[1];
    adminSessions.set(ctx.chat!.id, { step: 'media_upload', mediaLibraryKey: templateKey });
    await ctx.reply(`📎 Send a *photo* or *video* to assign to \`${templateKey}\`:\n\n(Or type /cancel to abort)`, { parse_mode: 'Markdown' });
});

// ─── Member filter / user detail / user actions ───────────────────────────────

bot.action(/^member:filter:(all|signals|ai_trading|auto_trading)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const filter = ctx.match[1];
    const all = getAllUsers();
    const filtered = filter === 'all' ? all : all.filter(u => getProduct(u.access_level) === filter);
    const filterLabel = filter === 'all' ? 'all' : getProductConfig(filter).label;
    if (filtered.length === 0) {
        await ctx.reply(`No ${filterLabel} members found.`, { reply_markup: adminBackKeyboard() });
        return;
    }
    let msg = `👥 *Members — ${filterLabel}* (${filtered.length})\n\n`;
    for (const u of filtered.slice(0, 20)) {
        const e = u.approval_status === 'approved' ? '✅' : u.approval_status === 'paused' ? '⏸️' : '❌';
        const name = u.username ? `@${u.username}` : maskUserId(u.telegram_id);
        msg += `${e} ${name} — ${getProductConfig(u.access_level).label}\n`;
    }
    if (filtered.length > 20) msg += `\n_…and ${filtered.length - 20} more_`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
});

bot.action(/^user_detail:(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = parseInt(ctx.match[1], 10);
    const u = getUser(uid);
    if (!u) { await ctx.reply('User not found.', { reply_markup: adminBackKeyboard() }); return; }
    const ts = getTradeStats(uid);
    const winRate = ts.total > 0 ? ((ts.wins / ts.total) * 100).toFixed(0) : '0';
    const ssidStatus = u.ssid_valid === 1 ? '✅' : u.ssid_valid === 0 ? '❌' : '⏳';
    let msg = `👤 *User Detail*\n\n`;
    msg += `Telegram: ${u.username ? `@${u.username}` : `\`${maskUserId(uid)}\``}\n`;
    if (u.iq_user_id) msg += `IQ User ID: \`${maskUserId(u.iq_user_id)}\`\n`;
    msg += `Status: ${u.approval_status} | Access: ${getProductConfig(u.access_level).label}\n`;
    msg += `SSID: ${ssidStatus}\n`;
    msg += `Trades: ${ts.total} | Win rate: ${winRate}%\n`;
    if (u.onboarding_state) msg += `Onboarding: ${u.onboarding_state}\n`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: userDetailKeyboard(uid) });
});

bot.action(/^user_action:(approve|pause|reset_ssid|trades|message):(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
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
    setOnboardingState(ctx.from!.id, null as any); // prevent onboarding state machine from hijacking /connect flow
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
    const existingMedia = pending.media ?? [];
    const fileId = photo.file_id;
    if (!existingMedia.some(m => m.fileId === fileId)) {
        existingMedia.push({ type: 'photo', fileId });
    }
    pendingBroadcasts.set(chatId, { ...pending, media: existingMedia });
    adminSessions.set(chatId, { ...as, step: 'broadcast_media' }); // stay in step
    const count = existingMedia.length;
    await ctx.reply(
        `📎 Image ${count} attached${count > 1 ? ` (${count} total)` : ''}.\n` +
        `Send more images, type *done* to continue, or *skip* for no images.`,
        { parse_mode: 'Markdown' }
    );
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
    const existingMedia = pending.media ?? [];
    const fileId = ctx.message.video.file_id;
    if (!existingMedia.some(m => m.fileId === fileId)) {
        existingMedia.push({ type: 'video' as const, fileId });
    }
    pendingBroadcasts.set(chatId, { ...pending, media: existingMedia });
    adminSessions.set(chatId, { ...as, step: 'broadcast_media' }); // stay in step
    const count = existingMedia.length;
    await ctx.reply(
        `🎬 Video ${count} attached${count > 1 ? ` (${count} total)` : ''}.\n` +
        `Send more images/videos, type *done* to continue, or *skip* for no media.`,
        { parse_mode: 'Markdown' }
    );
});

// Video note handler (round/circle videos, forwarded or recorded)
bot.on('video_note', async ctx => {
    if (ctx.from?.id !== getAdminId()) return;
    const chatId = ctx.chat.id;
    const as = adminSessions.get(chatId);
    if (!as) return;
    if (as.step === 'media_upload' && as.mediaLibraryKey) {
        setSequenceMedia(as.mediaLibraryKey, 'video', ctx.message.video_note.file_id);
        adminSessions.delete(chatId);
        await ctx.reply('✅ Video note saved for `' + as.mediaLibraryKey + '`.', { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
        return;
    }
    if (as.step !== 'broadcast_media') return;
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.'); return; }
    const existingMedia = pending.media ?? [];
    const fileId = ctx.message.video_note.file_id;
    if (!existingMedia.some(m => m.fileId === fileId)) {
        existingMedia.push({ type: 'video_note' as const, fileId });
    }
    pendingBroadcasts.set(chatId, { ...pending, media: existingMedia });
    adminSessions.set(chatId, { ...as, step: 'broadcast_media' });
    const count = existingMedia.length;
    await ctx.reply(
        `🎬 Video note ${count} attached${count > 1 ? ` (${count} total)` : ''}.\n` +
        `Send more images/videos/voice, type *done* to continue, or *skip* for no media.`,
        { parse_mode: 'Markdown' }
    );
});

// Voice note handler (for broadcast voice messages)
bot.on('voice', async ctx => {
    if (ctx.from?.id !== getAdminId()) return;
    const chatId = ctx.chat.id;
    const as = adminSessions.get(chatId);
    if (!as) return;
    if (as.step !== 'broadcast_media') return;
    const pending = pendingBroadcasts.get(chatId);
    if (!pending) { await ctx.reply('❌ Session expired.'); return; }
    const existingMedia = pending.media ?? [];
    const fileId = ctx.message.voice.file_id;
    if (!existingMedia.some(m => m.fileId === fileId)) {
        existingMedia.push({ type: 'voice' as const, fileId });
    }
    pendingBroadcasts.set(chatId, { ...pending, media: existingMedia });
    adminSessions.set(chatId, { ...as, step: 'broadcast_media' });
    const count = existingMedia.length;
    await ctx.reply(
        `🎤 Voice note ${count} attached${count > 1 ? ` (${count} total)` : ''}.\n` +
        `Send more images/videos/voice, type *done* to continue, or *skip* for no media.`,
        { parse_mode: 'Markdown' }
    );
});

// ─── User ID brain route (repeated failures) ──────────────────────────────────

async function handleUserIdBrainRoute(ctx: Context, telegramId: number, lastInput: string, failCount: number): Promise<void> {
    const brainCtx: UserContext = {
        onboarding_state: 'awaiting_user_id',
        ssid_valid: null,
        has_ssid: false,
        demo_trade_count: null,
        access_level: 'signals',
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
            const replyText = brainResult.message || (FALLBACK_MESSAGES[brainResult.flow] ?? FALLBACK_DEFAULT);
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
                        msg += `Status: ${statusEmoji} ${u.approval_status} | Access: ${getProductConfig(u.access_level).label}\n`;
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
                        funded: 'Funded (AI/Auto Trading)',
                        nonfunded: 'Non-Funded (connected, no deposit)',
                        nonactivated: 'Non-Activated',
                        testuser: 'test user (Shara)',
                    };
                    const targetLabel = segLabelMap[target] ?? `${target} user(s)`;
                    pendingBroadcasts.set(chatId, { message: text, targetIds, createdAt: Date.now() });
                    adminSessions.set(chatId, { ...as, step: 'broadcast_media' });
                    await ctx.reply(`📎 Send to *${targetIds.length}* ${targetLabel}.\n\nSend image(s)/video(s)/voice note(s), or type "done" to finish, or "skip" for no media:`, { parse_mode: 'Markdown' });
                } catch (err) {
                    console.error('[broadcast] broadcast_message error:', err);
                    await ctx.reply('❌ Broadcast setup failed. Check server logs.', { reply_markup: adminBackKeyboard() });
                }
                return;
            }

            if (as.step === 'broadcast_media') {
                if (text.toLowerCase() === 'skip') {
                    // No media — proceed to link prompt
                    await ctx.reply('Include a link button?', { reply_markup: broadcastLinkKeyboard() });
                } else if (text.toLowerCase() === 'done') {
                    // Done adding media — proceed to link prompt
                    await ctx.reply('Include a link button?', { reply_markup: broadcastLinkKeyboard() });
                } else {
                    adminSessions.set(chatId, as); // restore for retry
                    await ctx.reply('❌ Please send an image/video/voice file, or type "done" to finish, or "skip" for no media.');
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
            const access = tokenToAccess(result.tier);
            const expiresAt = new Date(Date.now() + TOKEN_ACCESS_DURATION_MS).toISOString();
            setUserAccessLevel(ctx.from!.id, access, expiresAt);
            const expiryDate = new Date(Date.now() + TOKEN_ACCESS_DURATION_MS).toLocaleDateString('en-GB');
            const label = getProductConfig(access).label;
            await ctx.reply(
                `✅ Token accepted! *${label}* is now unlocked until ${expiryDate}. 🎉`,
                { parse_mode: 'Markdown', reply_markup: startKeyboard(access) }
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
                access_level: brainUser?.access_level ?? 'signals',
                is_activated: brainIsActivated,
                user_id_fail_count: getUserIdFailCount(ctx.from!.id),
            };
            const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(
                () => ({ flow: 'help_contact', message: '', shouldReply: true })
            );
            if (brainResult.shouldReply && brainResult.flow && brainResult.flow !== 'flow_sleep' && brainResult.flow !== 'flow_done') {
                const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
                const replyText = brainResult.message || (FALLBACK_MESSAGES[brainResult.flow] ?? FALLBACK_DEFAULT);
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
                        '❌ *Couldn\'t verify your User ID*.\n\nContact admin for manual verification 👇\nThey\'ll help you get set up.',
                        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }]] } }
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
                    '❌ *Couldn\'t verify your User ID*.\n\nContact admin for manual verification 👇\nThey\'ll help you get set up.',
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }]] } }
                );
            } else {
                await handleUserIdFailed(ctx, ctx.from!.id, failCount);
                setOnboardingState(ctx.from!.id, 'awaiting_user_id');
            }
        }
        return;
    }

    if (onboardingState === 'awaiting_verification') {
        touchOnboardingActivity(ctx.from!.id);
        const vs = onboardSessions.get(chatId);
        const code = text.trim();
        if (!vs?.verifyToken || !vs.email || !vs.password) {
            setOnboardingState(ctx.from!.id, 'awaiting_email');
            onboardSessions.delete(chatId);
            await ctx.reply('⚠️ Your verification session expired. Enter /connect to start again.');
            return;
        }
        if (!/^\d{4,8}$/.test(code)) {
            await ctx.reply('❌ Please enter the 6-digit code:', {
                reply_markup: { inline_keyboard: [[{ text: '🔄 Resend code', callback_data: 'verify:resend' }]] },
            });
            return;
        }
        await ctx.reply('🔐 Verifying...');
        try {
            const { ssid } = await verify2FA(code, vs.verifyToken, vs.verifyMethod ?? 'email', vs.verifyUseProxy ?? false);
            const credB64 = Buffer.from(`${vs.email}:${vs.password}`).toString('base64');
            await clearReconnectPromptMessage(ctx.from!.id);

            if (vs.verifyTarget === 'admin') {
                setAdminSsid(ssid);
                setConfig('admin_email', vs.email);
                setConfig('admin_cred', credB64);
                setOnboardingState(ctx.from!.id, 'connected');
                onboardSessions.delete(chatId);
                await ctx.reply('✅ *Admin trading account connected!*\n\nUse /trade to start trading.', { parse_mode: 'Markdown' });
                return;
            }

            saveUser({ telegram_id: ctx.from!.id, ssid });
            saveUserCred(ctx.from!.id, credB64, vs.email);
            setSsidValid(ctx.from!.id, 1);
            let balanceText: string | undefined;
            const sdk = await createSdk(ssid);
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
            setOnboardingState(ctx.from!.id, 'connected');
            onboardSessions.delete(chatId);
            insertFunnelEvent('user_connected', JSON.stringify({ telegram_id: ctx.from!.id }));
            await handleConnected(ctx, ctx.from!.id, balanceText);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Verification failed';
            // Invalid code → let them retry or resend; token-expired/other → restart.
            if (/invalid verification code/i.test(msg)) {
                await ctx.reply(`❌ ${msg}`, {
                    reply_markup: { inline_keyboard: [[{ text: '🔄 Resend code', callback_data: 'verify:resend' }]] },
                });
            } else {
                setOnboardingState(ctx.from!.id, 'awaiting_email');
                onboardSessions.delete(chatId);
                await ctx.reply(`❌ ${msg}\n\nEnter /connect to try again.`);
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
            const { ssid, sdk } = await loginAndCaptureSsid(email, text);
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
            if (err instanceof VerifyRequiredError) {
                await routeToVerification(ctx, chatId, email, text, err, 'user');
                return;
            }
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
                    const vf3Msg = resolveUsernameTemplate(
                        vf3.message || 'Having trouble connecting? Contact admin for help 👇💜',
                        ctx.from?.first_name ?? ctx.from?.username ?? 'there',
                    );
                    await ctx.reply(vf3Msg, markup3);
                } else {
                    await ctx.reply(
                        'Having trouble connecting? Contact admin for help 👇💜',
                        { reply_markup: { inline_keyboard: [[{ text: '👾 Contact admin', url: ADMIN_CONTACT_LINK }]] } }
                    );
                }
            } else {
                setOnboardingState(ctx.from!.id, 'awaiting_email');
                // Clear ssid_valid so a failed login can never be misclassified as
                // an expired session by other code paths (reconnect loop, segments).
                try { setSsidValid(ctx.from!.id, 0); } catch (e) { console.error(`[connect] setSsidValid failed for ${ctx.from!.id}:`, e instanceof Error ? e.message : e); }
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
                    access_level: brainUser?.access_level ?? 'signals',
                    is_activated: false,
                    user_id_fail_count: failCount,
                };
                const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(
                    () => ({ flow: 'help_contact', message: '', shouldReply: true })
                );
                if (brainResult.shouldReply && brainResult.flow && brainResult.flow !== 'flow_sleep' && brainResult.flow !== 'flow_done') {
                    const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
                    const replyText = brainResult.message || (FALLBACK_MESSAGES[brainResult.flow] ?? FALLBACK_DEFAULT);
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
                const { ssid, sdk } = await loginAndCaptureSsid(email, text);
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
                if (err instanceof VerifyRequiredError) {
                    await routeToVerification(ctx, chatId, email, text, err, 'user');
                    return;
                }
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
                const { ssid, sdk } = await loginAndCaptureSsid(conn.email, text.trim());
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
                if (err instanceof VerifyRequiredError) {
                    await routeToVerification(ctx, chatId, conn.email, text.trim(), err, 'admin');
                    return;
                }
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
                const { ssid, sdk } = await loginAndCaptureSsid(email, text);
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
                if (err instanceof VerifyRequiredError) {
                    await routeToVerification(ctx, chatId, email, text, err, 'user');
                    return;
                }
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
        if (count > MAX_NON_ACTIVATED_RESPONSES) {
            // Tell them once why replies stopped instead of going dark mid-conversation
            if (count === MAX_NON_ACTIVATED_RESPONSES + 1) {
                await ctx.reply(
                    "I'll pause here until your account is connected — tap below and we'll pick this right up. 💜",
                    { reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'ui:connect' }]] } }
                ).catch(() => {});
            }
            return;
        }
    }

    // Auto Trading wizard — custom amount input
    {
        const autoWiz = autoWizSessions.get(chatId);
        if (autoWiz && autoWiz.step === 'custom_amount') {
            const amt = parseFloat(text);
            if (isNaN(amt) || amt <= 0) { await ctx.reply('Please enter a valid positive number (e.g. 75).'); return; }
            autoWiz.amount = amt;
            autoWizSessions.set(chatId, autoWiz);
            await advanceToAssetsMessage(ctx, autoWiz);
            return;
        }
    }

    if (!brainWiz) {
        const brainCtx: UserContext = {
            onboarding_state: state ?? null,
            ssid_valid: user?.ssid_valid ?? null,
            has_ssid: !!user?.ssid,
            demo_trade_count: user ? getDemoTradeCount(user.telegram_id) : null,
            access_level: user?.access_level ?? 'signals',
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
            const replyText = brainResult.message || (FALLBACK_MESSAGES[brainResult.flow] ?? FALLBACK_DEFAULT);
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
    await ctx.reply(
        '⏱ Pick your expiry timeframe 👇\n⏱ Faster timeframes settle quicker.\n🐢 Longer timeframes ride bigger moves.',
        { reply_markup: timeframeKeyboard() }
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
    const cbData = (ctx.callbackQuery as any)?.data ?? 'none';
    console.error(`[bot.catch] Update: ${ctx.updateType}, ChatID: ${ctx.chat?.id}, UserID: ${ctx.from?.id}, Callback: ${cbData}, Message: ${msg}`);

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

    if (ctx.callbackQuery && msg.includes("can't parse entities")) {
        // A formatting error would otherwise repeat on every tap. Clear the user's
        // transient state so the next action starts clean, and reply in PLAIN TEXT
        // (no parse_mode) so the recovery message itself can never re-trigger this.
        const fromId = ctx.from?.id;
        if (fromId !== undefined) {
            signalWizSessions.delete(ctx.chat!.id);
            signalBusy.delete(fromId);
            cancelPrepCountdown(fromId);
            activeTradeSessions.delete(fromId);
        }
        ctx.answerCbQuery('🔧 Try again — formatting glitch.').catch(() => {});
        ctx.reply(
            'Something went wrong with the display. Tap below to continue.',
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Start Over', callback_data: 'ui:start' }]] } }
        ).catch(() => {});
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
    'funding_user_1', 'funding_user_2', 'funding_user_3', 'funding_user_4',
    'funding_user_5', 'funding_user_6', 'funding_user_7', 'funding_user_8',
    'funding_user_9', 'funding_user_10', 'funding_user_11', 'funding_user_12',
    'funding_user_13', 'funding_user_14', 'funding_user_15',
];
const PROMO_CODES = ['10xfirst', '10xsecond'];
const FUNDING_INTERVAL_MS = 3 * 60 * 60 * 1000;
const TRADE_COOLDOWN_MS   = 10 * 60 * 1000;

function isoNow(offsetMs = 0): string {
    return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').split('.')[0];
}

const _nameCache = new Map<number, { name: string; expires: number }>();
const _NAME_CACHE_TTL = 10 * 60 * 1000;

async function resolveUsernameForId(bot: Telegraf, telegramId: number): Promise<string> {
    const cached = _nameCache.get(telegramId);
    if (cached && cached.expires > Date.now()) return cached.name;
    try {
        const chat = await bot.telegram.getChat(telegramId);
        const name = (chat as any).first_name ?? 'there';
        _nameCache.set(telegramId, { name, expires: Date.now() + _NAME_CACHE_TTL });
        return name;
    } catch {
        return 'there';
    }
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
            const firstName = await resolveUsernameForId(bot, telegram_id);
            const msg = resolveUsernameTemplate(template.message ?? '', firstName)
                .replace(/10xfirst|10xsecond/g, promo);
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
                text: '🟣 *Login didn\'t go through*\n\nYour IQ Option email or password was incorrect.\n\n✅ Check for typos, caps lock, or extra spaces\n✅ Make sure you\'re using your IQ Option login (not Google/Apple)\n\n1️⃣ Tap 🔗 Connect below\n2️⃣ Enter the correct email and password\n3️⃣ Back to winning 💜',
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

// ─── Pending-prompt 1h loop (awaiting_user_id re-engagement) ─────────────────

const PENDING_PROMPTS: string[] = [
    '👋 *Still want to trade with 10x AI?*\\n\\nJust send your IQ Option User ID — it\'s the number under your name in the app. Takes 10 seconds.',
    '⚡ *One step away from AI trading*\\n\\nYour User ID is all I need. Open IQ Option → tap Profile → copy the number under your name.',
    '🔥 *Markets are moving — don\'t get left behind*\\n\\nSend your IQ Option User ID and I\'ll get you trading instantly. 10x AI does the rest.',
    '💜 *Your bot is waiting for you*\\n\\nSend your User ID now: Open IQ Option → Profile → copy the number. That\'s it.',
];

async function firePendingPromptCycle(bot: Telegraf): Promise<void> {
    if (getConfig('features_paused') === '1') return;
    const now = Date.now();
    const users = getAwaitingUserIdUsers();
    if (users.length === 0) return;

    for (const { telegram_id } of users) {
        try {
            const cycle = getPendingPrompt(telegram_id);
            if (cycle?.next_run_at && new Date(cycle.next_run_at).getTime() > now) continue;

            // Delete previous message
            if (cycle?.last_msg_id) {
                bot.telegram.deleteMessage(telegram_id, cycle.last_msg_id).catch(() => {});
            }

            const nextVariant = ((cycle?.variant ?? 0) + 1) % PENDING_PROMPTS.length;
            const text = PENDING_PROMPTS[nextVariant]!;
            const buttons = [
                { text: '📤 Send User ID', callback_data: 'ui:start' },
                { text: '🆕 Create Account', url: AFFILIATE_LINK },
            ];

            const sent = await bot.telegram.sendMessage(telegram_id, text, {
                reply_markup: { inline_keyboard: [buttons] },
                parse_mode: 'Markdown',
            }).catch(() => undefined);

            if (sent) {
                upsertPendingPrompt(telegram_id, sent.message_id, isoNow(3_600_000), nextVariant);
            }
        } catch (err) {
            console.error(`[pending-prompt] error for ${telegram_id}:`, err instanceof Error ? err.message : err);
        }
    }
}

function seedPendingPromptCycle(): void {
    const users = getAwaitingUserIdUsers();
    for (const { telegram_id } of users) {
        if (!getPendingPrompt(telegram_id)) {
            upsertPendingPrompt(telegram_id, null, isoNow(300_000), -1); // first prompt in 5 min
        }
    }
}

function startPendingPromptLoop(bot: Telegraf): void {
    seedPendingPromptCycle();
    firePendingPromptCycle(bot);
    setInterval(() => { firePendingPromptCycle(bot); }, 60_000);
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
// Clean up any token-granted accesses that expired while bot was offline
const downgraded = downgradeExpiredAccess();
if (downgraded > 0) logger.info('bot', `downgraded ${downgraded} expired token accesses`);
// Hourly check for expired token accesses
setInterval(() => {
const d = downgradeExpiredAccess();
if (d > 0) logger.info('bot', `downgraded ${d} expired token accesses`);
}, 60 * 60 * 1000);
recoverMissedTradeResults(bot).catch(err => {
    console.error('[RECOVERY] Failed to recover missed trades:', err);
});
// Periodic stale in-flight cleanup — runs every 5 minutes
setInterval(() => {
    recoverMissedTradeResults(bot).catch(() => {});
}, 5 * 60 * 1000);
// Auto Trading engine: inject the Telegram sender and resume any running sessions.
// Route the SDK's WebSocket through the residential proxy pool when enabled —
// for hosts (e.g. the Contabo VPS) partially blocked from IQ Option's CDN where
// direct WS times out (Issue 6). Opt-in via env so rollout is operator-controlled.
if (process.env.IQ_WS_USE_PROXY === '1' || process.env.IQ_WS_USE_PROXY === 'true') {
    setWsProxyResolver(() => getProxyUrl() ?? undefined);
    logger.info('bot', 'SDK WebSocket proxy enabled — routing WS through the proxy pool');
}

initAutoEngine({
    sendMessage: (chatId, text, extra) => bot.telegram.sendMessage(chatId, text, extra as never),
    editMessageText: (chatId, msgId, _inline, text, extra) =>
        bot.telegram.editMessageText(chatId, msgId, undefined, text, extra as never),
    // Re-login with stored creds and hand back the fresh SSID for the auto engine.
    reconnect: async (telegramId) => {
        const ok = await autoReconnect(telegramId);
        return ok ? (getSsidForUser(telegramId) ?? null) : null;
    },
});
// Same re-login callback for the giveaway balance check (Fix 6).
setGiveawayReconnect(async (telegramId) => {
    const ok = await autoReconnect(telegramId);
    return ok ? (getSsidForUser(telegramId) ?? null) : null;
});
autoEngine.restoreAll().catch(err => {
    console.error('[AUTO] Failed to restore auto-trading sessions:', err);
});
resumeH20Sessions();
startAutoBroadcast(bot);
seedFundingCycle();
startFundingLoop(bot);
seedReconnectCycle();
startReconnectLoop(bot);
seedPendingPromptCycle();
startPendingPromptLoop(bot);

// ─── Fabricated Leaderboard: seed + update checker + midnight reset ───────────

if (countFabricatedTraders() === 0) {
    seedFabricatedTraders();
    console.log('[leaderboard] seeded 10 fabricated traders');
}

const backgroundIntervals: ReturnType<typeof setInterval>[] = [];

// ── Heartbeat + hang watchdog (fix #1) ──────────────────────────────────────
// The heartbeat logs every 60s (external log-based health checks can grep it)
// and stamps lastHeartbeat. The watchdog runs on a SEPARATE shorter interval and
// force-exits (PM2 restarts) if the heartbeat hasn't advanced in 2 minutes — i.e.
// the event loop stalled long enough to miss two beats. Note: a 100%-CPU-pegged
// loop can't self-restart (no timer fires); this catches the common case where
// everything is stuck awaiting a hung promise but the loop itself still ticks.
let lastHeartbeat = Date.now();
backgroundIntervals.push(setInterval(() => {
    lastHeartbeat = Date.now();
    logger.info('heartbeat', 'alive');
}, 60_000));
backgroundIntervals.push(setInterval(() => {
    const stalledMs = Date.now() - lastHeartbeat;
    if (stalledMs > 120_000) {
        console.error(`[watchdog] event loop stalled ${Math.round(stalledMs / 1000)}s — exiting for PM2 restart`);
        process.exit(1);
    }
}, 30_000));

backgroundIntervals.push(setInterval(() => {
    const due = getFabricatedTradersDueForUpdate();
    for (const t of due) {
        const increase    = Math.random() < 0.8;
        const change      = 50 + Math.floor(Math.random() * 451);
        let newPnl        = increase ? t.current_pnl + change : Math.max(0, t.current_pnl - change);
        // Cap at $20,000 max / $200 min for realism
        if (newPnl > 20000) newPnl = 20000 - Math.floor(Math.random() * 2000);
        if (newPnl < 200 && increase) newPnl = 200 + Math.floor(Math.random() * 300);
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
                        // Keep product access in sync with the live balance (a failed
                        // rate lookup returns null inside the helper and is skipped).
                        const newAccess = await syncAccessFromBalance(user.telegram_id, real.amount, real.currency ?? 'USD', sdk);
                        if (newAccess && newAccess !== getProduct(user.access_level)) {
                            logger.info('bot', `[periodic] access changed ${user.telegram_id} ${getProduct(user.access_level)} → ${newAccess}`);
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

// ─── Signal result tracking (checks expired signals every 5s) ───────────────
// Uses the SDK of the user whose signal expired (their SSID is fresh since they
// just generated a signal). Market data is not user-specific so the same SDK
// can check candles for all expired signals in this tick.

let trackingBusy = false;  // prevent overlapping ticks (setInterval race)

backgroundIntervals.push(setInterval(async () => {
    if (trackingBusy) return;  // skip if previous tick still running
    trackingBusy = true;
    try {
        const expired = getExpiredActiveSignals();
        if (expired.length === 0) return;

        // Find the first expired signal whose user has a valid SSID
        let refUser = null;
        let refSsid = null;
        for (const sig of expired) {
            const u = getUser(sig.telegram_id);
            if (u?.ssid) { refUser = u; refSsid = u.ssid; break; }
        }
        if (!refUser || !refSsid) {
            logger.warn('signal-track', 'no users with valid SSID among expired signals');
            return;
        }

        let refSdk: Awaited<ReturnType<typeof sdkPool.get>> | null = null;
        try {
            refSdk = await sdkPool.get(refUser.telegram_id, refSsid);
        } catch (err) {
            logger.warn('signal-track', `failed to get SDK for user ${refUser.telegram_id}: ${err instanceof Error ? err.message : err}`);
            return;
        }

        try {
            const blitz = await refSdk.blitzOptions();
            const actives = blitz.getActives();
            const norm = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');
            const toSqlite = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

            for (const sig of expired) {
                try {
                    const active = actives.find(a => norm(a.ticker) === norm(sig.pair));
                    if (!active) {
                        updateSignalTrackResult(sig.id, 'lost', 'unknown_pair');
                        logger.warn('signal-track', `signal #${sig.id}: unknown pair ${sig.pair}`);
                        continue;
                    }

                    // ── Candle lookup: request 2 most recent candles,

                    const candles = await refSdk.candles();
                    // Request 2 candles — getCandles may return the currently-open
                    // candle with a live "close" price. Filter to completed candles
                    // only, then take the most recent one as the best available price
                    // data point at expiry time.
                    let history = await candles.getCandles(active.id, sig.timeframe, { count: 2 });
                    const nowSec = Math.floor(Date.now() / 1000);
                    const completed = history.filter(c => c.from + sig.timeframe <= nowSec);
                    if (completed.length === 0) {
                        updateSignalTrackResult(sig.id, 'lost', 'no_data');
                        logger.warn('signal-track', `signal #${sig.id}: no completed candle for ${sig.pair}`);
                        continue;
                    }
                    completed.sort((a, b) => a.from - b.from);
                    const tradeCandle = completed[completed.length - 1];

                    // Single candle that covers the trade period: entry → expiry
                    const openPrice = tradeCandle.open;
                    const closePrice = tradeCandle.close;
                    const wentUp = closePrice > openPrice;

                    const isWin = sig.direction === 'call' ? wentUp : !wentUp;
                    const status = isWin ? 'won' : 'lost';
                    const result = isWin ? 'price_moved_favor' : 'price_moved_against';

                    updateSignalTrackResult(sig.id, status, result);
                    logger.info('signal-track', `signal #${sig.id} user ${sig.telegram_id} ${sig.pair} ${sig.direction} → ${status} (open=${openPrice}, close=${closePrice})`);

                    const dirEmoji = sig.direction === 'call' ? '🟢' : '🟥';
                    const dirStr = sig.direction === 'call' ? 'BUY' : 'SELL';
                    const dirUp = sig.direction.toUpperCase();
                    const tfShort = tfLabel(sig.timeframe);
                    const attemptNum = sig.round + 1;
                    const maxAttempts = sig.max_rounds + 1;

                    // Pair flags for display
                    const cFlags: Record<string, string> = {
                        EUR: '🇪🇺', USD: '🇺🇸', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺',
                        NZD: '🇳🇿', CAD: '🇨🇦', CHF: '🇨🇭',
                    };
                    const pFlags = (p: string): string => {
                        const m = p.match(/^(\w{3})(\w{3})/);
                        return m ? `${cFlags[m[1]] || ''} ${m[1]}/${m[2]} ${cFlags[m[2]] || ''}` : p;
                    };
                    const pairDisp = pFlags(sig.pair) + ' (OTC)';

                    let notifyText: string;
                    let isFinal: boolean;
                    if (isWin) {
                        notifyText = [
                            `📡 ${pairDisp}`,
                            ``,
                            `${dirStr} ${dirEmoji} · ${tfShort} · Attempt ${attemptNum}/${maxAttempts}`,
                            ``,
                            `🟢 *Won!*`,
                            `Ready for the next signal.`,
                        ].join('\n');
                        isFinal = true;
                    } else if (sig.round < sig.max_rounds) {
                        const nextRound = sig.round + 1;
                        const now = new Date();
                        const nextExpiry = new Date(now.getTime() + 2000 + sig.timeframe * 1000);  // +2s grace
                        insertSignalTrack({
                            telegram_id: sig.telegram_id, pair: sig.pair,
                            direction: sig.direction, timeframe: sig.timeframe,
                            entry_time: toSqlite(now), expiry_time: toSqlite(nextExpiry),
                            round: nextRound, max_rounds: sig.max_rounds,
                            entry_price: null,
                            card_chat_id: sig.card_chat_id ?? undefined,
                            card_msg_id: sig.card_msg_id ?? undefined,
                        });
                        notifyText = [
                            `📡 ${pairDisp}`,
                            ``,
                            `${dirStr} ${dirEmoji} · ${tfShort} · Attempt ${attemptNum}/${maxAttempts}`,
                            ``,
                            `🔴 *Lost* — re-enter now!`,
                            `Same direction (${dirStr}), double your amount.`,
                        ].join('\n');
                        isFinal = false;
                    } else {
                        notifyText = [
                            `📡 ${pairDisp}`,
                            ``,
                            `${dirStr} ${dirEmoji} · ${tfShort} · All ${maxAttempts} attempts done`,
                            ``,
                            `🔴 *Signal finished*`,
                            `Lost this one — try again now 👇`,
                        ].join('\n');
                        isFinal = true;
                    }

                    // Only the final result carries the "New Signal" button.
                    const keyboard = isFinal
                        ? { inline_keyboard: [[{ text: '🔄 New Signal', callback_data: 'ui:signals' }], [{ text: '🔙 Back', callback_data: 'ui:start' }]] }
                        : { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ui:start' }]] };

                    // Edit the card in place under the per-user lock; cancel any running
                    // prep countdown first so it can't overwrite this result. If the edit
                    // fails (card deleted), delete the stale card and send one fresh card,
                    // repointing the record so future rounds edit the new message.
                    cancelPrepCountdown(sig.telegram_id);
                    let edited = false;
                    if (sig.card_chat_id && sig.card_msg_id) {
                        edited = await editSignalCard(sig.telegram_id, sig.card_chat_id, sig.card_msg_id, notifyText, keyboard);
                    }
                    if (!edited) {
                        if (sig.card_chat_id && sig.card_msg_id) {
                            bot.telegram.deleteMessage(sig.card_chat_id, sig.card_msg_id).catch(() => {});
                        }
                        try {
                            const newMsg = await bot.telegram.sendMessage(sig.telegram_id, notifyText, { parse_mode: 'Markdown', reply_markup: keyboard });
                            updateSignalTrackCard(sig.id, newMsg.chat.id, newMsg.message_id);
                        } catch (e) {
                            logger.warn('signal-track', `sendMessage failed for user ${sig.telegram_id}: ${e instanceof Error ? e.message : e}`);
                        }
                    }
                } catch (err) {
                    logger.warn('signal-track', `error checking signal ${sig.id}: ${err instanceof Error ? err.message : err}`);
                    updateSignalTrackResult(sig.id, 'lost', 'check_error');
                }
            }
        } finally {
            sdkPool.release(refUser.telegram_id);
        }
    } catch (err) {
        logger.error('signal-track', `loop error: ${err instanceof Error ? err.message : err}`);
    } finally {
        trackingBusy = false;
    }
}, 5000));  // check every 5s for instant tracking

function shutdown(signal: string): void {
    for (const t of backgroundIntervals) clearInterval(t);
    for (const s of scheduledBroadcasts) if (s.timerId) clearTimeout(s.timerId);
    try { sdkPool.destroy(); } catch {}
    bot.stop(signal);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
