import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { executeTrade, type TradeRequest, type TradeResult } from './trade.js';

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

bot.command('start', ctx =>
    ctx.reply(
        '🤖 *IQ Bot V3*\n\nTrade directly from Telegram:\n`/trade EURUSD-OTC put 50`\n\n_Section 1: Trade Pipeline_',
        { parse_mode: 'Markdown' },
    )
);

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
