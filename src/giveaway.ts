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
    seedGiveawayFabricants,
    getRealAndFabricatedCounts,
    seedMarathonFabricants,
    getAllFabricatedTraders,
    getMarathonLeaderboardRows,
    deleteMarathonFabricants,
    setPromoFabricatedClaims,
    incrementPromoFabricatedClaims,
    markPromoUrgencySent,
    getActivePromosDueForFabTick,
    type GiveawayEventInput,
    type GiveawayEvent,
} from './db.js';
import { sdkPool } from './sdk-pool.js';
import { BalanceType } from './index.js';
import { normalizeTier } from './tiers.js';

export type { GiveawayEventInput, GiveawayEvent };
export { getGiveawayEvents, getActiveGiveaways, getGiveawayEvent, getRealAndFabricatedCounts };

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

function maskFabId(id: string): string {
    if (id.length <= 6) return id;
    return id.slice(0, 3) + '***' + id.slice(-3);
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

    seedGiveawayFabricants(giveawayId);
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

    const allEligible = getGiveawayParticipants(giveawayId, true);
    if (allEligible.length === 0) return [];

    // For giveaways: winners come from fabricated pool only — no real payout
    const pool = event.event_type === 'giveaway'
        ? allEligible.filter(p => p.fabricated === 1)
        : allEligible;

    if (pool.length === 0) return [];

    let winners: typeof pool;
    if (event.criteria_type === 'top_traders') {
        winners = pool.slice(0, event.max_winners);
    } else {
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        winners = shuffled.slice(0, event.max_winners);
    }

    // Assign realistic 9-digit display IDs from fabricated_traders pool
    const fabTraders = [...getAllFabricatedTraders()].sort(() => Math.random() - 0.5);
    const winnerDisplayIds: string[] = winners.map(
        (_, i) => fabTraders[i % Math.max(fabTraders.length, 1)]?.fabricated_id ?? String(100_000_000 + i)
    );

    for (let i = 0; i < winners.length; i++) {
        const w = winners[i];
        setParticipantWinner(w.id);
        incrementGiveawayWinnerCount(giveawayId);
        const prizeText = event.prize_per_winner != null ? ` — Prize: *$${event.prize_per_winner.toFixed(2)}*` : '';
        queueParticipantUpdate(
            giveawayId, w.id, w.telegram_id, 'won',
            `🎉 Congratulations! You won the *${event.title}* giveaway!${prizeText}\n\nThe admin will contact you shortly.`,
        );
        // Fabricated winners have negative telegram_ids — sendMessage will fail silently
    }

    // Results announcement to ALL approved users — fires even if zero real participants
    const approvedUsers = getApprovedUsersWithTier();
    if (approvedUsers.length > 0) {
        const maskedWinners = winnerDisplayIds.map(id => maskFabId(id)).join(', ');
        const prizeText = event.prize_per_winner != null
            ? `\nPrize per winner: *$${event.prize_per_winner.toFixed(2)}*` : '';
        const announcementMsg =
            `🎉 *GIVEAWAY RESULTS*\n\n` +
            `*${event.title}*\n\n` +
            `🏆 Winners: ${maskedWinners}${prizeText}\n\n` +
            `Prize will be delivered shortly. Thanks to everyone who participated!`;
        for (const u of approvedUsers) {
            insertNotification(u.telegram_id, announcementMsg, {});
        }
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

    // Seed initial fabricated claims (20-30% of max_winners)
    const max = event.max_winners ?? 0;
    if (max > 0) {
        const initial = Math.floor(max * (0.20 + Math.random() * 0.10));
        const firstTickMs = (10 + Math.floor(Math.random() * 5)) * 60_000;
        const firstTickAt = new Date(Date.now() + firstTickMs).toISOString().replace('T', ' ').split('.')[0];
        setPromoFabricatedClaims(giveawayId, initial, firstTickAt);
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

}

export async function tickPromoFabrication(): Promise<void> {
    const promos = getActivePromosDueForFabTick();
    for (const event of promos) {
        const max = event.max_winners ?? 0;
        if (max === 0) continue;

        const targetMax = Math.floor(max * 0.92);
        if (event.fabricated_claims >= targetMax) continue;

        // Pace: spread remaining fabricated claims across remaining time
        let increment = 1;
        const remaining_to_add = targetMax - event.fabricated_claims;
        if (event.ends_at) {
            const now = Date.now();
            const remaining_ms = Math.max(0, new Date(event.ends_at).getTime() - now);
            if (remaining_ms > 0) {
                const ticks_left = Math.max(1, remaining_ms / (12.5 * 60_000));
                increment = Math.max(1, Math.min(5, Math.ceil(remaining_to_add / ticks_left)));
            }
        }

        const newFab = Math.min(targetMax, event.fabricated_claims + increment);
        const nextTickMs = (10 + Math.floor(Math.random() * 6)) * 60_000;
        const nextTickAt = new Date(Date.now() + nextTickMs).toISOString().replace('T', ' ').split('.')[0];
        incrementPromoFabricatedClaims(event.id, newFab - event.fabricated_claims, nextTickAt);

        // Urgency notifications — each threshold fires only once
        const realClaims = getGiveawayParticipantCount(event.id);
        const remaining = max - realClaims - newFab;

        const testUserId = getTestUserId();
        if (testUserId) console.log(`[test-mode] promo urgency sending only to test user ${testUserId}`);
        const audience = testUserId
            ? [{ telegram_id: testUserId }]
            : getApprovedUsersWithTier();

        const claimBtn = (label: string) => JSON.stringify({
            inline_keyboard: [[{ text: label, callback_data: `promo:claim:${event.id}` }]],
        });

        if (remaining <= 1 && !event.urgency_1_sent) {
            markPromoUrgencySent(event.id, 1);
            for (const u of audience) {
                insertNotification(u.telegram_id,
                    `🏃 *Last promo code — grab it now!*\n\n*${event.title}*\n\nOnly 1 left!`,
                    { replyMarkup: claimBtn('🏃 Grab It Now') });
            }
        } else if (remaining <= 5 && !event.urgency_5_sent) {
            markPromoUrgencySent(event.id, 5);
            for (const u of audience) {
                insertNotification(u.telegram_id,
                    `🔥 *Only 5 promo codes remaining!*\n\n*${event.title}*\n\nGrab yours before they're gone!`,
                    { replyMarkup: claimBtn('🔥 Claim Now') });
            }
        } else if (remaining <= 10 && !event.urgency_10_sent) {
            markPromoUrgencySent(event.id, 10);
            for (const u of audience) {
                insertNotification(u.telegram_id,
                    `⚠️ *Only 10 promo codes left!*\n\n*${event.title}*\n\nRunning out fast — claim yours now!`,
                    { replyMarkup: claimBtn('⚠️ Claim Code') });
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
