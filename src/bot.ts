import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { ClientSdk, SsidAuthMethod, BalanceType } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST, IQ_AUTH_URL } from './protocol.js';
import { executeTrade, type TradeRequest, type TradeResult } from './trade.js';
import {
    getRecentTrades, getTradeStats,
    getUser, saveUser, deleteUser, getAllUsers,
    upsertOnboardingUser, approveUser, setManualApproval, rejectUser, getApprovalStats,
} from './db.js';
import { analyzePair, type AnalysisResult } from './analysis.js';
import { amountKeyboard, timeframeKeyboard, pairKeyboard, tfLabel, OTC_PAIRS } from './menu.js';
import { createSdk } from './trade.js';
import { startKeyboard, backKeyboard, onboardKeyboard } from './ui/user.js';
import { getAdminId, adminKeyboard } from './ui/admin.js';
import { checkAffiliate } from './affiliate.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const IQ_SSID = process.env.IQ_SSID;         // optional fallback for users without /connect
const AFFILIATE_LINK = process.env.AFFILIATE_LINK ?? '';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing from .env');

process.on('unhandledRejection', (reason, promise) => {
    console.error('[unhandledRejection]', reason);
    promise.catch(() => {});  // prevent process termination (Node.js v15+)
});

const bot = new Telegraf(BOT_TOKEN);

const MAX_ROUNDS = 6;
const MAX_EXPOSURE_MULTIPLIER = Math.pow(2, MAX_ROUNDS) - 1; // 63
const ROUND_COOLDOWN_MS = 5_000;

// ─── Start menu (admin vs client) ────────────────────────────────────────────

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

    if (!user || user.approval_status === 'pending') {
        await startOnboarding(ctx);
        return;
    }

    if (user.approval_status === 'manual') {
        await ctx.reply(
            '⏳ *Awaiting Approval*\n\nYour IQ Option User ID has been submitted.\n' +
            'Please contact the admin for manual approval.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (user.approval_status === 'rejected') {
        await ctx.reply('❌ Your access has been rejected. Contact the admin if this is a mistake.');
        return;
    }

    // Approved — show trading menu
    const stats = getTradeStats();
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    await ctx.reply(
        `🤖 *IQ Bot V3*\n\n📊 *Stats*: ${stats.total} trades | PnL: ${pnlSign}$${stats.totalPnl.toFixed(2)}`,
        { parse_mode: 'Markdown', reply_markup: startKeyboard() }
    );
}

// ─── Onboarding flow ─────────────────────────────────────────────────────────

async function startOnboarding(ctx: Context): Promise<void> {
    await ctx.reply(
        '👋 *Welcome to IQ Bot V3*\n\nDo you have an IQ Option account?',
        { parse_mode: 'Markdown', reply_markup: onboardKeyboard() }
    );
}

// ─── Approval gate ───────────────────────────────────────────────────────────

async function requireApproval(ctx: Context): Promise<boolean> {
    const user = getUser(ctx.from!.id);
    if (!user || user.approval_status === 'pending') {
        await startOnboarding(ctx);
        return false;
    }
    if (user.approval_status === 'approved') return true;
    if (user.approval_status === 'manual') {
        await ctx.reply('⏳ Your account is pending manual approval. Contact the admin.');
        return false;
    }
    await ctx.reply('❌ Your access has been rejected. Contact the admin if this is a mistake.');
    return false;
}

// ─── Wizard state machine ────────────────────────────────────────────────────

type WizardStep = 'amount' | 'timeframe' | 'pair' | 'custom_amount';
interface WizardState {
    step: WizardStep;
    amount?: number;
    timeframe?: number;
}
const wizardSessions = new Map<number, WizardState>();

// ─── Connect wizard ──────────────────────────────────────────────────────────

type ConnectStep = 'email' | 'password';
interface ConnectState {
    step: ConnectStep;
    email?: string;
}
const connectSessions = new Map<number, ConnectState>();

// ─── Onboarding wizard ───────────────────────────────────────────────────────

interface OnboardState {
    step: 'user_id';
    hasAccount: boolean;
}
const onboardSessions = new Map<number, OnboardState>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSsidForUser(telegramId: number): string | null {
    const user = getUser(telegramId);
    if (user?.ssid) return user.ssid;
    return IQ_SSID ?? null;
}

// Replicates LoginPasswordAuthMethod's internal HTTP call with correct headers,
// capturing the SSID so it can be persisted without storing the password.
async function loginAndCaptureSsid(email: string, password: string): Promise<{ ssid: string; sdk: ClientSdk }> {
    const res = await fetch(`${IQ_AUTH_URL}/v2/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'quadcode-client-sdk-js/1.3.21',
        },
        body: JSON.stringify({ identifier: email, password }),
    });

    // Read as text first so we can log the raw body if JSON parsing fails.
    const rawBody = await res.text();
    console.log(`[connect] HTTP ${res.status}: ${rawBody.slice(0, 200)}`);

    let data: { code?: string; message?: string; ssid?: string };
    try {
        data = JSON.parse(rawBody);
    } catch {
        throw new Error(`Login response is not JSON (HTTP ${res.status}): ${rawBody.slice(0, 100)}`);
    }

    if (data.code !== 'success' || !data.ssid) {
        throw new Error(data.message ?? 'Login failed');
    }
    const ssid = data.ssid;
    const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
    return { ssid, sdk };
}

// ─── Martingale loop ─────────────────────────────────────────────────────────

async function runMartingale(ctx: Context, ssid: string, pair: string, direction: 'call' | 'put', amount: number, timeframeSec = 60): Promise<void> {
    const dirStr = direction.toUpperCase();
    const runId = crypto.randomUUID();
    const roundTimeoutMs = (timeframeSec + 90) * 1000;
    let currentAmount = amount;
    let totalPnl = 0;

    await ctx.reply(
        `🎯 *Martingale starting*\n` +
        `Pair: \`${pair}\` *${dirStr}*\n` +
        `Base: $${amount} | Max exposure: $${(amount * MAX_EXPOSURE_MULTIPLIER).toFixed(2)}\n\n` +
        `_Round 1 starting..._`,
        { parse_mode: 'Markdown' }
    );

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        const roundTrade: TradeRequest = {
            pair,
            direction,
            amount: currentAmount,
            martingaleRunId: runId,
            timeframeSec,
        };

        let result: TradeResult;
        let roundTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            result = await Promise.race([
                executeTrade(ssid, roundTrade),
                new Promise<never>((_, reject) => {
                    roundTimer = setTimeout(
                        () => reject(new Error('Round timeout')),
                        roundTimeoutMs,
                    );
                }),
            ]);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            await ctx.reply(
                `⚠️ *Round ${round}/${MAX_ROUNDS} — exception*\n_${msg}_\n\nMartingale stopped.`,
                { parse_mode: 'Markdown' }
            );
            return;
        } finally {
            clearTimeout(roundTimer);
        }

        const roundPnl = result.status === 'WIN'
            ? result.pnl
            : result.status === 'TIE'
                ? 0
                : -currentAmount;
        totalPnl += roundPnl;

        const emoji = result.status === 'WIN' ? '💚' : result.status === 'LOSS' ? '💔' : result.status === 'TIE' ? '⚪' : '⚠️';
        let roundMsg = `${emoji} *Round ${round}/${MAX_ROUNDS}*\n`;
        roundMsg += `Amount: $${currentAmount.toFixed(2)} | `;

        if (result.status === 'WIN') {
            roundMsg += `Profit: +$${result.pnl.toFixed(2)}`;
        } else if (result.status === 'LOSS') {
            roundMsg += `Loss: -$${currentAmount.toFixed(2)}`;
        } else if (result.status === 'TIE') {
            roundMsg += `Refunded: $${currentAmount.toFixed(2)}`;
        } else {
            roundMsg += result.error ?? result.status;
        }

        if (result.status === 'WIN' || result.status === 'TIE') {
            const sign = totalPnl >= 0 ? '+' : '';
            roundMsg += `\n\n✅ *Martingale complete*\nRounds: ${round} | Total PnL: ${sign}$${totalPnl.toFixed(2)}`;
            await ctx.reply(roundMsg, { parse_mode: 'Markdown' });
            return;
        }

        if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
            roundMsg += `\n\n⚠️ *Martingale stopped*\n_${result.error ?? result.status}_`;
            await ctx.reply(roundMsg, { parse_mode: 'Markdown' });
            return;
        }

        if (round < MAX_ROUNDS) {
            currentAmount = currentAmount * 2;
            roundMsg += `\n\n🔄 Doubling to $${currentAmount.toFixed(2)} for round ${round + 1}...`;
            await ctx.reply(roundMsg, { parse_mode: 'Markdown' });
            await new Promise(r => setTimeout(r, ROUND_COOLDOWN_MS));
        } else {
            await ctx.reply(roundMsg, { parse_mode: 'Markdown' });
        }
    }

    const sign = totalPnl >= 0 ? '+' : '';
    await ctx.reply(
        `💔 *Martingale exhausted* — all ${MAX_ROUNDS} rounds lost.\n` +
        `Total loss: ${sign}$${totalPnl.toFixed(2)}`,
        { parse_mode: 'Markdown' }
    );
}

// ─── /start ───────────────────────────────────────────────────────────────────

bot.command('start', sendStartMenu);

// ─── Onboarding actions ───────────────────────────────────────────────────────

bot.action('onboard:yes', async ctx => {
    await ctx.answerCbQuery();
    onboardSessions.set(ctx.chat!.id, { step: 'user_id', hasAccount: true });
    await ctx.reply(
        '🔢 *Enter your IQ Option User ID*\n\n' +
        '_How to find it: Open IQ Option → Profile → copy the numeric User ID_',
        { parse_mode: 'Markdown' }
    );
});

bot.action('onboard:no', async ctx => {
    await ctx.answerCbQuery();
    onboardSessions.set(ctx.chat!.id, { step: 'user_id', hasAccount: false });
    const linkText = AFFILIATE_LINK
        ? `👉 [Create your IQ Option account](${AFFILIATE_LINK})\n\n`
        : '👉 Create an IQ Option account first, then come back.\n\n';
    await ctx.reply(
        linkText +
        '🔢 Once your account is created, enter your *User ID* here:\n\n' +
        '_How to find it: Open IQ Option → Profile → copy the numeric User ID_',
        { parse_mode: 'Markdown' }
    );
});

// ─── /trade wizard ────────────────────────────────────────────────────────────

bot.command('trade', async ctx => {
    if (!await requireApproval(ctx)) return;
    const chatId = ctx.chat.id;
    wizardSessions.set(chatId, { step: 'amount' });
    await ctx.reply('💰 *Enter amount:*', {
        parse_mode: 'Markdown',
        reply_markup: amountKeyboard(),
    });
});

bot.action('wizard:cancel', async ctx => {
    wizardSessions.delete(ctx.chat!.id);
    await ctx.editMessageText('❌ Trade cancelled.');
    await ctx.answerCbQuery();
});

bot.action(/^amt:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'amount') {
        await ctx.answerCbQuery('Session expired — use /trade to start over.');
        return;
    }

    const val = ctx.match[1];
    if (val === 'custom') {
        state.step = 'custom_amount';
        await ctx.editMessageText('✏️ *Enter your custom amount (e.g. 75):*', {
            parse_mode: 'Markdown',
        });
    } else {
        state.amount = parseFloat(val);
        state.step = 'timeframe';
        await ctx.editMessageText('⏱ *Pick timeframe:*', {
            parse_mode: 'Markdown',
            reply_markup: timeframeKeyboard(),
        });
    }
    await ctx.answerCbQuery();
});

bot.action(/^tf:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'timeframe') {
        await ctx.answerCbQuery('Session expired — use /trade to start over.');
        return;
    }

    state.timeframe = parseInt(ctx.match[1], 10);
    state.step = 'pair';
    await ctx.editMessageText('📈 *Pick pair:*', {
        parse_mode: 'Markdown',
        reply_markup: pairKeyboard(0),
    });
    await ctx.answerCbQuery();
});

bot.action(/^page:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') {
        await ctx.answerCbQuery('Session expired — use /trade to start over.');
        return;
    }
    const page = parseInt(ctx.match[1], 10);
    await ctx.editMessageReplyMarkup(pairKeyboard(page));
    await ctx.answerCbQuery();
});

bot.action(/^pair:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') {
        await ctx.answerCbQuery('Session expired — use /trade to start over.');
        return;
    }

    const pair = ctx.match[1];
    const { amount, timeframe } = state;
    wizardSessions.delete(chatId);
    await ctx.answerCbQuery();

    if (!amount || !timeframe) {
        await ctx.editMessageText('❌ Session error — use /trade to start over.');
        return;
    }

    const ssid = getSsidForUser(ctx.from!.id);
    if (!ssid) {
        await ctx.editMessageText('❌ Not connected. Use /connect to link your IQ Option account.');
        return;
    }

    const label = tfLabel(timeframe);
    await ctx.editMessageText(`🔍 *Analyzing ${pair} on ${label}...*`, { parse_mode: 'Markdown' });

    let analysis: AnalysisResult;
    try {
        analysis = await analyzePair(ssid, pair, timeframe);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await ctx.reply(`❌ Analysis failed: ${msg}`);
        return;
    }

    const dirStr = analysis.direction.toUpperCase();
    await ctx.reply(
        `📊 *${pair} ${label} → ${analysis.reason} — entering ${dirStr}*`,
        { parse_mode: 'Markdown' }
    );

    await runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe);
});

// ─── Other commands ───────────────────────────────────────────────────────────

bot.command('history', async ctx => {
    const trades = getRecentTrades(10);
    if (trades.length === 0) {
        return ctx.reply('No trades yet. Use /trade to get started.', { reply_markup: backKeyboard() });
    }

    let msg = '📋 *Recent Trades*\n\n';
    for (const t of trades) {
        const emoji = t.status === 'WIN' ? '💚' : t.status === 'LOSS' ? '💔' : t.status === 'TIE' ? '⚪' : '⚠️';
        const pnlStr = t.status === 'WIN'
            ? `+$${t.pnl.toFixed(2)}`
            : t.status === 'LOSS'
                ? `-$${t.amount.toFixed(2)}`
                : '$0.00';
        msg += `${emoji} \`${t.pair}\` *${t.direction.toUpperCase()}* $${t.amount} → ${pnlStr}`;
        if (t.martingale_run) msg += ' 🔄';
        msg += '\n';
        if (t.error) msg += `  _${t.error}_\n`;
    }

    const stats = getTradeStats();
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    msg += `\n📊 *Stats*: ${stats.total} trades | ${stats.wins}W / ${stats.losses}L / ${stats.ties}T | PnL: ${pnlSign}$${stats.totalPnl.toFixed(2)}`;

    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
});

bot.command('balance', async ctx => {
    const ssid = getSsidForUser(ctx.from!.id);
    if (!ssid) {
        await ctx.reply('❌ Not connected. Use /connect to link your IQ Option account.', { reply_markup: backKeyboard() });
        return;
    }
    try {
        const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
        try {
            const balances = await sdk.balances();
            const all = balances.getBalances();
            const demo = all.find(b => b.type === BalanceType.Demo);
            const real = all.find(b => b.type === BalanceType.Real);
            let msg = '💰 *Balances*\n\n';
            if (demo) msg += `🎮 Practice: $${demo.amount.toFixed(2)}\n`;
            if (real) msg += `💎 Live: $${real.amount.toFixed(2)}\n`;
            if (!demo && !real) msg += 'No balances found.';
            await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
        } finally {
            await sdk.shutdown();
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await ctx.reply(`❌ Balance fetch failed: ${msg}`, { reply_markup: backKeyboard() });
    }
});

// ─── User menu actions ────────────────────────────────────────────────────────

bot.action('ui:start', async ctx => {
    await ctx.answerCbQuery();
    await sendStartMenu(ctx);
});

bot.action('ui:trade', async ctx => {
    await ctx.answerCbQuery();
    if (!await requireApproval(ctx)) return;
    const chatId = ctx.chat!.id;
    wizardSessions.set(chatId, { step: 'amount' });
    await ctx.reply('💰 *Enter amount:*', {
        parse_mode: 'Markdown',
        reply_markup: amountKeyboard(),
    });
});

bot.action('ui:history', async ctx => {
    await ctx.answerCbQuery();
    const trades = getRecentTrades(10);
    if (trades.length === 0) {
        await ctx.reply('No trades yet.', { reply_markup: backKeyboard() });
        return;
    }
    let msg = '📋 *Recent Trades*\n\n';
    for (const t of trades) {
        const emoji = t.status === 'WIN' ? '💚' : t.status === 'LOSS' ? '💔' : t.status === 'TIE' ? '⚪' : '⚠️';
        const pnlStr = t.status === 'WIN' ? `+$${t.pnl.toFixed(2)}` : t.status === 'LOSS' ? `-$${t.amount.toFixed(2)}` : '$0.00';
        msg += `${emoji} \`${t.pair}\` *${t.direction.toUpperCase()}* $${t.amount} → ${pnlStr}`;
        if (t.martingale_run) msg += ' 🔄';
        msg += '\n';
        if (t.error) msg += `  _${t.error}_\n`;
    }
    const stats = getTradeStats();
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    msg += `\n📊 *Stats*: ${stats.total} trades | ${stats.wins}W / ${stats.losses}L / ${stats.ties}T | PnL: ${pnlSign}$${stats.totalPnl.toFixed(2)}`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
});

bot.action('ui:balance', async ctx => {
    await ctx.answerCbQuery();
    const ssid = getSsidForUser(ctx.from!.id);
    if (!ssid) {
        await ctx.reply('❌ Not connected. Use /connect to link your IQ Option account.', { reply_markup: backKeyboard() });
        return;
    }
    try {
        const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
        try {
            const balances = await sdk.balances();
            const all = balances.getBalances();
            const demo = all.find(b => b.type === BalanceType.Demo);
            const real = all.find(b => b.type === BalanceType.Real);
            let msg = '💰 *Balances*\n\n';
            if (demo) msg += `🎮 Practice: $${demo.amount.toFixed(2)}\n`;
            if (real) msg += `💎 Live: $${real.amount.toFixed(2)}\n`;
            if (!demo && !real) msg += 'No balances found.';
            await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
        } finally {
            await sdk.shutdown();
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await ctx.reply(`❌ Balance fetch failed: ${msg}`, { reply_markup: backKeyboard() });
    }
});

bot.action('ui:settings', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('⚙️ Settings coming soon.', { reply_markup: backKeyboard() });
});

// ─── Admin ────────────────────────────────────────────────────────────────────

bot.command('admin', async ctx => {
    if (ctx.from?.id !== getAdminId()) {
        await ctx.reply('Access denied.');
        return;
    }

    const args = ctx.message.text.split(/\s+/).slice(1);
    const sub = args[0];

    if (!sub) {
        const stats = getApprovalStats();
        await ctx.reply(
            `🛡️ *Admin Panel*\n\n` +
            `👥 ${stats.total} users | ✅ ${stats.approved} approved | ⏳ ${stats.pending} pending | 🔔 ${stats.manual} manual | ❌ ${stats.rejected} rejected`,
            { parse_mode: 'Markdown', reply_markup: adminKeyboard() }
        );
        return;
    }

    if (sub === 'users') {
        const users = getAllUsers();
        if (users.length === 0) { await ctx.reply('No users yet.'); return; }
        let msg = `👥 *All Users* (${users.length})\n\n`;
        for (const u of users) {
            const statusEmoji = u.approval_status === 'approved' ? '✅' : u.approval_status === 'manual' ? '🔔' : u.approval_status === 'rejected' ? '❌' : '⏳';
            const iqId = u.iq_user_id ? ` · IQ: \`${u.iq_user_id}\`` : '';
            msg += `${statusEmoji} \`${u.telegram_id}\`${iqId} — ${u.approval_status}\n`;
        }
        await ctx.reply(msg, { parse_mode: 'Markdown' });
        return;
    }

    if (sub === 'approve' && args[1]) {
        const targetId = parseInt(args[1], 10);
        if (isNaN(targetId)) { await ctx.reply('Usage: /admin approve <telegram_id>'); return; }
        approveUser(targetId);
        await ctx.reply(`✅ User \`${targetId}\` approved.`, { parse_mode: 'Markdown' });
        try { await bot.telegram.sendMessage(targetId, '✅ *Your account has been approved!* You can now start trading.', { parse_mode: 'Markdown' }); } catch {}
        return;
    }

    if (sub === 'reject' && args[1]) {
        const targetId = parseInt(args[1], 10);
        if (isNaN(targetId)) { await ctx.reply('Usage: /admin reject <telegram_id>'); return; }
        rejectUser(targetId);
        await ctx.reply(`❌ User \`${targetId}\` rejected.`, { parse_mode: 'Markdown' });
        try { await bot.telegram.sendMessage(targetId, '❌ Your access request has been rejected. Contact the admin for more information.'); } catch {}
        return;
    }

    if (sub === 'stats') {
        const ts = getTradeStats();
        const as_ = getApprovalStats();
        const pnlSign = ts.totalPnl >= 0 ? '+' : '';
        await ctx.reply(
            `📊 *Admin Stats*\n\n` +
            `*Users:*\n✅ Approved: ${as_.approved}\n⏳ Pending: ${as_.pending}\n🔔 Manual: ${as_.manual}\n❌ Rejected: ${as_.rejected}\n\n` +
            `*Trades:*\n${ts.total} total | ${ts.wins}W / ${ts.losses}L / ${ts.ties}T | PnL: ${pnlSign}$${ts.totalPnl.toFixed(2)}`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    await ctx.reply('Commands: /admin users | /admin approve <id> | /admin reject <id> | /admin stats');
});

bot.action('admin:users', async ctx => {
    await ctx.answerCbQuery();
    const users = getAllUsers();
    if (users.length === 0) { await ctx.reply('No users yet.'); return; }
    let msg = `👥 *All Users* (${users.length})\n\n`;
    for (const u of users) {
        const statusEmoji = u.approval_status === 'approved' ? '✅' : u.approval_status === 'manual' ? '🔔' : u.approval_status === 'rejected' ? '❌' : '⏳';
        const iqId = u.iq_user_id ? ` · IQ: \`${u.iq_user_id}\`` : '';
        msg += `${statusEmoji} \`${u.telegram_id}\`${iqId} — ${u.approval_status}\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.action('admin:broadcast', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('📢 Broadcast system coming soon.');
});

bot.action('admin:stats', async ctx => {
    await ctx.answerCbQuery();
    const ts = getTradeStats();
    const as_ = getApprovalStats();
    const pnlSign = ts.totalPnl >= 0 ? '+' : '';
    await ctx.reply(
        `📊 *Admin Stats*\n\n` +
        `*Users:*\n✅ Approved: ${as_.approved}\n⏳ Pending: ${as_.pending}\n🔔 Manual: ${as_.manual}\n❌ Rejected: ${as_.rejected}\n\n` +
        `*Trades:*\n${ts.total} total | ${ts.wins}W / ${ts.losses}L / ${ts.ties}T | PnL: ${pnlSign}$${ts.totalPnl.toFixed(2)}`,
        { parse_mode: 'Markdown' }
    );
});

bot.action('admin:tokens', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('🔑 Token management coming soon.');
});

// ─── /connect wizard ──────────────────────────────────────────────────────────

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
    const pairsSsid = getSsidForUser(ctx.from!.id);
    if (!pairsSsid) { await ctx.reply('❌ Not connected. Use /connect first.'); return; }
    try {
        const sdk = await createSdk(pairsSsid);
        try {
            const turboOptions = await sdk.turboOptions();
            const actives = turboOptions.getActives();
            const normTicker = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
            let msg = '📋 *Turbo Actives (ticker | localizationKey)*\n\n';
            const otcNorms = OTC_PAIRS.map(p => normTicker(p));
            for (const a of actives) {
                const matched = otcNorms.includes(normTicker(a.ticker)) || otcNorms.includes(normTicker(a.localizationKey));
                const mark = matched ? '✅' : '  ';
                msg += `${mark} \`${a.ticker}\` | \`${a.localizationKey}\`\n`;
            }
            await ctx.reply(msg, { parse_mode: 'Markdown' });
        } finally {
            await sdk.shutdown();
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await ctx.reply(`❌ Failed: ${msg}`);
    }
});

bot.command('ping', ctx => ctx.reply('pong'));

// ─── Text handler (all wizards) ───────────────────────────────────────────────
// Must be registered after all commands so command handlers take priority.

bot.on('text', async ctx => {
    if (ctx.message.text.startsWith('/')) return;
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();

    // ── Connect wizard ────────────────────────────────────────────────────────
    const connectState = connectSessions.get(chatId);
    if (connectState) {
        if (connectState.step === 'email') {
            connectState.email = text;
            connectState.step = 'password';
            await ctx.reply('🔑 Enter your password:');
        } else if (connectState.step === 'password' && connectState.email) {
            const email = connectState.email;
            connectSessions.delete(chatId);
            try { await ctx.deleteMessage(); } catch {}
            await ctx.reply('🔐 Logging in...');
            try {
                const { ssid, sdk } = await loginAndCaptureSsid(email, text);
                saveUser({ telegram_id: ctx.from!.id, ssid });
                try {
                    const balances = await sdk.balances();
                    const all = balances.getBalances();
                    const demo = all.find(b => b.type === BalanceType.Demo);
                    const real = all.find(b => b.type === BalanceType.Real);
                    let msg = '✅ *Connected!*\n\n';
                    if (demo) msg += `🎮 Practice: $${demo.amount.toFixed(2)}\n`;
                    if (real) msg += `💎 Live: $${real.amount.toFixed(2)}\n`;
                    await ctx.reply(msg, { parse_mode: 'Markdown' });
                } finally {
                    await sdk.shutdown();
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Unknown error';
                await ctx.reply(`❌ Connection failed: ${msg}`);
            }
        }
        return;
    }

    // ── Onboarding — User ID submission ──────────────────────────────────────
    const onboardState = onboardSessions.get(chatId);
    if (onboardState?.step === 'user_id') {
        const iqUserId = parseInt(text, 10);
        if (isNaN(iqUserId) || iqUserId <= 0) {
            await ctx.reply('Please enter a valid numeric IQ Option User ID.');
            return;
        }
        onboardSessions.delete(chatId);
        await ctx.reply('🔍 Checking your account...');

        upsertOnboardingUser(ctx.from!.id, iqUserId);

        try {
            const result = await checkAffiliate(iqUserId);
            if (result.found) {
                approveUser(ctx.from!.id, result.data ? JSON.stringify(result.data) : undefined);
                await ctx.reply(
                    '✅ *Account verified!* You\'re all set.\n\nUse /start to open the trading menu.',
                    { parse_mode: 'Markdown' }
                );
            } else {
                setManualApproval(ctx.from!.id);
                await ctx.reply(
                    '⏳ Your User ID wasn\'t found in our affiliate records.\n\n' +
                    'A notification has been sent to the admin for manual review. ' +
                    'You\'ll be notified once approved.'
                );
                // Notify admin
                const adminId = getAdminId();
                try {
                    await bot.telegram.sendMessage(
                        adminId,
                        `🔔 *Manual approval needed*\nTelegram ID: \`${ctx.from!.id}\`\nIQ User ID: \`${iqUserId}\`\n\nApprove: /admin approve ${ctx.from!.id}\nReject: /admin reject ${ctx.from!.id}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch {}
            }
        } catch (err: unknown) {
            // Affiliate check failed (Python not set up yet) — fall back to manual
            const errMsg = err instanceof Error ? err.message : 'Unknown error';
            console.error('[affiliate check]', errMsg);
            setManualApproval(ctx.from!.id);
            await ctx.reply(
                '⏳ Your User ID has been submitted for manual review.\n' +
                'You\'ll be notified once the admin approves your account.'
            );
            const adminId = getAdminId();
            try {
                await bot.telegram.sendMessage(
                    adminId,
                    `🔔 *Manual approval needed* (auto-check unavailable)\nTelegram ID: \`${ctx.from!.id}\`\nIQ User ID: \`${iqUserId}\`\n\nApprove: /admin approve ${ctx.from!.id}\nReject: /admin reject ${ctx.from!.id}`,
                    { parse_mode: 'Markdown' }
                );
            } catch {}
        }
        return;
    }

    // ── Trade wizard custom amount ────────────────────────────────────────────
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'custom_amount') return;

    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Please enter a valid positive number (e.g. 75).');
        return;
    }

    state.amount = amount;
    state.step = 'timeframe';
    await ctx.reply('⏱ *Pick timeframe:*', {
        parse_mode: 'Markdown',
        reply_markup: timeframeKeyboard(),
    });
});

bot.launch({ dropPendingUpdates: true });
console.log('[iqbot-v3] running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
