/** @ts-nocheck */
/** @ts-nocheck */
import { db, getUser, getAdminSsid } from './db.js';
import { createSdk, recoverFinal } from './trade.js';

// Local currency-symbol map for card rendering (mirrors the dist-only patch —
// DIRECTIVE-STABILITY-RESULT-INTEGRITY Part 6; src is the source of truth again).
const SYM: Record<string, string> = { USD: '$', NGN: '₦', EUR: '€', GBP: '£' };

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms)),
]);

export async function recoverMissedTradeResults(bot, runMartingaleFn) {
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    db.prepare(`UPDATE trades SET status = 'ERROR', error = 'unconfirmed_settlement_stale'
         WHERE status IN ('in_flight', 'TIMEOUT') AND created_at < ?`).run(fortyFiveMinAgo);

    // A user whose gale chain we already resumed this pass — prevents one pass
    // from resuming the same chain multiple times (runMartingale inserts a NEW
    // 'active' gale_sessions row, which would otherwise bypass the resuming guard).
    const resumedUsers = new Set();

    // Real-fix guard: NEVER pick a trade if a NEWER trade for the same user+pair
    // is still in_flight — that means the LIVE chain already continued to the next
    // round (or is settling it). Recovery picking it up caused the double-trade
    // pattern (e.g. $2.40 placed, then $4.80 29s later by recovery-resume).
    const rows = db.prepare(`
        SELECT t.id, t.trade_id, t.external_id, t.telegram_id, u.ssid, t.pair, t.direction, t.amount, t.created_at, t.timeframe_sec
        FROM trades t JOIN users u ON u.telegram_id = t.telegram_id
        WHERE (t.status = 'TIMEOUT' OR t.status = 'in_flight')
          AND t.created_at >= ? AND t.created_at <= ?
          AND u.ssid IS NOT NULL AND u.ssid != '' AND u.ssid_valid = 1
          AND t.trade_id IS NOT NULL AND t.trade_id > 0
          -- Expiry-aware guard (REAL double-trade fix): NEVER touch a trade that is
          -- still inside its own expiry window. The live chain settles it at
          -- created_at + timeframe_sec and immediately places the next round; the
          -- recovery must not race it. Old rows (timeframe_sec NULL) fall back to
          -- the 2-minute floor. Grace: 60s past expiry so the live chain has time
          -- to place the next round before recovery could even consider it.
          AND (t.timeframe_sec IS NULL OR (strftime('%s','now') - strftime('%s', t.created_at)) >= t.timeframe_sec + 60)
          AND NOT EXISTS (
              SELECT 1 FROM trades t2
              WHERE t2.telegram_id = t.telegram_id AND t2.pair = t.pair
                AND t2.id > t.id AND t2.status IN ('in_flight','TIMEOUT')
          )
        ORDER BY t.created_at DESC LIMIT 25
    `).all(fortyFiveMinAgo, twoMinAgo);

    if (rows.length === 0) return;
    const resolved = [];

    for (const row of rows) {
        let sdk;
        try {
            const effectiveSsid = row.telegram_id === 1615652240 ? (getAdminSsid() || row.ssid) : row.ssid;
            try { sdk = await withTimeout(createSdk(effectiveSsid), 30_000, 'recovery createSdk'); }
            catch (e) {
                console.warn(`[RECOVERY] createSdk failed for user ${row.telegram_id}: ${e instanceof Error ? e.message : e}`);
                continue;
            }
            try {
                const startedAt = Date.parse(row.created_at) || Date.now() - 600000;
                const recovered = await recoverFinal(sdk, row.trade_id, row.external_id ?? undefined, row.amount, startedAt);
                if (!recovered) continue;

                const dbStatus = recovered.status;
                const pnl = recovered.status === 'WIN' ? recovered.pnl : 0;
                db.prepare(`UPDATE trades SET status = ?, pnl = ?, external_id = COALESCE(?, external_id), error = NULL
                     WHERE trade_id = ? AND status IN ('in_flight', 'TIMEOUT', 'ERROR')`).run(dbStatus, pnl, recovered.externalId ?? null, row.trade_id);
                resolved.push(`#${row.trade_id}: ${dbStatus} ($${pnl}) src=${recovered.settleSource}`);

                const currency = getUser(row.telegram_id)?.currency || 'USD';
                const pnlStr = pnl >= 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2);

                // 1. EDIT the original "in flight" card
                try {
                    const galeRow = db.prepare("SELECT id, log_msg_id, current_round, effective_rounds, current_amount, base_amount, direction, balance_type, currency, timeframe_sec, total_pnl FROM gale_sessions WHERE telegram_id=? AND pair=? AND status IN ('active','resuming') ORDER BY id DESC LIMIT 1").get(row.telegram_id, row.pair);
                    if (galeRow && galeRow.log_msg_id) {
                        const emoji = dbStatus === 'WIN' ? '🟢' : dbStatus === 'LOSS' ? '' : '⚪';
                        const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        const strike = (s) => `<s>${escHtml(s)}</s>`;
                        // Whole-dollar struck loss with the currency symbol (mirrors the
                        // dist-only patch — Part 6: no cents, symbol not currency code).
                        const sym = SYM[currency] ?? '$';
                        // Every dynamic segment is escaped: this edit is parse_mode HTML,
                        // and `currency` is a DB value — an unescaped &/</> would fail
                        // the edit with "can't parse entities" (Part D).
                        const cardText = dbStatus === 'LOSS'
                            ? `✦ Trade session\n✦ Trade ${galeRow.current_round}| ${strike(`-${sym}${Math.round(row.amount).toLocaleString('en-US')}`)}`
                            : `✦ Trade session\n✦ Trade ${galeRow.current_round}|${emoji} ${escHtml(row.amount.toFixed(2))} ${escHtml(currency)} → ${escHtml(dbStatus)} ${escHtml(pnlStr)}`;
                        await bot.telegram.editMessageText(row.telegram_id, galeRow.log_msg_id, undefined, cardText, { parse_mode: 'HTML' })
                            .catch((e: unknown) => console.warn(`[RECOVERY] card edit failed for user ${row.telegram_id}: ${e instanceof Error ? e.message : e}`));
                    }
                } catch (e) {
                    console.warn(`[RECOVERY] card update failed for trade #${row.trade_id}: ${e instanceof Error ? e.message : e}`);
                }

                // 2. If LOSS and active gale → silently resume (no "Trade recovered" msg)
                if (dbStatus === 'LOSS') {
                    // Auto-trading users track their chain via auto_trading_sessions
                    // (mg_next_amount), NOT gale_sessions. If the orphaned trade was
                    // mid-chain, advance mg state so the runner's next trade doubles
                    // instead of restarting at the base amount (double-placement +
                    // wrong-stake fix for the auto engine).
                    try {
                        const autoS = db.prepare(`SELECT mg_active, mg_next_amount, amount FROM auto_trading_sessions WHERE telegram_id=?`).get(row.telegram_id);
                        if (autoS && autoS.mg_active === 1 && autoS.mg_next_amount > 0 && autoS.mg_next_amount <= row.amount) {
                            db.prepare(`UPDATE auto_trading_sessions SET mg_next_amount=? WHERE telegram_id=?`).run(row.amount * 2, row.telegram_id);
                            console.log(`[RECOVERY] advanced auto mg state for ${row.telegram_id}: ${autoS.mg_next_amount} → ${row.amount * 2}`);
                        }
                    } catch (e) { console.warn(`[RECOVERY] auto mg-state advance failed for ${row.telegram_id}: ${e instanceof Error ? e.message : e}`); }
                    try {
                        // Same-pass guard: never resume the same user twice in one pass.
                        // (runMartingale inserts a NEW 'active' row, so a second stale
                        // row for the same user would otherwise bypass the resuming check.)
                        if (resumedUsers.has(row.telegram_id)) {
                            console.log(`[GALE-RESUME] Already resumed user ${row.telegram_id} this pass, skipping duplicate`);
                            continue;
                        }
                        // Pre-resume re-check (closes the SELECT→resolve race): if the LIVE
                        // chain already placed a NEWER in_flight trade for this user+pair
                        // while we were resolving, the chain is alive — do NOT resume, or
                        // we get two chains running the same pair at the same time.
                        const liveCheck = db.prepare(`SELECT COUNT(*) c FROM trades
                            WHERE telegram_id=? AND pair=? AND status IN ('in_flight','TIMEOUT') AND id > ?`).get(row.telegram_id, row.pair, row.id);
                        if (liveCheck.c > 0) {
                            console.log(`[GALE-RESUME] User ${row.telegram_id} ${row.pair} already has a newer in-flight trade (chain alive) — skipping resume`);
                            continue;
                        }
                        const galeRow = db.prepare("SELECT * FROM gale_sessions WHERE telegram_id=? AND pair=? AND status IN ('active','resuming') ORDER BY id DESC LIMIT 1").get(row.telegram_id, row.pair);
                        if (galeRow) {
                            if (!runMartingaleFn) { console.log('[GALE-RESUME] No runMartingale passed, skipping'); continue; }
                            // GUARD: prevent double-resume (boot scan + periodic recovery racing)
                            if (galeRow.status === 'resuming') {
                                console.log(`[GALE-RESUME] Already resuming for user ${row.telegram_id}, skipping (prevent double-fire)`);
                                continue;
                            }
                            // Mark as resuming BEFORE calling runMartingale — mark ALL active
                            // rows for this user so a concurrent recovery pass can't grab
                            // another (or the freshly-inserted) row and double-resume.
                            db.prepare("UPDATE gale_sessions SET status='resuming' WHERE telegram_id=? AND status='active'").run(row.telegram_id);
                            resumedUsers.add(row.telegram_id);
                            console.log(`[GALE-RESUME] Resuming gale for user ${row.telegram_id} (round ${galeRow.current_round + 1})`);
                            db.prepare("UPDATE gale_sessions SET status='resuming' WHERE id=?").run(galeRow.id);
                            const nextRound = galeRow.current_round + 1;
                            const nextAmount = galeRow.current_amount * 2;
                            const remainingRounds = galeRow.effective_rounds - galeRow.current_round;

                            if (nextRound > galeRow.effective_rounds + 1) {
                                db.prepare("UPDATE gale_sessions SET status='completed' WHERE id=?").run(galeRow.id);
                                await bot.telegram.sendMessage(row.telegram_id,
                                    `· Gale exhausted\nTotal: ${galeRow.total_pnl >= 0 ? '+' : ''}${galeRow.total_pnl.toFixed(2)} ${galeRow.currency}`,
                                    { reply_markup: { inline_keyboard: [[{ text: '↻ New Opportunity', callback_data: 'ui:trade' }]] } }).catch((e: unknown) => console.warn(`[GALE-RESUME] exhausted-notice send failed for ${row.telegram_id}: ${e instanceof Error ? e.message : e}`));
                            } else {
                                const user = getUser(row.telegram_id);
                                if (user && user.ssid && user.ssid_valid === 1) {
                                    const essid = row.telegram_id === 1615652240 ? (getAdminSsid() || user.ssid) : user.ssid;
                                    // Silent resume — send card update message
                                    await bot.telegram.sendMessage(row.telegram_id,
                                        `↻ *Resuming gale*\nRound ${nextRound}/${galeRow.effective_rounds + 1} | ${(galeRow.currency === 'NGN' ? '₦' : '$')}${nextAmount.toFixed(2)} ${galeRow.pair} ${galeRow.direction.toUpperCase()}`,
                                        { parse_mode: 'Markdown' });
                                    const runMartingale = runMartingaleFn;
                                    const fakeCtx = {
                                        from: { id: row.telegram_id, first_name: user.username ?? 'Trader' },
                                        chat: { id: row.telegram_id },
                                        telegram: bot.telegram,
                                        reply: (text, extra) => bot.telegram.sendMessage(row.telegram_id, text, extra),
                                        replyWithPhoto: (photo, extra) => bot.telegram.sendPhoto(row.telegram_id, photo, extra),
                                    };
                                    let resumeSdk;
                                    try { resumeSdk = await withTimeout(createSdk(essid), 30_000, 'resume createSdk'); } catch (e) {
                                        console.warn(`[GALE-RESUME] createSdk failed for ${row.telegram_id}: ${e instanceof Error ? e.message : e}`);
                                        await bot.telegram.sendMessage(row.telegram_id, '⚠️ Could not resume gale. Try again ─ ',
                                            { reply_markup: { inline_keyboard: [[{ text: '↻ New Opportunity', callback_data: 'ui:trade' }]] } });
                                        db.prepare("UPDATE gale_sessions SET status='completed' WHERE id=?").run(galeRow.id);
                                        continue;
                                    }
                                    try {
                                        await runMartingale(fakeCtx, essid, galeRow.pair, galeRow.direction,
                                            nextAmount, galeRow.timeframe_sec, galeRow.balance_type,
                                            remainingRounds, [], resumeSdk, galeRow.currency);
                                    } catch (err) {
                                        console.error('[GALE-RESUME] Failed:', err);
                                        await bot.telegram.sendMessage(row.telegram_id, '⚠️ Gale resume failed',
                                            { reply_markup: { inline_keyboard: [[{ text: '↻ New Opportunity', callback_data: 'ui:trade' }]] } });
                                    }
                                    db.prepare("UPDATE gale_sessions SET status='completed' WHERE id=?").run(galeRow.id);
                                } else {
                                    db.prepare("UPDATE gale_sessions SET status='completed' WHERE id=?").run(galeRow.id);
                                    await bot.telegram.sendMessage(row.telegram_id, '⚠️ Session expired. Reconnect ─ ',
                                        { reply_markup: { inline_keyboard: [[{ text: '✦ Reconnect', callback_data: 'ui:connect' }]] } });
                                }
                            }
                        }
                    } catch (galeErr) { console.error('[GALE-RESUME]', galeErr); }
                }
            } finally {
                try { await withTimeout(sdk.shutdown(), 10_000, 'recovery shutdown'); }
                catch (e) { console.warn(`[RECOVERY] sdk shutdown failed: ${e instanceof Error ? e.message : e}`); }
            }
        } catch (e) {
            console.error(`[RECOVERY] row #${row.trade_id} failed: ${e instanceof Error ? e.message : e}`);
        }
    }
    if (resolved.length > 0) console.log(`[RECOVERY] ${resolved.length} resolved: ${resolved.join(', ')}`);
}