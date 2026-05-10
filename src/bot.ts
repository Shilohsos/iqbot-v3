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

bot.command('trade', async ctx => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length < 3) {
        return ctx.reply('Usage: /trade <pair> <direction> <amount>\nExample: /trade EURUSD-OTC put 50');
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

    const trade: TradeRequest = {
        pair: rawPair.toUpperCase(),
        direction: direction as 'call' | 'put',
        amount,
    };

    await ctx.reply(`⏳ Placing trade: ${trade.pair} ${trade.direction.toUpperCase()} $${amount}...`);

    try {
        const result = await executeTrade(IQ_SSID!, trade);
        await ctx.reply(formatResult(result), { parse_mode: 'Markdown' });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await ctx.reply(`❌ Trade failed: ${msg}`);
    }
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
        msg += `${emoji} \`${t.pair}\` *${t.direction.toUpperCase()}* $${t.amount} → ${pnlStr}\n`;
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
    msg += '_Section 2: History + Balance_';
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('ping', ctx => ctx.reply('pong'));

bot.launch();
console.log('[iqbot-v3] running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

function formatResult(r: TradeResult): string {
    const emoji = r.status === 'WIN' ? '💚' : r.status === 'LOSS' ? '💔' : r.status === 'TIE' ? '⚪' : '⚠️';
    let msg = `${emoji} *${r.status}*\n`;
    msg += `Pair: \`${r.pair}\`\n`;
    msg += `Direction: *${r.direction.toUpperCase()}*\n`;
    msg += `Amount: $${r.amount}\n`;
    if (r.status === 'WIN') msg += `Profit: +$${r.pnl.toFixed(2)}\n`;
    else if (r.status === 'LOSS') msg += `Loss: -$${r.amount.toFixed(2)}\n`;
    if (r.error) msg += `_${r.error}_`;
    return msg;
}
