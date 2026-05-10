import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { ClientSdk, SsidAuthMethod, BalanceType } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
import { executeTrade, type TradeRequest, type TradeResult } from './trade.js';
import { getRecentTrades, getTradeStats } from './db.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const IQ_SSID = process.env.IQ_SSID;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing from .env');
if (!IQ_SSID) throw new Error('IQ_SSID missing from .env');

const bot = new Telegraf(BOT_TOKEN);

const MAX_ROUNDS = 6;
const MAX_EXPOSURE_MULTIPLIER = Math.pow(2, MAX_ROUNDS) - 1; // 63
const ROUND_COOLDOWN_MS = 5_000;
const ROUND_TIMEOUT_MS = 120_000;

bot.command('trade', async ctx => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length < 3) {
        return ctx.reply(
            'Usage: /trade <pair> <direction> <amount>\n' +
            'Example: /trade EURUSD-OTC put 50\n\n' +
            `Auto-martingale: up to ${MAX_ROUNDS} rounds, doubles on loss.`
        );
    }

    const [rawPair, rawDir, amountStr] = args;
    const direction = rawDir.toLowerCase();
    const amount = parseFloat(amountStr);

    if (direction !== 'call' && direction !== 'put') {
        return ctx.reply('Direction must be "call" or "put".');
    }
    if (isNaN(amount) || amount <= 0) {
        return ctx.reply('Amount must be a positive number.');
    }

    const baseTrade: TradeRequest = {
        pair: rawPair.toUpperCase(),
        direction: direction as 'call' | 'put',
        amount,
    };

    await ctx.reply(
        `🎯 *Martingale starting*\n` +
        `Pair: \`${baseTrade.pair}\` *${baseTrade.direction.toUpperCase()}*\n` +
        `Base: $${amount} | Max exposure: $${(amount * MAX_EXPOSURE_MULTIPLIER).toFixed(2)}\n\n` +
        `_Round 1 starting..._`,
        { parse_mode: 'Markdown' }
    );

    const runId = crypto.randomUUID();
    let currentAmount = amount;
    let totalPnl = 0;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        const roundTrade: TradeRequest = {
            pair: baseTrade.pair,
            direction: baseTrade.direction,
            amount: currentAmount,
            martingaleRunId: runId,
        };

        // Fresh SDK connection per round. Race against a hard wall-clock
        // timeout so a silent hang never stalls the loop indefinitely.
        let result: TradeResult;
        let roundTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            result = await Promise.race([
                executeTrade(IQ_SSID!, roundTrade),
                new Promise<never>((_, reject) => {
                    roundTimer = setTimeout(
                        () => reject(new Error('Round timeout')),
                        ROUND_TIMEOUT_MS,
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

        // LOSS — send round result, then wait before the next connection attempt
        if (round < MAX_ROUNDS) {
            currentAmount = currentAmount * 2;
            roundMsg += `\n\n🔄 Doubling to $${currentAmount.toFixed(2)} for round ${round + 1}...`;
            await ctx.reply(roundMsg, { parse_mode: 'Markdown' });
            await new Promise(r => setTimeout(r, ROUND_COOLDOWN_MS));
        } else {
            await ctx.reply(roundMsg, { parse_mode: 'Markdown' });
        }
    }

    // All rounds exhausted with losses
    const sign = totalPnl >= 0 ? '+' : '';
    await ctx.reply(
        `💔 *Martingale exhausted* — all ${MAX_ROUNDS} rounds lost.\n` +
        `Total loss: ${sign}$${totalPnl.toFixed(2)}`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('history', async ctx => {
    const trades = getRecentTrades(10);
    if (trades.length === 0) {
        return ctx.reply('No trades yet. Use /trade to get started.');
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

    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('balance', async ctx => {
    try {
        const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(IQ_SSID!), { host: IQ_HOST });
        try {
            const balances = await sdk.balances();
            const all = balances.getBalances();
            const demo = all.find(b => b.type === BalanceType.Demo);
            const real = all.find(b => b.type === BalanceType.Real);

            let msg = '💰 *Balances*\n\n';
            if (demo) msg += `🎮 Practice: $${demo.amount.toFixed(2)}\n`;
            if (real) msg += `💎 Live: $${real.amount.toFixed(2)}\n`;
            if (!demo && !real) msg += 'No balances found.';

            await ctx.reply(msg, { parse_mode: 'Markdown' });
        } finally {
            await sdk.shutdown();
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await ctx.reply(`❌ Balance fetch failed: ${msg}`);
    }
});

bot.command('start', async ctx => {
    const stats = getTradeStats();
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    let msg = '🤖 *IQ Bot V3*\n\n';
    msg += 'Trade directly from Telegram:\n';
    msg += '`/trade EURUSD-OTC put 50`\n\n';
    msg += `📊 *Stats*: ${stats.total} trades | PnL: ${pnlSign}$${stats.totalPnl.toFixed(2)}\n\n`;
    msg += '/history — Recent trades\n';
    msg += '/balance — Live balance\n';
    msg += '_Section 3: Auto-Martingale_';
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('ping', ctx => ctx.reply('pong'));

bot.launch();
console.log('[iqbot-v3] running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
