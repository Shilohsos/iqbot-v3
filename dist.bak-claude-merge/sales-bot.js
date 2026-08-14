// src/sales-bot.ts — Sales team lead tracking bot
// Token: 6461943886:AAECqdFjZUdcQtmvw2NB076IylQuEn0t6CQ
import { Telegraf } from 'telegraf';
import { getAllUnclaimed, claimLead, getEventById, getWeeklyReport, getRepStats, getRepWeeklyCount, getKpiTargets, setKpiTargets, getContestConfig, setContestConfig, getAdminId, setRepTelegramId, getAllRepIds, } from './sales-leads.js';
const REP_NAMES = ['Eniola', 'Gift', 'Blessing'];
// Store pending claim confirmations: key = `${chatId}:${eventId}`, value = repName
const pendingConfirmations = new Map();
// Admin conversation state (for setting KPI/contest)
const adminState = new Map();
export function createSalesBot(token) {
    const bot = new Telegraf(token);
    const isAdmin = (ctx) => ctx.from?.id === getAdminId();
    // ─── Start (Admin Panel) ─────────────────────────────────────────────────
    bot.command('start', (ctx) => {
        if (!isAdmin(ctx)) {
            ctx.reply(`◆ *Sales Lead Tracker*\n\n` +
                `Send an IQ Option User ID to log a lead.\n\n` +
                `*Commands:*\n` +
                `/leaderboard — Weekly contest ranking\n` +
                `/mystats — Your personal stats this week\n` +
                `/help — All commands`, { parse_mode: 'Markdown' });
            return;
        }
        const kpi = getKpiTargets();
        const contest = getContestConfig();
        ctx.reply(` *Admin Panel*\n━━━━━━━━━━━━━━━━━\n\n` +
            ` KPI Targets: ${kpi.ftd || '—'} FTDs / ${kpi.redep || '—'} Redeps\n` +
            ` Contest Prize: ${contest.prize ? `₦${contest.prize.toLocaleString()}` : 'Not set'}\n\n` +
            `Select an action:`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '◆ View Progress', callback_data: 'admin:progress' }],
                    [{ text: ' Set KPI Targets', callback_data: 'admin:setkpi' }],
                    [{ text: ' Set Contest Prize', callback_data: 'admin:setcontest' }],
                    [{ text: '◆ Weekly Report', callback_data: 'admin:weekly' }],
                    [{ text: '◆ Leaderboard', callback_data: 'admin:leaderboard' }],
                ],
            },
        });
    });
    // ─── Help ────────────────────────────────────────────────────────────────
    bot.command('help', (ctx) => {
        ctx.reply(`◆ *Lead Tracker Bot*\n\n` +
            `Send an IQ Option User ID to log a lead.\n\n` +
            `*Commands:*\n` +
            `\`/weekly\` — Weekly KPI report (admin)\n` +
            `\`/leaderboard\` — Weekly contest ranking\n` +
            `\`/mystats\` — Your personal stats this week\n` +
            `\`/recent\` — Recently claimed leads\n` +
            `\`/help\` — This message`, { parse_mode: 'Markdown' });
    });
    // ─── Weekly Report (admin only) ──────────────────────────────────────────
    bot.command('weekly', (ctx) => {
        if (!isAdmin(ctx)) {
            ctx.reply(' Admin only.');
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
            const medal = i === 0 ? '' : i === 1 ? '' : i === 2 ? '' : '';
            text += `${medal} *${r.name}* — $${r.total_volume.toFixed(2)}\n`;
            text += `   FTDs: ${r.ftd_count} ($${r.ftd_volume.toFixed(2)}) · Redeps: ${r.redep_count} ($${r.redep_volume.toFixed(2)})\n\n`;
        }
        text += `━━━━━━━━━━━━━━━━━\n`;
        text += `Total: ${report.total_ftds} FTDs + ${report.total_redeps} redeps = $${report.total_volume.toFixed(2)}`;
        ctx.reply(text, { parse_mode: 'Markdown' });
    });
    // ─── Leaderboard ─────────────────────────────────────────────────────────
    bot.command('leaderboard', (ctx) => {
        const report = getWeeklyReport();
        if (report.total_ftds === 0 && report.total_redeps === 0) {
            ctx.reply(` *Weekly Contest — Deposit Volume*\n\n_No deposits logged yet this week._`, { parse_mode: 'Markdown' });
            return;
        }
        const contest = getContestConfig();
        let text = ` *Weekly Contest — Deposit Volume*\n`;
        if (contest.prize > 0) {
            text += ` Prize: ₦${contest.prize.toLocaleString()}\n`;
        }
        text += `\n`;
        for (let i = 0; i < report.reps.length; i++) {
            const r = report.reps[i];
            const medal = i === 0 ? '' : i === 1 ? '' : '';
            text += `${medal} *${r.name}* — $${r.total_volume.toFixed(2)}\n`;
            text += `   ${r.ftd_count} FTDs ($${r.ftd_volume.toFixed(2)}) + ${r.redep_count} redeps ($${r.redep_volume.toFixed(2)})\n`;
        }
        text += `\n Total volume this week: $${report.total_volume.toFixed(2)}\n`;
        text += `· Week ending: ${report.week_end}`;
        ctx.reply(text, { parse_mode: 'Markdown' });
    });
    // ─── My Stats ────────────────────────────────────────────────────────────
    bot.command('mystats', (ctx) => {
        if (!ctx.from)
            return;
        const firstName = ctx.from.first_name;
        const repName = REP_NAMES.find(n => n.toLowerCase() === firstName?.toLowerCase());
        if (!repName) {
            ctx.reply('⚠️ I don\'t recognize your name. Your Telegram first name must match one of: Eniola, Gift, Blessing.');
            return;
        }
        const stats = getRepStats(repName);
        const kpi = getKpiTargets();
        const bar = (current, target) => {
            if (target <= 0)
                return `${current} (no target set)`;
            const pct = Math.min(current / target, 1);
            const filled = Math.round(pct * 10);
            return `${current}/${target} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(pct * 100)}%`;
        };
        if (!stats || stats.total_count === 0) {
            ctx.reply(`◆ *${repName}* — No leads claimed yet this week.\n\n` +
                `*KPI Targets:* ${kpi.ftd || '—'} FTDs / ${kpi.redep || '—'} Redeps`, { parse_mode: 'Markdown' });
            return;
        }
        ctx.reply(`◆ *${repName} — Your Week*\n\n` +
            `*Progress to KPI:*\n` +
            `FTDs: ${bar(stats.ftd_count, kpi.ftd)}\n` +
            `Redeps: ${bar(stats.redep_count, kpi.redep)}\n\n` +
            `FTD Volume: $${stats.ftd_volume.toFixed(2)}\n` +
            `Redep Volume: $${stats.redep_volume.toFixed(2)}`, { parse_mode: 'Markdown' });
    });
    // ─── Recent (admin) ──────────────────────────────────────────────────────
    bot.command('recent', (ctx) => {
        if (!isAdmin(ctx)) {
            ctx.reply(' Admin only.');
            return;
        }
        const { getWeeklyClaimedEvents } = require('./sales-leads.js');
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
        if (ctx.chat?.id && adminState.has(ctx.chat.id))
            return next();
        const text = ctx.message.text.trim();
        // Must be a number (IQ user ID)
        if (!/^\d+$/.test(text)) {
            ctx.reply('Send an IQ Option User ID (numbers only) to look up their funding events.', { reply_parameters: { message_id: ctx.message.message_id } });
            return;
        }
        const iqUserId = parseInt(text, 10);
        const events = getAllUnclaimed(iqUserId);
        if (events.length === 0) {
            ctx.reply(` No unclaimed funding events found for User ID *${iqUserId}*.\n\n` +
                `They may not have funded yet, or the event was already claimed.`, { parse_mode: 'Markdown', reply_parameters: { message_id: ctx.message.message_id } });
            return;
        }
        // Show all unclaimed events for this user
        for (const event of events) {
            const typeLabel = event.event_type === 'ftd' ? '✅ FTD' : '↻ Redeposit';
            const dateStr = event.event_date.split('T')[0];
            const amountStr = `$${event.amount.toFixed(2)}`;
            const msg = await ctx.reply(`*User ${iqUserId}*\n` +
                `${typeLabel}: ${amountStr}\n` +
                `Date: ${dateStr}\n\n` +
                `Who closed this lead?`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        REP_NAMES.map(name => ({
                            text: name,
                            callback_data: `claim:${event.id}:${name}`,
                        })),
                    ],
                },
            });
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
        await ctx.editMessageText(`⚠️ *Confirm:* ${repName} closed User ${event.iq_user_id} for $${event.amount.toFixed(2)} ${typeLabel}?`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                        { text: '✅ Confirm', callback_data: `confirm:${eventId}:${repName}` },
                        { text: ' Cancel', callback_data: `cancel:${eventId}` },
                    ]],
            },
        });
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
        // Auto-register rep's Telegram ID so we can broadcast to them
        if (ctx.chat?.id) {
            setRepTelegramId(repName, ctx.chat.id);
        }
        const success = claimLead(eventId, repName);
        if (!success) {
            await ctx.answerCbQuery('Already claimed or event not found.');
            return;
        }
        const event = getEventById(eventId);
        const typeLabel = event?.event_type === 'ftd' ? 'FTD' : 'Redeposit';
        const amount = event?.amount ?? 0;
        // Get updated weekly counts + KPI targets
        const counts = getRepWeeklyCount(repName);
        const targets = getKpiTargets();
        // Build progress bars
        const bar = (current, target) => {
            if (target <= 0)
                return `${current} (no target set)`;
            const pct = Math.min(current / target, 1);
            const filled = Math.round(pct * 10);
            return `${current}/${target} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(pct * 100)}%`;
        };
        await ctx.editMessageText(`✅ *Logged!*\n` +
            `${repName} — ${typeLabel} $${amount.toFixed(2)}\n\n` +
            `*Progress to KPI:*\n` +
            `FTDs: ${bar(counts.ftd, targets.ftd)}\n` +
            `Redeps: ${bar(counts.redep, targets.redep)}`, { parse_mode: 'Markdown' });
        await ctx.answerCbQuery('✅ Lead logged successfully!');
    });
    // ─── Callback: Cancel ────────────────────────────────────────────────────
    bot.action(/^cancel:(\d+)$/, async (ctx) => {
        const eventId = parseInt(ctx.match[1], 10);
        const key = `${ctx.chat?.id}:${eventId}`;
        pendingConfirmations.delete(key);
        await ctx.editMessageText(' Cancelled. Lead was *not* logged.', { parse_mode: 'Markdown' });
        await ctx.answerCbQuery();
    });
    // ─── Admin Callbacks ──────────────────────────────────────────────────────
    // Admin: View Progress
    bot.action('admin:progress', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCbQuery(' Admin only.');
            return;
        }
        const report = getWeeklyReport();
        const kpi = getKpiTargets();
        const contest = getContestConfig();
        const bar = (current, target) => {
            if (target <= 0)
                return `${current} (no target)`;
            const pct = Math.min(current / target, 1);
            const filled = Math.round(pct * 10);
            return `${current}/${target} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(pct * 100)}%`;
        };
        let text = `◆ *Progress to KPI*\n` +
            `Target: ${kpi.ftd || '—'} FTDs / ${kpi.redep || '—'} Redeps\n` +
            `Prize: ${contest.prize ? `₦${contest.prize.toLocaleString()}` : 'Not set'}\n\n`;
        for (const r of report.reps) {
            text += `*${r.name}*\n` +
                `Deposit Volume: $${r.total_volume.toFixed(2)}\n` +
                `FTDs: ${bar(r.ftd_count, kpi.ftd)}\n` +
                `Redeps: ${bar(r.redep_count, kpi.redep)}\n\n`;
        }
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⟵ Back to Menu', callback_data: 'admin:menu' }]] },
        });
        await ctx.answerCbQuery();
    });
    // Admin: Set KPI — step 1: ask for FTD target
    bot.action('admin:setkpi', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCbQuery(' Admin only.');
            return;
        }
        const kpi = getKpiTargets();
        adminState.set(ctx.chat.id, { action: 'setkpi', step: 1 });
        await ctx.editMessageText(` *Set Weekly KPI Targets*\n\n` +
            `Current: ${kpi.ftd || '—'} FTDs / ${kpi.redep || '—'} Redeps\n\n` +
            `Send the *FTD target* (number only):`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: ' Cancel', callback_data: 'admin:menu' }]] },
        });
        await ctx.answerCbQuery();
    });
    // Admin: Set Contest — step 1: ask for prize amount
    bot.action('admin:setcontest', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCbQuery(' Admin only.');
            return;
        }
        const contest = getContestConfig();
        adminState.set(ctx.chat.id, { action: 'setcontest', step: 1 });
        await ctx.editMessageText(` *Set Weekly Contest Prize*\n\n` +
            `Current: ${contest.prize ? `₦${contest.prize.toLocaleString()}` : 'Not set'}\n` +
            (contest.description ? `Description: ${contest.description}\n` : '') +
            `\nSend the *prize amount* in Naira (number only):`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: ' Cancel', callback_data: 'admin:menu' }]] },
        });
        await ctx.answerCbQuery();
    });
    // Admin: Weekly Report
    bot.action('admin:weekly', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCbQuery(' Admin only.');
            return;
        }
        const report = getWeeklyReport();
        let text;
        if (report.total_ftds === 0 && report.total_redeps === 0) {
            text = `◆ *Weekly KPI Report*\n${report.week_start} → ${report.week_end}\n\n_No leads claimed yet this week._`;
        }
        else {
            text = `◆ *Weekly KPI Report*\n${report.week_start} → ${report.week_end}\n\n`;
            for (let i = 0; i < report.reps.length; i++) {
                const r = report.reps[i];
                const medal = i === 0 ? '' : i === 1 ? '' : '';
                text += `${medal} *${r.name}* — ${r.ftd_count} FTDs ($${r.ftd_volume.toFixed(2)}), ${r.redep_count} redeps ($${r.redep_volume.toFixed(2)})\n`;
            }
            text += `\nTotal: $${report.total_volume.toFixed(2)}`;
        }
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⟵ Back to Menu', callback_data: 'admin:menu' }]] },
        });
        await ctx.answerCbQuery();
    });
    // Admin: Leaderboard
    bot.action('admin:leaderboard', async (ctx) => {
        const report = getWeeklyReport();
        let text = ` *Weekly Contest*\n\n`;
        if (report.total_ftds === 0 && report.total_redeps === 0) {
            text += '_No leads yet this week._';
        }
        else {
            for (let i = 0; i < report.reps.length; i++) {
                const r = report.reps[i];
                const medal = i === 0 ? '' : i === 1 ? '' : '';
                text += `${medal} *${r.name}* — ${r.ftd_count} FTDs, ${r.redep_count} redeps — $${r.total_volume.toFixed(2)}\n`;
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
        if (!isAdmin(ctx)) {
            await ctx.answerCbQuery();
            return;
        }
        adminState.delete(ctx.chat.id);
        const kpi = getKpiTargets();
        const contest = getContestConfig();
        await ctx.editMessageText(` *Admin Panel*\n━━━━━━━━━━━━━━━━━\n\n` +
            ` KPI Targets: ${kpi.ftd || '—'} FTDs / ${kpi.redep || '—'} Redeps\n` +
            ` Contest Prize: ${contest.prize ? `₦${contest.prize.toLocaleString()}` : 'Not set'}\n\n` +
            `Select an action:`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '◆ View Progress', callback_data: 'admin:progress' }],
                    [{ text: ' Set KPI Targets', callback_data: 'admin:setkpi' }],
                    [{ text: ' Set Contest Prize', callback_data: 'admin:setcontest' }],
                    [{ text: '◆ Weekly Report', callback_data: 'admin:weekly' }],
                    [{ text: '◆ Leaderboard', callback_data: 'admin:leaderboard' }],
                ],
            },
        });
        await ctx.answerCbQuery();
    });
    // Handle text input for admin conversation (set KPI / contest)
    bot.on('text', async (ctx, next) => {
        const chatId = ctx.chat?.id;
        if (!chatId)
            return next();
        const state = adminState.get(chatId);
        if (!state)
            return next(); // not in admin conversation — let other handlers run
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
                ctx.reply(`FTD target: *${ftd}*\nNow send the *Redeposit target*:`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: ' Cancel', callback_data: 'admin:menu' }]] },
                });
                return;
            }
            if (state.step === 2) {
                const redep = parseInt(text, 10);
                if (isNaN(redep) || redep < 0) {
                    ctx.reply('Please send a valid number for Redeposit target.');
                    return;
                }
                setKpiTargets(state.ftd, redep);
                adminState.delete(chatId);
                ctx.reply(`✅ *KPI Targets Updated!*\n\n` +
                    ` ${state.ftd} FTDs / ${redep} Redeps per week`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '⟵ Back to Menu', callback_data: 'admin:menu' }]] },
                });
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
                    reply_markup: { inline_keyboard: [[{ text: ' Cancel', callback_data: 'admin:menu' }]] },
                });
                return;
            }
            if (state.step === 2) {
                const desc = text === '-' ? '' : text;
                setContestConfig(state.ftd, desc);
                adminState.delete(chatId);
                ctx.reply(`✅ *Contest Prize Updated!*\n\n` +
                    ` ₦${state.ftd.toLocaleString()}` +
                    (desc ? ` — ${desc}` : ''), {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '⟵ Back to Menu', callback_data: 'admin:menu' }]] },
                });
                return;
            }
        }
        return next();
    });
    // ─── Send weekly report to admin ─────────────────────────────────────────
    function sendWeeklyReportToAdmin() {
        const report = getWeeklyReport();
        let text;
        if (report.total_ftds === 0 && report.total_redeps === 0) {
            text = `◆ *Weekly KPI Report*\n${report.week_start} → ${report.week_end}\n\n_No leads claimed this week._`;
        }
        else {
            text = `◆ *Weekly KPI Report*\n${report.week_start} → ${report.week_end}\n\n`;
            for (let i = 0; i < report.reps.length; i++) {
                const r = report.reps[i];
                const medal = i === 0 ? '' : i === 1 ? '' : '';
                text += `${medal} *${r.name}* — ${r.ftd_count} FTDs ($${r.ftd_volume.toFixed(2)}), ${r.redep_count} redeps ($${r.redep_volume.toFixed(2)})\n`;
            }
            text += `\nTotal: ${report.total_ftds} FTDs + ${report.total_redeps} redeps = $${report.total_volume.toFixed(2)}`;
        }
        bot.telegram.sendMessage(getAdminId(), text, { parse_mode: 'Markdown' }).catch((err) => {
            console.error('[sales-bot] Failed to send weekly report:', err.message);
        });
    }
    // Schedule: every Sunday at 21:00 UTC (10 PM WAT)
    function scheduleWeeklyReport() {
        const now = new Date();
        const next = new Date(now);
        // Target: next Sunday 21:00 UTC
        next.setUTCDate(now.getUTCDate() + ((7 - now.getUTCDay()) % 7));
        next.setUTCHours(21, 0, 0, 0);
        // If it's already past Sunday 21:00, go to next week
        if (next <= now) {
            next.setUTCDate(next.getUTCDate() + 7);
        }
        const delay = next.getTime() - now.getTime();
        console.log(`[sales-bot] Weekly report scheduled in ${Math.round(delay / 1000 / 60)} minutes (${next.toISOString()})`);
        setTimeout(() => {
            sendWeeklyReportToAdmin();
            // Re-schedule for next week
            setInterval(sendWeeklyReportToAdmin, 7 * 24 * 60 * 60 * 1000);
        }, delay);
    }
    // Start the weekly report scheduler
    scheduleWeeklyReport();
    // ─── 12-hour leaderboard broadcast to sales reps ──────────────────────────
    function broadcastLeaderboard() {
        const report = getWeeklyReport();
        const kpi = getKpiTargets();
        const contest = getContestConfig();
        let text = `◆ *Leaderboard Update*\n\n`;
        if (report.total_ftds === 0 && report.total_redeps === 0) {
            text += `_No leads claimed yet this week._\n\n`;
        }
        else {
            for (let i = 0; i < report.reps.length; i++) {
                const r = report.reps[i];
                const medal = i === 0 ? '' : i === 1 ? '' : '';
                text += `${medal} *${r.name}* — ${r.ftd_count} FTDs, ${r.redep_count} redeps — $${r.total_volume.toFixed(2)}\n`;
            }
            text += `\n`;
        }
        text += ` Target: ${kpi.ftd || '—'} FTDs / ${kpi.redep || '—'} Redeps`;
        if (contest.prize) {
            text += `\n Prize: ₦${contest.prize.toLocaleString()}`;
        }
        text += `\n\n· Week ending: ${report.week_end}`;
        // Send to admin
        bot.telegram.sendMessage(getAdminId(), text, { parse_mode: 'Markdown' }).catch(() => { });
        // Also send to reps' shared account
        bot.telegram.sendMessage(1615652240, text, { parse_mode: 'Markdown' }).catch(() => { });
        // Send to all registered reps
        const repIds = getAllRepIds();
        for (const rep of repIds) {
            bot.telegram.sendMessage(rep.telegramId, text, { parse_mode: 'Markdown' }).catch(() => { });
        }
        console.log(`[sales-bot] Leaderboard broadcast sent to admin + ${repIds.length} reps`);
    }
    // Schedule every 12 hours (starting 5 min after boot)
    setTimeout(() => {
        broadcastLeaderboard();
        setInterval(broadcastLeaderboard, 12 * 60 * 60_000);
    }, 5 * 60_000);
    return bot;
}
