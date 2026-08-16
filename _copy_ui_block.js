// ─── Copy Trading UI (luxury redesign) ───────────────────────────────────────

function copyCurrencyLabel(uid) {
    const cur = (getUser(uid)?.currency ?? 'USD') || 'USD';
    return cur.toUpperCase();
}
function copyAmountPresets(cur) {
    if (cur === 'NGN')
        return [['₦25,000', '50'], ['₦50,000', '100'], ['₦100,000', '200'], ['₦250,000', '500'], ['₦500,000', '1000']];
    const sym = ({ USD: '$', EUR: '€', GBP: '£' })[cur] ?? '$';
    return [[`${sym}50`, '50'], [`${sym}100`, '100'], [`${sym}200`, '200'], [`${sym}500`, '500'], [`${sym}1000`, '1000']];
}
function copyAdminLine() {
    const cfg = getCopyConfig();
    const tf = cfg.timeframe === 30 ? '30s' : cfg.timeframe === 60 ? '1m' : cfg.timeframe === 120 ? '2m' : '5m';
    const pairs = (cfg.assets ?? []).map(p => String(p).replace(/-OTC/gi, '')).join(' · ') || '—';
    return cfg.trading_active ? `· Admin: LIVE — ${pairs} · ${tf}` : '· Admin: standby — next window soon';
}
function copyLastTradeLine(uid) {
    const t = db.prepare(`SELECT status, pnl, amount FROM trades
        WHERE telegram_id = ? AND status IN ('WIN','LOSS','TIE')
        ORDER BY julianday(created_at) DESC LIMIT 1`).get(uid);
    if (!t) return '· When admin trades, you trade';
    if (t.status === 'WIN') {
        const net = (t.pnl ?? 0) - (t.amount ?? 0);
        return `· Last copied trade: +$${net.toFixed(2)}`;
    }
    if (t.status === 'LOSS') return `· Last copied trade: -$${(t.amount ?? 0).toFixed(2)}`;
    return '· Last copied trade: $0.00';
}
function copyTodayStats(uid) {
    return db.prepare(`SELECT
        COUNT(*) AS n,
        COALESCE(SUM(CASE WHEN status='WIN' THEN pnl - amount WHEN status='LOSS' THEN -amount ELSE 0 END), 0) AS net
        FROM trades WHERE telegram_id = ? AND status IN ('WIN','LOSS','TIE')
        AND julianday(created_at) >= julianday('now', 'start of day', '+1 hour')`).get(uid);
}

bot.action('ui:copy', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!await requireApproval(ctx))
        return;
    const uid = ctx.from.id;
    const isPriv = isPrivilegedUser(uid);
    const user = getUser(uid);
    const st = getCopyStatus(uid);

    if (st.copying) {
        const stats = copyTodayStats(uid);
        const net = stats.net >= 0 ? `+$${stats.net.toFixed(2)}` : `-$${Math.abs(stats.net).toFixed(2)}`;
        await ctx.reply(`◆ Copy Trading — ACTIVE\n\nCopying admin · $${st.amount} per trade\n\n${copyAdminLine()}\n\n· Trades today: ${stats.n} · Net ${net}\n\nYou can stop anytime.`, { reply_markup: { inline_keyboard: [
            [{ text: '■ Stop Copying', callback_data: 'copy:stop' }],
            [{ text: '· Today\u2019s activity', callback_data: 'copy:activity' }],
            [{ text: '⟵ Back', callback_data: 'ui:trade_menu' }],
        ] } });
        return;
    }

    const fundedUsd = user?.funded_balance_usd ?? 0;
    if (!isPriv && fundedUsd < 1000) {
        const gap = Math.max(0, 1000 - fundedUsd);
        await ctx.reply(`◆ Copy Trading\n\nThe engine trades. Your account mirrors it.\n\n${copyAdminLine()}\n${copyLastTradeLine(uid)}\n\nTo copy: $1,000 minimum\nYour balance: $${fundedUsd.toFixed(2)} — $${gap.toFixed(2)} away\n\nClose the gap and mirroring starts.`, { reply_markup: { inline_keyboard: [
            [{ text: '✦ Fund Account', url: DEPOSIT_URL }],
            [{ text: '⟡ Contact Admin', url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' }],
            [{ text: '⟵ Back', callback_data: 'ui:trade_menu' }],
        ] } });
        return;
    }

    const cur = copyCurrencyLabel(uid);
    const presetRows = copyAmountPresets(cur);
    await ctx.reply(`◆ Copy Trading\n\nWhen admin opens a trade, your account opens the same one — same pair, same direction, same moment.\n\n${copyAdminLine()}\n\nChoose your copy amount:`, { reply_markup: { inline_keyboard: [
        [{ text: presetRows[0][0], callback_data: `copy:amt:${presetRows[0][1]}` }, { text: presetRows[1][0], callback_data: `copy:amt:${presetRows[1][1]}` }, { text: presetRows[2][0], callback_data: `copy:amt:${presetRows[2][1]}` }],
        [{ text: presetRows[3][0], callback_data: `copy:amt:${presetRows[3][1]}` }, { text: presetRows[4][0], callback_data: `copy:amt:${presetRows[4][1]}` }],
        [{ text: '· How it works', callback_data: 'copy:how' }],
        [{ text: '⟵ Back', callback_data: 'ui:trade_menu' }],
    ] } });
});

bot.action('copy:how', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    await ctx.reply(`◆ How Copy Trading works\n\nAdmin trades from the engine. Your account mirrors every move — same pair, same direction, same moment.\n\nYou choose the amount. Admin runs the strategy.\n\n· Min balance: $1,000\n· Min copy: $50\n· Stop anytime`, { reply_markup: { inline_keyboard: [
        [{ text: '⟡ Start Copying', callback_data: 'ui:copy' }],
        [{ text: '⟵ Back', callback_data: 'ui:trade_menu' }],
    ] } });
});

bot.action(/^copy:amt:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    try {
        await ctx.deleteMessage();
    }
    catch { }
    const amount = parseFloat(ctx.match[1]);
    if (isNaN(amount) || amount < 50) {
        await ctx.reply('Minimum copy amount is $50.');
        return;
    }
    const uid = ctx.from.id;
    const result = await startCopying(uid, amount);
    if (!result.ok) {
        await ctx.reply(`⚠️ ${result.error}`);
        return;
    }
    const stats = copyTodayStats(uid);
    await ctx.reply(`◆ Copy Trading — ACTIVE\n\nCopying admin · $${amount} per trade\n\n${copyAdminLine()}\n\n· Trades today: ${stats.n}\n\nYou can stop anytime.`, { reply_markup: { inline_keyboard: [
        [{ text: '■ Stop Copying', callback_data: 'copy:stop' }],
        [{ text: '⟵ Back', callback_data: 'ui:trade_menu' }],
    ] } });
});

bot.action('copy:activity', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const uid = ctx.from.id;
    const stats = copyTodayStats(uid);
    const net = stats.net >= 0 ? `+$${stats.net.toFixed(2)}` : `-$${Math.abs(stats.net).toFixed(2)}`;
    const rows = db.prepare(`SELECT pair, status, pnl, amount FROM trades
        WHERE telegram_id = ? AND status IN ('WIN','LOSS','TIE')
        AND julianday(created_at) >= julianday('now', 'start of day', '+1 hour')
        ORDER BY julianday(created_at) DESC LIMIT 6`).all(uid);
    let lines = '';
    for (const r of rows) {
        const em = r.status === 'WIN' ? '🟢' : r.status === 'LOSS' ? '🔴' : '🟡';
        const p = r.status === 'WIN' ? `+$${((r.pnl ?? 0) - (r.amount ?? 0)).toFixed(2)}` : r.status === 'LOSS' ? `-$${(r.amount ?? 0).toFixed(2)}` : '$0.00';
        lines += `\n${em} ${r.pair} — ${p}`;
    }
    if (!lines)
        lines = '\nNo trades yet today.';
    await ctx.reply(`◆ Today\u2019s activity\n\n${stats.n} trades today · Net ${net}${lines}`, { reply_markup: { inline_keyboard: [
        [{ text: '⟵ Back to Copy Trading', callback_data: 'ui:copy' }],
    ] } });
});

bot.action('copy:stop', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    stopCopying(ctx.from.id);
    await ctx.reply(`◆ Copy Trading — stopped\n\nMirroring paused. Admin keeps trading — your account no longer follows.\n\nStart again anytime.`, { reply_markup: { inline_keyboard: [
        [{ text: '⟡ Start Copying', callback_data: 'ui:copy' }],
        [{ text: '⟵ Back', callback_data: 'ui:trade_menu' }],
    ] } });
});
