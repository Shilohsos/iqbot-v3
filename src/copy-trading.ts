/** @ts-nocheck - reunified from dist */
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
import { launchH20 } from './h20.js';
export const COPY_MIN_BALANCE = 200; // USD minimum to access feature
export const COPY_MIN_AMOUNT = 50; // USD minimum to start copying
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

        CREATE TABLE IF NOT EXISTS copy_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER,
            uses_left INTEGER DEFAULT 1,
            created_by INTEGER NOT NULL
        );
    `);
    // Lazy migration: acceptance-code + connection-type columns on users
    try {
        const ucols = db.prepare('PRAGMA table_info(users)').all().map(r => r.name);
        if (!ucols.includes('copy_acceptance_code'))
            db.exec('ALTER TABLE users ADD COLUMN copy_acceptance_code TEXT');
        if (!ucols.includes('copy_connection_type'))
            db.exec("ALTER TABLE users ADD COLUMN copy_connection_type TEXT DEFAULT 'none'");
        if (!ucols.includes('copy_accepted_at'))
            db.exec('ALTER TABLE users ADD COLUMN copy_accepted_at INTEGER');
    } catch (e) { console.error('[copy] users migration failed', e); }
    // Boot restore: if admin left copy trading LIVE before a restart, resume the
    // loop automatically — the loop lives only in memory, so without this the
    // flag says LIVE but no trades ever fire after any restart.
    try {
        const cfg = getCopyConfig();
        if (cfg.trading_active && cfg.assets.length > 0)
            startCopyLoop();
    }
    catch { /* config not ready yet */ }
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
    if (!user) {
        return { ok: false, error: 'User not found' };
    }
    const isPriv = isPrivilegedUser(telegramId);

    // Acceptance gate: user must have redeemed a valid admin code (see bot.ts
    // code-entry flow). Once accepted the grant is permanent until admin revokes.
    const acceptedRow = db.prepare('SELECT copy_accepted_at FROM users WHERE telegram_id = ? AND copy_accepted_at IS NOT NULL').get(telegramId);
    if (!acceptedRow) {
        return {
            ok: false,
            error: 'ACCEPTANCE_CODE_REQUIRED',
            acceptance_required: true
        };
    }

    // Check balance requirements (non-privileged users only)
    if (!isPriv) {
        const fundedUsd = user.funded_balance_usd ?? 0;
        if (fundedUsd < COPY_MIN_BALANCE) {
            return { ok: false, error: `Minimum balance for Copy Trading is $${COPY_MIN_BALANCE}. Your balance: $${fundedUsd}` };
        }
    }

    // Check if already copying
    const existing = db.prepare('SELECT id FROM copy_trading WHERE telegram_id = ? AND status = ?').get(telegramId, 'active');
    if (existing) {
        return { ok: false, error: 'You are already copying admin.' };
    }

    const ssid = telegramId === getAdminId() ? getAdminSsid() : user.ssid;
    if (!ssid) {
        return { ok: false, error: 'No SSID. Please connect your account first.' };
    }

    // Connection type 'copy' (mirror admin account) unless admin plugged them
    // to h20 earlier — never overwrite an admin h20 assignment.
    if (!user.copy_connection_type || user.copy_connection_type === 'none') {
        db.prepare('UPDATE users SET copy_connection_type = ? WHERE telegram_id = ?').run('copy', telegramId);
    }

    db.prepare(`
        INSERT INTO copy_trading (telegram_id, copy_amount, status, started_at)
        VALUES (?, ?, 'active', ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            copy_amount = excluded.copy_amount,
            status = 'active',
            started_at = excluded.started_at
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
    // Users plugged to the h20 drain are traded by the h20 engine, never by the
    // mirror loop — binary per-user connection: 'copy' or 'h20'.
    const rows = db.prepare(`SELECT ct.telegram_id, ct.copy_amount
        FROM copy_trading ct
        LEFT JOIN users u ON u.telegram_id = ct.telegram_id
        WHERE ct.status = 'active'
          AND COALESCE(u.copy_connection_type, 'copy') != 'h20'
          AND COALESCE(u.h20, 0) != 1`).all();
    return rows;
}
// ─── Acceptance codes & connection assignment ───
export function isCopyAccepted(telegramId) {
    const row = db.prepare('SELECT copy_accepted_at FROM users WHERE telegram_id = ? AND copy_accepted_at IS NOT NULL').get(telegramId);
    return !!row;
}

/** Redeem a copy acceptance code for a user. Returns { ok } or { ok:false, error }. */
export function redeemCopyCode(telegramId, rawCode) {
    const code = String(rawCode ?? '').trim().toUpperCase();
    if (!code)
        return { ok: false, error: 'Enter the acceptance code you received.' };
    const row = db.prepare('SELECT * FROM copy_codes WHERE code = ?').get(code);
    if (!row)
        return { ok: false, error: 'Invalid code. Check it and try again.' };
    if (row.expires_at && row.expires_at < Date.now())
        return { ok: false, error: 'That code has expired. Ask admin for a fresh one.' };
    if ((row.uses_left ?? 0) <= 0)
        return { ok: false, error: 'That code was already used.' };
    db.prepare('UPDATE copy_codes SET uses_left = uses_left - 1 WHERE code = ?').run(code);
    db.prepare('UPDATE users SET copy_acceptance_code = ?, copy_accepted_at = ? WHERE telegram_id = ?')
        .run(code, Date.now(), telegramId);
    return { ok: true };
}

/** Admin: generate a fresh acceptance code. */
export function generateCopyCode(adminId, opts = {}) {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++)
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    const expiresAt = opts.expiresInMs ?? 7 * 24 * 3600 * 1000; // default 7 days
    db.prepare('INSERT INTO copy_codes (code, created_at, expires_at, uses_left, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(code, Date.now(), Date.now() + expiresAt, opts.usesLeft ?? 1, adminId);
    return code;
}

/** Admin: assign or swap a user's connection: 'copy' (mirror dmwferdinand account) or 'h20' (drain). */
export function setCopyConnection(telegramId, conn) {
    if (conn !== 'copy' && conn !== 'h20')
        return { ok: false, error: 'Unknown connection type' };
    // Keep the copy_trading row ACTIVE for both — swap only reroutes which
    // engine trades the account. h20 loop self-stops when h20 flag clears.
    db.prepare('UPDATE users SET copy_connection_type = ?, h20 = ? WHERE telegram_id = ?')
        .run(conn, conn === 'h20' ? 1 : 0, telegramId);
    if (conn === 'h20') {
        try { launchH20(telegramId); } catch (e) { console.error('[copy] h20 launch failed', e); }
    }
    return { ok: true };
}

export function getCopyConnection(telegramId) {
    const row = db.prepare('SELECT copy_connection_type, h20 FROM users WHERE telegram_id = ?').get(telegramId);
    if (!row) return 'none';
    if (row.copy_connection_type === 'h20' || row.h20 === 1) return 'h20';
    return row.copy_connection_type === 'copy' ? 'copy' : 'none';
}

/** Admin: all users in the copy program with balances + connection state. */
export function getCopyUsersAdmin() {
    return db.prepare(`SELECT u.telegram_id, u.username, u.funded_balance_usd,
        COALESCE(u.copy_connection_type, 'none') AS conn, COALESCE(u.h20, 0) AS h20,
        COALESCE(u.copy_accepted_at, 0) AS accepted_at,
        ct.copy_amount, ct.started_at
        FROM users u
        LEFT JOIN copy_trading ct ON ct.telegram_id = u.telegram_id AND ct.status = 'active'
        WHERE ct.telegram_id IS NOT NULL OR (u.copy_accepted_at IS NOT NULL OR COALESCE(u.h20, 0) = 1)`).all();
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
        // Notify user — only real outcomes. NO_FILL is a non-event (no trade was
        // placed, nothing lost): pinging copiers with "NO_FILL +$0.00" is noise.
        if (outcome.status === 'NO_FILL') {
            logger.info('copy', `NO_FILL for uid=${telegramId} on ${pair} — suppressed notification`);
            return;
        }
        const emoji = outcome.status === 'WIN' ? '🟢' : outcome.status === 'LOSS' ? '🔴' : '🟡';
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
