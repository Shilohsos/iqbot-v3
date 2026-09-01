// src/sales-bot.ts — Sales team lead tracking bot (Team A/B/C, masked stats, Sunday reveal)
// Token: 6461943886:***

import { Telegraf, Context } from 'telegraf';
import {
    getLatestUnclaimed,
    getAllUnclaimed,
    claimLead,
    getEventById,
    getWeeklyReport,
    getLeaderboard,
    getRepStats,
    getRepWeeklyCount,
    getKpiTargets,
    setKpiTargets,
    getContestConfig,
    setContestConfig,
    getAdminId,
    setRepTelegramId,
    getAllRepIds,
    getWeeklyClaimedEvents,
    startLeadScanner,
    type LeadEvent,
} from './sales-leads.js';

const TEAMS = ['Eniola', 'Olivia', 'Gift', 'Uduak', 'Blessing', 'Rebecca', 'Team'];

// Store pending claim confirmations: key = `${chatId}:${eventId}`, value = teamName
const pendingConfirmations = new Map<string, { repName: string; eventId: number; eventType: string; amount: number; iqUserId: number }>();

// Track the user's original ID message so it can be deleted after a claim (keeps chat clean)
const userMsgIds = new Map<string, number>(); // key = `${chatId}:${iqUserId}`, value = user message_id

// Admin conversation state (for setting KPI/contest)
const adminState = new Map<number, { action: string; step: number; ftd?: number }>();

/** True on Sunday (Africa/Lagos = UTC+1). Stats are revealed only on Sunday. */
function isSunday(): boolean {
    const d = new Date();
    return new Date(d.getTime() + 3600_000).getUTCDay() === 0;
}

function maskedNotice(kpi: { ftd: number; redep: number }, contest: { prize: number; description: string }): string {
    return (
        `✦ *Stats hidden until Sunday*\n\n` +
        `✦ KPI Target: ${kpi.ftd || '—'} FTDs / $${kpi.redep || '—'} Redep Volume\n` +
        (contest.prize ? `1. Contest Prize: ₦${contest.prize.toLocaleString()}\n` : '') +
        `\nTeam statistics are revealed every Sunday. Keep closing! ✦`
    );
}

/** Progress bar for FTD events (count vs target). */
function countBar(current: number, target: number): string {
    if (target <= 0) return `${current} (no target set)`;
    const pct = Math.min(current / target, 1);
    const filled = Math.round(pct * 10);
    return `${current}/${target} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(pct * 100)}%`;
}

/** Progress bar for redep volume ($ vs target). */
function volBar(current: number, target: number): string {
    if (target <= 0) return `$${current.toFixed(2)} (no target set)`;
    const pct = Math.min(current / target, 1);
    const filled = Math.round(pct * 10);
    return `$${current.toFixed(2)}/$${target} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(pct * 100)}%`;
}

export function createSalesBot(token: string): Telegraf {
    const bot = new Telegraf(token);

    const isAdmin = (ctx: Context): boolean => ctx.from?.id === getAdminId();

    // ─── Start (Admin Panel) ─────────────────────────────────────────────────
    bot.command('start', (ctx) => {
        if (!isAdmin(ctx)) {
            ctx.reply(
                `◆ *Sales Lead Tracker*\n\n` +
                `Send an IQ Option User ID to log a lead.\n\n` +
                `*Commands:*\n` +
                `/leaderboard — Weekly contest ranking\n` +
                `/mystats — Your team stats (revealed Sunday)\n` +
                `/help — All commands`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const kpi = getKpiTargets();
        const contest = getContestConfig();

        ctx.reply(
            `✦ *Admin Panel*\n━━━━━━━━━━━━━━━━━\n\n` +
            `✦ KPI Targets: ${kpi.ftd || '—'} FTDs / $${kpi.redep || '—'} Redep Volume\n` +
            `1. Contest Prize: ${contest.prize ? `₦${contest.prize.toLocaleString()}` : 'Not set'}\n\n` +
            `Select an action:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '◆ View Progress', callback_data: 'admin:progress' }],
                        [{ text: '✦ Set KPI Targets', callback_data: 'admin:setkpi' }],
                        [{ text: '1. Set Contest Prize', callback_data: 'admin:setcontest' }],
                        [{ text: '◆ Weekly Report', callback_data: 'admin:weekly' }],
                        [{ text: '◆ Leaderboard', callback_data: 'admin:leaderboard' }],
                    ],
                },
            }
        );
    });

    // ─── Help ────────────────────────────────────────────────────────────────
    bot.command('help', (ctx) => {
        ctx.reply(
            `◆ *Lead Tracker Bot*\n\n` +
            `Send an IQ Option User ID to log a lead.\n\n` +
            `*Commands:*\n` +
            `\`/weekly\` — Weekly KPI report (admin)\n` +
            `\`/leaderboard\` — Weekly contest ranking\n` +
            `\`/mystats\` — Your team stats this week\n` +
            `\`/recent\` — Recently claimed leads\n` +
            `\`/help\` — This message`,
            { parse_mode: 'Markdown' }
        );
    });

    // ─── Weekly Report (admin only — always real for admin) ──────────────────
    bot.command('weekly', (ctx) => {
        if (!isAdmin(ctx)) {
            ctx.reply('✕ Admin only.');
            return;
        }

        const report = getWeeklyReport();

        if (report.total_ftds === 0 && report.total_redeps === 0) {
            ctx.reply(`◆ *Weekly KPI Report*\n${report.week_start} → ${report.week_end}\n\n_No leads claimed yet this week._`, { parse_mode: 'Markdown' });
            return;
        }

        let text = `◆ *Weekly KPI Report*\n${report.week_start} → ${report.week_end}\n\n`;

        for (let i = 0; i < report.reps.length; i++) {
            const r = report.reps[i];
            const medal = i === 0 ? '2.' : i === 1 ? '3.' : i === 2 ? '4.' : '';
            text += `${medal} *${r.name}* — ${r.ftd_count} FTDs · Redep Volume $${r.redep_volume.toFixed(2)}\n\n`;
        }

        text += `━━━━━━━━━━━━━━━━━\n`;
        const totalRedepVol = report.reps.reduce((s, r) => s + r.redep_volume, 0);
        text += `Total: ${report.total_ftds} FTDs + $${totalRedepVol.toFixed(2)} redep volume`;

        ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // ─── Leaderboard (masked for teams until Sunday; admin always sees real) ──
    bot.command('leaderboard', (ctx) => {
        if (!isSunday() && !isAdmin(ctx)) {
            const kpi = getKpiTargets();
            const contest = getContestConfig();
            ctx.reply(maskedNotice(kpi, contest), { parse_mode: 'Markdown' });
            return;
        }

        const report = getWeeklyReport();

        if (report.total_ftds === 0 && report.total_redeps === 0) {
            ctx.reply(`1. *Weekly Contest — Deposit Volume*\n\n_No deposits logged yet this week._`, { parse_mode: 'Markdown' });
            return;
        }

        const contest = getContestConfig();
        let text = `1. *Weekly Contest — FTD Events* — ranked by most FTDs\n`;
        if (contest.prize > 0) {
            text += `✦ Prize: ₦${contest.prize.toLocaleString()}\n`;
        }
        text += `\n`;
        for (let i = 0; i < report.reps.length; i++) {
            const r = report.reps[i];
            const medal = i === 0 ? '2.' : i === 1 ? '3.' : '4.';
            text += `${medal} *${r.name}* — ${r.ftd_count} FTDs · Redep Volume $${r.redep_volume.toFixed(2)}\n`;
        }
        text += `\n✦ Total redep volume this week: $${report.reps.reduce((s, r) => s + r.redep_volume, 0).toFixed(2)}\n`;
        text += `· Week ending: ${report.week_end}`;

        ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // ─── My Stats (masked until Sunday) ──────────────────────────────────────
    bot.command('mystats', (ctx) => {
        if (!ctx.from) return;

        if (!isSunday() && !isAdmin(ctx)) {
            const kpi = getKpiTargets();
            const contest = getContestConfig();
            ctx.reply(maskedNotice(kpi, contest), { parse_mode: 'Markdown' });
            return;
        }

        // Sunday (or admin anytime): full team stats
        const report = getWeeklyReport();
        const kpi = getKpiTargets();

        let text = `◆ *Team Results — This Week*\n\n`;
        if (report.total_ftds === 0 && report.total_redeps === 0) {
            text += `_No leads claimed yet this week._`;
        } else {
            for (const r of report.reps) {
                text += `*${r.name}*\n` +
                    `FTDs: ${countBar(r.ftd_count, kpi.ftd)}\n` +
                    `Redep Volume: ${volBar(r.redep_volume, kpi.redep)}\n\n`;
            }
        }
        ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // ─── Recent (admin) ──────────────────────────────────────────────────────
    bot.command('recent', (ctx) => {
        if (!isAdmin(ctx)) {
            ctx.reply('✕ Admin only.');
            return;
        }

        const events = getWeeklyClaimedEvents().slice(0, 10);

        if (events.length === 0) {
            ctx.reply('No claimed leads this week.');
            return;
        }

        let text = '◆ *Recent Claims*\n\n';
        for (const e of events) {
            text += `• #${e.id}: UID ${e.iq_user_id} — ${e.event_type.toUpperCase()} $${e.amount.toFixed(2)} → *${e.claimed_by}*\n`;
        }

        ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // ─── Main Flow: Receive IQ User ID ───────────────────────────────────────
    bot.on('text', async (ctx, next) => {
        // Skip if admin is in conversation mode (setting KPI/contest)
        if (ctx.chat?.id && adminState.has(ctx.chat.id)) return next();

        const text = ctx.message.text.trim();

        // Must be a number (IQ user ID)
        if (!/^\d+$/.test(text)) {
            ctx.reply('Send an IQ Option User ID (numbers only) to look up their funding events.', { reply_parameters: { message_id: ctx.message.message_id } });
            return;
        }

        const iqUserId = parseInt(text, 10);
        const events = getAllUnclaimed(iqUserId);

        // Remember the user's ID message so it can be deleted once claimed
        userMsgIds.set(`${ctx.chat?.id}:${iqUserId}`, ctx.message.message_id);

        if (events.length === 0) {
            ctx.reply(
                `❌ No unclaimed funding events found for User ID *${iqUserId}*.\n\n` +
                `They may not have funded yet, or the event was already claimed.`,
                { parse_mode: 'Markdown', reply_parameters: { message_id: ctx.message.message_id } }
            );
            return;
        }

        // Show all unclaimed events for this user
        for (const event of events) {
            const typeLabel = event.event_type === 'ftd' ? '✅ FTD' : '↻ Redeposit';
            const dateStr = event.event_date.split('T')[0];
            const amountStr = `$${event.amount.toFixed(2)}`;

            const msg = await ctx.reply(
                `*User ${iqUserId}*\n` +
                `${typeLabel}: ${amountStr}\n` +
                `Date: ${dateStr}\n\n` +
                `Which team closed this lead?`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            TEAMS.map(name => ({
                                text: name,
                                callback_data: `claim:${event.id}:${name}`,
                            })),
                        ],
                    },
                }
            );
        }
    });

    // ─── Callback: Claim Button ──────────────────────────────────────────────
    bot.action(/^claim:(\d+):(.+)$/, async (ctx) => {
        const eventId = parseInt(ctx.match[1], 10);
        const repName = ctx.match[2];

        const event = getEventById(eventId);
        if (!event) {
            await ctx.answerCbQuery('Event not found.');
            return;
        }

        if (event.claimed) {
            await ctx.answerCbQuery(`Already claimed by ${event.claimed_by}.`);
            return;
        }

        const typeLabel = event.event_type === 'ftd' ? 'FTD' : 'Redeposit';
        const key = `${ctx.chat?.id}:${eventId}`;

        // Store pending confirmation
        pendingConfirmations.set(key, {
            repName,
            eventId,
            eventType: event.event_type,
            amount: event.amount,
            iqUserId: event.iq_user_id,
        });

        // Auto-expire after 60 seconds
        setTimeout(() => { pendingConfirmations.delete(key); }, 60_000);

        await ctx.editMessageText(
            `⚠️ *Confirm:* ${repName} closed User ${event.iq_user_id} for $${event.amount.toFixed(2)} ${typeLabel}?`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Confirm', callback_data: `confirm:${eventId}:${repName}` },
                        { text: '❌ Cancel', callback_data: `cancel:${eventId}` },
                    ]],
                },
            }
        );

        await ctx.answerCbQuery();
    });

    // ─── Callback: Confirm ───────────────────────────────────────────────────
    bot.action(/^confirm:(\d+):(.+)$/, async (ctx) => {
        const eventId = parseInt(ctx.match[1], 10);
        const repName = ctx.match[2];

        const key = `${ctx.chat?.id}:${eventId}`;
        const pending = pendingConfirmations.get(key);

        if (!pending || pending.repName !== repName) {
            await ctx.answerCbQuery('This confirmation has expired. Please start over.');
            return;
        }

        pendingConfirmations.delete(key);

        // Atomic double-claim protection: claimLead only updates WHERE claimed = 0
        const success = claimLead(eventId, repName);
        if (!success) {
            await ctx.answerCbQuery('Already claimed!');
            return;
        }

        // Auto-register team's Telegram ID so the Sunday reveal reaches them
        if (ctx.chat?.id) {
            setRepTelegramId(repName, ctx.chat.id);
        }

        // Transient toast only — the claim message is deleted to keep the chat clean
        await ctx.answerCbQuery('✅ Logged!', { show_alert: true });

        // Delete the claim/confirm message immediately (removes user ID from chat)
        await ctx.deleteMessage().catch(() => {});

        // Also delete the user's original ID message so no ID lingers in the chat
        const userMsgKey = `${ctx.chat?.id}:${pending.iqUserId}`;
        const userMsgId = userMsgIds.get(userMsgKey);
        if (userMsgId) {
            userMsgIds.delete(userMsgKey);
            await ctx.telegram.deleteMessage(ctx.chat!.id!, userMsgId).catch(() => {});
        }
    });

    // ─── Callback: Cancel ────────────────────────────────────────────────────
    bot.action(/^cancel:(\d+)$/, async (ctx) => {
        const eventId = parseInt(ctx.match[1], 10);
        const key = `${ctx.chat?.id}:${eventId}`;
        pendingConfirmations.delete(key);

        await ctx.editMessageText('❌ Cancelled. Lead was *not* logged.', { parse_mode: 'Markdown' });
        await ctx.answerCbQuery();
    });

    // ─── Admin Callbacks ──────────────────────────────────────────────────────

    // Admin: View Progress (always real for admin)
    bot.action('admin:progress', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCbQuery('✕ Admin only.'); return; }

        const kpi = getKpiTargets();
        const contest = getContestConfig();
        const report = getWeeklyReport();

        let text = `◆ *Progress to KPI*\n` +
            `Target: ${kpi.ftd || '—'} FTDs / $${kpi.redep || '—'} Redep Volume\n` +
            `Prize: ${contest.prize ? `₦${contest.prize.toLocaleString()}` : 'Not set'}\n\n`;

        for (const r of report.reps) {
            text += `*${r.name}*\n` +
                `FTDs: ${countBar(r.ftd_count, kpi.ftd)}\n` +
                `Redep Volume: ${volBar(r.redep_volume, kpi.redep)}\n\n`;
        }

        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⟵ Back to Menu', callback_data: 'admin:menu' }]] },
        });
        await ctx.answerCbQuery();
    });

    // Admin: Set KPI — step 1: ask for FTD target
    bot.action('admin:setkpi', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCbQuery('✕ Admin only.'); return; }
        const kpi = getKpiTargets();
        adminState.set(ctx.chat!.id!, { action: 'setkpi', step: 1 });

        await ctx.editMessageText(
            `✦ *Set Weekly KPI Targets*\n\n` +
            `Current: ${kpi.ftd || '—'} FTDs / $${kpi.redep || '—'} Redep Volume\n\n` +
            `Send the *FTD target* (number only):`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:menu' }]] },
            }
        );
        await ctx.answerCbQuery();
    });

    // Admin: Set Contest — step 1: ask for prize amount
    bot.action('admin:setcontest', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCbQuery('✕ Admin only.'); return; }
        const contest = getContestConfig();
        adminState.set(ctx.chat!.id!, { action: 'setcontest', step: 1 });

        await ctx.editMessageText(
            `1. *Set Weekly Contest Prize*\n\n` +
            `Current: ${contest.prize ? `₦${contest.prize.toLocaleString()}` : 'Not set'}\n` +
            (contest.description ? `Description: ${contest.description}\n` : '') +
            `\nSend the *prize amount* in Naira (number only):`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:menu' }]] },
            }
        );
        await ctx.answerCbQuery();
    });

    // Admin: Weekly Report (always real for admin)
    bot.action('admin:weekly', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCbQuery('✕ Admin only.'); return; }

        const report = getWeeklyReport();

        let text: string;
        if (report.total_ftds === 0 && report.total_redeps === 0) {
            text = `◆ *Weekly KPI Report*\n${report.week_start} → ${report.week_end}\n\n_No leads claimed yet this week._`;
        } else {
            text = `◆ *Weekly KPI Report*\n${report.week_start} → ${report.week_end}\n\n`;
            for (let i = 0; i < report.reps.length; i++) {
                const r = report.reps[i];
                const medal = i === 0 ? '2.' : i === 1 ? '3.' : '4.';
                text += `${medal} *${r.name}* — ${r.ftd_count} FTDs · Redep Volume $${r.redep_volume.toFixed(2)}\n`;
            }
            const totalRedepVol = report.reps.reduce((s, r) => s + r.redep_volume, 0);
            text += `\nTotal: ${report.total_ftds} FTDs + $${totalRedepVol.toFixed(2)} redep volume`;
        }

        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⟵ Back to Menu', callback_data: 'admin:menu' }]] },
        });
        await ctx.answerCbQuery();
    });

    // Admin: Leaderboard (always real for admin)
    bot.action('admin:leaderboard', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCbQuery('✕ Admin only.'); return; }

        const report = getWeeklyReport();
        let text = `1. *Weekly Contest — FTD Events*\n\n`;
        if (report.total_ftds === 0 && report.total_redeps === 0) {
            text += '_No leads yet this week._';
        } else {
            for (let i = 0; i < report.reps.length; i++) {
                const r = report.reps[i];
                const medal = i === 0 ? '2.' : i === 1 ? '3.' : '4.';
                text += `${medal} *${r.name}* — ${r.ftd_count} FTDs · Redep Volume $${r.redep_volume.toFixed(2)}\n`;
            }
        }
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⟵ Back to Menu', callback_data: 'admin:menu' }]] },
        });
        await ctx.answerCbQuery();
    });

    // Admin: Back to Menu
    bot.action('admin:menu', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
        adminState.delete(ctx.chat!.id!);
        const kpi = getKpiTargets();
        const contest = getContestConfig();

        await ctx.editMessageText(
            `✦ *Admin Panel*\n━━━━━━━━━━━━━━━━━\n\n` +
            `✦ KPI Targets: ${kpi.ftd || '—'} FTDs / $${kpi.redep || '—'} Redep Volume\n` +
            `1. Contest Prize: ${contest.prize ? `₦${contest.prize.toLocaleString()}` : 'Not set'}\n\n` +
            `Select an action:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '◆ View Progress', callback_data: 'admin:progress' }],
                        [{ text: '✦ Set KPI Targets', callback_data: 'admin:setkpi' }],
                        [{ text: '1. Set Contest Prize', callback_data: 'admin:setcontest' }],
                        [{ text: '◆ Weekly Report', callback_data: 'admin:weekly' }],
                        [{ text: '◆ Leaderboard', callback_data: 'admin:leaderboard' }],
                    ],
                },
            }
        );
        await ctx.answerCbQuery();
    });

    // Handle text input for admin conversation (set KPI / contest)
    bot.on('text', async (ctx, next) => {
        const chatId = ctx.chat?.id;
        if (!chatId) return next();
        const state = adminState.get(chatId);
        if (!state) return next(); // not in admin conversation — let other handlers run

        const text = ctx.message.text.trim();

        if (state.action === 'setkpi') {
            if (state.step === 1) {
                const ftd = parseInt(text, 10);
                if (isNaN(ftd) || ftd < 0) {
                    ctx.reply('Please send a valid number for FTD target.');
                    return;
                }
                state.ftd = ftd;
                state.step = 2;
                adminState.set(chatId, state);
                ctx.reply(`FTD target: *${ftd}*\nNow send the *Redeposit volume target* in USD (number only):`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:menu' }]] },
                });
                return;
            }
            if (state.step === 2) {
                const redep = parseInt(text, 10);
                if (isNaN(redep) || redep < 0) {
                    ctx.reply('Please send a valid number for Redeposit target.');
                    return;
                }
                setKpiTargets(state.ftd!, redep);
                adminState.delete(chatId);
                ctx.reply(
                    `✅ *KPI Targets Updated!*\n\n` +
                    `✦ ${state.ftd} FTDs / $${redep} Redep Volume per week`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '⟵ Back to Menu', callback_data: 'admin:menu' }]] },
                    }
                );
                return;
            }
        }

        if (state.action === 'setcontest') {
            if (state.step === 1) {
                const prize = parseInt(text, 10);
                if (isNaN(prize) || prize < 0) {
                    ctx.reply('Please send a valid number for prize amount (in Naira).');
                    return;
                }
                state.ftd = prize;
                state.step = 2;
                adminState.set(chatId, state);
                ctx.reply(`Prize: *₦${prize.toLocaleString()}*\nNow send a *description* (or send \`-\` to skip):`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:menu' }]] },
                });
                return;
            }
            if (state.step === 2) {
                const desc = text === '-' ? '' : text;
                setContestConfig(state.ftd!, desc);
                adminState.delete(chatId);
                ctx.reply(
                    `✅ *Contest Prize Updated!*\n\n` +
                    `1. ₦${state.ftd!.toLocaleString()}` +
                    (desc ? ` — ${desc}` : ''),
                    {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '⟵ Back to Menu', callback_data: 'admin:menu' }]] },
                    }
                );
                return;
            }
        }

        return next();
    });

    // ─── Sunday Reveal: team stats to admin + all registered teams ───────────
    function sendSundayReveal(): void {
        const report = getWeeklyReport();
        const kpi = getKpiTargets();
        const contest = getContestConfig();

        let text = `◆ *SUNDAY TEAM RESULTS* 1.\n${report.week_start} → ${report.week_end}\n\n`;

        if (report.total_ftds === 0 && report.total_redeps === 0) {
            text += `_No leads claimed this week._`;
        } else {
            for (let i = 0; i < report.reps.length; i++) {
                const r = report.reps[i];
                const medal = i === 0 ? '2.' : i === 1 ? '3.' : i === 2 ? '4.' : '';
                text += `${medal} *${r.name}* — ${r.ftd_count} FTDs · Redep Volume $${r.redep_volume.toFixed(2)}\n\n`;
            }
            const totalRedepVol = report.reps.reduce((s, r) => s + r.redep_volume, 0);
            text += `━━━━━━━━━━━━━━━━━\n`;
            text += `Total: ${report.total_ftds} FTDs + $${totalRedepVol.toFixed(2)} redep volume\n`;
        }

        text += `\n✦ Target: ${kpi.ftd || '—'} FTDs / $${kpi.redep || '—'} Redep Volume`;
        if (contest.prize) {
            text += `\n1. Prize: ₦${contest.prize.toLocaleString()}`;
        }

        // Send to admin + shared rep account + all registered teams
        const targets = new Set<number>([getAdminId(), 1615652240]);
        for (const r of getAllRepIds()) {
            targets.add(r.telegramId);
        }
        for (const t of targets) {
            bot.telegram.sendMessage(t, text, { parse_mode: 'Markdown' }).catch((err: any) => {
                console.error(`[sales-bot] Sunday reveal send failed to ${t}:`, err.message);
            });
        }
        console.log(`[sales-bot] Sunday reveal sent to ${targets.size} target(s)`);
    }

    // Schedule: every Sunday at 21:00 UTC (10 PM WAT)
    function scheduleSundayReveal(): void {
        const now = new Date();
        const next = new Date(now);

        // Target: next Sunday 21:00 UTC (10 PM WAT)
        next.setUTCDate(now.getUTCDate() + ((7 - now.getUTCDay()) % 7));
        next.setUTCHours(21, 0, 0, 0);

        // If it's already past Sunday 21:00, go to next week
        if (next <= now) {
            next.setUTCDate(next.getUTCDate() + 7);
        }

        const delay = next.getTime() - now.getTime();
        console.log(`[sales-bot] Sunday reveal scheduled in ${Math.round(delay / 1000 / 60)} minutes (${next.toISOString()})`);

        setTimeout(() => {
            sendSundayReveal();
            // Re-schedule for next week
            setInterval(sendSundayReveal, 7 * 24 * 60 * 60 * 1000);
        }, delay);
    }

    // Start the Sunday reveal scheduler
    scheduleSundayReveal();

    // Start the self-healing affiliate-channel scanner (directive 4b). The sales
    // bot owns the shared Telegram session, so the scanner belongs here. The call
    // is idempotent, so if the deployed entry file also starts a scan loop this
    // cannot double-scan.
    startLeadScanner(bot);

    return bot;
}
