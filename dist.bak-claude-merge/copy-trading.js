/** @ts-nocheck - reunified from dist */
// Copy Trading — admin-controlled trading for connected users.
// Users click "Start Copying Admin", enter amount (min $50).
// Admin controls on/off, assets, timeframe from backend.
// Users see trades appearing on their end automatically.
// Minimum balance: $1000. Minimum copy amount: $50.
import { createSdk, runMartingaleCore } from './trade.js';
import { sdkPool } from './sdk-pool.js';
import { analyzePairWithSdk } from './analysis.js';
import { runAdminAnalysis } from './admin-analysis.js';
import { getUser, getAdminSsid, db, getConfig } from './db.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';
const COPY_MIN_BALANCE = 1000; // USD minimum to access feature
const COPY_MIN_AMOUNT = 50; // USD minimum to start copying
const TIMEFRAMES = [30, 60, 120, 300];
let notifier;
export function setCopyNotifier(n) { notifier = n; }
const PRIV_IDS = new Set([6622587977, 8986669286, 6683209485]);
function isPrivilegedUser(uid) {
    return uid === getAdminId() || PRIV_IDS.has(uid);
}
export function initCopyDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS copy_trading (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            copy_amount REAL NOT NULL,
            status TEXT DEFAULT 'active',
            started_at INTEGER NOT NULL,
            UNIQUE(telegram_id)
        );

        CREATE TABLE IF NOT EXISTS copy_config (
            id INTEGER PRIMARY KEY DEFAULT 1,
            trading_active INTEGER DEFAULT 0,
            assets TEXT DEFAULT '[]',
            timeframe INTEGER DEFAULT 60,
            gale_rounds INTEGER DEFAULT 6,
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );

        INSERT OR IGNORE INTO copy_config (id) VALUES (1);
    `);
}
export function getCopyConfig() {
    const row = db.prepare('SELECT * FROM copy_config WHERE id = 1').get();
    return {
        trading_active: row?.trading_active ?? 0,
        assets: row?.assets ? JSON.parse(row.assets) : [],
        timeframe: row?.timeframe ?? 60,
        gale_rounds: row?.gale_rounds ?? 6,
    };
}
export function updateCopyConfig(updates) {
    const current = getCopyConfig();
    const merged = { ...current, ...updates };
    db.prepare(`
        UPDATE copy_config SET
            trading_active = ?,
            assets = ?,
            timeframe = ?,
            gale_rounds = ?,
            updated_at = strftime('%s','now')
        WHERE id = 1
    `).run(merged.trading_active ? 1 : 0, JSON.stringify(merged.assets), merged.timeframe, merged.gale_rounds);
}
// ─── User API ───
export async function startCopying(telegramId, copyAmount) {
    if (copyAmount < COPY_MIN_AMOUNT) {
        return { ok: false, error: `Minimum copy amount is $${COPY_MIN_AMOUNT}` };
    }
    const user = getUser(telegramId);
    if (!user)
        return { ok: false, error: 'User not found' };
    const isPriv = isPrivilegedUser(telegramId);
    if (!isPriv) {
        const fundedUsd = user.funded_balance_usd ?? 0;
        if (fundedUsd < COPY_MIN_BALANCE) {
            return { ok: false, error: `Minimum balance for Copy Trading is $${COPY_MIN_BALANCE}. Your balance: $${fundedUsd}` };
        }
    }
    // Check existing
    const existing = db.prepare('SELECT id FROM copy_trading WHERE telegram_id = ? AND status = ?').get(telegramId, 'active');
    if (existing)
        return { ok: false, error: 'You are already copying admin.' };
    const ssid = telegramId === getAdminId() ? getAdminSsid() : user.ssid;
    if (!ssid)
        return { ok: false, error: 'No SSID. Please connect your account first.' };
    db.prepare(`
        INSERT INTO copy_trading (telegram_id, copy_amount, status, started_at)
        VALUES (?, ?, 'active', ?)
    `).run(telegramId, copyAmount, Date.now());
    logger.info('copy', `User ${telegramId} started copying admin with $${copyAmount}`);
    return { ok: true };
}
export function stopCopying(telegramId) {
    db.prepare('UPDATE copy_trading SET status = ? WHERE telegram_id = ? AND status = ?')
        .run('stopped', telegramId, 'active');
}
export function getCopyStatus(telegramId) {
    const row = db.prepare('SELECT copy_amount FROM copy_trading WHERE telegram_id = ? AND status = ?').get(telegramId, 'active');
    if (!row)
        return { copying: false, amount: 0 };
    return { copying: true, amount: row.copy_amount };
}
export function getConnectedCopyUsers() {
    const rows = db.prepare('SELECT telegram_id, copy_amount FROM copy_trading WHERE status = ?').all('active');
    return rows;
}
// ─── Admin API ───
export function adminToggleTrading(on) {
    updateCopyConfig({ trading_active: on ? 1 : 0 });
    logger.info('copy', `Admin ${on ? 'enabled' : 'disabled'} copy trading`);
    if (on) {
        // Start the copy trading loop
        startCopyLoop();
    }
    else {
        stopCopyLoop();
    }
}
export function adminSetAssets(assets) {
    updateCopyConfig({ assets });
}
export function adminSetTimeframe(timeframe) {
    updateCopyConfig({ timeframe });
}
export function adminSetGaleRounds(gale) {
    updateCopyConfig({ gale_rounds: gale });
}
// ─── Copy Trading Loop ───
let copyLoopRunning = false;
let copyLoopTimer = null;
function startCopyLoop() {
    if (copyLoopRunning)
        return;
    copyLoopRunning = true;
    runCopyLoop();
}
function stopCopyLoop() {
    copyLoopRunning = false;
    if (copyLoopTimer) {
        clearTimeout(copyLoopTimer);
        copyLoopTimer = null;
    }
}
async function runCopyLoop() {
    if (!copyLoopRunning)
        return;
    const config = getCopyConfig();
    if (!config.trading_active || config.assets.length === 0) {
        copyLoopTimer = setTimeout(() => runCopyLoop(), 10000);
        return;
    }
    const users = getConnectedCopyUsers();
    if (users.length === 0) {
        copyLoopTimer = setTimeout(() => runCopyLoop(), 10000);
        return;
    }
    // Trade each asset for each connected user
    const timeframe = config.timeframe;
    const gale = config.gale_rounds;
    for (const asset of config.assets) {
        if (!copyLoopRunning)
            break;
        // Trade this asset for all connected users in parallel
        const promises = users.map(u => tradeForUser(u.telegram_id, u.copy_amount, asset, timeframe, gale));
        await Promise.allSettled(promises);
    }
    // Schedule next cycle
    if (copyLoopRunning) {
        copyLoopTimer = setTimeout(() => runCopyLoop(), 5000);
    }
}
async function tradeForUser(telegramId, amount, pair, timeframe, gale) {
    const user = getUser(telegramId);
    if (!user)
        return;
    const ssid = telegramId === getAdminId() ? getAdminSsid() : user.ssid;
    if (!ssid)
        return;
    const isPriv = isPrivilegedUser(telegramId);
    let sdk;
    let usedPool = false;
    try {
        try {
            sdk = await sdkPool.get(telegramId, ssid);
            usedPool = true;
            try {
                sdkPool.pin(telegramId);
            }
            catch { /* */ }
        }
        catch {
            sdk = await createSdk(ssid);
        }
        // Analyze
        const candlesFacade = await sdk.candles();
        const turboOpts = await sdk.turboOptions();
        const norm = (s) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');
        const normalizedPair = norm(pair);
        const active = turboOpts.getActives().find((a) => norm(a.ticker) === normalizedPair || norm(a.localizationKey) === normalizedPair);
        if (!active)
            return;
        let direction;
        if (isPriv || getConfig('admin_analysis_all') === 'true') {
            const history = await candlesFacade.getCandles(active.id, timeframe, { count: 200 });
            const result = runAdminAnalysis(history);
            direction = result.direction;
        }
        else {
            const result = await analyzePairWithSdk(sdk, pair, timeframe, 'MASTER', 2);
            direction = result.direction;
        }
        // Execute trade
        const outcome = await runMartingaleCore(sdk, {
            pair,
            direction,
            amount,
            galeRounds: gale,
            timeframeSec: timeframe,
            balanceType: 'live',
            telegramId,
        });
        // Notify user
        const emoji = outcome.status === 'WIN' ? '🟢' : outcome.status === 'LOSS' ? '🔴' : outcome.status === 'NO_FILL' ? '⚠️' : '🟡';
        const tfLabel = timeframe === 30 ? '30s' : timeframe === 60 ? '1m' : timeframe === 120 ? '2m' : '5m';
        const pnlStr = outcome.totalPnl >= 0 ? `+$${Math.abs(outcome.totalPnl).toFixed(2)}` : `-$${Math.abs(outcome.totalPnl).toFixed(2)}`;
        const roundsStr = outcome.rounds > 1 ? ` (${outcome.rounds} rounds)` : '';
        await notifier?.sendMessage(telegramId, `${emoji} ${pair} (${tfLabel}) — ${outcome.status} ${pnlStr}${roundsStr}`).catch(() => { });
    }
    catch (err) {
        logger.warn('copy', `Copy trade error for uid=${telegramId} on ${pair}: ${err}`);
    }
    finally {
        try {
            if (usedPool) {
                try { sdkPool.unpin(telegramId); sdkPool.release(telegramId); } catch { /* */ }
            } else if (sdk) {
                await sdk.shutdown();
            }
        }
        catch { /* gone */ }
    }
}
