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
const existingCols = (db.prepare('PRAGMA table_info(trades)').all() as { name: string }[]).map(c => c.name);
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
const userColInfo = db.prepare('PRAGMA table_info(users)').all() as { name: string; notnull: number }[];
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
} else {
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
const finalUserCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
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

// ─── Trades ──────────────────────────────────────────────────────────────────

export interface TradeRecord {
    id?: number;
    telegram_id?: number;
    pair: string;
    direction: string;
    amount: number;
    status: 'WIN' | 'LOSS' | 'TIE' | 'TIMEOUT' | 'ERROR';
    pnl: number;
    trade_id?: number;
    error?: string;
    martingale_run?: string;
    created_at?: string;
}

export interface TradeStats {
    total: number;
    wins: number;
    losses: number;
    ties: number;
    totalPnl: number;
}

const insertStmt = db.prepare(`
    INSERT INTO trades (telegram_id, pair, direction, amount, status, pnl, trade_id, error, martingale_run)
    VALUES (@telegram_id, @pair, @direction, @amount, @status, @pnl, @trade_id, @error, @martingale_run)
`);

export function insertTrade(t: TradeRecord): void {
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

export function getRecentTrades(limit = 10, telegramId?: number): TradeRecord[] {
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
        return db.prepare(sql).all(telegramId, limit) as TradeRecord[];
    }
    return db.prepare(sql).all(limit) as TradeRecord[];
}

export function getTradeStats(telegramId?: number): TradeStats {
    const pnlWhere  = telegramId !== undefined ? 'WHERE telegram_id = ?' : '';
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
        : db.prepare(sql).get()
    ) as { total: number; wins: number; losses: number; ties: number; totalPnl: number };

    return {
        total: row.total ?? 0,
        wins: row.wins ?? 0,
        losses: row.losses ?? 0,
        ties: row.ties ?? 0,
        totalPnl: row.totalPnl ?? 0,
    };
}

export function getTopTradersToday(limit = 20): Array<{ telegram_id: number; username: string | null; trade_count: number }> {
    return db.prepare(`
        SELECT t.telegram_id, u.username, COUNT(*) AS trade_count
        FROM trades t
        LEFT JOIN users u ON t.telegram_id = u.telegram_id
        WHERE date(t.created_at) = date('now')
          AND t.telegram_id IS NOT NULL
        GROUP BY t.telegram_id
        ORDER BY trade_count DESC
        LIMIT ?
    `).all(limit) as Array<{ telegram_id: number; username: string | null; trade_count: number }>;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'manual' | 'rejected' | 'paused';

export interface UserRecord {
    telegram_id: number;
    username?: string | null;
    ssid?: string | null;
    iq_user_id?: number | null;
    approval_status: ApprovalStatus;
    approved_at?: string | null;
    affiliate_data?: string | null;
    tier?: string | null;
    created_at?: string;
    last_used?: string;
}

export function maskUserId(id: number): string {
    const s = String(id);
    const half = Math.ceil(s.length / 2);
    return s.slice(0, half) + 'X'.repeat(s.length - half);
}

export function getUser(telegramId: number): UserRecord | undefined {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRecord | undefined;
}

export function findUsersByUsername(username: string): UserRecord[] {
    return db.prepare(
        'SELECT * FROM users WHERE username LIKE ? ORDER BY last_used DESC LIMIT 10'
    ).all(`%${username}%`) as UserRecord[];
}

export function saveUser(user: Pick<UserRecord, 'telegram_id' | 'ssid'>): void {
    db.prepare(`
        INSERT INTO users (telegram_id, ssid, last_used)
        VALUES (@telegram_id, @ssid, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET ssid = @ssid, last_used = datetime('now')
    `).run(user);
}

export function saveUsername(telegramId: number, username: string | undefined): void {
    if (!username) return;
    db.prepare(`
        UPDATE users SET username = ?, last_used = datetime('now') WHERE telegram_id = ?
    `).run(username, telegramId);
}

export function upsertOnboardingUser(telegramId: number, iqUserId: number): void {
    db.prepare(`
        INSERT INTO users (telegram_id, iq_user_id, approval_status)
        VALUES (?, ?, 'pending')
        ON CONFLICT(telegram_id) DO UPDATE SET iq_user_id = excluded.iq_user_id, last_used = datetime('now')
    `).run(telegramId, iqUserId);
}

export function approveUser(telegramId: number, affiliateData?: string): void {
    db.prepare(`
        UPDATE users
        SET approval_status = 'approved',
            approved_at     = datetime('now'),
            affiliate_data  = COALESCE(?, affiliate_data)
        WHERE telegram_id = ?
    `).run(affiliateData ?? null, telegramId);
}

export function setManualApproval(telegramId: number): void {
    db.prepare(`UPDATE users SET approval_status = 'manual' WHERE telegram_id = ?`).run(telegramId);
}

export function rejectUser(telegramId: number): void {
    db.prepare(`UPDATE users SET approval_status = 'rejected' WHERE telegram_id = ?`).run(telegramId);
}

export function pauseUser(telegramId: number): void {
    db.prepare(`UPDATE users SET approval_status = 'paused' WHERE telegram_id = ?`).run(telegramId);
}

export function resumeUser(telegramId: number): void {
    db.prepare(`UPDATE users SET approval_status = 'approved' WHERE telegram_id = ?`).run(telegramId);
}

export function deleteUser(telegramId: number): void {
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
}

export function setUserTier(telegramId: number, tier: string): void {
    db.prepare('UPDATE users SET tier = ? WHERE telegram_id = ?').run(tier, telegramId);
}

export function getAllUsers(): UserRecord[] {
    return db.prepare('SELECT * FROM users ORDER BY last_used DESC').all() as UserRecord[];
}

export function getAllUserIds(): number[] {
    return (db.prepare('SELECT telegram_id FROM users').all() as { telegram_id: number }[]).map(r => r.telegram_id);
}

export function getActiveTraderIds(hours = 5): number[] {
    return (db.prepare(`
        SELECT DISTINCT telegram_id FROM trades
        WHERE created_at >= datetime('now', ? || ' hours')
          AND telegram_id IS NOT NULL
    `).all(`-${hours}`) as { telegram_id: number }[]).map(r => r.telegram_id);
}

export function getInactiveTraderIds(hours = 5): number[] {
    const activeIds = getActiveTraderIds(hours);
    if (activeIds.length === 0) return getAllUserIds();
    const placeholders = activeIds.map(() => '?').join(',');
    return (db.prepare(
        `SELECT telegram_id FROM users WHERE telegram_id NOT IN (${placeholders})`
    ).all(...activeIds) as { telegram_id: number }[]).map(r => r.telegram_id);
}

export function getRecentApprovals(hours = 24): UserRecord[] {
    return db.prepare(`
        SELECT * FROM users
        WHERE approval_status = 'approved'
          AND approved_at >= datetime('now', ? || ' hours')
        ORDER BY approved_at DESC
    `).all(`-${hours}`) as UserRecord[];
}

export function getPendingManualUsers(): UserRecord[] {
    return db.prepare(`
        SELECT * FROM users WHERE approval_status IN ('pending', 'manual') ORDER BY created_at DESC
    `).all() as UserRecord[];
}

export interface ApprovalStats {
    approved: number;
    pending: number;
    manual: number;
    rejected: number;
    total: number;
}

export function getApprovalStats(): ApprovalStats {
    const row = db.prepare(`
        SELECT
            SUM(CASE WHEN approval_status = 'approved'  THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN approval_status = 'pending'   THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN approval_status = 'manual'    THEN 1 ELSE 0 END) AS manual,
            SUM(CASE WHEN approval_status = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
            COUNT(*)                                                         AS total
        FROM users
    `).get() as ApprovalStats;
    return {
        approved: row.approved ?? 0,
        pending:  row.pending  ?? 0,
        manual:   row.manual   ?? 0,
        rejected: row.rejected ?? 0,
        total:    row.total    ?? 0,
    };
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

export interface TokenRecord {
    id: number;
    token: string;
    tier: string;
    used_by?: number | null;
    used_at?: string | null;
    expires_at: string;
    created_at: string;
}

export function generateToken(tier: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const rand = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const token = `10X-${rand(4)}-${rand(4)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO tokens (token, tier, expires_at) VALUES (?, ?, ?)').run(token, tier, expiresAt);
    return token;
}

export function validateToken(token: string): { valid: boolean; tier?: string; error?: string } {
    const rec = db.prepare('SELECT * FROM tokens WHERE token = ?').get(token) as TokenRecord | undefined;
    if (!rec) return { valid: false, error: 'Invalid token' };
    if (rec.used_by) return { valid: false, error: 'Token already used' };
    if (new Date(rec.expires_at) < new Date()) return { valid: false, error: 'Token expired' };
    return { valid: true, tier: rec.tier };
}

export function useToken(token: string, telegramId: number): boolean {
    const result = db.prepare(`
        UPDATE tokens SET used_by = ?, used_at = datetime('now')
        WHERE token = ? AND used_by IS NULL AND expires_at > datetime('now')
    `).run(telegramId, token);
    return (result as { changes: number }).changes > 0;
}

export function getTokens(): TokenRecord[] {
    return db.prepare('SELECT * FROM tokens ORDER BY created_at DESC LIMIT 50').all() as TokenRecord[];
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export function updateLeaderboardAuto(telegramId: number, pnl: number): void {
    if (pnl <= 0) return;
    const user = db.prepare('SELECT tier FROM users WHERE telegram_id = ?').get(telegramId) as { tier: string } | undefined;
    if (!user || user.tier?.toUpperCase() !== 'PRO') return;
    const today = new Date().toISOString().split('T')[0];
    db.prepare(`
        INSERT INTO leaderboard (telegram_id, auto_profit, date)
        VALUES (?, ?, ?)
        ON CONFLICT(telegram_id, date) DO UPDATE SET
            auto_profit = auto_profit + excluded.auto_profit
        WHERE manual_profit IS NULL
    `).run(telegramId, pnl, today);
}

export function addLeaderboardManual(telegramId: number, profit: number): boolean {
    const today = new Date().toISOString().split('T')[0];
    const count = (db.prepare(
        'SELECT COUNT(*) AS cnt FROM leaderboard WHERE date = ?'
    ).get(today) as { cnt: number }).cnt;
    if (count >= 10) return false;
    db.prepare(`
        INSERT INTO leaderboard (telegram_id, auto_profit, manual_profit, date)
        VALUES (?, 0, ?, ?)
        ON CONFLICT(telegram_id, date) DO UPDATE SET manual_profit = excluded.manual_profit
    `).run(telegramId, profit, today);
    return true;
}

export function getLeaderboard(date?: string): Array<{ telegram_id: number; profit: number }> {
    const d = date ?? new Date().toISOString().split('T')[0];
    return db.prepare(`
        SELECT telegram_id,
               COALESCE(manual_profit, auto_profit) AS profit
        FROM leaderboard
        WHERE date = ?
        ORDER BY profit DESC
        LIMIT 10
    `).all(d) as Array<{ telegram_id: number; profit: number }>;
}

export interface LeaderboardDetailedEntry {
    id: number;
    telegram_id: number;
    auto_profit: number;
    manual_profit: number | null;
    date: string;
}

export function getLeaderboardDetailed(date?: string): LeaderboardDetailedEntry[] {
    const d = date ?? new Date().toISOString().split('T')[0];
    return db.prepare(`
        SELECT id, telegram_id, auto_profit, manual_profit, date
        FROM leaderboard
        WHERE date = ?
        ORDER BY COALESCE(manual_profit, auto_profit) DESC
        LIMIT 10
    `).all(d) as LeaderboardDetailedEntry[];
}

export function updateLeaderboardManual(telegramId: number, profit: number): boolean {
    const today = new Date().toISOString().split('T')[0];
    const result = db.prepare(`
        UPDATE leaderboard SET manual_profit = ?
        WHERE telegram_id = ? AND date = ? AND manual_profit IS NOT NULL
    `).run(profit, telegramId, today);
    return (result as { changes: number }).changes > 0;
}

// ─── Funnel ───────────────────────────────────────────────────────────────────

export function insertFunnelEvent(eventType: string, metadata?: string): void {
    db.prepare('INSERT INTO funnel_events (event_type, metadata) VALUES (?, ?)').run(eventType, metadata ?? null);
}

export function getFunnelStats(): { events: number; byType: Array<{ event_type: string; cnt: number }> } {
    const events = (db.prepare(
        `SELECT COUNT(*) AS cnt FROM funnel_events WHERE date(created_at) = date('now')`
    ).get() as { cnt: number }).cnt;
    const byType = db.prepare(
        `SELECT event_type, COUNT(*) AS cnt FROM funnel_events WHERE date(created_at) = date('now') GROUP BY event_type`
    ).all() as Array<{ event_type: string; cnt: number }>;
    return { events, byType };
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function getConfig(key: string): string | null {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
    db.prepare(`
        INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
}

// ─── Pair win rates ───────────────────────────────────────────────────────────

export interface PairWinRate {
    pair: string;
    winRate: number;
    totalCircles: number;
}

export function calculatePairWinRates(): PairWinRate[] {
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
    `).all() as PairWinRate[];
}

export function selectTopPicks(rates: PairWinRate[]): PairWinRate[] {
    const picks: PairWinRate[] = [];

    const top90 = rates.find(r => r.winRate >= 90);
    if (top90) picks.push(top90);

    const top80 = rates.filter(r => !picks.includes(r) && r.winRate >= 80).slice(0, 2);
    picks.push(...top80);

    const top70 = rates.find(r => !picks.includes(r) && r.winRate >= 70);
    if (top70) picks.push(top70);

    const below70 = rates.find(r => !picks.includes(r) && r.winRate < 70);
    if (below70) picks.push(below70);

    const remaining = rates.filter(r => !picks.includes(r));
    while (picks.length < 5 && remaining.length > 0) {
        picks.push(remaining.shift()!);
    }

    return picks;
}

// ─── Audit report ─────────────────────────────────────────────────────────────

export interface AuditReport {
    newUsers: number;
    autoApproved: number;
    manualPending: number;
    totalTrades: number;
    wins: number;
    losses: number;
    ties: number;
    totalPnl: number;
    martingaleRuns: number;
    martingaleRecovered: number;
    topPerformerId?: number;
    topPerformerProfit?: number;
}

export function getAuditReport(): AuditReport {
    const tradeRow = db.prepare(`
        SELECT
            COUNT(*)                                          AS total,
            SUM(CASE WHEN status = 'WIN'  THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN status = 'TIE'  THEN 1 ELSE 0 END) AS ties,
            COALESCE(SUM(pnl), 0)                            AS totalPnl
        FROM trades
        WHERE created_at >= datetime('now', '-1 day')
    `).get() as { total: number; wins: number; losses: number; ties: number; totalPnl: number };

    const userRow = db.prepare(`
        SELECT
            COUNT(*) AS new_users,
            SUM(CASE WHEN approval_status = 'approved'
                      AND approved_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS auto_approved,
            SUM(CASE WHEN approval_status = 'manual' THEN 1 ELSE 0 END) AS manual_pending
        FROM users
        WHERE created_at >= datetime('now', '-1 day')
    `).get() as { new_users: number; auto_approved: number; manual_pending: number };

    const mgRow = db.prepare(`
        SELECT
            COUNT(DISTINCT martingale_run)                                         AS runs,
            COUNT(DISTINCT CASE WHEN status = 'WIN' THEN martingale_run END)       AS recovered
        FROM trades
        WHERE created_at >= datetime('now', '-1 day')
          AND martingale_run IS NOT NULL AND martingale_run != ''
    `).get() as { runs: number; recovered: number };

    const topRow = db.prepare(`
        SELECT telegram_id, COALESCE(SUM(pnl), 0) AS total_pnl
        FROM trades
        WHERE created_at >= datetime('now', '-1 day') AND telegram_id IS NOT NULL
        GROUP BY telegram_id
        ORDER BY total_pnl DESC
        LIMIT 1
    `).get() as { telegram_id: number; total_pnl: number } | undefined;

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

const stmtSetSession = db.prepare(
    `INSERT INTO sessions (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
);
const stmtGetSession = db.prepare(`SELECT value FROM sessions WHERE key = ?`);
const stmtDelSession = db.prepare(`DELETE FROM sessions WHERE key = ?`);
const stmtCleanSessions = db.prepare(
    `DELETE FROM sessions WHERE updated_at < datetime('now', '-7 days')`
);

export function setSession(key: string, value: unknown): void {
    stmtSetSession.run(key, JSON.stringify(value));
}

export function getSession<T>(key: string): T | undefined {
    const row = stmtGetSession.get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.value) as T; } catch { return undefined; }
}

export function deleteSession(key: string): void {
    stmtDelSession.run(key);
}

export function cleanStaleSessions(): void {
    stmtCleanSessions.run();
}
