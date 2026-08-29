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
                            // GUARD: prevent double-resume (boot scan + periodic recovery racing).
                            // Self-heal: a resume that stalled >5 min (e.g. hung SDK acquire)
                            // is cleared back to 'active' so the chain can retry — it can
                            // never be permanently blocked by a dead 'resuming' marker.
                            if (galeRow.status === 'resuming') {
                                const updatedMs = Date.parse(String(galeRow.updated_at).replace(' ', 'T') + 'Z');
                                const stale = Number.isFinite(updatedMs) && (Date.now() - updatedMs) > 5 * 60 * 1000;
                                if (!stale) {
                                    console.log(`[GALE-RESUME] Already resuming for user ${row.telegram_id}, skipping (prevent double-fire)`);
                                    continue;
                                }
                                console.log(`[GALE-RESUME] Stale resuming (>5 min) for user ${row.telegram_id} — clearing and retrying`);
                                db.prepare("UPDATE gale_sessions SET status='active', updated_at=datetime('now') WHERE id=?").run(galeRow.id);
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

// ═══════════════════════════════════════════════════════════════════════════
// Yacht trade reconciliation (DIRECTIVE-YACHT-RESULT-HARDENING Part 2)
// ═══════════════════════════════════════════════════════════════════════════
//
// recoverMissedTradeResults() above resolves USER trades and finds them with
// `FROM trades t JOIN users u ON u.telegram_id = t.telegram_id`. Yacht engine
// trades carry `telegram_id = 0` and have no users row, so that JOIN drops them
// — which is why trade #124166 sat `in_flight` for 24 minutes on 2026-08-29
// with nothing in the system able to resolve it.
//
// This half is deliberately Telegram-free and read-only against IQ Option: it
// resolves the chain and writes the `trades` rows. The ENGINE owns the
// yacht_setups update, the session counters and the channel post — one place
// decides what the channel sees.

/** What a resolved yacht chain amounts to.
 *   win       — a round closed WIN (or TIE, which the engine counts as a win)
 *   loss      — every round of a COMPLETE ladder closed LOSS
 *   truncated — the ladder stopped early (process died mid-chain): the rounds we
 *               can see all lost, but the remaining rounds were never placed.
 *               The engine must NOT post a loss card for this — "all attempts
 *               done" would be a lie. */
export interface YachtChainResolution {
    outcome: 'win' | 'loss' | 'truncated';
    /** Rounds actually placed and resolved (1 = direct hit, no recovery). */
    rounds: number;
    /** IQ Option option id of the deciding round, for yacht_setups.trade_id. */
    tradeId: number | null;
    externalId: number | null;
    pnl: number;
    /** Rows found in the window that IQ Option could not account for. */
    unresolved: number;
}

/** Trades rows belonging to one yacht setup's martingale chain.
 *
 *  `yacht_setups.posted_at` is sqlite `datetime('now')` ("YYYY-MM-DD HH:MM:SS",
 *  UTC) while trade-core writes `trades.created_at` as a JS ISO string. The two
 *  formats do NOT compare lexicographically, so the window is computed in JS and
 *  handed over as ISO — comparing ISO against ISO, which does sort correctly. */
/** Derived from createSdk rather than imported from index.js — same trick the
 *  engine uses, so this file gains no new module dependency. */
type Sdk = Awaited<ReturnType<typeof createSdk>>;

interface YachtSetupRow {
    id: number;
    session_id: number | null;
    product: string;
    pair: string;
    timeframe_sec: number;
    direction: string;
    stake: number;
    status: string;
    trade_id: string | null;
    result_rounds: number | null;
    posted_at: string | null;
    closed_at: string | null;
}

function yachtChainRows(setup: YachtSetupRow, maxRounds: number) {
    const postedMs = Date.parse(String(setup.posted_at ?? '').replace(' ', 'T') + 'Z');
    if (!Number.isFinite(postedMs)) return [];
    const tf = Number(setup.timeframe_sec) || 60;
    // 60s entry hold + every round's expiry + inter-round cooldowns + slack.
    const windowMs = 60_000 + maxRounds * (tf * 1000 + 5_000) + 120_000;
    const from = new Date(postedMs - 5_000).toISOString();
    const to = new Date(postedMs + windowMs).toISOString();

    return db.prepare(`
        SELECT id, trade_id, external_id, pair, direction, amount, status, pnl, created_at, timeframe_sec
        FROM trades
        WHERE telegram_id = 0
          AND pair = ?
          AND created_at >= ? AND created_at <= ?
        ORDER BY id ASC
        LIMIT ?
    `).all(setup.pair, from, to, maxRounds);
}

/** Resolve one yacht setup's chain from IQ Option position history and write the
 *  outcome back to `trades`. Read-only against the broker: it looks positions up,
 *  it never places anything, so it can never cause a second entry.
 *
 *  Returns null when IQ Option has no record of any round — the caller then
 *  aborts the setup rather than inventing a result.
 *
 *  @param sdk        a live SDK for the YACHT account (never a member session)
 *  @param setup      the `yacht_setups` row
 *  @param galeRounds configured recovery rounds; the full ladder is galeRounds+1 */
export async function resolveYachtSetupTrades(sdk: Sdk, setup: YachtSetupRow, galeRounds: number): Promise<YachtChainResolution | null> {
    const maxRounds = Math.max(1, galeRounds + 1);
    const rows = yachtChainRows(setup, maxRounds);
    if (rows.length === 0) {
        console.log(`[YACHT-RECOVERY] setup ${setup.id}: no trades row in the window — nothing was placed`);
        return null;
    }

    const settled: Array<{ status: string; pnl: number; tradeId: number | null; externalId: number | null }> = [];
    let unresolved = 0;

    for (const row of rows) {
        // Already settled by the live chain before it died — trust the DB.
        if (row.status === 'WIN' || row.status === 'LOSS' || row.status === 'TIE') {
            settled.push({ status: row.status, pnl: Number(row.pnl) || 0, tradeId: row.trade_id ?? null, externalId: row.external_id ?? null });
            continue;
        }
        // in_flight / TIMEOUT / ERROR — ERROR is included on purpose: the user-path
        // sweep at the top of this file stamps EVERY stale in_flight row (yacht rows
        // included — that UPDATE has no telegram_id filter) with
        // 'unconfirmed_settlement_stale' after 45 minutes. A yacht row that crossed
        // that line is still perfectly resolvable from position history.
        if (!row.trade_id) { unresolved++; break; }
        let recovered = null;
        try {
            const startedAt = Date.parse(row.created_at) || (Date.now() - 600_000);
            recovered = await recoverFinal(sdk, row.trade_id, row.external_id ?? undefined, row.amount, startedAt);
        } catch (e) {
            console.warn(`[YACHT-RECOVERY] recoverFinal threw for trade #${row.trade_id}: ${e instanceof Error ? e.message : e}`);
        }
        if (!recovered) {
            unresolved++;
            console.warn(`[YACHT-RECOVERY] setup ${setup.id}: trade #${row.trade_id} not found in position history`);
            break;   // the ladder is ordered — stop at the first hole
        }
        const pnl = recovered.status === 'WIN' ? recovered.pnl : 0;
        db.prepare(`UPDATE trades SET status = ?, pnl = ?, external_id = COALESCE(?, external_id), error = NULL
                     WHERE id = ? AND status IN ('in_flight', 'TIMEOUT', 'ERROR')`)
            .run(recovered.status, pnl, recovered.externalId ?? null, row.id);
        console.log(`[YACHT-RECOVERY] setup ${setup.id}: trade #${row.trade_id} → ${recovered.status} (${pnl}) src=${recovered.settleSource}`);
        settled.push({ status: recovered.status, pnl, tradeId: row.trade_id, externalId: recovered.externalId ?? row.external_id ?? null });
    }

    if (settled.length === 0) return null;

    const last = settled[settled.length - 1];
    // Diagnostic only — never shown in the channel (no PnL doctrine).
    const totalPnl = settled.reduce((s, r) => s + r.pnl, 0);

    // TIE is a win for the engine (stake returned), matching runOneSetup.
    if (last.status === 'WIN' || last.status === 'TIE') {
        return { outcome: 'win', rounds: settled.length, tradeId: last.tradeId, externalId: last.externalId, pnl: totalPnl, unresolved };
    }
    // Every visible round lost. Only a COMPLETE ladder is a real loss; a ladder cut
    // short by the restart is 'truncated' and gets no card.
    const complete = settled.length >= maxRounds && unresolved === 0;
    return {
        outcome: complete ? 'loss' : 'truncated',
        rounds: settled.length,
        tradeId: last.tradeId,
        externalId: last.externalId,
        pnl: totalPnl,
        unresolved,
    };
}