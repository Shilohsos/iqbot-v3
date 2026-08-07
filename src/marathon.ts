/**
 * Marathon V2 — Live tracking marathon system.
 * Admin sets requirements (min balance, min trades, min growth).
 * Users click Marathon button → SDK balance check → registered/tracked.
 */
import type { Telegram } from 'telegraf';
import { sdkPool } from './sdk-pool.js';
import { ClientSdk, BalanceType } from './index.js';
import {
    getUser,
    getSessionTrades,
    insertNotification,
    getApprovedUsersWithTier,
    getTestUserId,
    createMarathonConfig,
    getActiveMarathonConfig,
    getMarathonConfig,
    setMarathonConfigStatus,
    getMarathonParticipant,
    insertMarathonParticipant,
    updateMarathonParticipantBalance,
    markMarathonParticipantQualified,
    markMarathonParticipantBlown,
    incrementMarathonPush,
    getActiveMarathonParticipants,
    getMarathonLeaderboard,
    type MarathonConfig,
    type MarathonParticipant,
} from './db.js';
import { convertToUsd } from './access.js';
import { logger } from './logger.js';

const DEPOSIT_URL = 'https://iqoption.com/pwa/payments/deposit';
const ADMIN_CONTACT = 'https://t.me/shiloh_is_10xing';

/** Get a user's live IQ Option real balance in USD via SDK. */
export async function getUserLiveBalanceUsd(telegramId: number): Promise<number | null> {
    const user = getUser(telegramId);
    if (!user?.ssid) return null;

    try {
        const sdk = await sdkPool.get(telegramId, user.ssid);
        try {
            const balances = (await sdk.balances()).getBalances();
            const real = balances.find(b => b.type === BalanceType.Real);
            if (!real) return 0;
            const usd = await convertToUsd(real.amount, real.currency ?? 'USD', sdk);
            return usd ?? null;
        } finally {
            sdkPool.release(telegramId);
        }
    } catch (err) {
        logger.warn('marathon', `Balance check failed for ${telegramId}: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}

/** Admin creates a marathon: sets requirements + broadcasts to all approved users. */
export async function startMarathonBroadcast(
    giveawayId: number,
    minBalanceUsd: number,
    minTrades: number,
    minGrowth: number,
    telegram: Telegram,
): Promise<void> {
    const configId = createMarathonConfig(giveawayId, minBalanceUsd, minTrades, minGrowth);

    const testUserId = getTestUserId();
    const users = testUserId
        ? [{ telegram_id: testUserId, tier: 'MASTER' as const }]
        : getApprovedUsersWithTier();

    if (testUserId) console.log(`[test-mode] marathon broadcast only to test user ${testUserId}`);

    const msg = [
        '🏃 *TRADING MARATHON IS LIVE*',
        '',
        `💰 *Prize Pool: See event details*`,
        `📊 *Requirements:*`,
        `   • Minimum balance: *$${minBalanceUsd}*`,
        `   • Minimum trades: *${minTrades}*`,
        `   • Minimum growth: *${minGrowth}x*`,
        '',
        'Trade. Grow. Win. 👇',
    ].join('\n');

    const markup = {
        inline_keyboard: [[{ text: '🏃 Join Marathon', callback_data: `marathon_v2:join:${configId}` }]],
    };

    for (const u of users) {
        insertNotification(u.telegram_id, msg, { replyMarkup: JSON.stringify(markup) });
    }
}

/** User clicks Join Marathon → SDK balance check → register or redirect to fund. */
export async function handleMarathonJoin(telegramId: number, configId: number): Promise<{ message: string; markup?: any }> {
    const config = getMarathonConfig(configId);
    if (!config || config.status !== 'active') {
        return { message: '❌ This marathon is no longer active.' };
    }

    // Check if already joined
    const existing = getMarathonParticipant(configId, telegramId);
    if (existing && !existing.blown_account) {
        const tradesLeft = Math.max(0, config.min_trades - existing.trades_done);
        const growthNeeded = Math.max(0, config.min_growth_multiplier - existing.growth_multiplier);
        return {
            message: [
                `✅ *You're in the marathon!*`,
                '',
                `📊 *Your progress:*`,
                `   • Trades: *${existing.trades_done}/${config.min_trades}*`,
                `   • Growth: *${existing.growth_multiplier.toFixed(2)}x / ${config.min_growth_multiplier}x*`,
                `   • Balance: *$${existing.current_balance_usd.toFixed(2)}*`,
                tradesLeft > 0 ? `   • Trades remaining: *${tradesLeft}*` : `   ✅ Trade requirement met!`,
                growthNeeded > 0 ? `   • Growth needed: *${growthNeeded.toFixed(2)}x more*` : `   ✅ Growth requirement met!`,
                existing.qualified ? '\n🎉 *You\'re qualified!*' : '',
            ].filter(Boolean).join('\n'),
        };
    }

    // Check live balance via SDK
    const balanceUsd = await getUserLiveBalanceUsd(telegramId);

    if (balanceUsd === null) {
        // Can't check balance (no SSID, SDK error)
        return {
            message: [
                '⚠️ *Cannot verify your balance right now.*',
                '',
                'Make sure your account is connected to 10x AI, then try again.',
                '',
                '👇 Click below to fund or contact admin:',
            ].join('\n'),
            markup: {
                inline_keyboard: [
                    [{ text: '💰 Fund Account', url: DEPOSIT_URL }],
                    [{ text: '👤 Contact Admin', url: ADMIN_CONTACT }],
                ],
            },
        };
    }

    if (balanceUsd < config.min_balance_usd) {
        // Below minimum — redirect to fund
        return {
            message: [
                `❌ *Balance too low for this marathon.*`,
                '',
                `Your balance: *$${balanceUsd.toFixed(2)}*`,
                `Required: *$${config.min_balance_usd.toFixed(2)}*`,
                '',
                'Fund your account and come back 👇',
            ].join('\n'),
            markup: {
                inline_keyboard: [
                    [{ text: '💰 Fund Account', url: DEPOSIT_URL }],
                    [{ text: '🏃 Try Again', callback_data: `marathon_v2:join:${configId}` }],
                ],
            },
        };
    }

    // Balance OK — register participant
    insertMarathonParticipant(configId, telegramId, balanceUsd);

    return {
        message: [
            '🎉 *You\'re participating!*',
            '',
            `Starting balance: *$${balanceUsd.toFixed(2)}*`,
            '',
            `📊 *Requirements to qualify:*`,
            `   • Minimum trades: *${config.min_trades}*`,
            `   • Minimum growth: *${config.min_growth_multiplier}x*`,
            `   • Minimum balance: *$${config.min_balance_usd.toFixed(2)}*`,
            '',
            `Trade to hit your targets 💜`,
        ].join('\n'),
        markup: {
            inline_keyboard: [
                [{ text: '📊 My Stats', callback_data: `marathon_v2:join:${configId}` }],
            ],
        },
    };
}

/** Marathon tracking loop — runs periodically (60s). Checks balance, trades, growth, sends push messages. */
export async function tickMarathonTracking(telegram: Telegram): Promise<void> {
    const config = getActiveMarathonConfig();
    if (!config) return;

    const participants = getActiveMarathonParticipants();
    if (participants.length === 0) return;

    const testUserId = getTestUserId();

    for (const p of participants) {
        if (testUserId && p.telegram_id !== testUserId) continue;

        // Already qualified — skip
        if (p.qualified) continue;

        // Check current balance
        const balanceUsd = await getUserLiveBalanceUsd(p.telegram_id);
        if (balanceUsd === null) continue;

        // Check if blown (balance near zero)
        if (balanceUsd < 1) {
            markMarathonParticipantBlown(config.id, p.telegram_id);
            await sendPushMessage(telegram, p.telegram_id, [
                '💥 *Your account balance is too low.*',
                '',
                'Fund your account to keep trading in the marathon! 👇',
            ].join('\n'), {
                inline_keyboard: [[{ text: '💰 Fund Account', url: DEPOSIT_URL }]],
            });
            continue;
        }

        // Get user's trade count from DB directly (session_trades column exists in DB but not in UserRecord interface)
        const sessionTrades = getSessionTrades(p.telegram_id);

        // Calculate marathon-specific trades: only count trades AFTER joining
        // Use stored trades_done as baseline; increment if session_trades increased since last check
        const newTradeCount = Math.max(p.trades_done, sessionTrades - p.start_session_trades);

        // Update participant stats
        updateMarathonParticipantBalance(config.id, p.telegram_id, balanceUsd, newTradeCount);

        // Check qualification
        const updated = getMarathonParticipant(config.id, p.telegram_id);
        if (!updated) continue;

        const tradesMet = updated.trades_done >= config.min_trades;
        const growthMet = updated.growth_multiplier >= config.min_growth_multiplier;
        const balanceMet = balanceUsd >= config.min_balance_usd;

        if (tradesMet && growthMet && balanceMet) {
            markMarathonParticipantQualified(config.id, p.telegram_id);
            await sendPushMessage(telegram, p.telegram_id, [
                '🎉 *CONGRATULATIONS! You\'re qualified!*',
                '',
                `📊 *Final stats:*`,
                `   • Trades: *${updated.trades_done}*`,
                `   • Growth: *${updated.growth_multiplier.toFixed(2)}x*`,
                `   • Balance: *$${balanceUsd.toFixed(2)}*`,
                '',
                'You\'re eligible to win! Keep trading until the marathon ends 🚀',
            ].join('\n'));
            continue;
        }

        // Send push notifications (every 10 trades, not more than once per hour)
        const lastPush = p.last_push_at ? new Date(p.last_push_at).getTime() : 0;
        const hourPassed = Date.now() - lastPush > 3_600_000;
        const tradesIncreased = newTradeCount > p.trades_done;

        if (hourPassed && tradesIncreased && updated.trades_done > 0 && updated.trades_done % 10 === 0) {
            incrementMarathonPush(config.id, p.telegram_id);

            const tradesLeft = Math.max(0, config.min_trades - updated.trades_done);
            const growthLeft = Math.max(0, config.min_growth_multiplier - updated.growth_multiplier);
            const pushLines: string[] = [];

            if (tradesLeft > 0) {
                pushLines.push(`📊 *Marathon progress:* ${updated.trades_done}/${config.min_trades} trades (${tradesLeft} to go)`);
            }
            if (growthLeft > 0) {
                pushLines.push(`📈 Growth: ${updated.growth_multiplier.toFixed(2)}x / ${config.min_growth_multiplier}x (${growthLeft.toFixed(2)}x to go)`);
            }

            if (pushLines.length > 0) {
                pushLines.unshift('🏃 *Keep going!*');
                pushLines.push('', 'Trade now to hit your targets 💜');
                await sendPushMessage(telegram, p.telegram_id, pushLines.join('\n'));
            }
        }
    }
}

async function sendPushMessage(telegram: Telegram, telegramId: number, message: string, markup?: any): Promise<void> {
    try {
        await telegram.sendMessage(telegramId, message, {
            parse_mode: 'Markdown',
            ...(markup ? { reply_markup: markup } : {}),
        });
    } catch (err) {
        logger.warn('marathon', `Push message failed for ${telegramId}: ${err instanceof Error ? err.message : err}`);
    }
}

/** Get marathon leaderboard for display. */
export function getMarathonV2Leaderboard(configId: number) {
    return getMarathonLeaderboard(configId);
}

/** End marathon — mark config as ended. */
export function endMarathon(configId: number): void {
    setMarathonConfigStatus(configId, 'ended');
}
