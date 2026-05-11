import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH ?? path.resolve('iqbot-v3.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
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

// Migration: add martingale_run column to databases created before Section 3
const existingCols = (db.prepare('PRAGMA table_info(trades)').all() as { name: string }[]).map(c => c.name);
if (!existingCols.includes('martingale_run')) {
    db.exec('ALTER TABLE trades ADD COLUMN martingale_run TEXT');
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
}

// ─── Trades ──────────────────────────────────────────────────────────────────

export interface TradeRecord {
    id?: number;
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
    INSERT INTO trades (pair, direction, amount, status, pnl, trade_id, error, martingale_run)
    VALUES (@pair, @direction, @amount, @status, @pnl, @trade_id, @error, @martingale_run)
`);

export function insertTrade(t: TradeRecord): void {
    insertStmt.run({
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

export function getRecentTrades(limit = 10): TradeRecord[] {
    return db.prepare(
        'SELECT * FROM trades ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as TradeRecord[];
}

export function getTradeStats(): TradeStats {
    const row = db.prepare(`
        SELECT
            COUNT(*)                                          AS total,
            SUM(CASE WHEN status = 'WIN'  THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN status = 'TIE'  THEN 1 ELSE 0 END) AS ties,
            COALESCE(SUM(pnl), 0)                             AS totalPnl
        FROM trades
    `).get() as { total: number; wins: number; losses: number; ties: number; totalPnl: number };

    return {
        total: row.total ?? 0,
        wins: row.wins ?? 0,
        losses: row.losses ?? 0,
        ties: row.ties ?? 0,
        totalPnl: row.totalPnl ?? 0,
    };
}

// ─── Users ───────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'manual' | 'rejected';

export interface UserRecord {
    telegram_id: number;
    ssid?: string | null;
    iq_user_id?: number | null;
    approval_status: ApprovalStatus;
    approved_at?: string | null;
    affiliate_data?: string | null;
    created_at?: string;
    last_used?: string;
}

export function getUser(telegramId: number): UserRecord | undefined {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRecord | undefined;
}

export function saveUser(user: Pick<UserRecord, 'telegram_id' | 'ssid'>): void {
    db.prepare(`
        INSERT INTO users (telegram_id, ssid, last_used)
        VALUES (@telegram_id, @ssid, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET ssid = @ssid, last_used = datetime('now')
    `).run(user);
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

export function deleteUser(telegramId: number): void {
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
}

export function getAllUsers(): UserRecord[] {
    return db.prepare('SELECT * FROM users ORDER BY last_used DESC').all() as UserRecord[];
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
