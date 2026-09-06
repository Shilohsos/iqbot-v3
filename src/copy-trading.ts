/** @ts-nocheck - reunified from dist */
// Copy Trading — mirror the live dmwferdinand account (compounding strategy).
//
// A user is plugged to exactly ONE of two engines:
//   · 'copy' — every ACTUAL trade the dmwferdinand account places (the Yacht
//     live mirror: base + each recovery round) is replicated on the user's own
//     IQ Option account — same pair, same direction, same timeframe, same
//     moment. The user's stake uses the SAME compounding strategy the account
//     uses: their chosen copy amount calibrates their ratio once (stake =
//     balance × ratio), and recovery rounds double (× 2^round) exactly like the
//     account's ladder.
//   · 'h20'  — the account is traded by the H20 engine instead. Never both.
//
// There is NO independent analysis loop anymore. Copy users trade only when
// the account trades. The global ON/OFF flag in the admin panel gates the
// fan-out (trading_active); h20 is unaffected by it.
import { createSdk, executeTradeWithSdk } from './trade.js';
import { sdkPool } from './sdk-pool.js';
import { getUser, getAdminSsid, db, getConfig } from './db.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';
import { launchH20 } from './h20.js';

export const COPY_MIN_BALANCE = 200; // USD minimum to access feature
export const COPY_MIN_AMOUNT = 1; // platform floor only — user picks ANY amount

/** Broker floor — below this a buy is rejected, so the user's mirror is
 *  skipped rather than erroring (same rule as the account's live mirror). */
const LIVE_MIN_STAKE = 1;
/** Mirror buy+settle budget: 20s headroom + the trade window itself. */
const COPY_MIRROR_TIMEOUT_MS = 20_000;

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
    // Lazy migration: acceptance-code + connection-type + compounding-ratio
    // columns on users.
    try {
        const ucols = db.prepare('PRAGMA table_info(users)').all().map(r => r.name);
        if (!ucols.includes('copy_acceptance_code'))
            db.exec('ALTER TABLE users ADD COLUMN copy_acceptance_code TEXT');
        if (!ucols.includes('copy_connection_type'))
            db.exec("ALTER TABLE users ADD COLUMN copy_connection_type TEXT DEFAULT 'none'");
        if (!ucols.includes('copy_accepted_at'))
            db.exec('ALTER TABLE users ADD COLUMN copy_accepted_at INTEGER');
        if (!ucols.includes('copy_ratio'))
            db.exec('ALTER TABLE users ADD COLUMN copy_ratio REAL');
        // Lazy fix: copiers whose active rows predate the connection-type
        // column still sit at 'none' — the mirror filter requires exactly
        // 'copy', so promote them (h20 assignments are never touched).
        db.exec(`UPDATE users SET copy_connection_type = 'copy'
            WHERE copy_connection_type = 'none'
              AND COALESCE(h20, 0) != 1
              AND EXISTS (SELECT 1 FROM copy_trading ct
                          WHERE ct.telegram_id = users.telegram_id
                            AND ct.status = 'active')`);
    } catch (e) { console.error('[copy] users migration failed', e); }
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
        return { ok: false, error: 'Enter a valid copy amount (at least $1).' };
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
    // ONLY users plugged to 'copy'. h20-assigned accounts are traded by the
    // h20 engine, never by the mirror fan-out.
    const rows = db.prepare(`SELECT ct.telegram_id, ct.copy_amount
        FROM copy_trading ct
        LEFT JOIN users u ON u.telegram_id = ct.telegram_id
        WHERE ct.status = 'active'
          AND u.copy_connection_type = 'copy'
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
    const expiresAt = Date.now() + (opts.expiresInMs ?? 7 * 24 * 3600 * 1000); // default 7 days from now
    db.prepare('INSERT INTO copy_codes (code, created_at, expires_at, uses_left, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(code, Date.now(), expiresAt, opts.usesLeft ?? 1, adminId);
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
    return db.prepare(`SELECT u.telegram_id, u.username, u.currency, u.funded_balance_usd,
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
}

// ─── Mirror fan-out (DIRECTIVE-COPY-MIRROR-COMPOUNDING) ────────────────────
// Called by the Yacht engine at the moment a real trade lands on the
// dmwferdinand account (base + each recovery round). Fire-and-forget from the
// engine's side — this function never throws and never blocks the account's
// own ladder.

/** Serial per-user queue: one in-flight mirror per user at a time. Two
 *  concurrent buys over one WebSocket is the known parallel-buy hang, so a
 *  user's mirrors wait for the previous one to settle. Bounded naturally —
 *  the account's ladder is sequential per setup. */
const userQueues = new Map();

function withTimeout(p, ms, label) {
    return Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`copy mirror ${label} timed out`)), ms)),
    ]);
}

/** Live real-money balance on the user's own account, or null. */
async function userLiveBalance(sdk) {
    try {
        const balances = await withTimeout(sdk.balances(), 10_000, 'balances');
        const list = balances.getBalances();
        const real = list.find(b => String(b.type) === 'real') ?? list.find(b => b.type === undefined);
        if (!real) return null;
        const amount = Number(real.amount);
        return Number.isFinite(amount) ? amount : null;
    } catch (e) {
        logger.warn('copy', `copy user live balance read failed: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

/**
 * The compounding stake for one mirror round on one user's account.
 *
 *  ratio is calibrated ONCE per user — their chosen copy amount divided by
 *  their live balance at the first mirror — then never rewritten, exactly like
 *  the account's FIRST_LIVE_STAKE calibration. Every later round: stake =
 *  balance × ratio × 2^round (round 0 = base, round N = recovery N). */
function userStakeForRound(user, balance, round) {
    let ratio = Number(user.copy_ratio);
    if (!Number.isFinite(ratio) || ratio <= 0) {
        ratio = Number(user.copy_amount) / balance;
        db.prepare('UPDATE users SET copy_ratio = ? WHERE telegram_id = ?').run(ratio, user.telegram_id);
        logger.info('copy', `copy user ${user.telegram_id} calibrated: $${Number(user.copy_amount)} on a $${balance.toFixed(2)} balance → ratio ${(ratio * 100).toFixed(4)}%`);
    }
    const stake = Math.round(balance * ratio * Math.pow(2, round) * 100) / 100;
    return stake;
}

async function mirrorForUser(telegramId, opts) {
    const { pair, direction, timeframeSec, round, setupId, accountStake } = opts;
    const user = getUser(telegramId);
    if (!user) return;
    const ssid = telegramId === getAdminId() ? getAdminSsid() : user.ssid;
    if (!ssid) {
        logger.warn('copy', `copy mirror skipped uid=${telegramId} on ${pair} — no SSID`);
        return;
    }

    let sdk;
    let usedPool = false;
    try {
        try {
            sdk = await withTimeout(sdkPool.get(telegramId, ssid), 15_000, 'pool');
            usedPool = true;
            try { sdkPool.pin(telegramId); } catch { /* */ }
        } catch {
            sdk = await withTimeout(createSdk(ssid), 60_000, 'sdk');
        }

        const balance = await userLiveBalance(sdk);
        if (balance == null || !(balance > 0)) {
            logger.warn('copy', `copy mirror skipped uid=${telegramId} on ${pair} — live balance unavailable (${balance})`);
            return;
        }

        const stake = userStakeForRound(user, balance, round);
        if (!(stake >= LIVE_MIN_STAKE)) {
            logger.warn('copy', `copy mirror skipped uid=${telegramId} on ${pair} — round ${round} stake $${stake.toFixed(2)} below the $${LIVE_MIN_STAKE} broker minimum`);
            return;
        }

        logger.info('copy', `copy mirror uid=${telegramId}: ${pair} ${direction} $${stake.toFixed(2)} (round ${round} of setup ${setupId}; account staked $${accountStake}) tf=${timeframeSec}s`);

        const result = await withTimeout(
            executeTradeWithSdk(sdk, {
                pair,
                direction,
                amount: stake,
                timeframeSec,
                balanceType: 'live',
                telegramId,
            }),
            COPY_MIRROR_TIMEOUT_MS + timeframeSec * 1000,
            `uid=${telegramId} ${pair}`,
        );

        // Only settled outcomes reach the user. NO_FILL / ERROR mean no trade
        // was placed (or it is unconfirmed) — nothing lost, nothing to say.
        if (result.status === 'NO_FILL' || result.status === 'ERROR') {
            logger.info('copy', `copy mirror uid=${telegramId} on ${pair} — ${result.status} (${result.error ?? 'no fill'}), silent`);
            return;
        }
        const emoji = result.status === 'WIN' ? '🟢' : result.status === 'LOSS' ? '🔴' : '🟡';
        const tfLabel = timeframeSec === 30 ? '30s' : timeframeSec === 60 ? '1m' : timeframeSec === 120 ? '2m' : '5m';
        const pnlStr = result.pnl >= 0 ? `+$${Math.abs(result.pnl).toFixed(2)}` : `-$${Math.abs(result.pnl).toFixed(2)}`;
        await notifier?.sendMessage(telegramId, `${emoji} ${pair} (${tfLabel}) — ${result.status} ${pnlStr}`).catch(() => { });
    } catch (err) {
        logger.warn('copy', `copy mirror error uid=${telegramId} on ${pair}: ${err instanceof Error ? err.message : err}`);
    } finally {
        try {
            if (usedPool) {
                try { sdkPool.unpin(telegramId); sdkPool.release(telegramId); } catch { /* */ }
            } else if (sdk) {
                await withTimeout(Promise.resolve(sdk.shutdown()), 10_000, 'shutdown').catch(() => { });
            }
        } catch { /* gone */ }
    }
}

/**
 * Fan out one actual dmwferdinand trade to every plugged copy user.
 * Called by the Yacht live mirror after each settled round (WIN/LOSS/TIE).
 * `round` is the account's ladder round (0 = base, N = recovery N) so each
 * user's compounding stake doubles in lockstep with the account.
 */
export async function mirrorTradeToCopyUsers(opts) {
    const cfg = getCopyConfig();
    if (!cfg.trading_active) return;
    const users = getConnectedCopyUsers();
    if (!users.length) return;
    for (const u of users) {
        const prev = userQueues.get(u.telegram_id) || Promise.resolve();
        const next = prev
            .catch(() => { })
            .then(() => mirrorForUser(u.telegram_id, opts))
            .catch(e => logger.warn('copy', `copy mirror queue error uid=${u.telegram_id}: ${e instanceof Error ? e.message : e}`));
        userQueues.set(u.telegram_id, next);
    }
}
