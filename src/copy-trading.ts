/** @ts-nocheck - reunified from dist */
// Compounding — users compound alongside the live account (engine strategy).
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
import { createSdk, executeTradeWithSdk, runMartingaleCore } from './trade.js';
import { settle, recoverFinal } from './trade-core.js';
import { sdkPool } from './sdk-pool.js';
import { analyzePairWithSdk } from './analysis.js';
import { getProxyUrl } from './proxy.js';
import { ALL_PAIRS } from './access.js';
import { getUser, getAdminSsid, db, getConfig, setConfig } from './db.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';
import { launchH20 } from './h20.js';

export const COPY_MIN_BALANCE = 200; // USD minimum — COMPOUNDING (no gate beyond this)
export const COPY_TRADE_MIN_BALANCE = 500; // USD minimum — COPY TRADING (code + Terms/Sign gate)
export const COPY_MIN_AMOUNT = 1; // platform floor only — user picks ANY amount

/* eslint-disable @typescript-eslint/no-explicit-any */
/** ── Controlled compounding engine (DIRECTIVE-COPY-CONTROLLED-ENGINE, 2026-09-10) ──
 *  Window schedule, Nigeria time (minutes-of-day). Day = mirror all yacht
 *  setups + 10 dummies; night/dawn = random 5 of 10 + 15 dummies. Risk % is
 *  the window figure (judder configurable via jitter). All chains: 3 gales. */
const COPY_WINDOWS_DEFAULT = [
    { label: 'day', start: 360, end: 60, risk: 5, night: false, dummies: 10, jitter: 0 },   // 06:00–01:00
    { label: 'night', start: 60, end: 300, risk: 15, night: true, dummies: 15, jitter: 0 }, // 01:00–05:00
    { label: 'dawn', start: 300, end: 360, risk: 10, night: true, dummies: 15, jitter: 0 }, // 05:00–06:00
];
const COPY_GALE_ROUNDS = 3;
const COPY_SETUPS_PER_SESSION = 10; // must match SETUPS_PER_SESSION in yacht-setup-engine
const COPY_DUMMY_TF = [{ v: 30, w: 60 }, { v: 60, w: 30 }, { v: 300, w: 10 }];
const COPY_FLOW_TOL_FRAC = 0.02;

/** Display confidence draw — SHAPED by window (Master 2026-09-19):
 *  DAY → 50% of fires carry 80–90, 50% carry 90–97.
 *  NIGHT → 70% carry 90–97, 30% carry 80–90. DAWN = night style.
 *  Cosmetic number: the analysis only decides direction; the draw shapes the
 *  story AND the sizing interpolation (member bands + the admin $ stakes). */
export function drawDisplayConfidence(win) {
    const w = win || currentCopyWindow();
    const pHigh = w && w.night ? 0.70 : 0.50;
    if (Math.random() < pHigh) return Math.floor(Math.random() * 8) + 90;  // 90..97
    return Math.floor(Math.random() * 11) + 80;                            // 80..90
}

/** Member stake band (admin-settable per product). Defaults 2–12 until set.
 *  Compounding → comp_band_min/max · Copy Trading → copy_band_min/max. */
export function memberBand(product) {
    const mk = product === 'copy' ? 'copy_band' : 'comp_band';
    const lo = Number(getConfig(mk + '_min'));
    const hi = Number(getConfig(mk + '_max'));
    let min = Number.isFinite(lo) && lo > 0 ? lo : 2;
    let max = Number.isFinite(hi) && hi > lo ? hi : 12;
    min = Math.min(50, Math.max(0.5, min));
    max = Math.min(50, Math.max(min + 0.5, max));
    return { min, max };
}

/** Confidence → risk % inside a band. 81 → min, 97 → max, linear between. */
export function riskFromConfidence(conf, band) {
    const c = Math.min(97, Math.max(80, Number(conf) || 80));
    if (c <= 81) return band.min;
    if (c >= 97) return band.max;
    return band.min + (band.max - band.min) * ((c - 81) / 16);
}

/** Admin account stake — $100–$1,000, interpolated by the display confidence
 *  (81 → $100 … 97 → $1,000). Copy Trading's OWN trades only. */
export function adminStakeFromConfidence(conf) {
    const c = Math.min(97, Math.max(81, Number(conf) || 81));
    return Math.round(100 + (c - 81) * (900 / 16));
}

/** Dummy TF dice — Compounding keeps its old split; Copy Trading (Master
 *  2026-09-19): 30s 60% / 1m,2m,5m share the remaining 40%. */
const COPY_DUMMY_TF_COPY = [{ v: 30, w: 60 }, { v: 60, w: 13.33 }, { v: 120, w: 13.33 }, { v: 300, w: 13.34 }];
function dummyTfDice(product) {
    return product === 'copy' ? COPY_DUMMY_TF_COPY : COPY_DUMMY_TF;
}

export const COPY_TERMS_TEXT = '✦ Copy Trading — Terms\n\n' +
    'The goal is simple: take the account to 5x your starting capital.\n\n' +
    '• Do not withdraw before your account reaches 5x in profit. Withdrawing early violates the rules.\n' +
    '• Reach 5x and you may withdraw — then start again with a small capital.\n' +
    '• Stop at any time with Disconnect. Restart at any time.\n' +
    '• Each Copy Trading code lasts only one month. When it expires, request another code.\n' +
    '• When the admin trades, you trade — same pair, same direction, the same moment.';

const chainBases = new Map();        // setupId:uid -> chain base stake (native)
const setupMirrorDecisions = new Map(); // setupId -> mirror decision (night gate)

/** Broker floor — below this a buy is rejected, so the user's mirror is
 *  skipped rather than erroring (same rule as the account's live mirror). */
const LIVE_MIN_STAKE = 1;
/** NGN/USD anchor — MUST match the UI anchor (copyAmountLabel: ₦ = usd × 500). */
const NGN_USD_ANCHOR = 500;
/** Per-currency stake floors that actually fill (proven live — ₦1,000 NGN
 *  rounds settle; $1 USD fills; below these IQ rejects with 4112). */
const MIN_STAKE_NATIVE = { USD: 1, NGN: 1000 };
/** Mirror buy+settle budget: 20s headroom + the trade window itself. */
const COPY_MIRROR_TIMEOUT_MS = 20_000;
const COPY_ENTRY_DEADLINE_SHORT_MS = 15_000;
const COPY_ENTRY_DEADLINE_LONG_MS = 30_000;
let copySubmissionGuardsReady = false;

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

    // ── Controlled-engine migrations (2026-09-10) ──
    // 2026-09-20: tables are CREATED FIRST, then altered — the old order ran an
    // ALTER on copy_bursts before its CREATE, so a fresh database threw, the
    // catch swallowed the rest of the block and every boot repeated the failure.
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS copy_session_plan (
                session_id INTEGER PRIMARY KEY,
                slots TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS copy_bursts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                total INTEGER NOT NULL,
                done INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                created_at INTEGER NOT NULL,
                product TEXT DEFAULT 'compounding',
                UNIQUE(session_id, telegram_id)
            );
            CREATE TABLE IF NOT EXISTS copy_flows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER NOT NULL,
                detected_at INTEGER NOT NULL,
                delta_native REAL NOT NULL,
                kind TEXT NOT NULL,
                note TEXT
            );
            CREATE TABLE IF NOT EXISTS copy_runs (
                run_id INTEGER PRIMARY KEY,
                pair TEXT NOT NULL,
                direction TEXT NOT NULL,
                tf_sec INTEGER NOT NULL,
                base_stake REAL NOT NULL,
                round INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'open',
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS copy_dispatches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                round INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'queued',
                created_at INTEGER NOT NULL
            );
        `);
    } catch (e) { console.error('[copy] table creation failed', e); }
    try {
        // Product split (2026-09-19): 'compounding' (default) or 'copy'.
        const pcols = db.prepare('PRAGMA table_info(copy_trading)').all().map(r => r.name);
        if (!pcols.includes('product'))
            db.exec("ALTER TABLE copy_trading ADD COLUMN product TEXT DEFAULT 'compounding'");
        const bcols = db.prepare('PRAGMA table_info(copy_bursts)').all().map(r => r.name);
        if (!bcols.includes('product'))
            db.exec("ALTER TABLE copy_bursts ADD COLUMN product TEXT DEFAULT 'compounding'");
        const tcols = db.prepare('PRAGMA table_info(copy_trading)').all().map(r => r.name);
        if (!tcols.includes('signed_at'))
            db.exec('ALTER TABLE copy_trading ADD COLUMN signed_at INTEGER');
        if (!tcols.includes('baseline_native'))
            db.exec('ALTER TABLE copy_trading ADD COLUMN baseline_native REAL');
        if (!tcols.includes('expected_native'))
            db.exec('ALTER TABLE copy_trading ADD COLUMN expected_native REAL');
        if (!tcols.includes('last_accounted_trade_id'))
            db.exec('ALTER TABLE copy_trading ADD COLUMN last_accounted_trade_id INTEGER');
        const ucols2 = db.prepare('PRAGMA table_info(users)').all().map(r => r.name);
        if (!ucols2.includes('copy_signed_at'))
            db.exec('ALTER TABLE users ADD COLUMN copy_signed_at INTEGER');
        if (!ucols2.includes('copy_baseline_native'))
            db.exec('ALTER TABLE users ADD COLUMN copy_baseline_native REAL');
        if (!ucols2.includes('copy_baseline_currency'))
            db.exec('ALTER TABLE users ADD COLUMN copy_baseline_currency TEXT');
    } catch (e) { console.error('[copy] controlled-engine migration failed', e); }
    // Invalidate old mirror work even when a switch is turned off and back on
    // while the queue is blocked. Existing UI setters need no changes.
    copySubmissionGuardsReady = false;
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS copy_submission_versions (
                telegram_id INTEGER PRIMARY KEY,
                version INTEGER NOT NULL DEFAULT 0
            );
            INSERT OR IGNORE INTO copy_submission_versions VALUES (0, 0);
            DROP TRIGGER IF EXISTS copy_guard_config_update;
            CREATE TRIGGER copy_guard_config_update AFTER UPDATE OF value ON config
            WHEN NEW.key IN ('copy_active', 'copy_admin_plugged') AND OLD.value IS NOT NEW.value
            BEGIN UPDATE copy_submission_versions SET version = version + 1 WHERE telegram_id = 0; END;
            DROP TRIGGER IF EXISTS copy_guard_config_insert;
            CREATE TRIGGER copy_guard_config_insert AFTER INSERT ON config
            WHEN NEW.key IN ('copy_active', 'copy_admin_plugged')
            BEGIN UPDATE copy_submission_versions SET version = version + 1 WHERE telegram_id = 0; END;
            DROP TRIGGER IF EXISTS copy_guard_config_delete;
            CREATE TRIGGER copy_guard_config_delete AFTER DELETE ON config
            WHEN OLD.key IN ('copy_active', 'copy_admin_plugged')
            BEGIN UPDATE copy_submission_versions SET version = version + 1 WHERE telegram_id = 0; END;
            DROP TRIGGER IF EXISTS copy_guard_membership_update;
            CREATE TRIGGER copy_guard_membership_update AFTER UPDATE OF status, product, started_at ON copy_trading
            WHEN OLD.status IS NOT NEW.status OR OLD.product IS NOT NEW.product OR OLD.started_at IS NOT NEW.started_at
            BEGIN
                INSERT INTO copy_submission_versions (telegram_id, version)
                    SELECT NEW.telegram_id, 0
                    WHERE NEW.telegram_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM copy_submission_versions WHERE telegram_id = NEW.telegram_id);
                UPDATE copy_submission_versions SET version = version + 1 WHERE telegram_id = NEW.telegram_id;
            END;
            DROP TRIGGER IF EXISTS copy_guard_membership_delete;
            CREATE TRIGGER copy_guard_membership_delete AFTER DELETE ON copy_trading
            BEGIN
                INSERT INTO copy_submission_versions (telegram_id, version)
                    SELECT OLD.telegram_id, 0
                    WHERE OLD.telegram_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM copy_submission_versions WHERE telegram_id = OLD.telegram_id);
                UPDATE copy_submission_versions SET version = version + 1 WHERE telegram_id = OLD.telegram_id;
            END;
            DROP TRIGGER IF EXISTS copy_guard_user_update;
            CREATE TRIGGER copy_guard_user_update AFTER UPDATE OF copy_connection_type, h20, ssid ON users
            WHEN OLD.copy_connection_type IS NOT NEW.copy_connection_type OR OLD.h20 IS NOT NEW.h20 OR OLD.ssid IS NOT NEW.ssid
            BEGIN
                INSERT INTO copy_submission_versions (telegram_id, version)
                    SELECT NEW.telegram_id, 0
                    WHERE NEW.telegram_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM copy_submission_versions WHERE telegram_id = NEW.telegram_id);
                UPDATE copy_submission_versions SET version = version + 1 WHERE telegram_id = NEW.telegram_id;
            END;
        `);
        copySubmissionGuardsReady = true;
        logger.info('copy', 'submission guard migration complete');
    } catch (e) { logger.warn('copy', `submission guard migration failed — mirrors blocked: ${e instanceof Error ? e.message : e}`); }
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
export async function startCopying(telegramId, copyAmount = 0, product = 'compounding') {
    const amt = Number(copyAmount) || 0;
    const prod = product === 'copy' ? 'copy' : 'compounding';
    if (amt > 0 && amt < COPY_MIN_AMOUNT) {
        return { ok: false, error: 'Enter a valid amount (at least $1).' };
    }
    const user = getUser(telegramId);
    if (!user) {
        return { ok: false, error: 'User not found' };
    }
    const isPriv = isPrivilegedUser(telegramId);

    // COPY TRADING keeps the acceptance-code gate (Terms + Sign happen first,
    // see bot.ts). COMPOUNDING has NO gate — balance alone is enough (2026-09-19).
    if (prod === 'copy') {
        const acceptedRow = db.prepare('SELECT copy_accepted_at FROM users WHERE telegram_id = ? AND copy_accepted_at IS NOT NULL').get(telegramId);
        if (!acceptedRow) {
            return { ok: false, error: 'ACCEPTANCE_CODE_REQUIRED', acceptance_required: true };
        }
    }

    // Balance requirement (non-privileged): Compounding $200 (or an active
    // access token, mirroring the UI) · Copy Trading $500.
    if (!isPriv) {
        const fundedUsd = user.funded_balance_usd ?? 0;
        const minBal = prod === 'copy' ? COPY_TRADE_MIN_BALANCE : COPY_MIN_BALANCE;
        if (fundedUsd < minBal && !(prod === 'compounding' && compAccessTokenOk(user))) {
            const label = prod === 'copy' ? 'Copy Trading' : 'Compounding';
            return { ok: false, error: `Minimum balance for ${label} is $${minBal}. Your balance: ${fundedUsd}` };
        }
    }

    // One product per account (UNIQUE telegram_id): switching moves the row.
    const existing = db.prepare('SELECT id, product FROM copy_trading WHERE telegram_id = ? AND status = ?').get(telegramId, 'active');
    if (existing && (existing.product || 'compounding') === prod) {
        return { ok: false, error: prod === 'copy' ? 'You are already copying.' : 'You are already compounding.' };
    }

    // Compounding baseline (the 10x tracker) — snapshot once, funded-anchored.
    if (prod === 'compounding' && !user.copy_baseline_native) {
        try {
            const cur = user.currency || 'USD';
            const funded = Number(user.funded_balance_usd) || 0;
            const baseline = funded > 0 ? (cur === 'NGN' ? funded * NGN_USD_ANCHOR : funded) : 0;
            if (baseline > 0)
                db.prepare('UPDATE users SET copy_baseline_native = ?, copy_baseline_currency = ? WHERE telegram_id = ?').run(baseline, cur, telegramId);
        } catch (e) { /* best-effort */ }
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
        INSERT INTO copy_trading (telegram_id, copy_amount, status, started_at, product)
        VALUES (?, ?, 'active', ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            copy_amount = excluded.copy_amount,
            status = 'active',
            started_at = excluded.started_at,
            product = excluded.product
    `).run(telegramId, amt, Date.now(), prod);
    // 2026-09-20: seed the row's own baseline at enrollment. Its absence made
    // the withdraw probe treat any unexplained outflow as a violation and let
    // the first settlements post onto a zero expected-balance.
    if (prod === 'compounding') {
        try {
            const cur = user.currency || 'USD';
            const funded = Number(user.funded_balance_usd) || 0;
            const baselineNative = funded > 0 ? (cur === 'NGN' ? funded * NGN_USD_ANCHOR : funded) : 0;
            if (baselineNative > 0)
                db.prepare('UPDATE copy_trading SET baseline_native = COALESCE(NULLIF(baseline_native, 0), ?) WHERE telegram_id = ?').run(baselineNative, telegramId);
        } catch (e) { /* best-effort */ }
    }
    logger.info('copy', `User ${telegramId} started ${prod} (controlled engine, amount field=${amt})`);
    return { ok: true };
}
export function stopCopying(telegramId) {
    db.prepare('UPDATE copy_trading SET status = ? WHERE telegram_id = ? AND status = ?')
        .run('stopped', telegramId, 'active');
}
export function getCopyStatus(telegramId, product = 'compounding') {
    const row = db.prepare("SELECT copy_amount, COALESCE(product, 'compounding') AS product FROM copy_trading WHERE telegram_id = ? AND status = ?").get(telegramId, 'active');
    if (!row || (row.product || 'compounding') !== product)
        return { copying: false, amount: 0 };
    return { copying: true, amount: row.copy_amount, product: row.product };
}
export function getConnectedCopyUsers(product = 'compounding') {
    // ONLY users plugged to 'copy'. h20-assigned accounts are traded by the
    // h20 engine, never by the mirror fan-out. Product split (2026-09-19):
    // 'compounding' (yacht-setup mirrors) vs 'copy' (admin-account mirrors).
    const rows = db.prepare(`SELECT ct.telegram_id, ct.copy_amount, COALESCE(ct.product, 'compounding') AS product
        FROM copy_trading ct
        LEFT JOIN users u ON u.telegram_id = ct.telegram_id
        WHERE ct.status = 'active'
          AND COALESCE(ct.product, 'compounding') = ?
          AND u.copy_connection_type = 'copy'
          AND COALESCE(u.h20, 0) != 1`).all(product);
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
    const expiresAt = Date.now() + (opts.expiresInMs ?? 30 * 24 * 3600 * 1000); // default 30 days from now
    db.prepare('INSERT INTO copy_codes (code, created_at, expires_at, uses_left, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(code, Date.now(), expiresAt, opts.usesLeft ?? 1, adminId);
    return code;
}

/** Admin: assign or swap a user's connection: 'copy' (mirror dmwferdinand account) or 'h20' (position system). */
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

/** Admin: fully disconnect a user from the copy program (silent — no user DM).
 *  Stops the copying row and clears connection + access, so a fresh code is
 *  required to rejoin. */
export function disconnectCopyUser(telegramId) {
    try {
        stopCopying(telegramId);
        db.prepare('UPDATE users SET copy_connection_type = ?, h20 = 0, copy_accepted_at = NULL, copy_signed_at = NULL WHERE telegram_id = ?')
            .run('none', telegramId);
        logger.info('copy', `admin disconnect uid=${telegramId} — stopped, connection cleared`);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
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

/** Live real-money balance on the user's own account, or null.
 *  Returns { cash, bonus, usable } — usable = cash + bonus, because IQ Option
 *  lets buys run on the bonus balance (verified live 2026-09-09: $1 buy filled
 *  on a $0-cash / $298-bonus account). */
async function userLiveBalance(sdk) {
    try {
        const balances = await withTimeout(sdk.balances(), 10_000, 'balances');
        const list = balances.getBalances();
        const real = list.find(b => String(b.type) === 'real') ?? list.find(b => b.type === undefined);
        if (!real) return null;
        const cash = Number(real.amount);
        const bonus = Number(real.bonusAmount ?? real.bonus ?? 0);
        if (!Number.isFinite(cash) || !Number.isFinite(bonus)) return null;
        return { cash, bonus, usable: cash + bonus };
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
function userStakeForRound(user, balance, round, calibration) {
    let ratio = Number(user.copy_ratio);
    if (!Number.isFinite(ratio) || ratio <= 0) {
        ratio = calibration / balance;
        db.prepare('UPDATE users SET copy_ratio = ? WHERE telegram_id = ?').run(ratio, user.telegram_id);
        logger.info('copy', `copy user ${user.telegram_id} calibrated: $${calibration} on a $${balance.toFixed(2)} balance → ratio ${(ratio * 100).toFixed(4)}%`);
    }
    const stake = Math.round(balance * ratio * Math.pow(2, round) * 100) / 100;
    return stake;
}

/** Execution-time access rule per product. Compounding: the active row +
 *  connection (checked below) are the whole gate — no code, no sign. Copy
 *  Trading: keeps the signed code gate. */
function mirrorAccessOk(telegramId, product) {
    if (product === 'copy') return isCopyAccessLive(telegramId);
    return true;
}

function compAccessTokenOk(user) {
    // Compounding accepts an active access token in place of the $200 balance —
    // UI parity (2026-09-20). Mirrors bot.ts hasCompoundingToken().
    if (!user)
        return false;
    try {
        const u = user as Record<string, unknown>;
        const lvl = u.access_level;
        if (lvl && lvl !== 'signals') {
            const exp = u.access_expires_at ? Date.parse(String(u.access_expires_at)) : NaN;
            if (!Number.isFinite(exp) || exp > Date.now())
                return true;
        }
        if (u.promo_product && u.promo_access_until && Date.parse(String(u.promo_access_until)) > Date.now())
            return true;
    } catch (e) { /* */ }
    return false;
}

function copySubmissionVersion(telegramId) {
    if (!copySubmissionGuardsReady) return null;
    try {
        const global = db.prepare('SELECT version FROM copy_submission_versions WHERE telegram_id = 0').get();
        if (!global) return null;
        const user = db.prepare('SELECT version FROM copy_submission_versions WHERE telegram_id = ?').get(telegramId);
        return `${global.version}:${user?.version ?? 0}`;
    } catch { return null; }
}

function copyMirrorCanSubmit(telegramId, opts) {
    // 2026-09-20: the full submission guard covers BOTH products — state version,
    // engine switches, route/connection, live access and the entry deadline —
    // rechecked at queue entry AND again immediately before every buy/retry.
    const prod = opts?.product === 'copy' ? 'copy' : 'compounding';
    const version = copySubmissionVersion(telegramId);
    if (!version || version !== opts.submissionVersion) {
        logger.info('copy', `mirror skipped uid=${telegramId} run=${opts.runId ?? opts.setupId} round=${opts.round} — state changed`);
        return false;
    }
    if (getConfig('copy_active') !== '1') {
        logger.info('copy', `mirror skipped uid=${telegramId} run=${opts.runId ?? opts.setupId} round=${opts.round} — engine off`);
        return false;
    }
    if (prod === 'copy' && getConfig('copy_admin_plugged') !== '1') {
        logger.info('copy', `mirror skipped uid=${telegramId} run=${opts.runId ?? opts.setupId} round=${opts.round} — admin unplugged`);
        return false;
    }
    const row = db.prepare(`SELECT ct.product, u.copy_connection_type, u.h20 FROM copy_trading ct
        JOIN users u ON u.telegram_id = ct.telegram_id WHERE ct.telegram_id = ? AND ct.status = 'active'`).get(telegramId);
    if (!row || (row.product || 'compounding') !== prod || row.copy_connection_type !== 'copy' || row.h20 === 1) {
        logger.info('copy', `mirror skipped uid=${telegramId} run=${opts.runId ?? opts.setupId} round=${opts.round} — connection or route changed`);
        return false;
    }
    if (prod === 'copy' && !isCopyAccessLive(telegramId)) {
        logger.info('copy', `mirror skipped uid=${telegramId} run=${opts.runId ?? opts.setupId} round=${opts.round} — access not live`);
        return false;
    }
    if (!Number.isFinite(opts.entryDeadline) || Date.now() > opts.entryDeadline) {
        const late = Number.isFinite(opts.entryDeadline) ? Math.max(0, (Date.now() - opts.entryDeadline) / 1000).toFixed(1) : 'unknown';
        logger.info('copy', `stale mirror skipped (${late}s late) uid=${telegramId} run=${opts.runId ?? opts.setupId} round=${opts.round}`);
        return false;
    }
    return true;
}

async function mirrorForUser(telegramId, copyAmount, opts) {
    const { pair, direction, timeframeSec, round, setupId, accountStake } = opts;
    const user = getUser(telegramId);
    if (!user) return;
    const ssid = telegramId === getAdminId() ? getAdminSsid() : user.ssid;
    if (!ssid) {
        logger.warn('copy', `copy mirror skipped uid=${telegramId} on ${pair} — no SSID`);
        return;
    }
    const prod = opts?.product === 'copy' ? 'copy' : 'compounding';
    if (!copyMirrorCanSubmit(telegramId, opts)) {
        if (prod === 'copy' && opts.runId != null) markDispatch(opts.runId, telegramId, opts.round ?? 0, 'skipped');
        return;
    }
    if (!mirrorAccessOk(telegramId, prod)) {
        logger.warn('copy', `copy mirror skipped uid=${telegramId} on ${pair} — access not live (${prod}: unsigned or code expired)`);
        return;
    }
    if (!isCopyConnectionActive(telegramId)) {
        logger.info('copy', `copy mirror skipped uid=${telegramId} on ${pair} — disconnected since dispatch`);
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

        const bal = await userLiveBalance(sdk);
        if (!bal || !(bal.usable > 0)) {
            logger.warn('copy', `copy mirror skipped uid=${telegramId} on ${pair} — live balance unavailable (${bal ? bal.usable : null})`);
            return;
        }
        const balance = bal.usable;
        if (bal.bonus > 0) {
            logger.info('copy', `copy mirror uid=${telegramId} — trading on $${bal.bonus.toFixed(2)} bonus (cash $${bal.cash.toFixed(2)})`);
        }

        const isNGN = user.currency === 'NGN';
        // Member stake band (admin-settable per product; Master 2026-09-19):
        // confidence picks the spot inside [min,max] — Compounding and Copy
        // Trading each use their own band. Base snapshots at the chain's first
        // round; the ladder doubles from it (3 gales). Fallback: window figure.
        const conf = Number(opts?.confidence);
        const riskPct = conf >= 80
            ? riskFromConfidence(conf, memberBand(prod))
            : (Number(opts?.winRisk) > 0 ? Number(opts.winRisk) : currentCopyWindow().risk);
        const chainKey = 'y' + (setupId ?? 'chain') + ':' + telegramId;
        let chainBase = chainBases.get(chainKey);
        if (!Number.isFinite(chainBase) || chainBase <= 0) {
            chainBase = Math.round(balance * (riskPct / 100) * 100) / 100;
            if (chainBases.size > 500) chainBases.clear();
            chainBases.set(chainKey, chainBase);
            logger.info('copy', `chain base uid=${telegramId} [${prod}] setup=${setupId ?? '-'} — conf ${conf >= 80 ? conf + '%' : 'n/a'} → risk ${riskPct.toFixed(2)}% of ${isNGN ? '₦' : '$'}${balance.toFixed(2)} → ${isNGN ? '₦' : '$'}${chainBase.toFixed(2)}`);
        }
        let stake = Math.round(chainBase * Math.pow(2, round) * 100) / 100;
        const floor = MIN_STAKE_NATIVE[isNGN ? 'NGN' : 'USD'] ?? LIVE_MIN_STAKE;
        // Keep a 10% margin of usable balance — deep recovery rounds must never
        // exceed what IQ accepts on a cash- or bonus-backed account. The margin
        // applies BEFORE the floor check: a stake capped below the floor (dust
        // account) skips cleanly instead of attempting an unfillable amount.
        const usableCap = Math.round(bal.usable * 0.9 * 100) / 100;
        if (stake > usableCap) stake = usableCap;
        if (!(stake >= floor)) {
            logger.warn('copy', `copy mirror skipped uid=${telegramId} on ${pair} — round ${round} stake ${isNGN ? '₦' : '$'}${stake.toFixed(2)} below the ${isNGN ? '₦' : '$'}${floor} fill floor`);
            return;
        }

        logger.info('copy', `copy mirror uid=${telegramId}: ${pair} ${direction} ${isNGN ? '₦' : '$'}${stake.toFixed(2)} (round ${round} of setup ${setupId}; account staked $${accountStake}) tf=${timeframeSec}s`);

        const order = {
            pair,
            direction,
            amount: stake,
            timeframeSec,
            balanceType: 'live' as const,
            telegramId,
        };
        // 2026-09-20: BOTH products stay on the queue until TradeCore finishes
        // tracking (the old Promise.race released the SDK while a buy could still
        // submit), and both revalidate state + affordability immediately before
        // the broker buy.
        if (prod === 'copy' && opts.runId != null) markDispatch(opts.runId, telegramId, opts.round ?? 0, 'submitted');
        const result = await settle(sdk, {
            ...order,
            beforeSubmit: (availableBalance: number) => {
                if (!copyMirrorCanSubmit(telegramId, opts)) return false;
                const cap = Math.round(availableBalance * 0.9 * 100) / 100;
                if (!(stake <= cap)) {
                    logger.info('copy', `mirror skipped uid=${telegramId} run=${opts.runId ?? opts.setupId} round=${opts.round} — stake ${stake.toFixed(2)} above usable ${cap.toFixed(2)}`);
                    return false;
                }
                return true;
            },
        });

        // Only settled outcomes reach the user. NO_FILL / ERROR mean no trade
        // was placed (or it is unconfirmed) — nothing lost, nothing to say.
        if (String(result.status) === 'NO_FILL' || String(result.status) === 'ERROR') {
            logger.info('copy', `copy mirror uid=${telegramId} on ${pair} — ${result.status} (${result.error ?? 'no fill'}), silent`);
            return;
        }
        // Silent by design (controlled engine): copiers get no per-trade
        // messages. Settled rounds feed the expected-balance tracker instead.
        adjustExpected(telegramId, mirrorNet(result, stake), result.tradeId);
        if (prod === 'copy' && opts.runId != null) markDispatch(opts.runId, telegramId, opts.round ?? 0, 'settled');
        // Compounding: a settled WIN/TIE closes the member's chain → drop the base.
        // Copy Trading: the ADMIN decides when the chain ends — keep the base so
        // every mirror round stays base×2^round across the admin's whole run.
        if (prod !== 'copy' && (result.status === 'WIN' || result.status === 'TIE')) chainBases.delete(chainKey);
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
 * Fan out one actual yacht-club trade to every plugged copy user.
 * Called by the Yacht live mirror after each settled round (WIN/LOSS/TIE).
 * Controlled engine (2026-09-10): night windows mirror only the randomly
 * chosen 5 of the session's setups; stakes run the window-risk compounding
 * ladder; copiers are never notified per trade.
 */
export async function mirrorTradeToCopyUsers(opts) {
    const prod = opts?.product === 'copy' ? 'copy' : 'compounding';
    if (prod === 'copy') {
        // Admin recovery may finish after unplug, but no new follower order may.
        if (getConfig('copy_active') !== '1') return;
        if (getConfig('copy_admin_plugged') !== '1') return;
    } else {
        const cfg = getCopyConfig();
        if (!cfg.trading_active) return;
    }
    const win = currentCopyWindow();
    // Night gate (random 5-of-10) is a yacht-session concept — compounding only.
    if (prod === 'compounding' && win.night && opts && opts.setupId != null) {
        let decision = setupMirrorDecisions.get(opts.setupId);
        if (decision === undefined) {
            const pos = setupSlot(opts.setupId);
            if (!pos) decision = true;
            else {
                const plan = getOrCreateSessionPlan(pos.sessionId);
                decision = plan ? plan.has(pos.slot) : true;
                logger.info('copy', `night gate setup ${opts.setupId} (session #${pos.sessionId} slot ${pos.slot}) → ${decision ? 'mirrored' : 'skipped'}`);
            }
            if (setupMirrorDecisions.size > 400) setupMirrorDecisions.clear();
            setupMirrorDecisions.set(opts.setupId, decision);
        }
        if (!decision) return;
    }
    const users = getConnectedCopyUsers(prod);
    if (!users.length) return;
    const entryAt = Number(opts?.entryAt);
    // 2026-09-20: deadlines + submission versions apply to BOTH products now.
    const entryDeadline = Number.isFinite(entryAt)
        ? entryAt + (opts.timeframeSec <= 60 ? COPY_ENTRY_DEADLINE_SHORT_MS : COPY_ENTRY_DEADLINE_LONG_MS)
        : NaN;
    for (const u of users) {
        const submissionVersion = copySubmissionVersion(u.telegram_id);
        if (prod === 'copy' && opts.runId != null) {
            try { db.prepare('INSERT INTO copy_dispatches (run_id, telegram_id, round, status, created_at) VALUES (?, ?, ?, ?, ?)').run(opts.runId, u.telegram_id, opts.round ?? 0, 'queued', Date.now()); } catch (e) { /* best-effort */ }
        }
        const prev = userQueues.get(u.telegram_id) || Promise.resolve();
        const next = prev
            .catch(() => { })
            .then(() => mirrorForUser(u.telegram_id, u.copy_amount, Object.assign({}, opts, { product: prod, winRisk: win.risk, winJitter: win.jitter, entryDeadline, submissionVersion })))
            .catch(e => logger.warn('copy', `copy mirror queue error uid=${u.telegram_id}: ${e instanceof Error ? e.message : e}`));
        userQueues.set(u.telegram_id, next);
    }
}

// ═══ Controlled engine (DIRECTIVE-COPY-CONTROLLED-ENGINE, 2026-09-10) ═══════
// Windows · night plan · dummy bursts · expected-balance withdrawal detection ·
// sign/expiry access flow · engine ticker.

/* eslint-disable @typescript-eslint/no-explicit-any */

function sleepCopy(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

/** Configured windows (config key copy_windows_json) or the locked defaults. */
function getCopyWindows() {
    try {
        const raw = getConfig('copy_windows_json');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) {
                return parsed.map(function (w) {
                    return {
                        label: String(w.label || 'window'),
                        start: Number(w.start) || 0,
                        end: Number(w.end) || 0,
                        risk: Number(w.risk) || 5,
                        night: !!w.night,
                        dummies: Number(w.dummies) || 10,
                        jitter: Number(w.jitter) || 0,
                    };
                });
            }
        }
    } catch (e) { /* defaults below */ }
    return COPY_WINDOWS_DEFAULT;
}

/** The window that covers `date` in Nigeria time (Africa/Lagos). */
export function currentCopyWindow(date) {
    const d = date instanceof Date ? date : new Date();
    let mins = 0;
    try {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
        const h = Number((parts.find(function (x) { return x.type === 'hour'; }) || {}).value || 0);
        const m = Number((parts.find(function (x) { return x.type === 'minute'; }) || {}).value || 0);
        mins = (h % 24) * 60 + m;
    } catch (e) {
        mins = ((d.getUTCHours() + 1) % 24) * 60 + d.getUTCMinutes();
    }
    const windows = getCopyWindows();
    for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        const hit = w.start < w.end ? (mins >= w.start && mins < w.end) : (mins >= w.start || mins < w.end);
        if (hit) return w;
    }
    return windows[0];
}

function rollRiskFrac(win) {
    const pct = Number(win && win.risk) > 0 ? Number(win.risk) : 5;
    const jitter = Number(win && win.jitter) || 0;
    return (pct + Math.random() * jitter) / 100;
}

/** Session slot (1-based position) of a setup row, or null when unknown. */
function setupSlot(setupId) {
    try {
        const s = db.prepare('SELECT session_id FROM yacht_setups WHERE id = ?').get(setupId);
        if (!s || s.session_id == null) return null;
        const pos = db.prepare('SELECT COUNT(*) AS n FROM yacht_setups WHERE session_id = ? AND id <= ?').get(s.session_id, setupId);
        return { sessionId: s.session_id, slot: Number(pos && pos.n) || 1 };
    } catch (e) { return null; }
}

/** Night plan: pick 5 random slots of the session ONCE; persisted per session. */
function getOrCreateSessionPlan(sessionId) {
    try {
        const row = db.prepare('SELECT slots FROM copy_session_plan WHERE session_id = ?').get(sessionId);
        if (row && row.slots) return new Set(JSON.parse(row.slots));
        const pool = [];
        for (let i = 1; i <= COPY_SETUPS_PER_SESSION; i++) pool.push(i);
        const slots = [];
        for (let i = 0; i < 5 && pool.length; i++) slots.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        db.prepare('INSERT OR REPLACE INTO copy_session_plan (session_id, slots, created_at) VALUES (?, ?, ?)').run(sessionId, JSON.stringify(slots), Date.now());
        logger.info('copy', `night plan session #${sessionId}: mirroring slots ${slots.join(', ')} of ${COPY_SETUPS_PER_SESSION}`);
        return new Set(slots);
    } catch (e) {
        logger.warn('copy', `session plan failed: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

/** Net delta of a settled mirror round. Tolerates gross-or-net pnl shapes:
 *  at OTC payouts a NET win is always below the stake, a GROSS win is not. */
function mirrorNet(result, stake) {
    const pnl = Number(result && result.pnl) || 0;
    if (!result) return 0;
    if (result.status === 'WIN') return pnl > stake ? pnl - stake : pnl;
    if (result.status === 'LOSS') return -stake;
    return 0;
}

/** Expected-balance tracker: every settled controlled trade moves it. */
function adjustExpected(telegramId, netDelta, tradeId = 0) {
    try {
        const d = Number(netDelta) || 0;
        if (!d) return;
        db.prepare('UPDATE copy_trading SET expected_native = COALESCE(expected_native, 0) + ? WHERE telegram_id = ? AND status = ?').run(d, telegramId, 'active');
        // Exactly-once accounting (2026-09-20): remember the newest settlement
        // folded into expected_native so the withdraw probe never subtracts the
        // same losses twice.
        if (tradeId) {
            const row = db.prepare('SELECT id FROM trades WHERE trade_id = ? AND telegram_id = ? ORDER BY id DESC LIMIT 1').get(tradeId, telegramId);
            if (row && Number.isFinite(Number(row.id)))
                db.prepare('UPDATE copy_trading SET last_accounted_trade_id = MAX(COALESCE(last_accounted_trade_id, 0), ?) WHERE telegram_id = ?').run(Number(row.id), telegramId);
        }
    } catch (e) { /* best-effort */ }
}

/** Best-effort dispatch ledger updates (informational; boot reconciliation
 *  works from copy_runs + trades, never from these rows). */
function markDispatch(runId, telegramId, round, statusText) {
    try {
        db.prepare(`UPDATE copy_dispatches SET status = ? WHERE id = (
            SELECT id FROM copy_dispatches WHERE run_id = ? AND telegram_id = ? AND round = ? ORDER BY id DESC LIMIT 1
        )`).run(statusText, runId, telegramId, round);
    } catch (e) { /* best-effort */ }
}

function weightedPick(items) {
    let total = 0;
    for (let i = 0; i < items.length; i++) total += items[i].w;
    let roll = Math.random() * total;
    for (let i = 0; i < items.length; i++) { roll -= items[i].w; if (roll <= 0) return items[i].v; }
    return items[0].v;
}

/**
 * Worst-3 assets, data-driven: rank yacht-club trades (telegram_id = 0) from
 * the last 2h by FULL-GALE losses (exhausted chains: >= 4 rounds, all LOSS).
 * Falls back to per-pair loss counts, then to the hard-pairs pool.
 */
export function worstAssetsLast2h() {
    try {
        // The yacht engine does not stamp martingale_run on its rows, so the
        // chains are RECONSTRUCTED: within a pair, doubling amounts continue a
        // chain; a reset (or pair change) starts a new one. A full gale loss =
        // a chain of >= 4 rounds with every round LOSS.
        const rows = db.prepare(`
            SELECT pair, amount, status
            FROM trades
            WHERE telegram_id = 0
              AND julianday(created_at) >= julianday('now', '-2 hours')
            ORDER BY id ASC
        `).all();
        const full = new Map();
        const part = new Map();
        let cur = null;
        function closeChain() {
            if (!cur) return;
            if (cur.len >= 4 && cur.allLoss) full.set(cur.pair, (full.get(cur.pair) || 0) + 1);
            cur = null;
        }
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const amt = Number(r.amount) || 0;
            const loss = r.status === 'LOSS';
            if (loss) part.set(r.pair, (part.get(r.pair) || 0) + 1);
            const continues = cur && cur.pair === r.pair &&
                (Math.abs(amt - cur.lastAmount * 2) < 0.01 || Math.abs(amt - cur.lastAmount) < 0.01);
            if (continues) {
                cur.lastAmount = amt;
                cur.len += 1;
                cur.allLoss = cur.allLoss && loss;
            } else {
                closeChain();
                cur = { pair: r.pair, lastAmount: amt, len: 1, allLoss: loss };
            }
        }
        closeChain();
        function rank(m) {
            return Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (e) { return e[0]; });
        }
        const list = rank(full);
        const partial = rank(part);
        for (let i = 0; i < partial.length; i++) if (list.length < 3 && list.indexOf(partial[i]) === -1) list.push(partial[i]);
        const FALLBACK = ['EURJPY-OTC', 'GBPJPY-OTC', 'USDCHF-OTC', 'EURGBP-OTC', 'AUDUSD-OTC', 'USDCAD-OTC'];
        for (let i = 0; i < FALLBACK.length; i++) if (list.length < 3 && list.indexOf(FALLBACK[i]) === -1) list.push(FALLBACK[i]);
        return list.slice(0, 3);
    } catch (e) {
        logger.warn('copy', `worst-asset query failed: ${e instanceof Error ? e.message : e}`);
        return ['EURJPY-OTC', 'GBPJPY-OTC', 'USDCHF-OTC'];
    }
}

/** Access is live only when signed AND the redeemed code has not expired. */
export function isCopyAccessLive(telegramId) {
    try {
        const u = db.prepare('SELECT copy_signed_at, copy_acceptance_code, copy_accepted_at FROM users WHERE telegram_id = ?').get(telegramId);
        if (!u || !u.copy_signed_at || !u.copy_accepted_at) return false;
        if (u.copy_acceptance_code) {
            const c = db.prepare('SELECT expires_at FROM copy_codes WHERE code = ?').get(u.copy_acceptance_code);
            if (c && c.expires_at && c.expires_at < Date.now()) return false;
        }
        return true;
    } catch (e) { return false; }
}

/** The user's CURRENT connection. Disconnect (user or admin) flips the
 *  copying row to 'stopped' while the signed/accepted flags stay put — so
 *  anything already dispatched (a queued mirror, an in-progress dummy burst)
 *  must re-check this before placing another trade. Access alone is not
 *  enough: Master 2026-09-17 — Shara disconnected and her queued burst kept
 *  trading. */
export function isCopyConnectionActive(telegramId) {
    try {
        const row = db.prepare("SELECT id FROM copy_trading WHERE telegram_id = ? AND status = 'active'").get(telegramId);
        return !!row;
    } catch (e) { return false; }
}

/** UI state for the access flow. */
export function copyAccessState(telegramId) {
    try {
        const u = db.prepare('SELECT copy_accepted_at, copy_signed_at, copy_acceptance_code, copy_baseline_native FROM users WHERE telegram_id = ?').get(telegramId);
        const ct = db.prepare("SELECT status, baseline_native, expected_native, COALESCE(product, 'compounding') AS product FROM copy_trading WHERE telegram_id = ?").get(telegramId);
        let expired = false;
        let codeExpiresAt = null;
        if (u && u.copy_acceptance_code) {
            const c = db.prepare('SELECT expires_at FROM copy_codes WHERE code = ?').get(u.copy_acceptance_code);
            codeExpiresAt = (c && c.expires_at) || null;
            expired = !!(codeExpiresAt && codeExpiresAt < Date.now());
        }
        const baseline = (ct && ct.baseline_native) || (u && u.copy_baseline_native) || null;
        const prod = (ct && ct.product) || 'compounding';
        const mult = prod === 'copy' ? 5 : 10;
        return {
            accepted: !!(u && u.copy_accepted_at),
            signed: !!(u && u.copy_signed_at),
            expired: expired,
            codeExpiresAt: codeExpiresAt,
            copying: !!(ct && ct.status === 'active'),
            product: prod,
            baseline: baseline,
            target: baseline ? baseline * mult : null,
            target10x: baseline ? baseline * mult : null,
        };
    } catch (e) {
        return { accepted: false, signed: false, expired: false, codeExpiresAt: null, copying: false, baseline: null, target10x: null };
    }
}

/**
 * Terms signed → access granted. Snapshots the baseline (live read with a
 * funded fallback) — the 10x tracker — and activates the copying row.
 */
export async function signCopyAccess(telegramId) {
    const user = getUser(telegramId);
    if (!user) return { ok: false, error: 'User not found' };
    if (!user.copy_accepted_at || !user.copy_acceptance_code)
        return { ok: false, error: 'Enter your access code first.' };
    const crow = db.prepare('SELECT expires_at FROM copy_codes WHERE code = ?').get(user.copy_acceptance_code);
    if (crow && crow.expires_at && crow.expires_at < Date.now())
        return { ok: false, expired: true, error: 'Your code has expired. Request a new one.' };
    if (user.copy_signed_at) {
        const started = await startCopying(telegramId, 0, 'copy');
        return started.ok ? { ok: true, already: true } : started;
    }
    let baseline = null;
    const cur = user.currency || 'USD';
    try {
        const ssid = telegramId === getAdminId() ? getAdminSsid() : user.ssid;
        if (ssid) {
            let sdk = null;
            let usedPool = false;
            try {
                sdk = await withTimeout(sdkPool.get(telegramId, ssid), 15_000, 'pool');
                usedPool = true;
                try { sdkPool.pin(telegramId); } catch (e) { /* */ }
                const bal = await userLiveBalance(sdk);
                if (bal && bal.usable > 0) baseline = bal.usable;
            } catch (e) { /* fallback below */ }
            finally {
                try {
                    if (usedPool) { try { sdkPool.unpin(telegramId); sdkPool.release(telegramId); } catch (e) { /* */ } }
                    else if (sdk) { await withTimeout(Promise.resolve(sdk.shutdown()), 10_000, 'shutdown').catch(function () { }); }
                } catch (e) { /* */ }
            }
        }
    } catch (e) { /* fallback below */ }
    if (baseline == null) {
        const funded = Number(user.funded_balance_usd) || 0;
        baseline = funded > 0 ? (cur === 'NGN' ? funded * NGN_USD_ANCHOR : funded) : 0;
    }
    const now = Date.now();
    db.prepare('UPDATE users SET copy_signed_at = ?, copy_baseline_native = ?, copy_baseline_currency = ? WHERE telegram_id = ?')
        .run(now, baseline, cur, telegramId);
    const started = await startCopying(telegramId, 0, 'copy');
    if (!started.ok) return started;
    db.prepare(`UPDATE copy_trading SET signed_at = ?, baseline_native = COALESCE(baseline_native, ?), expected_native = COALESCE(expected_native, ?) WHERE telegram_id = ?`)
        .run(now, baseline, baseline, telegramId);
    logger.info('copy', `uid=${telegramId} signed terms — baseline ${baseline} ${cur} (5x target ${baseline * 5})`);
    return { ok: true, baseline: baseline, currency: cur };
}

/** Disconnect + clear the sign/acceptance so a fresh code is required. */
export function revokeCopyAccess(telegramId, reason) {
    try {
        stopCopying(telegramId);
        db.prepare('UPDATE users SET copy_accepted_at = NULL, copy_signed_at = NULL WHERE telegram_id = ?').run(telegramId);
        logger.warn('copy', `access revoked uid=${telegramId} (${reason})`);
        let plabel = 'Compounding';
        try {
            const prow = db.prepare("SELECT COALESCE(product, 'compounding') AS p FROM copy_trading WHERE telegram_id = ?").get(telegramId);
            if (prow && prow.p === 'copy') plabel = 'Copy Trading';
        } catch (e) { /* */ }
        notifyAdminCopy('◆ ' + plabel + ' — access revoked\nuid ' + telegramId + '\nreason: ' + reason);
        if (reason === 'code-expired') sendToUserCopy(telegramId, '✦ Your ' + plabel + ' code has expired. Request a new code to continue.');
        else if (reason === 'early-withdrawal') sendToUserCopy(telegramId, '✦ Your ' + plabel + ' access was disconnected.');
    } catch (e) {
        logger.warn('copy', `revoke failed uid=${telegramId}: ${e instanceof Error ? e.message : e}`);
    }
}

function notifyAdminCopy(text) {
    try {
        const admin = getAdminId();
        if (notifier && notifier.telegram && notifier.telegram.sendMessage) { void notifier.telegram.sendMessage(admin, text).catch(function () { }); }
        else if (notifier && typeof notifier.sendMessage === 'function') { void Promise.resolve(notifier.sendMessage(admin, text)).catch(function () { }); }
    } catch (e) { /* */ }
}

function sendToUserCopy(uid, text) {
    try {
        if (notifier && typeof notifier.sendMessage === 'function') { void Promise.resolve(notifier.sendMessage(uid, text)).catch(function () { }); }
        else if (notifier && notifier.telegram && notifier.telegram.sendMessage) { void notifier.telegram.sendMessage(uid, text).catch(function () { }); }
    } catch (e) { /* */ }
}

// ─── Dummy bursts ────────────────────────────────────────────────────────────

/** Called by the yacht engine right after a session closes. */
export function copySessionClosed(sessionId, product) {
    try {
        const win = currentCopyWindow();
        // COMPOUNDING only — no code/sign gate; the active row is the membership.
        const users = getConnectedCopyUsers('compounding');
        if (!users.length) return;
        const total = win.dummies;
        for (let i = 0; i < users.length; i++) {
            db.prepare("INSERT OR IGNORE INTO copy_bursts (session_id, telegram_id, total, done, status, created_at, product) VALUES (?, ?, ?, 0, 'pending', ?, 'compounding')")
                .run(sessionId, users[i].telegram_id, total, Date.now());
        }
        logger.info('copy', `session #${sessionId} (${product || '?'}) closed — dummy bursts queued: ${total} × ${users.length} copiers (window ${win.label})`);
    } catch (e) {
        logger.warn('copy', `session-close burst queue failed: ${e instanceof Error ? e.message : e}`);
    }
}

async function processPendingBursts() {
    try {
        // Stale 'running' rows (process died mid-burst) go back to pending.
        db.prepare("UPDATE copy_bursts SET status = 'pending' WHERE status = 'running' AND created_at < ?").run(Date.now() - 3 * 3600 * 1000);
        const rows = db.prepare("SELECT * FROM copy_bursts WHERE status = 'pending' ORDER BY id LIMIT 12").all();
        for (let i = 0; i < rows.length; i++) {
            const b = rows[i];
            const uid = b.telegram_id;
            const prev = userQueues.get(uid) || Promise.resolve();
            const next = prev.catch(function () { }).then(function () { return runBurst(b); })
                .catch(function (e) { logger.warn('copy', `burst uid=${uid} error: ${e instanceof Error ? e.message : e}`); });
            userQueues.set(uid, next);
        }
    } catch (e) { logger.warn('copy', `burst sweep failed: ${e instanceof Error ? e.message : e}`); }
}

async function runBurst(b) {
    const claim = db.prepare("UPDATE copy_bursts SET status = 'running' WHERE id = ? AND status = 'pending'").run(b.id);
    if (!claim.changes) return;
    const prod = b.product === 'copy' ? 'copy' : 'compounding';
    let done = Number(b.done) || 0;
    const total = Number(b.total) || 0;
    logger.info('copy', `burst start uid=${b.telegram_id} [${prod}] session #${b.session_id} — ${done}/${total}`);
    while (done < total) {
        // Copy Trading spec: dummies are the UNPLUGGED fallback — a burst pauses
        // (stays pending) while the admin is plugged, resumes when unplugged.
        const engineOn = prod === 'copy'
            ? (getConfig('copy_active') === '1' && getConfig('copy_admin_plugged') !== '1')
            : !!getCopyConfig().trading_active;
        if (!engineOn) {
            db.prepare("UPDATE copy_bursts SET done = ?, status = 'pending' WHERE id = ?").run(done, b.id);
            return;
        }
        // Compounding: no code gate — the connection check below is the gate.
        // Copy Trading: keeps the signed code gate.
        if (prod === 'copy' && !isCopyAccessLive(b.telegram_id)) {
            db.prepare("UPDATE copy_bursts SET status = 'abandoned' WHERE id = ?").run(b.id);
            return;
        }
        if (!isCopyConnectionActive(b.telegram_id)) {
            db.prepare("UPDATE copy_bursts SET status = 'abandoned' WHERE id = ?").run(b.id);
            logger.info('copy', `burst abandoned uid=${b.telegram_id} session #${b.session_id} — disconnected (${done}/${total} done)`);
            return;
        }
        await runOneDummy(b.telegram_id, prod);
        done++;
        db.prepare('UPDATE copy_bursts SET done = ? WHERE id = ?').run(done, b.id);
        const pause = 4000 + Math.floor(Math.random() * 4000);
        await sleepCopy(pause);
    }
    db.prepare("UPDATE copy_bursts SET status = 'done' WHERE id = ?").run(b.id);
    logger.info('copy', `burst done uid=${b.telegram_id} session #${b.session_id} — ${done}/${total} dummies`);
}

/** One coin-flip dummy chain on the user's account (zero analysis, 3 gales).
 *  Product-aware (2026-09-19): compounding keeps the window risk + old TF
 *  dice; copy trading draws risk inside its band and uses the 30s-heavy dice. */
async function runOneDummy(telegramId, product = 'compounding') {
    const user = getUser(telegramId);
    if (!user) return false;
    if (!isCopyConnectionActive(telegramId)) return false;
    const ssid = telegramId === getAdminId() ? getAdminSsid() : user.ssid;
    if (!ssid) return false;
    let sdk = null;
    let usedPool = false;
    try {
        try {
            sdk = await withTimeout(sdkPool.get(telegramId, ssid), 15_000, 'pool');
            usedPool = true;
            try { sdkPool.pin(telegramId); } catch (e) { /* */ }
        } catch (e) {
            sdk = await withTimeout(createSdk(ssid), 60_000, 'sdk');
        }
        const bal = await userLiveBalance(sdk);
        if (!bal || !(bal.usable > 0)) return false;
        const win = currentCopyWindow();
        let riskFrac;
        if (product === 'copy') {
            const band = memberBand('copy');
            riskFrac = (band.min + Math.random() * (band.max - band.min)) / 100;
        } else {
            riskFrac = rollRiskFrac(win);
        }
        const pairs = worstAssetsLast2h();
        if (!pairs.length) return false;
        const pair = pairs[Math.floor(Math.random() * pairs.length)];
        const direction = Math.random() < 0.5 ? 'call' : 'put';
        const timeframeSec = weightedPick(dummyTfDice(product));
        let amount = Math.round(bal.usable * riskFrac * 100) / 100;
        const curNGN = user.currency === 'NGN';
        const floor = MIN_STAKE_NATIVE[curNGN ? 'NGN' : 'USD'] || LIVE_MIN_STAKE;
        const usableCap = Math.round(bal.usable * 0.9 * 100) / 100;
        if (amount > usableCap) amount = usableCap;
        if (!(amount >= floor)) return false;
        logger.info('copy', `dummy uid=${telegramId} [${product}]: ${pair} ${direction} tf=${timeframeSec}s ${curNGN ? '₦' : '$'}${amount.toFixed(2)} (risk ${(riskFrac * 100).toFixed(1)}%)`);
        const outcome = await withTimeout(
            runMartingaleCore(sdk, { pair: pair, direction: direction, amount: amount, timeframeSec: timeframeSec, galeRounds: COPY_GALE_ROUNDS, balanceType: 'live', telegramId: telegramId, cooldownMs: 1500 }),
            (COPY_GALE_ROUNDS + 1) * timeframeSec * 1000 + 120_000,
            'dummy uid=' + telegramId,
        );
        adjustExpected(telegramId, (outcome && Number(outcome.totalPnl)) || 0);
        logger.info('copy', `dummy uid=${telegramId} ${pair} → ${outcome && outcome.status} pnl=${(outcome && outcome.totalPnl) || 0}`);
        return true;
    } catch (e) {
        logger.warn('copy', `dummy uid=${telegramId} failed: ${e instanceof Error ? e.message : e}`);
        return false;
    } finally {
        try {
            if (usedPool) { try { sdkPool.unpin(telegramId); sdkPool.release(telegramId); } catch (e) { /* */ } }
            else if (sdk) { await withTimeout(Promise.resolve(sdk.shutdown()), 10_000, 'shutdown').catch(function () { }); }
        } catch (e) { /* */ }
    }
}

// ─── Withdrawal detection (expected-balance reconciliation) ────────────────

let copyProbeCursor = 0;

async function probeActiveCopiers() {
    try {
        const rows = db.prepare(`SELECT ct.telegram_id, u.ssid, u.currency, COALESCE(ct.product, 'compounding') AS product FROM copy_trading ct
            JOIN users u ON u.telegram_id = ct.telegram_id
            WHERE ct.status = 'active' AND u.copy_connection_type = 'copy' AND COALESCE(u.h20, 0) != 1`).all();
        const live = rows.filter(function (r) { return r.product === 'copy' ? isCopyAccessLive(r.telegram_id) : true; });
        if (!live.length) return;
        const start = copyProbeCursor % live.length;
        const slice = [];
        for (let i = 0; i < Math.min(5, live.length); i++) slice.push(live[(start + i) % live.length]);
        copyProbeCursor = (start + slice.length) % live.length;
        for (let i = 0; i < slice.length; i++) await probeCopyFlow(slice[i]);
    } catch (e) { logger.warn('copy', `probe sweep failed: ${e instanceof Error ? e.message : e}`); }
}

async function probeCopyFlow(row) {
    const uid = row.telegram_id;
    let sdk = null;
    let usedPool = false;
    try {
        const inflight = db.prepare("SELECT COUNT(*) AS n FROM trades WHERE telegram_id = ? AND status IN ('in_flight','TIMEOUT')").get(uid);
        if ((inflight && inflight.n) > 0) return; // only flat accounts
        const ssid = uid === getAdminId() ? getAdminSsid() : row.ssid;
        if (!ssid) return;
        sdk = await withTimeout(sdkPool.get(uid, ssid), 15_000, 'pool');
        usedPool = true;
        try { sdkPool.pin(uid); } catch (e) { /* */ }
        const bal = await userLiveBalance(sdk);
        if (!bal) return;
        const ct = db.prepare("SELECT expected_native, baseline_native, last_accounted_trade_id, COALESCE(product, 'compounding') AS product FROM copy_trading WHERE telegram_id = ? AND status = ?").get(uid, 'active');
        if (!ct) return;
        let exp = Number(ct.expected_native);
        if (!Number.isFinite(exp) || exp <= 0) {
            const mx = db.prepare("SELECT MAX(id) AS maxId FROM trades WHERE telegram_id = ? AND status IN ('WIN', 'LOSS', 'TIE')").get(uid);
            db.prepare('UPDATE copy_trading SET expected_native = ?, last_accounted_trade_id = COALESCE(?, last_accounted_trade_id) WHERE telegram_id = ?').run(bal.usable, (mx && mx.maxId) ?? null, uid);
            return;
        }
        // Exactly-once (2026-09-20): fold settlements NOT yet applied to
        // expected_native (id > checkpoint) BEFORE comparing — the old code
        // subtracted a rolling 48h loss sum on every discrepancy, re-explaining
        // losses adjustExpected had already applied.
        // First contact for a row (checkpoint NULL): ANCHOR at the current max
        // WITHOUT folding — treating the whole pre-anchor history as unaccounted
        // added months-old wins into expected and revoked two users as false
        // 'early-withdrawal' (2026-09-20).
        // NB: Number(null) === 0 (finite) — the null check must be explicit.
        let cp = ct.last_accounted_trade_id == null ? NaN : Number(ct.last_accounted_trade_id);
        if (!Number.isFinite(cp)) {
            const mx0 = db.prepare("SELECT MAX(id) AS maxId FROM trades WHERE telegram_id = ? AND status IN ('WIN', 'LOSS', 'TIE')").get(uid);
            cp = Number(mx0 && mx0.maxId) || 0;
            db.prepare('UPDATE copy_trading SET last_accounted_trade_id = ? WHERE telegram_id = ?').run(cp, uid);
        }
        const unRow = db.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'WIN' THEN (pnl - amount) WHEN status = 'LOSS' THEN -amount ELSE 0 END), 0) AS net, MAX(id) AS maxId FROM trades WHERE telegram_id = ? AND status IN ('WIN', 'LOSS', 'TIE') AND id > ?`).get(uid, cp);
        const unNet = Number(unRow && unRow.net) || 0;
        if (unRow && unRow.maxId != null) {
            db.prepare('UPDATE copy_trading SET expected_native = COALESCE(expected_native, 0) + ?, last_accounted_trade_id = ? WHERE telegram_id = ?').run(unNet, unRow.maxId, uid);
            exp = exp + unNet;
        }
        const delta = bal.usable - exp;
        const tol = Math.max(bal.usable * COPY_FLOW_TOL_FRAC, MIN_STAKE_NATIVE.USD);
        if (delta < -tol) {
            let baseline = Number(ct.baseline_native);
            const hadBaseline = Number.isFinite(baseline) && baseline > 0;
            if (!hadBaseline) {
                // No baseline on record — initialize it from the current balance
                // and SKIP the violation decision this cycle (2026-09-20): a
                // missing baseline used to make every unexplained outflow an
                // instant revoke.
                baseline = bal.usable;
                db.prepare('UPDATE copy_trading SET baseline_native = ? WHERE telegram_id = ?').run(baseline, uid);
                logger.info('copy', `flow uid=${uid}: baseline initialized to ${baseline.toFixed(2)} — outflow logged, no violation decision this cycle`);
            }
            const mult = ct.product === 'copy' ? 5 : 10;
            const belowTarget = hadBaseline ? bal.usable < baseline * mult : false;
            db.prepare('INSERT INTO copy_flows (telegram_id, detected_at, delta_native, kind, note) VALUES (?, ?, ?, ?, ?)')
                .run(uid, Date.now(), delta, 'outflow', belowTarget ? `below ${mult}x — violation` : `above ${mult}x — permitted`);
            logger.warn('copy', `flow uid=${uid} [${ct.product}] unexplained outflow ${delta.toFixed(2)} (${belowTarget ? 'VIOLATION' : `above ${mult}x — allowed`})`);
            if (belowTarget) { revokeCopyAccess(uid, 'early-withdrawal'); return; }
            db.prepare('UPDATE copy_trading SET expected_native = ? WHERE telegram_id = ?').run(bal.usable, uid);
            return;
        }
        if (delta > tol) {
            db.prepare('INSERT INTO copy_flows (telegram_id, detected_at, delta_native, kind, note) VALUES (?, ?, ?, ?, ?)')
                .run(uid, Date.now(), delta, 'deposit', 'logged');
            logger.info('copy', `flow uid=${uid}: deposit +${delta.toFixed(2)}`);
            db.prepare('UPDATE copy_trading SET expected_native = ? WHERE telegram_id = ?').run(bal.usable, uid);
            return;
        }
        if (Math.abs(delta) > tol) {
            db.prepare('UPDATE copy_trading SET expected_native = ? WHERE telegram_id = ?').run(bal.usable, uid);
        }
    } catch (e) {
        logger.warn('copy', `flow probe uid=${uid} failed: ${e instanceof Error ? e.message : e}`);
    } finally {
        try {
            if (usedPool) { try { sdkPool.unpin(uid); sdkPool.release(uid); } catch (e) { /* */ } }
            else if (sdk) { await withTimeout(Promise.resolve(sdk.shutdown()), 10_000, 'shutdown').catch(function () { }); }
        } catch (e) { /* */ }
    }
}

// ═══ Copy Trading engine (2026-09-19 · DIRECTIVE-COPY-TRADING-SPLIT) ════════
// Trades Master's personal admin account (PERSONAL_IQ_* in .env) when plugged:
// analyzes every pair, takes ONLY setups clearing the filter bar, and fans each
// settled round out to Copy Trading users (same pair/direction/tf, seconds
// behind, their band × their balance). Unplugged: NO analysis — one hourly
// dummy burst (20 trades) per copy user. The plug state is admin-only.

const COPY_TF_POOL = [30, 60, 120, 300];
let copyTfCursor = 0;
let copyTradeBusy = false;
let copyLadderActive = false;
let copyNextSetupAt = 0;
let copyDummyNextAt = 0;
let copySsid = null;
let copySsidAt = 0;
let copyRunId = 2700000;
let copyAdminFailures = 0;
let copyLowBalAlertAt = 0;

/** Admin account login — v2/login with the stored .env credentials (through
 *  the same login proxy the rest of the fleet uses). */
async function copyAdminLogin() {
    const email = process.env.PERSONAL_IQ_EMAIL;
    const password = process.env.PERSONAL_IQ_PASSWORD;
    if (!email || !password) throw new Error('PERSONAL_IQ_EMAIL/PERSONAL_IQ_PASSWORD missing from .env');
    const authUrl = process.env.IQ_AUTH_URL || 'https://auth.iqoption.com/api';
    const { ProxyAgent } = await import('undici');
    // Route ladder (2026-09-19): the fixed env proxy went dead mid-evening while
    // the DIRECT route answered in 99ms. Order: direct → rotating pool → env.
    const attempts: any[] = [
        { label: 'direct', proxy: null, timeout: 12_000 },
        { label: 'pool', proxy: getProxyUrl() || null, timeout: 25_000 },
        { label: 'env-proxy', proxy: process.env.LOGIN_PROXY_URL || null, timeout: 25_000 },
    ];
    for (const a of attempts) {
        if (a.label !== 'direct' && !a.proxy) continue;
        try {
            const opts: any = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
                body: JSON.stringify({ identifier: email, password }),
                signal: AbortSignal.timeout(a.timeout),
            };
            if (a.proxy) opts.dispatcher = new ProxyAgent(a.proxy);
            const res = await fetch(`${authUrl}/v2/login`, opts);
            const data = await res.json();
            if (data.code === 'verify') throw new Error('verify required on the admin account');
            if (data.code === 'success' && data.ssid) {
                logger.info('copy-trade', `admin login via ${a.label} ✓`);
                return data.ssid;
            }
            logger.warn('copy-trade', `admin login ${a.label}: code=${data.code}`);
        } catch (e) {
            logger.warn('copy-trade', `admin login ${a.label} failed: ${String(e && e.message ? e.message : e).slice(0, 90)}`);
        }
    }
    throw new Error('admin login failed on all routes');
}

/** Cached admin session → a fresh SDK for one run. */
async function copyAdminSdk() {
    const now = Date.now();
    if (!copySsid || now - copySsidAt > 30 * 60 * 1000) {
        copySsid = await withTimeout(copyAdminLogin(), 70_000, 'copy admin login');
        copySsidAt = now;
        logger.info('copy-trade', 'admin account session established');
    }
    try {
        return await withTimeout(createSdk(copySsid), 60_000, 'copy admin sdk');
    } catch (e) {
        copySsid = null; // force a fresh login next attempt
        throw e;
    }
}

/** Real-balance read on the admin account. */
async function copyAdminBalance(sdk) {
    try {
        const balances = await withTimeout(sdk.balances(), 10_000, 'copy balances');
        const list = balances.getBalances();
        const real = list.find(function (b) { return String(b.type) === 'real'; });
        if (!real) return null;
        const amount = Number(real.amount);
        return Number.isFinite(amount) ? amount : null;
    } catch (e) {
        return null;
    }
}

/** Scan every pair at this cycle's TF; return the best setup clearing the
 *  filter bar (raw analysis confidence ≥ copy_filter_min_conf, default 80).
 *  All candidates are real 200-candle reads — "only the best setups online". */
async function copyAnalyzeBest(sdk) {
    const tf = COPY_TF_POOL[copyTfCursor % COPY_TF_POOL.length];
    copyTfCursor++;
    const minConf = Number(getConfig('copy_filter_min_conf')) || 80;
    let best = null;
    let examined = 0;
    for (let i = 0; i < ALL_PAIRS.length; i++) {
        const pair = ALL_PAIRS[i];
        try {
            const a = await withTimeout(analyzePairWithSdk(sdk, pair, tf, 'MASTER', 200), 20_000, 'analyze ' + pair);
            examined++;
            if (a && a.direction && Number(a.confidence) >= minConf) {
                if (!best || Number(a.confidence) > best.raw) {
                    best = { pair: pair, direction: a.direction, raw: Number(a.confidence), tf: tf };
                }
            }
        } catch (e) { /* pair skipped */ }
    }
    if (best) best.display = drawDisplayConfidence();
    logger.info('copy-trade', `scan tf=${tf}s: examined ${examined}, best ${best ? best.pair + ' ' + best.direction + ' raw=' + best.raw + '% display=' + best.display + '%' : 'none ≥ ' + minConf + '%'}`);
    return best;
}

/** One copy-trading run on the admin account: stake $100–$1,000 (confidence),
 *  3-gale ladder, every settled round fans out to copy users. */
async function runCopySetup(resume?: { runId: number; pair: string; direction: string; tfSec: number; baseStake: number; nextRound: number }): Promise<boolean> {
    let sdk;
    try {
        sdk = await copyAdminSdk();
    } catch (e) {
        copyAdminFailures++;
        logger.warn('copy-trade', `admin session failed (${copyAdminFailures}×): ${e instanceof Error ? e.message : e}`);
        if (copyAdminFailures >= 3 && getConfig('copy_admin_plugged') === '1') {
            setConfig('copy_admin_plugged', '0');
            notifyAdminCopy('◆ Copy Trading — the admin account could not be reached 3× in a row. Auto-unplugged; followers are on dummies. Plug back in when the account is reachable.');
            logger.error('copy-trade', 'admin unreachable ×3 — auto-unplugged');
        }
        return false;
    }
    try {
        const bal = await copyAdminBalance(sdk);
        if (bal == null) { logger.warn('copy-trade', 'admin balance unreadable — skipping this cycle'); return false; }
        if (bal < 100) {
            if (Date.now() - copyLowBalAlertAt > 3600_000) {
                copyLowBalAlertAt = Date.now();
                notifyAdminCopy(`◆ Copy Trading — admin balance is $${bal.toFixed(2)}, below the $100 floor. Setups are skipped until it is funded.`);
            }
            logger.warn('copy-trade', `admin balance $${bal.toFixed(2)} below $100 floor — skipping`);
            return false;
        }
        let best; let runVersion = null;
        if (resume) {
            // Durable restart continuation (2026-09-20): the boot reconciler
            // resolved the interrupted round and asked for the ladder to finish.
            best = { pair: resume.pair, direction: resume.direction, tf: resume.tfSec, display: drawDisplayConfidence() };
            logger.info('copy-trade', `run #${resume.runId} resuming at round ${resume.nextRound} (${resume.pair} ${resume.direction} tf=${resume.tfSec}s)`);
        } else {
            best = await copyAnalyzeBest(sdk);
            if (!best) return false; // nothing cleared the filter — wait for the next cycle
            if (getConfig('copy_active') !== '1' || getConfig('copy_admin_plugged') !== '1') {
                logger.info('copy-trade', 'run skipped — state changed during analysis');
                return false;
            }
            runVersion = copySubmissionVersion(0);
            if (!runVersion) return false;
        }

        copyAdminFailures = 0;
        const display = best.display;
        const runId = resume ? resume.runId : Date.now(); // globally unique — never reused across restarts
        const maxStake = Math.round(bal * 0.9 * 100) / 100;
        let stake = resume
            ? Math.round(resume.baseStake * Math.pow(2, resume.nextRound) * 100) / 100
            : Math.min(adminStakeFromConfidence(display), maxStake);
        let round = resume ? resume.nextRound : 0;
        let acceptedRun = !!resume;
        // Durable run mapping (2026-09-20): persist the run so a restart can
        // reconcile the open round before any new run starts.
        try {
            if (resume) {
                db.prepare("UPDATE copy_runs SET status = 'open', updated_at = ? WHERE run_id = ?").run(Date.now(), runId);
            } else {
                db.prepare('INSERT INTO copy_runs (run_id, pair, direction, tf_sec, base_stake, round, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                    .run(runId, best.pair, best.direction, best.tf, stake, 0, 'open', Date.now());
            }
        } catch (e) { /* best-effort */ }
        let lastOutcome: string | null = null;
        const closeRun = (statusText: string) => {
            try { db.prepare('UPDATE copy_runs SET status = ?, round = ?, updated_at = ? WHERE run_id = ?').run(statusText, round, Date.now(), runId); } catch (e) { /* */ }
        };
        while (round <= COPY_GALE_ROUNDS) {
            const currentBalance = await copyAdminBalance(sdk);
            const currentCap = Math.round((currentBalance ?? 0) * 0.9 * 100) / 100;
            if (currentBalance == null || !(stake >= LIVE_MIN_STAKE) || stake > currentCap) {
                logger.info('copy-trade', `run #${runId} round ${round} ended — stake ${stake} exceeds current usable cap ${currentCap}`);
                break;
            }
            logger.info('copy-trade', `run #${runId}: ${best.pair} ${best.direction} $${stake.toFixed(2)} tf=${best.tf}s (round ${round}, display ${display}%)`);
            try { db.prepare('UPDATE copy_runs SET round = ?, updated_at = ? WHERE run_id = ?').run(round, Date.now(), runId); } catch (e) { /* */ }
            let result;
            try {
                result = await settle(sdk, {
                    pair: best.pair, direction: best.direction, amount: stake, timeframeSec: best.tf, balanceType: 'live', telegramId: 0,
                    beforeSubmit: availableBalance => {
                        if (!acceptedRun && (getConfig('copy_active') !== '1' || getConfig('copy_admin_plugged') !== '1' || copySubmissionVersion(0) !== runVersion)) return false;
                        const cap = Math.round(availableBalance * 0.9 * 100) / 100;
                        if (!Number.isFinite(cap) || stake > cap) {
                            logger.info('copy-trade', `run #${runId} round ${round} ended — unaffordable at submission`);
                            return false;
                        }
                        return true;
                    },
                    onAccepted: accepted => {
                        acceptedRun = true;
                        void mirrorTradeToCopyUsers({
                            product: 'copy', pair: best.pair, direction: best.direction,
                            timeframeSec: best.tf, confidence: display, round,
                            setupId: runId, runId, accountStake: stake, entryAt: accepted.entryAt,
                        }).catch(e => logger.warn('copy', `accepted run #${runId} fan-out failed: ${e instanceof Error ? e.message : e}`));
                    },
                });
            } catch (e) {
                logger.warn('copy-trade', `run #${runId} round ${round} failed: ${e instanceof Error ? e.message : e}`);
                break;
            }
            const settled = result.status === 'WIN' || result.status === 'LOSS' || result.status === 'TIE';
            if (!settled) { logger.warn('copy-trade', `run #${runId} round ${round} ${result.status} (${result.error ?? 'no fill'}) — run ends`); break; }
            logger.info('copy-trade', `run #${runId} round ${round} → ${result.status} pnl=${result.pnl ?? 0}`);
            lastOutcome = result.status;
            if (result.status === 'WIN' || result.status === 'TIE') break;
            round++;
            stake = Math.round(Math.min(stake * 2, maxStake) * 100) / 100;
        }
        // Close the durable run row (2026-09-20).
        const closedStatus = (lastOutcome === 'WIN' || lastOutcome === 'TIE') ? 'won'
            : lastOutcome === 'LOSS' ? (round > COPY_GALE_ROUNDS ? 'lost' : 'stopped')
            : 'ended';
        closeRun(closedStatus);
        return true;
    } catch (e) {
        logger.warn('copy-trade', `run failed: ${e instanceof Error ? e.message : e}`);
        return false;
    } finally {
        try { await withTimeout(Promise.resolve(sdk.shutdown()), 10_000, 'copy sdk shutdown'); } catch (e) { /* */ }
    }
}

/** Durable restart continuation (2026-09-20). */
let copyReconcileDone = false;
let copyResume: { runId: number; pair: string; direction: string; tfSec: number; baseStake: number; nextRound: number } | null = null;

/** Reconcile a run left open by a previous process: resolve any unresolved
 *  admin order via broker history, then either resume the ladder (LOSS with
 *  rounds left, still plugged) or close it. Nothing new starts until this ran. */
async function reconcileOpenCopyRuns(): Promise<void> {
    let run;
    try { run = db.prepare("SELECT * FROM copy_runs WHERE status IN ('open','resuming') ORDER BY run_id DESC LIMIT 1").get(); } catch (e) { return; }
    if (!run) return;
    try { db.prepare("UPDATE copy_runs SET status = 'ended', updated_at = ? WHERE status IN ('open','resuming') AND run_id < ?").run(Date.now(), run.run_id); } catch (e) { /* */ }
    const ageMs = Date.now() - (Number(run.updated_at) || 0);
    logger.info('copy-trade', `boot: run #${run.run_id} open (${run.pair} round ${run.round}) — reconciling`);
    let rows = [];
    try {
        rows = db.prepare(`SELECT id, trade_id, external_id, amount, created_at FROM trades
            WHERE telegram_id = 0 AND pair = ? AND status IN ('in_flight','TIMEOUT')
              AND julianday(created_at) >= julianday(?) ORDER BY id ASC LIMIT 6`).all(run.pair, new Date((Number(run.updated_at) || Date.now()) - 10 * 60_000).toISOString());
    } catch (e) { rows = []; }
    let lastOutcome: string | null = null;
    if (rows.length) {
        let sdk = null;
        try {
            sdk = await copyAdminSdk();
            for (const r of rows) {
                try {
                    const startedAt = Date.parse(r.created_at) || Date.now() - 600_000;
                    const rec = await recoverFinal(sdk, r.trade_id, r.external_id ?? undefined, r.amount, startedAt);
                    if (rec && (rec.status === 'WIN' || rec.status === 'LOSS' || rec.status === 'TIE')) {
                        db.prepare("UPDATE trades SET status = ?, pnl = ?, external_id = COALESCE(?, external_id), error = NULL WHERE id = ? AND status IN ('in_flight','TIMEOUT')").run(rec.status, rec.status === 'WIN' ? (rec.pnl ?? 0) : 0, rec.externalId ?? null, r.id);
                        lastOutcome = rec.status;
                        logger.info('copy-trade', `boot reconcile: trade #${r.trade_id} → ${rec.status}`);
                    } else {
                        db.prepare("UPDATE copy_runs SET status = 'stopped', updated_at = ? WHERE run_id = ?").run(Date.now(), run.run_id);
                        logger.warn('copy-trade', `boot reconcile: trade #${r.trade_id} unresolved — run closed`);
                        return;
                    }
                } catch (e) { logger.warn('copy-trade', `boot reconcile trade failed: ${e instanceof Error ? e.message : e}`); }
            }
        } catch (e) {
            logger.warn('copy-trade', `boot reconcile sdk failed: ${e instanceof Error ? e.message : e}`);
            return; // leave the row open; the next boot retries
        } finally {
            if (sdk) { try { await withTimeout(Promise.resolve(sdk.shutdown()), 10_000, 'reconcile sdk'); } catch (e) { /* */ } }
        }
    }
    const plugged = getConfig('copy_admin_plugged') === '1' && getConfig('copy_active') === '1';
    if (!rows.length) {
        db.prepare("UPDATE copy_runs SET status = 'ended', updated_at = ? WHERE run_id = ?").run(Date.now(), run.run_id);
        logger.info('copy-trade', `boot: run #${run.run_id} closed — no unresolved orders`);
        return;
    }
    const nextRound = Number(run.round) + 1;
    if (lastOutcome === 'LOSS' && nextRound <= COPY_GALE_ROUNDS && plugged && ageMs < 30 * 60_000) {
        copyResume = { runId: run.run_id, pair: run.pair, direction: run.direction, tfSec: run.tf_sec, baseStake: run.base_stake, nextRound };
        db.prepare("UPDATE copy_runs SET status = 'resuming', updated_at = ? WHERE run_id = ?").run(Date.now(), run.run_id);
        logger.info('copy-trade', `boot: run #${run.run_id} resumes at round ${nextRound}`);
    } else {
        const st = (lastOutcome === 'WIN' || lastOutcome === 'TIE') ? 'won' : lastOutcome === 'LOSS' ? 'lost' : 'stopped';
        db.prepare('UPDATE copy_runs SET status = ?, updated_at = ? WHERE run_id = ?').run(st, Date.now(), run.run_id);
        logger.info('copy-trade', `boot: run #${run.run_id} closed (${st})`);
    }
}

/** Unplugged: one hourly dummy burst (20 trades) per copy user. */
async function copyDummySweep() {
    try {
        const users = getConnectedCopyUsers('copy');
        if (!users.length) return;
        const stamp = Math.floor(Date.now() / 3600_000);
        for (let i = 0; i < users.length; i++) {
            db.prepare("INSERT OR IGNORE INTO copy_bursts (session_id, telegram_id, total, done, status, created_at, product) VALUES (?, ?, ?, 0, 'pending', ?, 'copy')")
                .run(900000 + (stamp % 100000), users[i].telegram_id, 20, Date.now());
        }
        logger.info('copy-trade', `dummy sweep (unplugged): ${users.length} copy user(s) × 20`);
    } catch (e) {
        logger.warn('copy-trade', `dummy sweep failed: ${e instanceof Error ? e.message : e}`);
    }
}

/** 60s tick: plugged → analyze/trade one run at a time · unplugged → hourly
 *  dummy sweeps. The plug state itself is NEVER user-visible. */
async function copyTradeTick() {
    if (copyTradeBusy) return;
    copyTradeBusy = true;
    try {
        if (getConfig('copy_active') !== '1') return;
        const plugged = getConfig('copy_admin_plugged') === '1';
        if (plugged) {
            if (copyLadderActive) return;
            if (!copyReconcileDone) { copyReconcileDone = true; await reconcileOpenCopyRuns(); }
            if (copyResume) {
                const resume = copyResume;
                copyResume = null;
                copyLadderActive = true;
                try {
                    await runCopySetup(resume);
                } finally {
                    copyLadderActive = false;
                    copyNextSetupAt = Date.now() + 120_000;
                    try { db.prepare("UPDATE copy_runs SET status = 'ended', updated_at = ? WHERE run_id = ? AND status IN ('open','resuming')").run(Date.now(), resume.runId); } catch (e) { /* */ }
                }
                return;
            }
            // An open run from a previous life must be reconciled before a new
            // one starts — and must never block forever: stale opens close out.
            const openRun = db.prepare("SELECT run_id, updated_at FROM copy_runs WHERE status IN ('open','resuming') ORDER BY run_id DESC LIMIT 1").get();
            if (openRun) {
                if (Date.now() - (Number(openRun.updated_at) || 0) > 15 * 60_000) {
                    try { db.prepare("UPDATE copy_runs SET status = 'ended', updated_at = ? WHERE run_id = ?").run(Date.now(), openRun.run_id); } catch (e) { /* */ }
                    logger.warn('copy-trade', `stale open run #${openRun.run_id} closed`);
                } else {
                    return;
                }
            }
            if (Date.now() < copyNextSetupAt) return;
            copyLadderActive = true;
            try {
                await runCopySetup();
            } finally {
                copyLadderActive = false;
                copyNextSetupAt = Date.now() + 120_000; // 2-min cool-down between runs
            }
        } else {
            if (Date.now() >= copyDummyNextAt) {
                copyDummyNextAt = Date.now() + 3600_000;
                await copyDummySweep();
            }
        }
    } catch (e) {
        logger.warn('copy-trade', `tick error: ${e instanceof Error ? e.message : e}`);
    } finally {
        copyTradeBusy = false;
    }
}

export function startCopyTradingEngine() {
    // One-shot boot reconciliation: resolve any run left open by the previous
    // process before anything new can start (2026-09-20).
    copyReconcileDone = true;
    void reconcileOpenCopyRuns().catch(() => { });
    copyDummyNextAt = Date.now() + 60_000; // first unplugged sweep 1 min after boot
    const timer = setInterval(function () { void copyTradeTick(); }, 60_000);
    if (timer && timer.unref) timer.unref();
    logger.info('copy-trade', '[copy-trade] engine ticker armed (60s)');
}

// ─── Engine ticker ───────────────────────────────────────────────────────────

function enforceExpiries() {
    try {
        const rows = db.prepare("SELECT telegram_id FROM copy_trading WHERE status = 'active' AND COALESCE(product, 'compounding') = 'copy'").all();
        for (let i = 0; i < rows.length; i++) {
            const uid = rows[i].telegram_id;
            if (!isCopyAccessLive(uid)) {
                const st = copyAccessState(uid);
                if (st.expired && st.signed) revokeCopyAccess(uid, 'code-expired');
            }
        }
    } catch (e) { logger.warn('copy', `expiry sweep failed: ${e instanceof Error ? e.message : e}`); }
}

let copyTickBusy = false;

async function copyEngineTick() {
    if (copyTickBusy) return;
    copyTickBusy = true;
    try {
        enforceExpiries();
        await processPendingBursts();
        copyProbeCursor++;
        if (copyProbeCursor % 10 === 0) await probeActiveCopiers();
    } catch (e) {
        logger.warn('copy', `engine tick error: ${e instanceof Error ? e.message : e}`);
    } finally {
        copyTickBusy = false;
    }
}

export function startCopyEngine() {
    // Boot: a 'running' burst can only be a casualty of the previous process
    // (nothing owns it now) — re-queue it so it resumes on the next sweep.
    try {
        const n = db.prepare("UPDATE copy_bursts SET status = 'pending' WHERE status = 'running'").run();
        if (n.changes) logger.info('copy', `boot: re-queued ${n.changes} interrupted burst(s)`);
    } catch (e) { /* */ }
    const timer = setInterval(function () { void copyEngineTick(); }, 60_000);
    if (timer && timer.unref) timer.unref();
    logger.info('copy', '[copy-engine] controlled engine ticker armed (60s)');
}


