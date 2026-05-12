import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { ClientSdk, SsidAuthMethod, BalanceType } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST, IQ_AUTH_URL } from './protocol.js';
import { executeTrade, createSdk, type TradeRequest, type TradeResult } from './trade.js';
import {
    getRecentTrades, getTradeStats,
    getUser, saveUser, deleteUser, getAllUsers,
    upsertOnboardingUser, approveUser, setManualApproval, rejectUser, getApprovalStats,
    setUserTier,
} from './db.js';
import { analyzePair, type AnalysisResult } from './analysis.js';
import {
    amountKeyboard, timeframeKeyboard, pairKeyboard, tfLabel, OTC_PAIRS,
    tierKeyboard, tradeModeKeyboard, demoUpsellKeyboard, affiliateFailKeyboard,
} from './menu.js';
import { startKeyboard, backKeyboard, onboardKeyboard } from './ui/user.js';
import { getAdminId, adminKeyboard } from './ui/admin.js';
import { checkAffiliate } from './affiliate.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const IQ_SSID   = process.env.IQ_SSID;
const AFFILIATE_LINK   = process.env.AFFILIATE_LINK   ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue';
const ADMIN_CONTACT_LINK = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
const ASSETS_DIR = process.env.ASSETS_DIR ?? '/root/iqbot-v3/assets';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing from .env');

process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });

const bot = new Telegraf(BOT_TOKEN);

const MAX_ROUNDS       = 6;
const ROUND_COOLDOWN_MS = 5_000;

function ASSET(f: string): { source: string } {
    return { source: `${ASSETS_DIR}/${f}` };
}

// ─── Session / wizard state ───────────────────────────────────────────────────

const sessionStats = new Map<number, { trades: number; pnl: number }>();
function getSessionStats(uid: number) {
    if (!sessionStats.has(uid)) sessionStats.set(uid, { trades: 0, pnl: 0 });
    return sessionStats.get(uid)!;
}

type WizardStep = 'mode' | 'amount' | 'timeframe' | 'pair' | 'custom_amount';
interface WizardState {
    step: WizardStep;
    mode?: 'demo' | 'live';
    amount?: number;
    timeframe?: number;
}
const wizardSessions = new Map<number, WizardState>();

type OnboardStep = 'user_id' | 'create_user_id' | 'connect_email' | 'connect_password';
interface OnboardState {
    step: OnboardStep;
    tier?: string;
    iqUserId?: number;
    email?: string;
    loginFailCount?: number;
}
const onboardSessions = new Map<number, OnboardState>();

type ConnectStep = 'email' | 'password';
interface ConnectState { step: ConnectStep; email?: string; }
const connectSessions = new Map<number, ConnectState>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSsidForUser(telegramId: number): string | null {
    const user = getUser(telegramId);
    if (user?.ssid) return user.ssid;
    return IQ_SSID ?? null;
}

async function loginAndCaptureSsid(email: string, password: string): Promise<{ ssid: string; sdk: ClientSdk }> {
    const res = await fetch(`${IQ_AUTH_URL}/v2/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
        body: JSON.stringify({ identifier: email, password }),
    });
    const rawBody = await res.text();
    console.log(`[connect] HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
    let data: { code?: string; message?: string; ssid?: string };
    try { data = JSON.parse(rawBody); } catch {
        throw new Error(`Login response is not JSON (HTTP ${res.status}): ${rawBody.slice(0, 100)}`);
    }
    if (data.code !== 'success' || !data.ssid) throw new Error(data.message ?? 'Login failed');
    const ssid = data.ssid;
    const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
    return { ssid, sdk };
}

// ─── Start menu ───────────────────────────────────────────────────────────────

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

    if (!user || user.approval_status === 'pending') { await startOnboarding(ctx); return; }

    if (user.approval_status === 'manual') {
        await ctx.reply('⏳ *Awaiting Approval*\n\nYour IQ Option User ID has been submitted.\nPlease contact the admin for manual approval.', { parse_mode: 'Markdown' });
        return;
    }

    if (user.approval_status === 'rejected') {
        await ctx.reply('❌ Your access has been rejected. Contact the admin if this is a mistake.');
        return;
    }

    // Approved — build rich menu
    const ss  = getSessionStats(telegramId);
    const tier = (user.tier ?? 'DEMO').toUpperCase();
    const tierEmoji = tier === 'PRO' ? '⚡' : tier === 'NEWBIE' ? '🚀' : '🧪';
    const pnlSign   = ss.pnl >= 0 ? '+' : '';

    let balanceLine = '';
    const ssid = getSsidForUser(telegramId);
    if (ssid) {
        try {
            const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
            try {
                const all = (await sdk.balances()).getBalances();
                const demo = all.find(b => b.type === BalanceType.Demo);
                const real = all.find(b => b.type === BalanceType.Real);
                balanceLine = [
                    demo ? `Practice $${demo.amount.toFixed(2)}` : '',
                    real ? `Real $${real.amount.toFixed(2)}` : '',
                ].filter(Boolean).join(' | ');
            } finally { await sdk.shutdown(); }
        } catch {}
    }

    const lines = [
        `MoneyGBT — Home`,
        ``,
        `Tier: ${tierEmoji} ${tier}`,
        balanceLine ? `Balance: ${balanceLine}` : '',
        `Session: ${ss.trades} trade${ss.trades !== 1 ? 's' : ''} · ${pnlSign}$${Math.abs(ss.pnl).toFixed(2)}`,
        ``,
        `What now? 👇`,
    ].filter(l => l !== '');

    await ctx.reply(lines.join('\n'), { reply_markup: startKeyboard() });
}

// ─── Onboarding helpers ───────────────────────────────────────────────────────

async function startOnboarding(ctx: Context): Promise<void> {
    try { await ctx.replyWithPhoto(ASSET('L1.png')); } catch {}
    await ctx.reply(
        `I'm 10x Special Bot.\n\n` +
        `The smartest semi auto-trading bot for IQ Option OTC pairs.\n\n` +
        `I scan markets. I read signals. I place trades.\n` +
        `You sit back and watch the wins land.`
    );
    try { await ctx.replyWithPhoto(ASSET('L2.png')); } catch {}
    await ctx.reply(
        `⚡ Built for serious traders.\n` +
        `🎯 Trades 8+ OTC pairs.\n` +
        `🛡️ Smart Gale recovery.\n` +
        `💰 Withdraws straight to your own IQ Option account.`
    );
    try { await ctx.replyWithPhoto(ASSET('L3.png')); } catch {}
    await ctx.reply(
        `Three ways to start 👾\n\n` +
        `✅ The bot itself is completely free.\n\n` +
        `What you fund is your own IQ Option trading capital.\n` +
        `It stays in your account, you trade with it, you withdraw it.\n\n` +
        `🧪 DEMO — try the bot risk-free\n` +
        `🚀 Newbie — trade with $20+ capital\n` +
        `⚡ PRO — trade with $100+ capital\n\n` +
        `How are you starting? 👇`,
        { reply_markup: tierKeyboard() }
    );
}

async function askAccountConnection(ctx: Context): Promise<void> {
    await ctx.reply(
        `Connect your IQ Option account.\n\n` +
        `Free signup · 60 seconds · Linked instantly.\n` +
        `Bot trades on your account. Money stays yours.\n\n` +
        `Pick what fits 👇`,
        { reply_markup: onboardKeyboard() }
    );
}

async function askCreateAccountUserId(ctx: Context): Promise<void> {
    await ctx.reply(
        `👉 Create your IQ Option account\n` +
        `👉 [Create your IQ Option Account](${AFFILIATE_LINK})\n` +
        `Click Above 👆🏼👾\n\n` +
        `🔢 Once your account is created, enter your User ID here:\n\n` +
        `How to find it:\n` +
        `Open IQ Option → Profile → copy the numeric User ID 🆔\n\n` +
        `Then paste that here 👇👾`,
        { parse_mode: 'Markdown' }
    );
}

// ─── Approval gate ────────────────────────────────────────────────────────────

async function requireApproval(ctx: Context): Promise<boolean> {
    const user = getUser(ctx.from!.id);
    if (!user || user.approval_status === 'pending') { await startOnboarding(ctx); return false; }
    if (user.approval_status === 'approved') return true;
    if (user.approval_status === 'manual') {
        await ctx.reply('⏳ Your account is pending manual approval. Contact the admin.');
        return false;
    }
    await ctx.reply('❌ Your access has been rejected. Contact the admin if this is a mistake.');
    return false;
}

// ─── Martingale loop ──────────────────────────────────────────────────────────

async function runMartingale(
    ctx: Context,
    ssid: string,
    pair: string,
    direction: 'call' | 'put',
    amount: number,
    timeframeSec = 60,
    balanceType: 'demo' | 'live' = 'demo',
): Promise<void> {
    const runId = crypto.randomUUID();
    const roundTimeoutMs = (timeframeSec + 90) * 1000;
    let currentAmount = amount;
    let totalPnl = 0;
    const logLines: string[] = ['✦ Trade session initialized…'];
    const logMsg = await ctx.reply(logLines.join('\n'));

    const syncLog = async () => {
        try {
            await ctx.telegram.editMessageText(ctx.chat!.id, logMsg.message_id, undefined, logLines.join('\n'));
        } catch {}
    };

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        logLines.push(`⚡ Trade 1|Step ${round}|🟡 $${currentAmount.toFixed(2)} → in flight`);
        await syncLog();

        const roundTrade: TradeRequest = { pair, direction, amount: currentAmount, martingaleRunId: runId, timeframeSec, balanceType };

        let result: TradeResult;
        let roundTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            result = await Promise.race([
                executeTrade(ssid, roundTrade),
                new Promise<never>((_, reject) => {
                    roundTimer = setTimeout(() => reject(new Error('Round timeout')), roundTimeoutMs);
                }),
            ]);
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error';
            logLines[logLines.length - 1] = `⚡ Trade 1|Step ${round}|⚠️ $${currentAmount.toFixed(2)} → error`;
            await syncLog();
            await ctx.reply(`⚠️ Stopped: ${errMsg}`);
            return;
        } finally {
            clearTimeout(roundTimer);
        }

        const roundPnl = result.status === 'WIN' ? result.pnl : result.status === 'TIE' ? 0 : -currentAmount;
        totalPnl += roundPnl;

        const lastIdx = logLines.length - 1;
        if (result.status === 'WIN') {
            logLines[lastIdx] = `⚡ Trade 1|Step ${round}|🟢 $${currentAmount.toFixed(2)} → +$${result.pnl.toFixed(2)}`;
        } else if (result.status === 'LOSS') {
            logLines[lastIdx] = `⚡ Trade 1|Step ${round}|🔴 $${currentAmount.toFixed(2)} → -$${currentAmount.toFixed(2)}`;
        } else if (result.status === 'TIE') {
            logLines[lastIdx] = `⚡ Trade 1|Step ${round}|⚪ $${currentAmount.toFixed(2)} → $0.00`;
        } else {
            logLines[lastIdx] = `⚡ Trade 1|Step ${round}|⚠️ $${currentAmount.toFixed(2)} → ${result.error ?? result.status}`;
        }
        await syncLog();

        // Update session stats on any settled trade
        if (result.status === 'WIN' || result.status === 'LOSS' || result.status === 'TIE') {
            const ss = getSessionStats(ctx.from!.id);
            ss.trades++;
            ss.pnl += roundPnl;
        }

        if (result.status === 'WIN' || result.status === 'TIE') {
            try { await ctx.replyWithPhoto(ASSET('L11a.png')); } catch {}
            await ctx.reply(
                `🏆 +$${result.pnl.toFixed(2)} added to your balance.\n\n` +
                (round > 1 ? `Recovery complete on step ${round}/${MAX_ROUNDS}.\n\n` : '') +
                `💸 You just made +$${result.pnl.toFixed(2)}`
            );
            if (balanceType === 'demo') await showDemoUpsell(ctx);
            return;
        }

        if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
            await ctx.reply(`⚠️ Stopped: ${result.error ?? result.status}`);
            return;
        }

        // LOSS — next round
        if (round < MAX_ROUNDS) {
            if (round === 1) {
                try { await ctx.replyWithPhoto(ASSET('L10.png')); } catch {}
                await ctx.reply('SMART RECOVERY ACTIVATED\nBumping the next stake. Bot fights back.');
            }
            currentAmount = currentAmount * 2;
            await new Promise(r => setTimeout(r, ROUND_COOLDOWN_MS));
        }
    }

    const sign = totalPnl >= 0 ? '+' : '';
    await ctx.reply(`Lost this one 💔! Remain confident! New setup loading 👾\n\nTotal: ${sign}$${totalPnl.toFixed(2)}`);
    if (balanceType === 'demo') await showDemoUpsell(ctx);
}

async function showDemoUpsell(ctx: Context): Promise<void> {
    try { await ctx.replyWithPhoto(ASSET('L12.png')); } catch {}
    await ctx.reply(
        `WHAT IF THIS WAS REAL?\n\n` +
        `While you read this…\n\n` +
        `real 10x users just banked CASH from the exact same setup.\n\n` +
        `Every minute on demo = real profit lost.`
    );
    try { await ctx.replyWithPhoto(ASSET('L13.png')); } catch {}
    await ctx.reply(
        `Time to earn real money.\n` +
        `Fund your IQ Option account, wins land in your bank, withdraw anytime.\n\n` +
        `Switch to LIVE in 1 tap 👇`,
        { reply_markup: demoUpsellKeyboard() }
    );
}

// ─── /start ───────────────────────────────────────────────────────────────────

bot.command('start', sendStartMenu);

// ─── Tier selection ───────────────────────────────────────────────────────────

bot.action(/^tier:(demo|newbie|pro)$/, async ctx => {
    await ctx.answerCbQuery();
    const tier = ctx.match[1].toUpperCase();
    const chatId = ctx.chat!.id;
    const existing = onboardSessions.get(chatId) ?? { step: 'user_id' as OnboardStep };
    onboardSessions.set(chatId, { ...existing, tier });
    const dbUser = getUser(ctx.from!.id);
    if (dbUser) setUserTier(ctx.from!.id, tier);
    await askAccountConnection(ctx);
});

// ─── Account connection choice ────────────────────────────────────────────────

bot.action('onboard:yes', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const existing = onboardSessions.get(chatId) ?? { step: 'user_id' as OnboardStep };
    onboardSessions.set(chatId, { ...existing, step: 'user_id' });
    await ctx.reply(
        `🔢 Enter your IQ Option User ID\n\n` +
        `How to find it:\n` +
        `Open IQ Option → Profile → copy the numeric User ID 🆔\n\n` +
        `Then paste that here 👇👾`
    );
});

bot.action('onboard:no', async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const existing = onboardSessions.get(chatId) ?? { step: 'create_user_id' as OnboardStep };
    onboardSessions.set(chatId, { ...existing, step: 'create_user_id' });
    await askCreateAccountUserId(ctx);
});

// ─── Trade wizard — mode ──────────────────────────────────────────────────────

bot.action(/^mode:(demo|live)$/, async ctx => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'mode') return;
    state.mode = ctx.match[1] as 'demo' | 'live';
    state.step = 'amount';
    try { await ctx.replyWithPhoto(ASSET('L5.png')); } catch {}
    await ctx.reply('Enter amount', { reply_markup: amountKeyboard() });
});

// ─── Trade wizard — amount ────────────────────────────────────────────────────

bot.action('wizard:cancel', async ctx => {
    wizardSessions.delete(ctx.chat!.id);
    await ctx.editMessageText('❌ Trade cancelled.');
    await ctx.answerCbQuery();
});

bot.action(/^amt:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'amount') { await ctx.answerCbQuery('Session expired — start over.'); return; }

    const val = ctx.match[1];
    if (val === 'custom') {
        state.step = 'custom_amount';
        await ctx.editMessageText('✏️ Enter your custom amount (e.g. 75):');
    } else {
        const amt = parseFloat(val);
        if (state.mode === 'demo' && amt > 20) { await ctx.answerCbQuery('Demo max is $20.'); return; }
        state.amount = amt;
        state.step = 'timeframe';
        try { await ctx.replyWithPhoto(ASSET('L6.png')); } catch {}
        await ctx.editMessageText(
            '⏱ Pick your expiry timeframe 👇\n⏱ Faster timeframes settle quicker.\n🐢 Longer timeframes ride bigger moves.',
            { reply_markup: timeframeKeyboard() }
        );
    }
    await ctx.answerCbQuery();
});

// ─── Trade wizard — timeframe ─────────────────────────────────────────────────

bot.action(/^tf:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'timeframe') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    state.timeframe = parseInt(ctx.match[1], 10);
    state.step = 'pair';
    try { await ctx.replyWithPhoto(ASSET('L7.png')); } catch {}
    await ctx.editMessageText(
        'Top picks ready 🎯\n\nHighest chance to win right now:\n\n' +
        '🏆 EUR/GBP OTC — Win rate ≈83%\n✅ EUR/USD OTC — Win rate ≈78%\n✅ AUD/USD OTC — Win rate ≈70%\n✅ USD/CAD OTC — Win rate ≈66%\n\n🚀 Make your choice below 👇',
        { reply_markup: pairKeyboard(0) }
    );
    await ctx.answerCbQuery();
});

// ─── Trade wizard — pair pagination ──────────────────────────────────────────

bot.action(/^page:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') { await ctx.answerCbQuery('Session expired — start over.'); return; }
    await ctx.editMessageReplyMarkup(pairKeyboard(parseInt(ctx.match[1], 10)));
    await ctx.answerCbQuery();
});

// ─── Trade wizard — pair selected → analyze → execute ────────────────────────

bot.action(/^pair:(.+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'pair') { await ctx.answerCbQuery('Session expired — start over.'); return; }

    const pair = ctx.match[1];
    const { amount, timeframe, mode } = state;
    wizardSessions.delete(chatId);
    await ctx.answerCbQuery();

    if (!amount || !timeframe) { await ctx.editMessageText('❌ Session error — start over.'); return; }

    const ssid = getSsidForUser(ctx.from!.id);
    if (!ssid) { await ctx.editMessageText('❌ Not connected. Use /connect to link your IQ Option account.'); return; }

    try { await ctx.replyWithPhoto(ASSET('L8.png')); } catch {}
    await ctx.editMessageText(`Selected: ${pair}\n\n🔍 Scanning markets...`);

    let analysis: AnalysisResult;
    try {
        analysis = await analyzePair(ssid, pair, timeframe);
    } catch (err: unknown) {
        await ctx.reply(`❌ Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
    }

    const signalImg = analysis.direction === 'call' ? 'L9a.png' : 'L9b.png';
    try { await ctx.replyWithPhoto(ASSET(signalImg)); } catch {}

    const dirStr = analysis.direction === 'call' ? '🟢 CALL SIGNAL' : '🔴 PUT SIGNAL';
    await ctx.reply(
        `OPPORTUNITY FOUND\nConfidence: 78% · Bot is ready to execute.\n\n${dirStr}\n\n` +
        `🔷 Trading pair: ${pair}\n🔷 Amount: $${amount.toFixed(2)} USD\n` +
        `🔷 Expiration: ${tfLabel(timeframe)}\n🔷 Strategy: High-Profit ⚡`
    );

    await runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe, mode === 'live' ? 'live' : 'demo');
});

// ─── Demo upsell ──────────────────────────────────────────────────────────────

bot.action('upsell:live', async ctx => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('✅ Switched to Live mode! Your next trade will use your real balance.');
});

bot.action('upsell:demo', async ctx => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('🪫 Continuing on Demo. Next trade stays in practice mode.');
});

// ─── User menu actions ────────────────────────────────────────────────────────

bot.action('ui:start', async ctx => { await ctx.answerCbQuery(); await sendStartMenu(ctx); });

bot.action('ui:trade', async ctx => {
    await ctx.answerCbQuery();
    if (!await requireApproval(ctx)) return;
    wizardSessions.set(ctx.chat!.id, { step: 'mode' });
    try { await ctx.replyWithPhoto(ASSET('L4.png')); } catch {}
    await ctx.reply('Trade live | Trade Demo', { reply_markup: tradeModeKeyboard() });
});

bot.action('ui:history', async ctx => {
    await ctx.answerCbQuery();
    const trades = getRecentTrades(10);
    if (trades.length === 0) { await ctx.reply('No trades yet.', { reply_markup: backKeyboard() }); return; }
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

bot.action('ui:stats', async ctx => {
    await ctx.answerCbQuery();
    const stats = getTradeStats();
    const ss = getSessionStats(ctx.from!.id);
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';
    const ssPnlSign = ss.pnl >= 0 ? '+' : '';
    await ctx.reply(
        `📈 *Stats*\n\n` +
        `All time: ${stats.total} trades | ${stats.wins}W / ${stats.losses}L / ${stats.ties}T\n` +
        `Total PnL: ${pnlSign}$${stats.totalPnl.toFixed(2)}\n\n` +
        `This session: ${ss.trades} trades | ${ssPnlSign}$${Math.abs(ss.pnl).toFixed(2)}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:upgrade', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `💡 *Upgrade your account*\n\nContact admin to upgrade your tier:\n${ADMIN_CONTACT_LINK}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:help', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `❓ *Help & FAQ*\n\n` +
        `*How does the bot work?*\nAnalyzes OTC pairs and places trades via Smart Gale (Martingale) recovery.\n\n` +
        `*What is Martingale?*\nIf a trade loses, the next bet doubles to recover the loss. Up to 6 rounds.\n\n` +
        `*Demo vs Live?*\nDemo uses practice balance. Live uses your real account balance.\n\n` +
        `*How to withdraw?*\nAll funds stay in your IQ Option account — withdraw directly from there.`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

bot.action('ui:support', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `🔋 *Support*\n\nContact admin for help:\n${ADMIN_CONTACT_LINK}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
});

// ─── Legacy commands (keep for power users) ───────────────────────────────────

bot.command('trade', async ctx => {
    if (!await requireApproval(ctx)) return;
    wizardSessions.set(ctx.chat.id, { step: 'mode' });
    try { await ctx.replyWithPhoto(ASSET('L4.png')); } catch {}
    await ctx.reply('Trade live | Trade Demo', { reply_markup: tradeModeKeyboard() });
});

bot.command('history', async ctx => {
    const trades = getRecentTrades(10);
    if (trades.length === 0) return ctx.reply('No trades yet.', { reply_markup: backKeyboard() });
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

bot.command('balance', async ctx => {
    const ssid = getSsidForUser(ctx.from!.id);
    if (!ssid) { await ctx.reply('❌ Not connected. Use /connect first.', { reply_markup: backKeyboard() }); return; }
    try {
        const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });
        try {
            const all = (await sdk.balances()).getBalances();
            const demo = all.find(b => b.type === BalanceType.Demo);
            const real = all.find(b => b.type === BalanceType.Real);
            let msg = '💰 *Balances*\n\n';
            if (demo) msg += `🎮 Practice: $${demo.amount.toFixed(2)}\n`;
            if (real) msg += `💎 Live: $${real.amount.toFixed(2)}\n`;
            if (!demo && !real) msg += 'No balances found.';
            await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backKeyboard() });
        } finally { await sdk.shutdown(); }
    } catch (err: unknown) {
        await ctx.reply(`❌ Balance fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`, { reply_markup: backKeyboard() });
    }
});

// ─── Admin ────────────────────────────────────────────────────────────────────

bot.command('admin', async ctx => {
    if (ctx.from?.id !== getAdminId()) { await ctx.reply('Access denied.'); return; }
    const args = ctx.message.text.split(/\s+/).slice(1);
    const sub  = args[0];

    if (!sub) {
        const stats = getApprovalStats();
        await ctx.reply(
            `🛡️ *Admin Panel*\n\n👥 ${stats.total} users | ✅ ${stats.approved} approved | ⏳ ${stats.pending} pending | 🔔 ${stats.manual} manual | ❌ ${stats.rejected} rejected`,
            { parse_mode: 'Markdown', reply_markup: adminKeyboard() }
        );
        return;
    }

    if (sub === 'users') {
        const users = getAllUsers();
        if (users.length === 0) { await ctx.reply('No users yet.'); return; }
        let msg = `👥 *All Users* (${users.length})\n\n`;
        for (const u of users) {
            const e = u.approval_status === 'approved' ? '✅' : u.approval_status === 'manual' ? '🔔' : u.approval_status === 'rejected' ? '❌' : '⏳';
            msg += `${e} \`${u.telegram_id}\`${u.iq_user_id ? ` · IQ: \`${u.iq_user_id}\`` : ''} — ${u.approval_status}\n`;
        }
        await ctx.reply(msg, { parse_mode: 'Markdown' });
        return;
    }

    if (sub === 'approve' && args[1]) {
        const tid = parseInt(args[1], 10);
        if (isNaN(tid)) { await ctx.reply('Usage: /admin approve <telegram_id>'); return; }
        approveUser(tid);
        await ctx.reply(`✅ User \`${tid}\` approved.`, { parse_mode: 'Markdown' });
        try { await bot.telegram.sendMessage(tid, '✅ *Your account has been approved!* You can now start trading.', { parse_mode: 'Markdown' }); } catch {}
        return;
    }

    if (sub === 'reject' && args[1]) {
        const tid = parseInt(args[1], 10);
        if (isNaN(tid)) { await ctx.reply('Usage: /admin reject <telegram_id>'); return; }
        rejectUser(tid);
        await ctx.reply(`❌ User \`${tid}\` rejected.`, { parse_mode: 'Markdown' });
        try { await bot.telegram.sendMessage(tid, '❌ Your access request has been rejected.'); } catch {}
        return;
    }

    if (sub === 'stats') {
        const ts = getTradeStats(); const as_ = getApprovalStats();
        const pnlSign = ts.totalPnl >= 0 ? '+' : '';
        await ctx.reply(
            `📊 *Admin Stats*\n\n*Users:*\n✅ Approved: ${as_.approved}\n⏳ Pending: ${as_.pending}\n🔔 Manual: ${as_.manual}\n❌ Rejected: ${as_.rejected}\n\n` +
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
        const e = u.approval_status === 'approved' ? '✅' : u.approval_status === 'manual' ? '🔔' : u.approval_status === 'rejected' ? '❌' : '⏳';
        msg += `${e} \`${u.telegram_id}\`${u.iq_user_id ? ` · IQ: \`${u.iq_user_id}\`` : ''} — ${u.approval_status}\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.action('admin:broadcast', async ctx => { await ctx.answerCbQuery(); await ctx.reply('📢 Broadcast coming soon.'); });

bot.action('admin:stats', async ctx => {
    await ctx.answerCbQuery();
    const ts = getTradeStats(); const as_ = getApprovalStats();
    const pnlSign = ts.totalPnl >= 0 ? '+' : '';
    await ctx.reply(
        `📊 *Admin Stats*\n\n*Users:*\n✅ Approved: ${as_.approved}\n⏳ Pending: ${as_.pending}\n🔔 Manual: ${as_.manual}\n❌ Rejected: ${as_.rejected}\n\n` +
        `*Trades:*\n${ts.total} total | ${ts.wins}W / ${ts.losses}L / ${ts.ties}T | PnL: ${pnlSign}$${ts.totalPnl.toFixed(2)}`,
        { parse_mode: 'Markdown' }
    );
});

bot.action('admin:tokens', async ctx => { await ctx.answerCbQuery(); await ctx.reply('🔑 Token management coming soon.'); });

// ─── /connect & /disconnect ───────────────────────────────────────────────────

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
    const ssid = getSsidForUser(ctx.from!.id);
    if (!ssid) { await ctx.reply('❌ Not connected. Use /connect first.'); return; }
    try {
        const sdk = await createSdk(ssid);
        try {
            const actives = (await sdk.turboOptions()).getActives();
            const normTicker = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
            const otcNorms = OTC_PAIRS.map(p => normTicker(p));
            let msg = '📋 *Turbo Actives*\n\n';
            for (const a of actives) {
                const matched = otcNorms.includes(normTicker(a.ticker)) || otcNorms.includes(normTicker(a.localizationKey));
                msg += `${matched ? '✅' : '  '} \`${a.ticker}\` | \`${a.localizationKey}\`\n`;
            }
            await ctx.reply(msg, { parse_mode: 'Markdown' });
        } finally { await sdk.shutdown(); }
    } catch (err: unknown) {
        await ctx.reply(`❌ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
});

bot.command('ping', ctx => ctx.reply('pong'));

// ─── Text handler (all wizards) ───────────────────────────────────────────────

bot.on('text', async ctx => {
    if (ctx.message.text.startsWith('/')) return;
    const chatId = ctx.chat.id;
    const text   = ctx.message.text.trim();

    // ── Onboarding wizard ────────────────────────────────────────────────────
    const ob = onboardSessions.get(chatId);
    if (ob) {
        if (ob.step === 'user_id' || ob.step === 'create_user_id') {
            const iqUserId = parseInt(text, 10);
            if (isNaN(iqUserId) || iqUserId <= 0) { await ctx.reply('Please enter a valid numeric IQ Option User ID.'); return; }
            await ctx.reply('🔍 Checking your account...');
            upsertOnboardingUser(ctx.from!.id, iqUserId);
            if (ob.tier) setUserTier(ctx.from!.id, ob.tier);

            try {
                const result = await checkAffiliate(iqUserId);
                if (result.found) {
                    approveUser(ctx.from!.id, result.data ? JSON.stringify(result.data) : undefined);
                    ob.iqUserId = iqUserId;
                    ob.step = 'connect_email';
                    await ctx.reply('✅ Account verified! You\'re all set.\n\n📧 Enter your IQ Option email:');
                } else {
                    setManualApproval(ctx.from!.id);
                    onboardSessions.delete(chatId);
                    await ctx.reply(
                        '⏳ We were not able to confirm your User ID.\n\n' +
                        'Please consider creating a new account the right way using our link 👇👾\n\n' +
                        'You can as-well contact admin 👇💜',
                        { reply_markup: affiliateFailKeyboard() }
                    );
                    try {
                        await bot.telegram.sendMessage(
                            getAdminId(),
                            `🔔 *Manual approval needed*\nTelegram ID: \`${ctx.from!.id}\`\nIQ User ID: \`${iqUserId}\`\n\nApprove: /admin approve ${ctx.from!.id}\nReject: /admin reject ${ctx.from!.id}`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch {}
                }
            } catch (err: unknown) {
                console.error('[affiliate check]', err instanceof Error ? err.message : err);
                setManualApproval(ctx.from!.id);
                onboardSessions.delete(chatId);
                await ctx.reply('⏳ Your User ID has been submitted for manual review.\nYou\'ll be notified once the admin approves your account.');
                try {
                    await bot.telegram.sendMessage(
                        getAdminId(),
                        `🔔 *Manual approval needed* (auto-check unavailable)\nTelegram ID: \`${ctx.from!.id}\`\nIQ User ID: \`${iqUserId}\`\n\nApprove: /admin approve ${ctx.from!.id}\nReject: /admin reject ${ctx.from!.id}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch {}
            }
            return;
        }

        if (ob.step === 'connect_email') {
            ob.email = text;
            ob.step = 'connect_password';
            await ctx.reply('🛡️ Your password is safe\n\nWe use the official IQ Option API.\nWe can\'t read or store it.\nYour message auto-deletes from this chat in 10 seconds.');
            try { await ctx.replyWithPhoto(ASSET('L4.png')); } catch {}
            await ctx.reply('🔑 Enter your IQ Option password:');
            return;
        }

        if (ob.step === 'connect_password' && ob.email) {
            const email = ob.email;
            try { await ctx.deleteMessage(); } catch {}
            await ctx.reply('🔐 Logging in...');
            try {
                const { ssid, sdk } = await loginAndCaptureSsid(email, text);
                saveUser({ telegram_id: ctx.from!.id, ssid });
                try {
                    const all = (await sdk.balances()).getBalances();
                    const demo = all.find(b => b.type === BalanceType.Demo);
                    const real = all.find(b => b.type === BalanceType.Real);
                    let msg = '✅ Connected!\n\n';
                    if (demo) msg += `🎮 Practice: $${demo.amount.toFixed(2)}\n`;
                    if (real) msg += `💎 Live: $${real.amount.toFixed(2)}\n`;
                    onboardSessions.delete(chatId);
                    await ctx.reply(msg, { reply_markup: startKeyboard() });
                } finally { await sdk.shutdown(); }
            } catch (err: unknown) {
                console.error('[connect fail]', err instanceof Error ? err.message : err);
                ob.loginFailCount = (ob.loginFailCount ?? 0) + 1;
                if ((ob.loginFailCount ?? 0) >= 2) {
                    onboardSessions.delete(chatId);
                    await ctx.reply(
                        'Seems you\'re having trouble logging into your IQ Options Account 👾😨\n\nNo worries we\'re here to assist you. Contact admin below 👇💜',
                        { reply_markup: { inline_keyboard: [[{ text: '👾 Contact admin', url: ADMIN_CONTACT_LINK }]] } }
                    );
                } else {
                    ob.step = 'connect_email';
                    ob.email = undefined;
                    await ctx.reply('Sorry we\'re unable to retrieve your account details 😨\n\nPlease re-check your account email or password and try again 👇\n\n📧 Enter your IQ Option email:');
                }
            }
            return;
        }
        return;
    }

    // ── Standalone /connect wizard ────────────────────────────────────────────
    const conn = connectSessions.get(chatId);
    if (conn) {
        if (conn.step === 'email') {
            conn.email = text;
            conn.step = 'password';
            await ctx.reply('🔑 Enter your password:');
        } else if (conn.step === 'password' && conn.email) {
            const email = conn.email;
            connectSessions.delete(chatId);
            try { await ctx.deleteMessage(); } catch {}
            await ctx.reply('🔐 Logging in...');
            try {
                const { ssid, sdk } = await loginAndCaptureSsid(email, text);
                saveUser({ telegram_id: ctx.from!.id, ssid });
                try {
                    const all = (await sdk.balances()).getBalances();
                    const demo = all.find(b => b.type === BalanceType.Demo);
                    const real = all.find(b => b.type === BalanceType.Real);
                    let msg = '✅ *Connected!*\n\n';
                    if (demo) msg += `🎮 Practice: $${demo.amount.toFixed(2)}\n`;
                    if (real) msg += `💎 Live: $${real.amount.toFixed(2)}\n`;
                    await ctx.reply(msg, { parse_mode: 'Markdown' });
                } finally { await sdk.shutdown(); }
            } catch (err: unknown) {
                await ctx.reply(`❌ Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        }
        return;
    }

    // ── Trade wizard — custom amount ──────────────────────────────────────────
    const wiz = wizardSessions.get(chatId);
    if (!wiz || wiz.step !== 'custom_amount') return;

    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) { await ctx.reply('Please enter a valid positive number (e.g. 75).'); return; }
    if (wiz.mode === 'demo' && amount > 20) { await ctx.reply('Demo max is $20. Please enter a smaller amount.'); return; }

    wiz.amount = amount;
    wiz.step = 'timeframe';
    try { await ctx.replyWithPhoto(ASSET('L6.png')); } catch {}
    await ctx.reply(
        '⏱ Pick your expiry timeframe 👇\n⏱ Faster timeframes settle quicker.\n🐢 Longer timeframes ride bigger moves.',
        { reply_markup: timeframeKeyboard() }
    );
});

bot.launch({ dropPendingUpdates: true });
console.log('[iqbot-v3] running');

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
