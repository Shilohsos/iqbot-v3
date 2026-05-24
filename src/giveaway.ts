import type { Telegram } from 'telegraf';
import {
    dbCreateGiveawayEvent,
    getGiveawayEvent,
    getGiveawayEvents,
    getActiveGiveaways,
    setGiveawayStatus,
    incrementGiveawayWinnerCount,
    getUser,
    getApprovedUsersWithTier,
    getGiveawayParticipant,
    insertGiveawayParticipant,
    getGiveawayParticipants,
    getGiveawayParticipantCount,
    incrementParticipantTradeCount,
    setParticipantWinner,
    getActiveParticipations,
    insertGiveawayUpdate,
    getPendingGiveawayUpdates,
    markGiveawayUpdateSent,
    getRandomMotivationalMessage,
    insertNotification,
    getPendingNotifications,
    markNotificationSent,
    markNotificationFailed,
    getTestUserId,
    seedMarathonFabricants,
    getMarathonLeaderboardRows,
    deleteMarathonFabricants,
    type GiveawayEventInput,
    type GiveawayEvent,
} from './db.js';
import { sdkPool } from './sdk-pool.js';
import { BalanceType } from './index.js';
import { normalizeTier } from './tiers.js';

export type { GiveawayEventInput, GiveawayEvent };
export { getGiveawayEvents, getActiveGiveaways, getGiveawayEvent };

export interface ParticipateResult {
    success: boolean;
    message: string;
    alreadyIn?: boolean;
    replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string } | { text: string; url: string }>> };
}

function formatCriteriaDescription(criteriaType: string | null, criteriaValue: string | null): string {
    if (!criteriaType || criteriaType === 'none') return '';
    if (criteriaType === 'new_user') return `📋 Open to new users (joined ≤ ${criteriaValue ?? '7'} days ago)`;
    if (criteriaType === 'min_balance') return `📋 Minimum balance: $${criteriaValue ?? '0'}`;
    if (criteriaType === 'top_traders') return `📋 Top ${criteriaValue ?? '10'} traders by trade count win`;
    return '';
}

function futureTimestamp(minMs: number, maxMs: number): string {
    const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
    return new Date(Date.now() + ms).toISOString().replace('T', ' ').split('.')[0];
}

export function createGiveawayEvent(input: GiveawayEventInput): number {
    return dbCreateGiveawayEvent(input);
}

export async function activateGiveaway(giveawayId: number): Promise<void> {
    setGiveawayStatus(giveawayId, 'active');
    const event = getGiveawayEvent(giveawayId);
    if (!event) return;

    const testUserId = getTestUserId();
    if (testUserId) console.log(`[test-mode] sending only to test user ${testUserId}`);
    const users = testUserId
        ? [{ telegram_id: testUserId, tier: 'MASTER' as const }]
        : getApprovedUsersWithTier();
    const prizePoolText = event.prize_pool != null ? `$${event.prize_pool.toFixed(2)}` : '';
    const criteriaText = formatCriteriaDescription(event.criteria_type, event.criteria_value);

    for (const u of users) {
        const tier = normalizeTier(u.tier);
        const canParticipate = tier === 'PRO' || tier === 'MASTER';

        const lines = [
            `🎁 *LIVE GIVEAWAY*`,
            ``,
            `*${event.title}*`,
            event.description ?? '',
            prizePoolText ? `Prize Pool: ${prizePoolText}` : '',
            criteriaText,
            ``,
            canParticipate ? `Tap below to participate 👇` : `🔒 Upgrade to PRO to participate`,
        ].filter(Boolean);

        const markup = canParticipate
            ? { inline_keyboard: [[{ text: '🎯 Participate', callback_data: `giveaway:participate:${giveawayId}` }]] }
            : { inline_keyboard: [[{ text: '⚡ Upgrade to PRO', callback_data: 'ui:upgrade' }]] };

        insertNotification(u.telegram_id, lines.join('\n'), { replyMarkup: JSON.stringify(markup) });
    }
}

export async function participate(giveawayId: number, telegramId: number): Promise<ParticipateResult> {
    const event = getGiveawayEvent(giveawayId);
    if (!event || event.status !== 'active') {
        return { success: false, message: '❌ This giveaway is no longer active.' };
    }

    const user = getUser(telegramId);
    if (!user) return { success: false, message: '❌ User not found.' };

    const tier = normalizeTier(user.tier);
    if (tier === 'DEMO') {
        return {
            success: false,
            message: '❌ Only Pro and Master traders can participate in giveaways.\n\nUpgrade your tier to join!',
            replyMarkup: { inline_keyboard: [[{ text: '⚡ Upgrade to PRO', callback_data: 'ui:upgrade' }]] },
        };
    }

    const existing = getGiveawayParticipant(giveawayId, telegramId);
    if (existing) {
        return { success: false, alreadyIn: true, message: '✅ You\'re already in this giveaway! Good luck 🍀' };
    }

    if (event.criteria_type === 'new_user') {
        const daysThreshold = parseInt(event.criteria_value ?? '7', 10);
        const starts = new Date(event.starts_at ?? event.created_at);
        const cutoff = new Date(starts.getTime() - daysThreshold * 86_400_000);
        const userCreated = new Date(user.created_at ?? '2000-01-01');
        if (userCreated < cutoff) {
            return {
                success: false,
                message: `❌ This giveaway is only for new users (joined within ${daysThreshold} days of the event start).`,
            };
        }
    }

    if (event.criteria_type === 'min_balance' && user.ssid) {
        const minBalance = parseFloat(event.criteria_value ?? '0');
        try {
            const sdk = await sdkPool.get(telegramId, user.ssid);
            try {
                const balances = (await sdk.balances()).getBalances();
                const real = balances.find((b: { type: unknown }) => b.type === BalanceType.Real);
                const amount = (real as { amount?: number } | undefined)?.amount ?? 0;
                if (amount < minBalance) {
                    return {
                        success: false,
                        message: `❌ Insufficient balance. You need at least $${minBalance} in your real account to participate.`,
                        replyMarkup: {
                            inline_keyboard: [[{
                                text: '💰 Fund Account',
                                url: process.env.AFFILIATE_LINK ?? 'https://iqbroker.com',
                            }]],
                        },
                    };
                }
            } finally {
                sdkPool.release(telegramId);
            }
        } catch {
            // Balance check failed — allow participation
        }
    }

    const participantId = insertGiveawayParticipant(giveawayId, telegramId);
    const count = getGiveawayParticipantCount(giveawayId);

    queueParticipantUpdate(
        giveawayId, participantId, telegramId, 'joined',
        `✅ You're in! *${event.title}*\n\n${count} participants so far. Good luck! 🍀`,
    );

    return {
        success: true,
        message: `✅ You've joined the *${event.title}* giveaway!\n\n*${count}* participants so far. Good luck! 🍀`,
    };
}

export function recordTrade(telegramId: number, isMartingaleRecovery = false): void {
    if (isMartingaleRecovery) return;
    const participations = getActiveParticipations(telegramId);
    for (const p of participations) {
        if (p.criteria_type === 'top_traders') {
            incrementParticipantTradeCount(p.participation_id);
            const sendAt = futureTimestamp(60_000, 300_000);
            insertGiveawayUpdate(
                p.giveaway_id, p.participation_id, telegramId, 'progress',
                `📈 Trade recorded for *${p.title}*! Keep trading to climb the rankings.`,
                sendAt,
            );
        }
    }
}

export function selectWinners(giveawayId: number): Array<{ telegram_id: number; participantId: number }> {
    const event = getGiveawayEvent(giveawayId);
    if (!event) return [];

    const eligible = getGiveawayParticipants(giveawayId, true);
    if (eligible.length === 0) return [];

    let winners: typeof eligible;
    if (event.criteria_type === 'top_traders') {
        winners = eligible.slice(0, event.max_winners);
    } else {
        const shuffled = [...eligible].sort(() => Math.random() - 0.5);
        winners = shuffled.slice(0, event.max_winners);
    }

    for (const w of winners) {
        setParticipantWinner(w.id);
        incrementGiveawayWinnerCount(giveawayId);
        const prizeText = event.prize_per_winner != null ? ` — Prize: *$${event.prize_per_winner.toFixed(2)}*` : '';
        queueParticipantUpdate(
            giveawayId, w.id, w.telegram_id, 'won',
            `🎉 Congratulations! You won the *${event.title}* giveaway!${prizeText}\n\nThe admin will contact you shortly.`,
        );
    }

    setGiveawayStatus(giveawayId, 'completed');
    return winners.map(w => ({ telegram_id: w.telegram_id, participantId: w.id }));
}

export function queueParticipantUpdate(
    giveawayId: number, participantId: number, telegramId: number, type: string, text: string
): void {
    const sendAt = futureTimestamp(30_000, 300_000);
    insertGiveawayUpdate(giveawayId, participantId, telegramId, type, text, sendAt);
}

export function sendMotivationalMessages(giveawayId: number): void {
    const event = getGiveawayEvent(giveawayId);
    if (!event) return;

    const msg = getRandomMotivationalMessage();
    if (!msg) return;

    const count = getGiveawayParticipantCount(giveawayId);
    const text = msg.content
        .replace(/\$\{prize_pool\}/g, event.prize_pool != null ? `$${event.prize_pool.toFixed(2)}` : 'the prize')
        .replace(/\$\{prize_per_winner\}/g, event.prize_per_winner != null ? `$${event.prize_per_winner.toFixed(2)}` : 'the prize')
        .replace(/\$\{count\}/g, String(count))
        .replace(/\$\{title\}/g, event.title)
        .replace(/\$\{spots_left\}/g, String(event.max_winners))
        .replace(/\$\{time_left\}/g, 'soon')
        .replace(/\$\{recent_winner\}/g, 'a recent winner');

    const markup = JSON.stringify({
        inline_keyboard: [[{ text: '🎯 Participate', callback_data: `giveaway:participate:${giveawayId}` }]],
    });

    const testUserId = getTestUserId();
    if (testUserId) console.log(`[test-mode] sending only to test user ${testUserId}`);
    const participants = getGiveawayParticipants(giveawayId, true)
        .filter(p => !testUserId || p.telegram_id === testUserId);
    for (const p of participants) {
        insertNotification(p.telegram_id, text, { replyMarkup: markup });
    }
}

export async function activatePromoCode(giveawayId: number): Promise<void> {
    setGiveawayStatus(giveawayId, 'active');
    const event = getGiveawayEvent(giveawayId);
    if (!event) return;

    const testUserId = getTestUserId();
    if (testUserId) console.log(`[test-mode] sending only to test user ${testUserId}`);
    const users = testUserId
        ? [{ telegram_id: testUserId, tier: 'MASTER' as const }]
        : getApprovedUsersWithTier();

    for (const u of users) {
        const tier = normalizeTier(u.tier);
        const canClaim = tier === 'PRO' || tier === 'MASTER';

        const lines = [
            `🏷️ *NEW PROMO CODE*`,
            ``,
            `*${event.title}*`,
            event.description ?? '',
            event.max_winners != null ? `Limited: ${event.max_winners} claims available` : '',
            ``,
            canClaim ? `Tap below to claim your code 👇` : `🔒 Upgrade to PRO to claim`,
        ].filter(Boolean);

        const markup = canClaim
            ? { inline_keyboard: [[{ text: '🎁 Claim Code', callback_data: `promo:claim:${giveawayId}` }]] }
            : { inline_keyboard: [[{ text: '⚡ Upgrade to PRO', callback_data: 'ui:upgrade' }]] };

        insertNotification(u.telegram_id, lines.join('\n'), { replyMarkup: JSON.stringify(markup) });
    }
}

export async function activateMarathon(giveawayId: number): Promise<void> {
    setGiveawayStatus(giveawayId, 'active');
    seedMarathonFabricants(giveawayId);
    const event = getGiveawayEvent(giveawayId);
    if (!event) return;

    const testUserId = getTestUserId();
    if (testUserId) console.log(`[test-mode] sending only to test user ${testUserId}`);
    const users = testUserId
        ? [{ telegram_id: testUserId, tier: 'MASTER' as const }]
        : getApprovedUsersWithTier();
    const prizePoolText = event.prize_pool != null ? `$${event.prize_pool.toFixed(2)}` : '';
    const endsLine = event.ends_at ? `Ends: ${event.ends_at.split(' ')[0]}` : '';

    for (const u of users) {
        const tier = normalizeTier(u.tier);
        const canJoin = tier === 'PRO' || tier === 'MASTER';

        const lines = [
            `🏃 *LIVE MARATHON*`,
            ``,
            `*${event.title}*`,
            event.description ?? '',
            prizePoolText ? `Prize Pool: ${prizePoolText}` : '',
            `Top ${event.max_winners} traders win`,
            endsLine,
            ``,
            canJoin ? `Trade the most to win! 👇` : `🔒 Upgrade to PRO to join`,
        ].filter(Boolean);

        const markup = canJoin
            ? { inline_keyboard: [[{ text: '🏃 Join Marathon', callback_data: `giveaway:participate:${giveawayId}` }]] }
            : { inline_keyboard: [[{ text: '⚡ Upgrade to PRO', callback_data: 'ui:upgrade' }]] };

        insertNotification(u.telegram_id, lines.join('\n'), { replyMarkup: JSON.stringify(markup) });
    }
}

export async function claimPromoCode(
    giveawayId: number,
    telegramId: number
): Promise<{ success: boolean; code?: string; message: string; replyMarkup?: ParticipateResult['replyMarkup'] }> {
    const event = getGiveawayEvent(giveawayId);
    if (!event || event.status !== 'active' || event.event_type !== 'promo_code') {
        return { success: false, message: '❌ This promo code is no longer available.' };
    }

    const user = getUser(telegramId);
    if (!user) return { success: false, message: '❌ User not found.' };

    const tier = normalizeTier(user.tier);
    if (tier === 'DEMO') {
        return {
            success: false,
            message: '❌ Only Pro and Master traders can claim promo codes.\n\nUpgrade to claim!',
            replyMarkup: { inline_keyboard: [[{ text: '⚡ Upgrade to PRO', callback_data: 'ui:upgrade' }]] },
        };
    }

    const code = event.criteria_value ?? '';

    const existing = getGiveawayParticipant(giveawayId, telegramId);
    if (existing) {
        return { success: true, code, message: `✅ Already claimed!\n\n🎉 Your code: *${code}*\n\nUse this when funding your account.` };
    }

    const claimed = getGiveawayParticipantCount(giveawayId);
    if (event.max_winners != null && claimed >= event.max_winners) {
        return { success: false, message: '❌ This promo code has reached its maximum number of claims. Check back for more promos!' };
    }

    const participantId = insertGiveawayParticipant(giveawayId, telegramId);
    setParticipantWinner(participantId);

    const newCount = getGiveawayParticipantCount(giveawayId);
    if (event.max_winners != null && newCount >= event.max_winners) {
        setGiveawayStatus(giveawayId, 'completed');
    }

    return {
        success: true,
        code,
        message: `🎉 Your code: *${code}*\n\nUse this when funding your account.`,
    };
}

export function getMarathonLeaderboard(giveawayId: number): Array<{ telegram_id: number | null; display_name: string | null; trade_count: number; rank: number }> {
    const rows = getMarathonLeaderboardRows(giveawayId);
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export async function checkMarathonDeadlines(telegram: Telegram): Promise<void> {
    const now = new Date();
    const expired = getActiveGiveaways().filter(
        g => g.event_type === 'marathon' && g.ends_at && new Date(g.ends_at) <= now
    );
    for (const m of expired) {
        const winners = selectWinners(m.id);
        const winnerIds = new Set(winners.map(w => w.telegram_id));
        const all = getGiveawayParticipants(m.id, true);
        for (const p of all) {
            const msg = winnerIds.has(p.telegram_id)
                ? `🏆 Marathon *${m.title}* has ended — you're a top winner! The admin will contact you shortly.`
                : `📊 Marathon *${m.title}* has ended. Thanks for competing! Top ${m.max_winners} won.`;
            try { await telegram.sendMessage(p.telegram_id, msg, { parse_mode: 'Markdown' }); } catch {}
        }
        deleteMarathonFabricants(m.id);
    }
}

export async function processUpdateQueue(telegram: Telegram): Promise<void> {
    const updates = getPendingGiveawayUpdates();
    for (const update of updates) {
        try {
            await telegram.sendMessage(update.telegram_id, update.update_text ?? '', { parse_mode: 'Markdown' });
        } catch {
            // ignore send failures
        } finally {
            markGiveawayUpdateSent(update.id);
        }
    }

    // Social proof: send random participant count bursts to a sample of active giveaway participants
    const testUserId = getTestUserId();
    const activeGiveaways = getActiveGiveaways();
    for (const event of activeGiveaways) {
        const count = getGiveawayParticipantCount(event.id);
        if (count < 2) continue;

        const participants = getGiveawayParticipants(event.id, true);
        const batchSize = Math.min(participants.length, 2 + Math.floor(Math.random() * 15));
        const rawBatch = [...participants].sort(() => Math.random() - 0.5).slice(0, batchSize);
        const batch = testUserId ? rawBatch.filter(p => p.telegram_id === testUserId) : rawBatch;
        if (batch.length === 0) continue;

        const fakeCount = count + Math.floor(Math.random() * 12);
        const msg = Math.random() > 0.5
            ? `🔥 ${fakeCount} people just joined the giveaway`
            : `📊 ${count} users now participating`;

        for (const p of batch) {
            try {
                await telegram.sendMessage(p.telegram_id, msg);
            } catch {
                // ignore
            }
        }
    }
}

export async function processNotificationsQueue(telegram: Telegram): Promise<void> {
    const testUserId = getTestUserId();
    if (testUserId) console.log(`[test-mode] sending only to test user ${testUserId}`);
    const notifications = getPendingNotifications(20);
    for (const n of notifications) {
        if (testUserId && n.telegram_id !== testUserId) continue;
        try {
            const markup = n.reply_markup ? JSON.parse(n.reply_markup) : undefined;
            const opts: Record<string, unknown> = { parse_mode: 'Markdown' };
            if (markup) opts.reply_markup = markup;

            if (n.image_file_id) {
                await telegram.sendPhoto(n.telegram_id, n.image_file_id, {
                    caption: n.message,
                    parse_mode: 'Markdown',
                    ...(markup ? { reply_markup: markup } : {}),
                });
            } else {
                await telegram.sendMessage(n.telegram_id, n.message, opts as Parameters<Telegram['sendMessage']>[2]);
            }
            markNotificationSent(n.id);
        } catch {
            markNotificationFailed(n.id);
        }
    }
}
