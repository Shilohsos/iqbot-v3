import { db, getUser, getAutoSession } from './db.js';
import { createSdk } from './trade.js';
import type { Telegraf } from 'telegraf';

interface UnresolvedTrade {
    trade_id: number;
    external_id: number | null;
    telegram_id: number;
    ssid: string;
    pair: string;
    direction: string;
    amount: number;
}

export async function recoverMissedTradeResults(bot: Telegraf): Promise<void> {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // Clean up stale in-flight trades that are too old to recover.
    db.prepare(`UPDATE trades SET status = 'LOSS', error = 'unresolved_restart'
                 WHERE status = 'in_flight' AND created_at < ?`)
        .run(fifteenMinutesAgo);

    const rows = db.prepare(`
        SELECT t.trade_id, t.external_id, t.telegram_id, u.ssid, t.pair, t.direction, t.amount
        FROM trades t
        JOIN users u ON u.telegram_id = t.telegram_id
        WHERE (t.status = 'TIMEOUT' OR t.status = 'in_flight')
          AND t.created_at >= ?
          AND u.ssid IS NOT NULL
          AND u.ssid != ''
          AND u.ssid_valid = 1
        ORDER BY t.created_at DESC
        LIMIT 20
    `).all(fifteenMinutesAgo) as UnresolvedTrade[];

    if (rows.length === 0) return;

    const resolved: string[] = [];

    for (const row of rows) {
        try {
            let sdk;
            try {
                sdk = await createSdk(row.ssid);
            } catch {
                continue;
            }

            let recoveredStatus: string | null = null;
            let recoveredPnl = 0;

            try {
                const positions = await sdk.positions();

                if (row.external_id) {
                    const historyPos = await positions.getPositionsHistory().getPositionHistory(row.external_id);
                    if (historyPos && historyPos.status === 'closed') {
                        const pnl = historyPos.closeProfit ?? 0;
                        const reason = historyPos.closeReason ?? '';
                        const status = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                        db.prepare(`UPDATE trades SET status = ?, pnl = ?, error = NULL WHERE trade_id = ?`)
                            .run(status, pnl, row.trade_id);
                        recoveredStatus = status;
                        recoveredPnl = pnl;
                    }
                } else {
                    // No external_id (older trades): match by trade_id in orderIds.
                    // Opened positions only hold still-open trades, so a closed trade
                    // won't be there — also sweep the positions history (closed trades).
                    const opened = positions.getOpenedPositions();
                    let match = opened.find(p => p.orderIds.includes(row.trade_id));

                    if (!match) {
                        const history = positions.getPositionsHistory();
                        match = history.getPositions().find(p => p.orderIds.includes(row.trade_id));
                    }

                    if (match && match.status === 'closed') {
                        const pnl = match.closeProfit ?? 0;
                        const reason = match.closeReason ?? '';
                        const status = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                        db.prepare(`UPDATE trades SET status = ?, pnl = ?, external_id = ?, error = NULL WHERE trade_id = ?`)
                            .run(status, pnl, match.externalId ?? null, row.trade_id);
                        recoveredStatus = status;
                        recoveredPnl = pnl;
                    }
                }
            } finally {
                await sdk.shutdown();
            }

            if (recoveredStatus) {
                resolved.push(`#${row.trade_id}: ${recoveredStatus} ($${recoveredPnl})`);

                // Notify the user — but skip for auto-trading users (the status card
                // already shows results; recovery messages are just noise).
                const hasAutoSession = getAutoSession(row.telegram_id) !== null;
                if (!hasAutoSession) {
                    const emoji = recoveredStatus === 'WIN' ? '✅' : recoveredStatus === 'LOSS' ? '❌' : '🤝';
                    const currency = getUser(row.telegram_id)?.currency || 'USD';
                    const pnlStr = recoveredPnl >= 0 ? `+${recoveredPnl.toFixed(2)}` : recoveredPnl.toFixed(2);
                    try {
                        await bot.telegram.sendMessage(row.telegram_id,
                            `${emoji} Trade recovered: ${row.pair} ${row.direction.toUpperCase()} — ${recoveredStatus}\n` +
                            `Amount: ${row.amount.toFixed(2)} ${currency} | PnL: ${pnlStr} ${currency}`,
                        );
                    } catch {
                        // User may have blocked the bot — not critical.
                    }
                }
            }
        } catch {
            // Individual trade recovery failure — don't block the rest
        }
    }

    if (resolved.length > 0) {
        console.log(`[RECOVERY] Resolved ${resolved.length} missed trade result(s): ${resolved.join(', ')}`);
    }
}
