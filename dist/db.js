import Database from 'better-sqlite3';
import path from 'node:path';
const DB_PATH = process.env.DB_PATH ?? path.resolve('iqbot-v3.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id     INTEGER,
    pair            TEXT    NOT NULL,
    direction       TEXT    NOT NULL,
    amount          REAL    NOT NULL,
    status          TEXT    NOT NULL,
    pnl             REAL    NOT NULL DEFAULT 0,
    trade_id        INTEGER,
    error           TEXT,
    martingale_run  TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
// Migrations for the trades table
const existingCols = db.prepare('PRAGMA table_info(trades)').all().map(c => c.name);
if (!existingCols.includes('martingale_run')) {
    db.exec('ALTER TABLE trades ADD COLUMN martingale_run TEXT');
}
if (!existingCols.includes('telegram_id')) {
    db.exec('ALTER TABLE trades ADD COLUMN telegram_id INTEGER');
}
// Users table with full onboarding columns (ssid nullable — user may onboard before /connect)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id     INTEGER PRIMARY KEY,
    ssid            TEXT,
    iq_user_id      INTEGER,
    approval_status TEXT    NOT NULL DEFAULT 'pending',
    approved_at     TEXT,
    affiliate_data  TEXT,
    tier            TEXT    NOT NULL DEFAULT 'NEWBIE',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    last_used       TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
// Migration: recreate users table if ssid column is NOT NULL (old schema)
const userColInfo = db.prepare('PRAGMA table_info(users)').all();
const userColNames = userColInfo.map(c => c.name);
const ssidColNotNull = userColInfo.find(c => c.name === 'ssid')?.notnull === 1;
if (ssidColNotNull) {
    // Recreate with nullable ssid and new onboarding columns
    db.exec(`
        ALTER TABLE users RENAME TO _users_v7;
        CREATE TABLE users (
            telegram_id     INTEGER PRIMARY KEY,
            ssid            TEXT,
            iq_user_id      INTEGER,
            approval_status TEXT    NOT NULL DEFAULT 'pending',
            approved_at     TEXT,
            affiliate_data  TEXT,
            tier            TEXT    NOT NULL DEFAULT 'NEWBIE',
            created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            last_used       TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users (telegram_id, ssid, created_at, last_used)
            SELECT telegram_id, ssid, created_at, last_used FROM _users_v7;
        DROP TABLE _users_v7;
    `);
}
else {
    // Nullable ssid already — just add any missing onboarding columns
    if (!userColNames.includes('iq_user_id'))
        db.exec('ALTER TABLE users ADD COLUMN iq_user_id INTEGER');
    if (!userColNames.includes('approval_status'))
        db.exec("ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'");
    if (!userColNames.includes('approved_at'))
        db.exec('ALTER TABLE users ADD COLUMN approved_at TEXT');
    if (!userColNames.includes('affiliate_data'))
        db.exec('ALTER TABLE users ADD COLUMN affiliate_data TEXT');
    if (!userColNames.includes('tier'))
        db.exec("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'NEWBIE'");
}
// Additional column migrations (run after main table setup to get final state)
const finalUserCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!finalUserCols.includes('username'))
    db.exec('ALTER TABLE users ADD COLUMN username TEXT');
// ─── Section 10 tables ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT    UNIQUE NOT NULL,
    tier        TEXT    NOT NULL,
    used_by     INTEGER,
    used_at     TEXT,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS leaderboard (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id   INTEGER NOT NULL,
    auto_profit   REAL    NOT NULL DEFAULT 0,
    manual_profit REAL,
    date          TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(telegram_id, date)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS funnel_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT    NOT NULL,
    metadata   TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
const insertStmt = db.prepare(`
    INSERT INTO trades (telegram_id, pair, direction, amount, status, pnl, trade_id, error, martingale_run)
    VALUES (@telegram_id, @pair, @direction, @amount, @status, @pnl, @trade_id, @error, @martingale_run)
`);
export function insertTrade(t) {
    insertStmt.run({
        telegram_id: t.telegram_id ?? null,
        pair: t.pair,
        direction: t.direction,
        amount: t.amount,
        status: t.status,
        pnl: t.pnl,
        trade_id: t.trade_id ?? null,
        error: t.error ?? null,
        martingale_run: t.martingale_run ?? null,
    });
}
export function getRecentTrades(limit = 10, telegramId) {
    const whereClause = telegramId !== undefined ? 'WHERE telegram_id = ?' : '';
    const sql = `
        WITH circles AS (
            SELECT
                martingale_run,
                MAX(created_at) AS created_at,
                SUM(pnl)        AS pnl,
                telegram_id,
                (SELECT pair      FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS pair,
                (SELECT direction FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS direction,
                (SELECT amount    FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS amount,
                (SELECT status    FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS status
            FROM trades t1
            WHERE martingale_run IS NOT NULL
            GROUP BY martingale_run
            UNION ALL
            SELECT CAST(id AS TEXT) AS martingale_run, created_at, pnl, telegram_id, pair, direction, amount, status
            FROM trades WHERE martingale_run IS NULL
        )
        SELECT NULL AS id, telegram_id, pair, direction, amount, status, pnl, NULL AS trade_id, NULL AS error, martingale_run, created_at
        FROM circles
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ?
    `;
    if (telegramId !== undefined) {
        return db.prepare(sql).all(telegramId, limit);
    }
    return db.prepare(sql).all(limit);
}
export function getTradeStats(telegramId) {
    const pnlWhere = telegramId !== undefined ? 'WHERE telegram_id = ?' : '';
    const circleWhere = telegramId !== undefined ? 'WHERE cr.telegram_id = ?' : '';
    const sql = `
        WITH circle_results AS (
            SELECT
                martingale_run,
                (SELECT status FROM trades t2
                 WHERE t2.martingale_run = t1.martingale_run
                 ORDER BY created_at DESC LIMIT 1) AS final_status,
                telegram_id
            FROM trades t1
            WHERE martingale_run IS NOT NULL
            GROUP BY martingale_run
            UNION ALL
            SELECT CAST(id AS TEXT) AS martingale_run, status AS final_status, telegram_id
            FROM trades WHERE martingale_run IS NULL
        )
        SELECT
            COUNT(*)                                                AS total,
            SUM(CASE WHEN final_status = 'WIN'  THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN final_status = 'LOSS' THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN final_status = 'TIE'  THEN 1 ELSE 0 END) AS ties,
            (SELECT COALESCE(SUM(pnl), 0) FROM trades ${pnlWhere})  AS totalPnl
        FROM circle_results cr
        ${circleWhere}
    `;
    const row = (telegramId !== undefined
        ? db.prepare(sql).get(telegramId, telegramId)
        : db.prepare(sql).get());
    return {
        total: row.total ?? 0,
        wins: row.wins ?? 0,
        losses: row.losses ?? 0,
        ties: row.ties ?? 0,
        totalPnl: row.totalPnl ?? 0,
    };
}
export function getTopTradersToday(limit = 20) {
    return db.prepare(`
        SELECT t.telegram_id, u.username, COUNT(*) AS trade_count
        FROM trades t
        LEFT JOIN users u ON t.telegram_id = u.telegram_id
        WHERE date(t.created_at) = date('now')
          AND t.telegram_id IS NOT NULL
        GROUP BY t.telegram_id
        ORDER BY trade_count DESC
        LIMIT ?
    `).all(limit);
}
export function maskUserId(id) {
    const s = String(id);
    const half = Math.ceil(s.length / 2);
    return s.slice(0, half) + 'X'.repeat(s.length - half);
}
export function getUser(telegramId) {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}
export function findUsersByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username LIKE ? ORDER BY last_used DESC LIMIT 10').all(`%${username}%`);
}
export function saveUser(user) {
    db.prepare(`
        INSERT INTO users (telegram_id, ssid, last_used)
        VALUES (@telegram_id, @ssid, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET ssid = @ssid, last_used = datetime('now')
    `).run(user);
}
export function saveUsername(telegramId, username) {
    if (!username)
        return;
    db.prepare(`
        UPDATE users SET username = ?, last_used = datetime('now') WHERE telegram_id = ?
    `).run(username, telegramId);
}
export function upsertOnboardingUser(telegramId, iqUserId) {
    db.prepare(`
        INSERT INTO users (telegram_id, iq_user_id, approval_status)
        VALUES (?, ?, 'pending')
        ON CONFLICT(telegram_id) DO UPDATE SET iq_user_id = excluded.iq_user_id, last_used = datetime('now')
    `).run(telegramId, iqUserId);
}
export function approveUser(telegramId, affiliateData) {
    db.prepare(`
        UPDATE users
        SET approval_status = 'approved',
            approved_at     = datetime('now'),
            affiliate_data  = COALESCE(?, affiliate_data)
        WHERE telegram_id = ?
    `).run(affiliateData ?? null, telegramId);
}
export function setManualApproval(telegramId) {
    db.prepare(`UPDATE users SET approval_status = 'manual' WHERE telegram_id = ?`).run(telegramId);
}
export function rejectUser(telegramId) {
    db.prepare(`UPDATE users SET approval_status = 'rejected' WHERE telegram_id = ?`).run(telegramId);
}
export function resetUser(telegramId) {
    db.prepare(`UPDATE users SET ssid = NULL, iq_user_id = NULL, approval_status = 'pending' WHERE telegram_id = ?`).run(telegramId);
}
export function pauseUser(telegramId) {
    db.prepare(`UPDATE users SET approval_status = 'paused' WHERE telegram_id = ?`).run(telegramId);
}
export function resumeUser(telegramId) {
    db.prepare(`UPDATE users SET approval_status = 'approved' WHERE telegram_id = ?`).run(telegramId);
}
export function deleteUser(telegramId) {
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
}
export function setUserTier(telegramId, tier) {
    db.prepare('UPDATE users SET tier = ? WHERE telegram_id = ?').run(tier, telegramId);
}
export function getAllUsers() {
    return db.prepare('SELECT * FROM users ORDER BY last_used DESC').all();
}
export function getAllUserIds() {
    return db.prepare('SELECT telegram_id FROM users').all().map(r => r.telegram_id);
}
export function getActiveTraderIds(hours = 5) {
    return db.prepare(`
        SELECT DISTINCT telegram_id FROM trades
        WHERE created_at >= datetime('now', ? || ' hours')
          AND telegram_id IS NOT NULL
    `).all(`-${hours}`).map(r => r.telegram_id);
}
export function getInactiveTraderIds(hours = 5) {
    const activeIds = getActiveTraderIds(hours);
    if (activeIds.length === 0)
        return getAllUserIds();
    const placeholders = activeIds.map(() => '?').join(',');
    return db.prepare(`SELECT telegram_id FROM users WHERE telegram_id NOT IN (${placeholders})`).all(...activeIds).map(r => r.telegram_id);
}
export function getRecentApprovals(hours = 24) {
    return db.prepare(`
        SELECT * FROM users
        WHERE approval_status = 'approved'
          AND approved_at >= datetime('now', ? || ' hours')
        ORDER BY approved_at DESC
    `).all(`-${hours}`);
}
export function getPendingManualUsers() {
    return db.prepare(`
        SELECT * FROM users WHERE approval_status IN ('pending', 'manual') ORDER BY created_at DESC
    `).all();
}
export function getApprovalStats() {
    const row = db.prepare(`
        SELECT
            SUM(CASE WHEN approval_status = 'approved'  THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN approval_status = 'pending'   THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN approval_status = 'manual'    THEN 1 ELSE 0 END) AS manual,
            SUM(CASE WHEN approval_status = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
            COUNT(*)                                                         AS total
        FROM users
    `).get();
    return {
        approved: row.approved ?? 0,
        pending: row.pending ?? 0,
        manual: row.manual ?? 0,
        rejected: row.rejected ?? 0,
        total: row.total ?? 0,
    };
}
export function generateToken(tier) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const rand = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const token = `10X-${rand(4)}-${rand(4)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO tokens (token, tier, expires_at) VALUES (?, ?, ?)').run(token, tier, expiresAt);
    return token;
}
export function validateToken(token) {
    const rec = db.prepare('SELECT * FROM tokens WHERE token = ?').get(token);
    if (!rec)
        return { valid: false, error: 'Invalid token' };
    if (rec.used_by)
        return { valid: false, error: 'Token already used' };
    if (new Date(rec.expires_at) < new Date())
        return { valid: false, error: 'Token expired' };
    return { valid: true, tier: rec.tier };
}
export function useToken(token, telegramId) {
    const result = db.prepare(`
        UPDATE tokens SET used_by = ?, used_at = datetime('now')
        WHERE token = ? AND used_by IS NULL AND expires_at > datetime('now')
    `).run(telegramId, token);
    return result.changes > 0;
}
export function getTokens() {
    return db.prepare('SELECT * FROM tokens ORDER BY created_at DESC LIMIT 50').all();
}
// ─── Leaderboard ──────────────────────────────────────────────────────────────
export function updateLeaderboardAuto(telegramId, pnl) {
    if (pnl <= 0)
        return;
    const user = db.prepare('SELECT tier FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user || user.tier?.toUpperCase() !== 'PRO')
        return;
    const today = new Date().toISOString().split('T')[0];
    db.prepare(`
        INSERT INTO leaderboard (telegram_id, auto_profit, date)
        VALUES (?, ?, ?)
        ON CONFLICT(telegram_id, date) DO UPDATE SET
            auto_profit = auto_profit + excluded.auto_profit
        WHERE manual_profit IS NULL
    `).run(telegramId, pnl, today);
}
export function addLeaderboardManual(telegramId, profit) {
    const today = new Date().toISOString().split('T')[0];
    const count = db.prepare('SELECT COUNT(*) AS cnt FROM leaderboard WHERE date = ?').get(today).cnt;
    if (count >= 10)
        return false;
    db.prepare(`
        INSERT INTO leaderboard (telegram_id, auto_profit, manual_profit, date)
        VALUES (?, 0, ?, ?)
        ON CONFLICT(telegram_id, date) DO UPDATE SET manual_profit = excluded.manual_profit
    `).run(telegramId, profit, today);
    return true;
}
export function getLeaderboard(date) {
    const d = date ?? new Date().toISOString().split('T')[0];
    return db.prepare(`
        SELECT telegram_id,
               COALESCE(manual_profit, auto_profit) AS profit
        FROM leaderboard
        WHERE date = ?
        ORDER BY profit DESC
        LIMIT 10
    `).all(d);
}
export function getLeaderboardDetailed(date) {
    const d = date ?? new Date().toISOString().split('T')[0];
    return db.prepare(`
        SELECT id, telegram_id, auto_profit, manual_profit, date
        FROM leaderboard
        WHERE date = ?
        ORDER BY COALESCE(manual_profit, auto_profit) DESC
        LIMIT 10
    `).all(d);
}
export function updateLeaderboardManual(telegramId, profit) {
    const today = new Date().toISOString().split('T')[0];
    const result = db.prepare(`
        UPDATE leaderboard SET manual_profit = ?
        WHERE telegram_id = ? AND date = ? AND manual_profit IS NOT NULL
    `).run(profit, telegramId, today);
    return result.changes > 0;
}
// ─── Funnel ───────────────────────────────────────────────────────────────────
export function insertFunnelEvent(eventType, metadata) {
    db.prepare('INSERT INTO funnel_events (event_type, metadata) VALUES (?, ?)').run(eventType, metadata ?? null);
}
export function getFunnelStats() {
    const events = db.prepare(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE date(created_at) = date('now')`).get().cnt;
    const byType = db.prepare(`SELECT event_type, COUNT(*) AS cnt FROM funnel_events WHERE date(created_at) = date('now') GROUP BY event_type`).all();
    return { events, byType };
}
// ─── Config ───────────────────────────────────────────────────────────────────
export function getConfig(key) {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row?.value ?? null;
}
export function setConfig(key, value) {
    db.prepare(`
        INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
}
export function calculatePairWinRates() {
    return db.prepare(`
        WITH circle_results AS (
            SELECT
                martingale_run,
                (SELECT status FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS final_status,
                (SELECT pair   FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS pair
            FROM trades t1 WHERE martingale_run IS NOT NULL GROUP BY martingale_run
            UNION ALL
            SELECT CAST(id AS TEXT), status, pair FROM trades WHERE martingale_run IS NULL
        )
        SELECT
            pair,
            ROUND(CAST(SUM(CASE WHEN final_status = 'WIN' THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1) * 100, 1) AS winRate,
            COUNT(*) AS totalCircles
        FROM circle_results
        WHERE pair IS NOT NULL
        GROUP BY pair
        ORDER BY winRate DESC
    `).all();
}
export function selectTopPicks(rates) {
    const picks = [];
    const top90 = rates.find(r => r.winRate >= 90);
    if (top90)
        picks.push(top90);
    const top80 = rates.filter(r => !picks.includes(r) && r.winRate >= 80).slice(0, 2);
    picks.push(...top80);
    const top70 = rates.find(r => !picks.includes(r) && r.winRate >= 70);
    if (top70)
        picks.push(top70);
    const below70 = rates.find(r => !picks.includes(r) && r.winRate < 70);
    if (below70)
        picks.push(below70);
    const remaining = rates.filter(r => !picks.includes(r));
    while (picks.length < 5 && remaining.length > 0) {
        picks.push(remaining.shift());
    }
    return picks;
}
export function getAuditReport() {
    const tradeRow = db.prepare(`
        SELECT
            COUNT(*)                                          AS total,
            SUM(CASE WHEN status = 'WIN'  THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN status = 'TIE'  THEN 1 ELSE 0 END) AS ties,
            COALESCE(SUM(pnl), 0)                            AS totalPnl
        FROM trades
        WHERE created_at >= datetime('now', '-1 day')
    `).get();
    const userRow = db.prepare(`
        SELECT
            COUNT(*) AS new_users,
            SUM(CASE WHEN approval_status = 'approved'
                      AND approved_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS auto_approved,
            SUM(CASE WHEN approval_status = 'manual' THEN 1 ELSE 0 END) AS manual_pending
        FROM users
        WHERE created_at >= datetime('now', '-1 day')
    `).get();
    const mgRow = db.prepare(`
        SELECT
            COUNT(DISTINCT martingale_run)                                         AS runs,
            COUNT(DISTINCT CASE WHEN status = 'WIN' THEN martingale_run END)       AS recovered
        FROM trades
        WHERE created_at >= datetime('now', '-1 day')
          AND martingale_run IS NOT NULL AND martingale_run != ''
    `).get();
    const topRow = db.prepare(`
        SELECT telegram_id, COALESCE(SUM(pnl), 0) AS total_pnl
        FROM trades
        WHERE created_at >= datetime('now', '-1 day') AND telegram_id IS NOT NULL
        GROUP BY telegram_id
        ORDER BY total_pnl DESC
        LIMIT 1
    `).get();
    return {
        newUsers: userRow?.new_users ?? 0,
        autoApproved: userRow?.auto_approved ?? 0,
        manualPending: userRow?.manual_pending ?? 0,
        totalTrades: tradeRow?.total ?? 0,
        wins: tradeRow?.wins ?? 0,
        losses: tradeRow?.losses ?? 0,
        ties: tradeRow?.ties ?? 0,
        totalPnl: tradeRow?.totalPnl ?? 0,
        martingaleRuns: mgRow?.runs ?? 0,
        martingaleRecovered: mgRow?.recovered ?? 0,
        topPerformerId: topRow?.telegram_id,
        topPerformerProfit: topRow?.total_pnl,
    };
}
// ─── Session persistence ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
const stmtSetSession = db.prepare(`INSERT INTO sessions (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
const stmtGetSession = db.prepare(`SELECT value FROM sessions WHERE key = ?`);
const stmtDelSession = db.prepare(`DELETE FROM sessions WHERE key = ?`);
const stmtCleanSessions = db.prepare(`DELETE FROM sessions WHERE updated_at < datetime('now', '-7 days')`);
export function setSession(key, value) {
    stmtSetSession.run(key, JSON.stringify(value));
}
export function getSession(key) {
    const row = stmtGetSession.get(key);
    if (!row)
        return undefined;
    try {
        return JSON.parse(row.value);
    }
    catch {
        return undefined;
    }
}
export function deleteSession(key) {
    stmtDelSession.run(key);
}
export function cleanStaleSessions() {
    stmtCleanSessions.run();
}
