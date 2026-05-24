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
    tier            TEXT    NOT NULL DEFAULT 'DEMO',
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
            tier            TEXT    NOT NULL DEFAULT 'DEMO',
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
        db.exec("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'DEMO'");
}
// Additional column migrations (run after main table setup to get final state)
const finalUserCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!finalUserCols.includes('username'))
    db.exec('ALTER TABLE users ADD COLUMN username TEXT');
if (!finalUserCols.includes('currency'))
    db.exec("ALTER TABLE users ADD COLUMN currency TEXT DEFAULT 'USD'");
if (!finalUserCols.includes('simultaneous_trades'))
    db.exec('ALTER TABLE users ADD COLUMN simultaneous_trades INTEGER NOT NULL DEFAULT 1');
if (!finalUserCols.includes('gale_disabled'))
    db.exec('ALTER TABLE users ADD COLUMN gale_disabled INTEGER NOT NULL DEFAULT 0');
// V4 Phase 6: session persistence columns
if (!finalUserCols.includes('mg_enabled'))
    db.exec('ALTER TABLE users ADD COLUMN mg_enabled INTEGER NOT NULL DEFAULT 1');
if (!finalUserCols.includes('mg_max_rounds'))
    db.exec('ALTER TABLE users ADD COLUMN mg_max_rounds INTEGER NOT NULL DEFAULT 6');
if (!finalUserCols.includes('session_trades'))
    db.exec('ALTER TABLE users ADD COLUMN session_trades INTEGER NOT NULL DEFAULT 0');
if (!finalUserCols.includes('session_pnl'))
    db.exec('ALTER TABLE users ADD COLUMN session_pnl REAL NOT NULL DEFAULT 0');
if (!finalUserCols.includes('balance_cache'))
    db.exec('ALTER TABLE users ADD COLUMN balance_cache TEXT');
if (!finalUserCols.includes('balance_cache_ts'))
    db.exec('ALTER TABLE users ADD COLUMN balance_cache_ts TEXT');
// V4 tier migration: NEWBIE → DEMO (run-once, idempotent)
db.prepare("UPDATE users SET tier = 'DEMO' WHERE tier = 'NEWBIE'").run();
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
// ─── V4 tables ───────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS giveaway_events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type       TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    description      TEXT,
    criteria_type    TEXT,
    criteria_value   TEXT,
    prize_pool       REAL,
    prize_per_winner REAL,
    max_winners      INTEGER,
    status           TEXT    NOT NULL DEFAULT 'pending',
    starts_at        TEXT,
    ends_at          TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS giveaway_participants (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id  INTEGER NOT NULL REFERENCES giveaway_events(id),
    telegram_id  INTEGER NOT NULL,
    trade_count  INTEGER NOT NULL DEFAULT 0,
    eligible     INTEGER NOT NULL DEFAULT 1,
    joined_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS broadcast_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    type          TEXT    NOT NULL,
    category      TEXT,
    content       TEXT    NOT NULL,
    image_file_id TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    last_sent_at  TEXT,
    sent_count    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
{
    const bmCols = db.prepare('PRAGMA table_info(broadcast_messages)').all().map(c => c.name);
    if (!bmCols.includes('sent_count'))
        db.exec('ALTER TABLE broadcast_messages ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0');
}
{
    const autoCount = db.prepare("SELECT COUNT(*) AS cnt FROM broadcast_messages WHERE type = 'auto'").get().cnt;
    if (autoCount === 0) {
        const seed = [
            ['persuasion', "👀 Want to see the bot actually trade?\n\nDemo mode is risk-free.\nOne tap, one signal, one trade.\n\nWatch it work 👇"],
            ['social_proof', "💸 Another 10x user just banked +$270 CASH\n\nSame bot. Same signals. Real money.\nYou're still on demo coins.\n\nSwitch up 👇"],
            ['social_proof', "📊 71% of demo users upgraded to LIVE this week.\n\nThey didn't guess. They watched the bot win on demo first.\nThen they switched.\n\nRun your demo trade 👇"],
            ['urgency', "⏱ Markets don't wait. Every minute you're not trading is profit someone else is taking.\n\nTap Trade Now 👇"],
            ['persuasion', "🤑 Real money. Real wins. Real withdrawals.\n\nThe bot's been printing for users all day.\nYour account should be next.\n\nStart a trade 👇"],
            ['motivation', "🔋 Tired of watching others win while you sit out?\n\nOne trade changes everything.\nOne win builds momentum.\nOne session could pay your bills.\n\nTrade now 👇"],
            ['social_proof', "🏆 Top trader today banked +$890 in 3 trades.\n\nNo magic. Just the bot doing its job.\nThe same bot you have access to.\n\nUse it 👇"],
            ['urgency', "📈 The algorithm just fired a 84% confidence signal.\n\nThese don't come often. When they do, smart traders act.\n\nTap to catch this one 👇"],
            ['persuasion', "💡 Demo mode exists for ONE reason:\n\nSo you can see it work before you go live.\nIf you've seen it work… what are you waiting for?\n\nGo live 👇"],
            ['motivation', "🎯 Your next trade could be the one that pays for your week.\n\nThe bot is online. Signals are firing. Account is ready.\n\nWhat's stopping you? 👇"],
        ];
        const ins = db.prepare("INSERT INTO broadcast_messages (type, category, content) VALUES ('auto', ?, ?)");
        for (const [cat, content] of seed)
            ins.run(cat, content);
        console.log('[db] seeded 10 auto broadcast messages');
    }
}
db.exec(`
  CREATE TABLE IF NOT EXISTS channel_approvals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL UNIQUE,
    approved    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
// ─── V4.2 Giveaway table migrations ──────────────────────────────────────────
{
    const geCols = db.prepare('PRAGMA table_info(giveaway_events)').all().map(c => c.name);
    if (!geCols.includes('winner_count'))
        db.exec('ALTER TABLE giveaway_events ADD COLUMN winner_count INTEGER NOT NULL DEFAULT 0');
}
{
    const gpCols = db.prepare('PRAGMA table_info(giveaway_participants)').all().map(c => c.name);
    if (!gpCols.includes('disqualify_reason'))
        db.exec('ALTER TABLE giveaway_participants ADD COLUMN disqualify_reason TEXT');
    if (!gpCols.includes('winner'))
        db.exec('ALTER TABLE giveaway_participants ADD COLUMN winner INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_gp_unique ON giveaway_participants(giveaway_id, telegram_id);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS giveaway_updates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id     INTEGER NOT NULL REFERENCES giveaway_events(id),
    participant_id  INTEGER NOT NULL REFERENCES giveaway_participants(id),
    telegram_id     INTEGER NOT NULL,
    update_type     TEXT    NOT NULL,
    update_text     TEXT,
    sent            INTEGER NOT NULL DEFAULT 0,
    send_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS motivational_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications_queue (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id          INTEGER NOT NULL,
    message              TEXT    NOT NULL,
    reply_markup         TEXT,
    image_file_id        TEXT,
    delete_after_seconds INTEGER DEFAULT NULL,
    priority             INTEGER NOT NULL DEFAULT 0,
    status               TEXT    NOT NULL DEFAULT 'pending',
    send_after           TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_gp_giveaway_id ON giveaway_participants(giveaway_id);
  CREATE INDEX IF NOT EXISTS idx_gp_telegram_id ON giveaway_participants(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_gu_send_at ON giveaway_updates(send_at, sent);
  CREATE INDEX IF NOT EXISTS idx_nq_status ON notifications_queue(status, send_after);
`);
{
    const motCount = db.prepare('SELECT COUNT(*) AS cnt FROM motivational_messages').get().cnt;
    if (motCount === 0) {
        const templates = [
            ['persuasion', "Giveaway is still on — you still have a chance to win *${prize_per_winner}*. Don't sit this one out 👇"],
            ['urgency', "⏳ Winners will be selected soon. You can still participate and claim your share of *${prize_pool}*."],
            ['social_proof', "🔥 *${count}* traders already joined this giveaway. Every second you wait = less chance to win."],
            ['persuasion', "Someone's going to win *${prize_per_winner}*. Why not you? Join now 👇"],
            ['urgency', "🚨 Last chance! Winners picked in *${time_left}*. Tap Participate now."],
            ['social_proof', "💸 *${recent_winner}* just claimed a prize last giveaway. This could be you next."],
            ['persuasion', "Trade more, win more. The *${title}* giveaway rewards the most active traders 🏆"],
            ['urgency', "Not in yet? *${spots_left}* winners will split *${prize_pool}*. Your move 👇"],
        ];
        const ins = db.prepare('INSERT INTO motivational_messages (category, content) VALUES (?, ?)');
        for (const [cat, content] of templates)
            ins.run(cat, content);
    }
}
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
export function saveUserCurrency(telegramId, currency) {
    db.prepare('UPDATE users SET currency = ? WHERE telegram_id = ?').run(currency, telegramId);
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
export function getUserMartingaleSettings(telegramId) {
    const row = db.prepare('SELECT mg_enabled, mg_max_rounds FROM users WHERE telegram_id = ?').get(telegramId);
    return { enabled: row?.mg_enabled !== 0, maxRounds: row?.mg_max_rounds ?? 6 };
}
export function setUserMartingaleSettings(telegramId, enabled, maxRounds) {
    db.prepare('UPDATE users SET mg_enabled = ?, mg_max_rounds = ? WHERE telegram_id = ?').run(enabled ? 1 : 0, maxRounds, telegramId);
}
export function getUserSessionStats(telegramId) {
    const row = db.prepare('SELECT session_trades, session_pnl FROM users WHERE telegram_id = ?').get(telegramId);
    return { trades: row?.session_trades ?? 0, pnl: row?.session_pnl ?? 0 };
}
export function addUserSessionStats(telegramId, tradeDelta, pnlDelta) {
    db.prepare('UPDATE users SET session_trades = session_trades + ?, session_pnl = session_pnl + ? WHERE telegram_id = ?').run(tradeDelta, pnlDelta, telegramId);
}
export function getUserBalanceCache(telegramId) {
    const row = db.prepare('SELECT balance_cache, balance_cache_ts FROM users WHERE telegram_id = ?').get(telegramId);
    if (!row?.balance_cache || !row.balance_cache_ts)
        return undefined;
    return { line: row.balance_cache, ts: new Date(row.balance_cache_ts).getTime() };
}
export function setUserBalanceCache(telegramId, line) {
    db.prepare("UPDATE users SET balance_cache = ?, balance_cache_ts = datetime('now') WHERE telegram_id = ?").run(line, telegramId);
}
export function clearUserBalanceCache(telegramId) {
    db.prepare('UPDATE users SET balance_cache = NULL, balance_cache_ts = NULL WHERE telegram_id = ?').run(telegramId);
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
// ─── Channel message tracking ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    direction   TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_tid ON messages(telegram_id, created_at);
`);
export function insertMessage(telegramId, direction) {
    db.prepare('INSERT INTO messages (telegram_id, direction) VALUES (?, ?)').run(telegramId, direction);
}
export function getRecentlyApprovedUsers(minutes) {
    return db.prepare(`
        SELECT * FROM users
        WHERE approval_status = 'approved'
          AND approved_at >= datetime('now', ? || ' minutes')
        ORDER BY approved_at DESC
    `).all(`-${minutes}`);
}
export function userHasActivity(telegramId) {
    const user = getUser(telegramId);
    if (!user || !user.last_used)
        return false;
    const lastUsed = new Date(user.last_used).getTime();
    const approvedAt = user.approved_at ? new Date(user.approved_at).getTime() : 0;
    return lastUsed > approvedAt;
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
// ─── Giveaway ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS giveaway_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_run  TEXT    NOT NULL,
    generated_id  TEXT    NOT NULL UNIQUE,
    pattern       TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_giveaway_log_generated_id ON giveaway_log(generated_id);
`);
export function saveGeneratedGiveawayId(giveawayRun, generatedId, pattern) {
    db.prepare(`INSERT OR IGNORE INTO giveaway_log (giveaway_run, generated_id, pattern) VALUES (?, ?, ?)`).run(giveawayRun, generatedId, pattern);
}
export function isGeneratedIdUsed(generatedId) {
    const inLog = db.prepare(`SELECT 1 FROM giveaway_log WHERE generated_id = ?`).get(generatedId);
    if (inLog)
        return true;
    const inUsers = db.prepare(`SELECT 1 FROM users WHERE CAST(iq_user_id AS TEXT) = ?`).get(generatedId);
    return !!inUsers;
}
export function getTradersIqUserIds(hours) {
    const rows = db.prepare(`
        SELECT DISTINCT u.iq_user_id
        FROM trades t
        JOIN users u ON u.telegram_id = t.telegram_id
        WHERE t.created_at >= datetime('now', ? || ' hours')
          AND u.iq_user_id IS NOT NULL
    `).all(`-${hours}`);
    return rows.map(r => r.iq_user_id);
}
export function getGiveawayTargetIds(target) {
    const rows = target === '24h'
        ? db.prepare(`SELECT DISTINCT telegram_id FROM trades WHERE created_at >= datetime('now', '-24 hours') AND telegram_id IS NOT NULL`).all()
        : db.prepare(`SELECT telegram_id FROM users WHERE approval_status = 'approved'`).all();
    return rows.map(r => r.telegram_id);
}
// ─── Fabricated Traders (Dynamic Leaderboard) ─────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS fabricated_traders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    fabricated_id    TEXT    NOT NULL UNIQUE,
    display_name     TEXT    NOT NULL,
    current_pnl      REAL    NOT NULL DEFAULT 0,
    next_update_at   TEXT,
    update_interval  INTEGER NOT NULL DEFAULT 3600,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_fab_next_update ON fabricated_traders(next_update_at);
`);
export function countFabricatedTraders() {
    return db.prepare(`SELECT COUNT(*) AS cnt FROM fabricated_traders`).get().cnt;
}
export function seedFabricatedTraders() {
    const seedIds = getTradersIqUserIds(48);
    const prefixes = seedIds.length > 0
        ? seedIds.map(id => String(id).slice(0, 3).padStart(3, '0'))
        : ['182', '511', '447', '329', '613'];
    for (let i = 0; i < 10; i++) {
        let fabricatedId = null;
        for (let attempt = 0; attempt < 30 && !fabricatedId; attempt++) {
            const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
            const candidate = prefix + suffix;
            const inUsers = db.prepare(`SELECT 1 FROM users WHERE CAST(iq_user_id AS TEXT) = ?`).get(candidate);
            const inGiveaway = db.prepare(`SELECT 1 FROM giveaway_log WHERE generated_id = ?`).get(candidate);
            const inFab = db.prepare(`SELECT 1 FROM fabricated_traders WHERE fabricated_id = ?`).get(candidate);
            if (!inUsers && !inGiveaway && !inFab)
                fabricatedId = candidate;
        }
        if (!fabricatedId)
            continue;
        const displayName = `${fabricatedId.slice(0, 3)}***${fabricatedId.slice(-3)}`;
        const startPnl = 10 + Math.floor(Math.random() * 4991);
        const intervalSec = 3600 + Math.floor(Math.random() * 32401);
        const nextUpdateAt = new Date(Date.now() + intervalSec * 1000).toISOString().replace('T', ' ').split('.')[0];
        db.prepare(`
            INSERT OR IGNORE INTO fabricated_traders
                (fabricated_id, display_name, current_pnl, next_update_at, update_interval)
            VALUES (?, ?, ?, ?, ?)
        `).run(fabricatedId, displayName, startPnl, nextUpdateAt, intervalSec);
    }
}
export function getFabricatedTradersDueForUpdate() {
    return db.prepare(`
        SELECT * FROM fabricated_traders
        WHERE next_update_at IS NULL OR next_update_at <= datetime('now')
    `).all();
}
export function updateFabricatedPnl(id, newPnl, nextUpdateAt) {
    db.prepare(`
        UPDATE fabricated_traders SET current_pnl = ?, next_update_at = ? WHERE id = ?
    `).run(newPnl, nextUpdateAt, id);
}
export function getAllFabricatedTraders() {
    return db.prepare(`
        SELECT * FROM fabricated_traders ORDER BY current_pnl DESC
    `).all();
}
export function resetFabricatedPnl() {
    db.prepare(`UPDATE fabricated_traders SET current_pnl = 0, next_update_at = NULL`).run();
}
export function getRealTraderLeaderboard() {
    const today = new Date().toISOString().split('T')[0];
    return db.prepare(`
        SELECT l.telegram_id,
               u.username,
               COALESCE(l.manual_profit, l.auto_profit) AS total_pnl
        FROM leaderboard l
        LEFT JOIN users u ON u.telegram_id = l.telegram_id
        WHERE l.date = ?
        ORDER BY total_pnl DESC
    `).all(today);
}
export function dbCreateGiveawayEvent(input) {
    const prizePerWinner = (input.prize_pool != null && input.max_winners > 0)
        ? input.prize_pool / input.max_winners : null;
    const result = db.prepare(`
        INSERT INTO giveaway_events
            (event_type, title, description, criteria_type, criteria_value,
             prize_pool, prize_per_winner, max_winners, starts_at, ends_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(input.event_type, input.title, input.description ?? null, input.criteria_type ?? null, input.criteria_value ?? null, input.prize_pool ?? null, prizePerWinner, input.max_winners, input.starts_at ?? null, input.ends_at ?? null);
    return result.lastInsertRowid;
}
export function getGiveawayEvent(id) {
    return db.prepare('SELECT * FROM giveaway_events WHERE id = ?').get(id);
}
export function getGiveawayEvents(status) {
    if (status) {
        return db.prepare('SELECT * FROM giveaway_events WHERE status = ? ORDER BY created_at DESC').all(status);
    }
    return db.prepare('SELECT * FROM giveaway_events ORDER BY created_at DESC LIMIT 50').all();
}
export function getActiveGiveaways() {
    return db.prepare("SELECT * FROM giveaway_events WHERE status = 'active' ORDER BY created_at DESC").all();
}
export function setGiveawayStatus(id, status) {
    db.prepare('UPDATE giveaway_events SET status = ? WHERE id = ?').run(status, id);
}
export function incrementGiveawayWinnerCount(id) {
    db.prepare('UPDATE giveaway_events SET winner_count = winner_count + 1 WHERE id = ?').run(id);
}
export function getGiveawayParticipant(giveawayId, telegramId) {
    return db.prepare('SELECT * FROM giveaway_participants WHERE giveaway_id = ? AND telegram_id = ?').get(giveawayId, telegramId);
}
export function insertGiveawayParticipant(giveawayId, telegramId) {
    const result = db.prepare(`
        INSERT INTO giveaway_participants (giveaway_id, telegram_id)
        VALUES (?, ?)
        ON CONFLICT(giveaway_id, telegram_id) DO NOTHING
    `).run(giveawayId, telegramId);
    if (result.changes === 0) {
        return getGiveawayParticipant(giveawayId, telegramId).id;
    }
    return result.lastInsertRowid;
}
export function getGiveawayParticipants(giveawayId, eligibleOnly = false) {
    if (eligibleOnly) {
        return db.prepare('SELECT * FROM giveaway_participants WHERE giveaway_id = ? AND eligible = 1 ORDER BY trade_count DESC, joined_at').all(giveawayId);
    }
    return db.prepare('SELECT * FROM giveaway_participants WHERE giveaway_id = ? ORDER BY joined_at').all(giveawayId);
}
export function getGiveawayParticipantCount(giveawayId) {
    return db.prepare('SELECT COUNT(*) AS cnt FROM giveaway_participants WHERE giveaway_id = ? AND eligible = 1').get(giveawayId).cnt;
}
export function incrementParticipantTradeCount(participantId) {
    db.prepare('UPDATE giveaway_participants SET trade_count = trade_count + 1 WHERE id = ?').run(participantId);
}
export function setParticipantWinner(participantId) {
    db.prepare('UPDATE giveaway_participants SET winner = 1 WHERE id = ?').run(participantId);
}
export function disqualifyParticipant(participantId, reason) {
    db.prepare('UPDATE giveaway_participants SET eligible = 0, disqualify_reason = ? WHERE id = ?').run(reason, participantId);
}
export function getActiveParticipations(telegramId) {
    return db.prepare(`
        SELECT gp.id AS participation_id, gp.giveaway_id,
               ge.criteria_type, ge.title, ge.prize_per_winner, ge.prize_pool
        FROM giveaway_participants gp
        JOIN giveaway_events ge ON ge.id = gp.giveaway_id
        WHERE gp.telegram_id = ? AND ge.status = 'active' AND gp.eligible = 1
    `).all(telegramId);
}
export function insertGiveawayUpdate(giveawayId, participantId, telegramId, type, text, sendAt) {
    db.prepare(`
        INSERT INTO giveaway_updates
            (giveaway_id, participant_id, telegram_id, update_type, update_text, send_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(giveawayId, participantId, telegramId, type, text, sendAt);
}
export function getPendingGiveawayUpdates() {
    return db.prepare(`
        SELECT * FROM giveaway_updates
        WHERE sent = 0 AND send_at <= datetime('now')
        ORDER BY send_at LIMIT 50
    `).all();
}
export function markGiveawayUpdateSent(id) {
    db.prepare('UPDATE giveaway_updates SET sent = 1 WHERE id = ?').run(id);
}
export function getRandomMotivationalMessage(category) {
    if (category) {
        return db.prepare('SELECT * FROM motivational_messages WHERE enabled = 1 AND category = ? ORDER BY RANDOM() LIMIT 1').get(category);
    }
    return db.prepare('SELECT * FROM motivational_messages WHERE enabled = 1 ORDER BY RANDOM() LIMIT 1').get();
}
export function insertNotification(telegramId, message, opts) {
    db.prepare(`
        INSERT INTO notifications_queue
            (telegram_id, message, reply_markup, image_file_id, delete_after_seconds, priority, send_after)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(telegramId, message, opts?.replyMarkup ?? null, opts?.imageFileId ?? null, opts?.deleteAfterSeconds ?? null, opts?.priority ?? 0, opts?.sendAfter ?? null);
}
export function getPendingNotifications(limit = 20) {
    return db.prepare(`
        SELECT * FROM notifications_queue
        WHERE status = 'pending'
          AND (send_after IS NULL OR send_after <= datetime('now'))
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
    `).all(limit);
}
export function markNotificationSent(id) {
    db.prepare("UPDATE notifications_queue SET status = 'sent' WHERE id = ?").run(id);
}
export function markNotificationFailed(id) {
    db.prepare("UPDATE notifications_queue SET status = 'failed' WHERE id = ?").run(id);
}
export function getApprovedUsersWithTier() {
    return db.prepare("SELECT telegram_id, tier FROM users WHERE approval_status = 'approved'").all();
}
export function getEnabledAutoMessages() {
    return db.prepare("SELECT * FROM broadcast_messages WHERE type = 'auto' AND enabled = 1 ORDER BY id").all();
}
export function getBroadcastMessages(type) {
    if (type) {
        return db.prepare('SELECT * FROM broadcast_messages WHERE type = ? ORDER BY created_at DESC').all(type);
    }
    return db.prepare('SELECT * FROM broadcast_messages ORDER BY created_at DESC LIMIT 50').all();
}
export function insertBroadcastMessage(type, content, category, imageFileId) {
    const result = db.prepare(`
        INSERT INTO broadcast_messages (type, category, content, image_file_id)
        VALUES (?, ?, ?, ?)
    `).run(type, category ?? null, content, imageFileId ?? null);
    return result.lastInsertRowid;
}
export function markBroadcastSent(id, count) {
    db.prepare(`
        UPDATE broadcast_messages
        SET last_sent_at = datetime('now'), sent_count = sent_count + ?
        WHERE id = ?
    `).run(count, id);
}
export function updateBroadcastImageFileId(id, imageFileId) {
    db.prepare('UPDATE broadcast_messages SET image_file_id = ? WHERE id = ?').run(imageFileId, id);
}
export function getGiveawayStats() {
    const row = db.prepare(`
        SELECT
            SUM(CASE WHEN status = 'active'    THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS scheduled,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
        FROM giveaway_events
    `).get();
    return {
        active: row.active ?? 0,
        scheduled: row.scheduled ?? 0,
        completed: row.completed ?? 0,
    };
}
