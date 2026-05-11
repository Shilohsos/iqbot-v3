import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { ClientSdk, SsidAuthMethod, BalanceType } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
import { executeTrade, type TradeRequest, type TradeResult } from './trade.js';
import { getRecentTrades, getTradeStats, getUser, saveUser, deleteUser, getAllUsers } from './db.js';
import { analyzePair, type AnalysisResult } from './analysis.js';
import { amountKeyboard, timeframeKeyboard, pairKeyboard, tfLabel, OTC_PAIRS } from './menu.js';
import { createSdk } from './trade.js';
import { startKeyboard, backKeyboard } from './ui/user.js';
import { ADMIN_ID, adminKeyboard } from './ui/admin.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const IQ_SSID = process.env.IQ_SSID; // optional fallback for users without /connect

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing from .env');

process.on('unhandledRejection', (reason, promise) => {
    console.error('[unhandledRejection]', reason);
    promise.catch(() => {});  // prevent process termination (Node.js v15+)
});

const bot = new Telegraf(BOT_TOKEN);

const MAX_ROUNDS = 6;
const MAX_EXPOSURE_MULTIPLIER = Math.pow(2, MAX_ROUNDS) - 1; // 63
const ROUND_COOLDOWN_MS = 5_000;

// ─── Shared UI helper ────────────────────────────────────────────────────────

async function sendStartMenu(ctx: Context): Promise<void> {
    const stats = getTradeStats();
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    const msg =
        `🤖 *IQ Bot V3*\n\n` +
        `📊 *Stats*: ${stats.total} trades | PnL: ${pnlSign}$${stats.totalPnl.toFixed(2)}`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: startKeyboard() });
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

function getSsidForUser(telegramId: number): string | null {
    const user = getUser(telegramId);
    if (user) return user.ssid;
    return IQ_SSID ?? null;
}

// ─── Martingale loop (shared helper) ────────────────────────────────────────

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

// ─── /trade wizard ───────────────────────────────────────────────────────────

bot.command('trade', async ctx => {
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

// ─── Other commands ──────────────────────────────────────────────────────────

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

bot.command('start', sendStartMenu);

// ─── User menu actions ────────────────────────────────────────────────────────

bot.action('ui:start', async ctx => {
    await ctx.answerCbQuery();
    await sendStartMenu(ctx);
});

bot.action('ui:trade', async ctx => {
    const chatId = ctx.chat!.id;
    wizardSessions.set(chatId, { step: 'amount' });
    await ctx.answerCbQuery();
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
    if (ctx.from?.id !== ADMIN_ID) {
        await ctx.reply('Access denied.');
        return;
    }
    await ctx.reply('🛡️ *Admin Panel*', { parse_mode: 'Markdown', reply_markup: adminKeyboard() });
});

bot.action('admin:users', async ctx => {
    await ctx.answerCbQuery();
    const users = getAllUsers();
    if (users.length === 0) {
        await ctx.reply('👥 No connected users.');
        return;
    }
    let msg = `👥 *Connected Users* (${users.length})\n\n`;
    for (const u of users) {
        const lastUsed = u.last_used ? u.last_used.replace('T', ' ').slice(0, 16) : '—';
        msg += `• \`${u.telegram_id}\` — last: ${lastUsed}\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});
bot.action('admin:broadcast', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('📢 Broadcast system coming soon.');
});
bot.action('admin:stats', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('📊 Admin statistics coming soon.');
});
bot.action('admin:tokens', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('🔑 Token management coming soon.');
});

// ─── /connect wizard ─────────────────────────────────────────────────────────

bot.command('connect', async ctx => {
    const chatId = ctx.chat.id;
    connectSessions.set(chatId, { step: 'email' });
    await ctx.reply('📧 Enter your IQ Option email:');
});

bot.command('disconnect', async ctx => {
    const telegramId = ctx.from!.id;
    deleteUser(telegramId);
    connectSessions.delete(ctx.chat.id);
    await ctx.reply('✅ Disconnected. Your IQ Option session has been removed.');
});

// ─── /pairs debug ────────────────────────────────────────────────────────────

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

// Text handler: covers both connect wizard and trade custom-amount step.
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
            connectSessions.delete(chatId);
            await ctx.reply('🔐 Logging in...');
            try {
                const res = await fetch(`${IQ_HOST}/v2/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier: connectState.email, password: text }),
                });
                const data = await res.json() as { code?: string; message?: string; ssid?: string };
                if (data.code !== 'success' || !data.ssid) {
                    await ctx.reply(`❌ Login failed: ${data.message ?? 'Invalid credentials'}`);
                    return;
                }
                saveUser({ telegram_id: ctx.from!.id, ssid: data.ssid });

                // Show balances on successful connect
                const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(data.ssid), { host: IQ_HOST });
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

bot.launch();
console.log('[iqbot-v3] running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
