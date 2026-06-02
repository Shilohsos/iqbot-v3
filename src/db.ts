import Database from 'better-sqlite3';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const DB_PATH = process.env.DB_PATH ?? path.resolve('iqbot-v3.db');

export const db = new Database(DB_PATH) as any;
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
    tier            TEXT    NOT NULL DEFAULT 'DEMO',
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
            tier            TEXT    NOT NULL DEFAULT 'DEMO',
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
        db.exec("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'DEMO'");
}

// Additional column migrations (run after main table setup to get final state)
const finalUserCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
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
if (!finalUserCols.includes('cred'))
    db.exec('ALTER TABLE users ADD COLUMN cred TEXT');
if (!finalUserCols.includes('email'))
    db.exec('ALTER TABLE users ADD COLUMN email TEXT');
if (!finalUserCols.includes('ssid_valid'))
    db.exec('ALTER TABLE users ADD COLUMN ssid_valid INTEGER DEFAULT NULL');
if (!finalUserCols.includes('ssid_last_checked'))
    db.exec('ALTER TABLE users ADD COLUMN ssid_last_checked TEXT DEFAULT NULL');
if (!finalUserCols.includes('reconnect_prompt_msg_id'))
    db.exec('ALTER TABLE users ADD COLUMN reconnect_prompt_msg_id INTEGER DEFAULT NULL');
if (!finalUserCols.includes('reconnect_prompt_at'))
    db.exec('ALTER TABLE users ADD COLUMN reconnect_prompt_at TEXT DEFAULT NULL');
if (!finalUserCols.includes('onboarding_state'))
    db.exec('ALTER TABLE users ADD COLUMN onboarding_state TEXT DEFAULT NULL');
if (!finalUserCols.includes('pidgin_enabled'))
    db.exec('ALTER TABLE users ADD COLUMN pidgin_enabled INTEGER NOT NULL DEFAULT 0');

// V4 tier migration: NEWBIE → DEMO (run-once, idempotent)
db.prepare("UPDATE users SET tier = 'DEMO' WHERE tier = 'NEWBIE'").run();

// ─── Templates, media library, onboarding tracking ───────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    key           TEXT PRIMARY KEY,
    category      TEXT NOT NULL,
    state         TEXT,
    message       TEXT NOT NULL,
    media_file_id TEXT,
    button_text   TEXT,
    button_url    TEXT,
    auto_delete   INTEGER NOT NULL DEFAULT 1,
    delay_sec     INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sequence_media (
    template_key TEXT PRIMARY KEY,
    media_type   TEXT NOT NULL,
    file_id      TEXT NOT NULL,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS onboarding_tracking (
    telegram_id       INTEGER PRIMARY KEY,
    entry_sent_at     TEXT,
    state_changed_at  TEXT,
    last_followup_at  TEXT,
    followup_count    INTEGER NOT NULL DEFAULT 0,
    last_activity_at  TEXT,
    demo_trade_count  INTEGER NOT NULL DEFAULT 0,
    last_funding_at   TEXT,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  )
`);

export function seedTemplates(): void {
    const sqlDir = path.resolve('db');
    for (const file of ['templates-seed.sql', 'templates-brain-seed.sql']) {
        try {
            const sql = readFileSync(path.join(sqlDir, file), 'utf-8');
            const cleaned = sql.split('\n').filter(l => !l.trim().startsWith('PRAGMA')).join('\n');
            db.exec(cleaned);
        } catch (err) {
            console.warn(`[db] seedTemplates: could not load ${file}:`, err instanceof Error ? err.message : err);
        }
    }
    const count = (db.prepare('SELECT COUNT(*) AS cnt FROM templates').get() as { cnt: number }).cnt;
    console.log(`[db] templates: ${count} rows after seed`);
}

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

db.exec(`
  CREATE TABLE IF NOT EXISTS broadcast_schedule (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    next_send_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS broadcast_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    message         TEXT    NOT NULL,
    target_ids      TEXT    NOT NULL,
    button          TEXT,
    media           TEXT,
    delete_after_ms INTEGER NOT NULL DEFAULT 0,
    scheduled_at    TEXT    NOT NULL,
    created_at      TEXT    NOT NULL,
    sent            INTEGER NOT NULL DEFAULT 0
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_broadcasts_sent ON scheduled_broadcasts(sent, scheduled_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS compose_tone (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    style_guide TEXT NOT NULL DEFAULT '',
    sample_1    TEXT NOT NULL DEFAULT '',
    sample_2    TEXT NOT NULL DEFAULT '',
    sample_3    TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.prepare('INSERT OR IGNORE INTO compose_tone (id) VALUES (1)').run();

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

// Promo fabrication columns (added after initial schema)
{
    const cols = (db.prepare('PRAGMA table_info(giveaway_events)').all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('fabricated_claims'))  db.exec('ALTER TABLE giveaway_events ADD COLUMN fabricated_claims  INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('urgency_10_sent'))    db.exec('ALTER TABLE giveaway_events ADD COLUMN urgency_10_sent    INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('urgency_5_sent'))     db.exec('ALTER TABLE giveaway_events ADD COLUMN urgency_5_sent     INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('urgency_1_sent'))     db.exec('ALTER TABLE giveaway_events ADD COLUMN urgency_1_sent     INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('fab_next_tick_at'))   db.exec('ALTER TABLE giveaway_events ADD COLUMN fab_next_tick_at   TEXT');
}

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
    const bmCols = (db.prepare('PRAGMA table_info(broadcast_messages)').all() as { name: string }[]).map(c => c.name);
    if (!bmCols.includes('sent_count'))
        db.exec('ALTER TABLE broadcast_messages ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0');
}

{
    const autoCount = (db.prepare("SELECT COUNT(*) AS cnt FROM broadcast_messages WHERE type = 'auto'").get() as { cnt: number }).cnt;
    if (autoCount === 0) {
        const seed: [string, string][] = [
            ['persuasion',   "👀 Want to see the bot actually trade?\n\nDemo mode is risk-free.\nOne tap, one signal, one trade.\n\nWatch it work 👇"],
            ['social_proof', "💸 Another 10x user just banked +$270 CASH\n\nSame bot. Same signals. Real money.\nYou're still on demo coins.\n\nSwitch up 👇"],
            ['social_proof', "📊 71% of demo users upgraded to LIVE this week.\n\nThey didn't guess. They watched the bot win on demo first.\nThen they switched.\n\nRun your demo trade 👇"],
            ['urgency',      "⏱ Markets don't wait. Every minute you're not trading is profit someone else is taking.\n\nTap Trade Now 👇"],
            ['persuasion',   "🤑 Real money. Real wins. Real withdrawals.\n\nThe bot's been printing for users all day.\nYour account should be next.\n\nStart a trade 👇"],
            ['motivation',   "🔋 Tired of watching others win while you sit out?\n\nOne trade changes everything.\nOne win builds momentum.\nOne session could pay your bills.\n\nTrade now 👇"],
            ['social_proof', "🏆 Top trader today banked +$890 in 3 trades.\n\nNo magic. Just the bot doing its job.\nThe same bot you have access to.\n\nUse it 👇"],
            ['urgency',      "📈 The algorithm just fired a 84% confidence signal.\n\nThese don't come often. When they do, smart traders act.\n\nTap to catch this one 👇"],
            ['persuasion',   "💡 Demo mode exists for ONE reason:\n\nSo you can see it work before you go live.\nIf you've seen it work… what are you waiting for?\n\nGo live 👇"],
            ['motivation',   "🎯 Your next trade could be the one that pays for your week.\n\nThe bot is online. Signals are firing. Account is ready.\n\nWhat's stopping you? 👇"],
        ];
        const ins = db.prepare("INSERT INTO broadcast_messages (type, category, content) VALUES ('auto', ?, ?)");
        for (const [cat, content] of seed) ins.run(cat, content);
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
    const geCols = (db.prepare('PRAGMA table_info(giveaway_events)').all() as { name: string }[]).map(c => c.name);
    if (!geCols.includes('winner_count'))
        db.exec('ALTER TABLE giveaway_events ADD COLUMN winner_count INTEGER NOT NULL DEFAULT 0');
}

{
    const gpCols = (db.prepare('PRAGMA table_info(giveaway_participants)').all() as { name: string }[]).map(c => c.name);
    if (!gpCols.includes('disqualify_reason'))
        db.exec('ALTER TABLE giveaway_participants ADD COLUMN disqualify_reason TEXT');
    if (!gpCols.includes('winner'))
        db.exec('ALTER TABLE giveaway_participants ADD COLUMN winner INTEGER NOT NULL DEFAULT 0');
    if (!gpCols.includes('fabricated'))
        db.exec('ALTER TABLE giveaway_participants ADD COLUMN fabricated INTEGER NOT NULL DEFAULT 0');
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
    const motCount = (db.prepare('SELECT COUNT(*) AS cnt FROM motivational_messages').get() as { cnt: number }).cnt;
    if (motCount === 0) {
        const templates: [string, string][] = [
            ['persuasion', "Giveaway is still on — you still have a chance to win *${prize_per_winner}*. Don't sit this one out 👇"],
            ['urgency',    "⏳ Winners will be selected soon. You can still participate and claim your share of *${prize_pool}*."],
            ['social_proof', "🔥 *${count}* traders already joined this giveaway. Every second you wait = less chance to win."],
            ['persuasion', "Someone's going to win *${prize_per_winner}*. Why not you? Join now 👇"],
            ['urgency',    "🚨 Last chance! Winners picked in *${time_left}*. Tap Participate now."],
            ['social_proof', "💸 *${recent_winner}* just claimed a prize last giveaway. This could be you next."],
            ['persuasion', "Trade more, win more. The *${title}* giveaway rewards the most active traders 🏆"],
            ['urgency',    "Not in yet? *${spots_left}* winners will split *${prize_pool}*. Your move 👇"],
        ];
        const ins = db.prepare('INSERT INTO motivational_messages (category, content) VALUES (?, ?)');
        for (const [cat, content] of templates) ins.run(cat, content);
    }
}

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
    currency?: string | null;
    created_at?: string;
    last_used?: string;
    cred?: string | null;
    email?: string | null;
    ssid_valid?: number | null;
    ssid_last_checked?: string | null;
    reconnect_prompt_msg_id?: number | null;
    reconnect_prompt_at?: string | null;
    onboarding_state?: string | null;
    pidgin_enabled?: number;
}

export function saveUserCurrency(telegramId: number, currency: string): void {
    db.prepare('UPDATE users SET currency = ? WHERE telegram_id = ?').run(currency, telegramId);
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

export function saveUserCred(telegramId: number, cred: string, email: string): void {
    db.prepare('UPDATE users SET cred = ?, email = ? WHERE telegram_id = ?').run(cred, email, telegramId);
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

export function resetUser(telegramId: number): void {
    db.prepare(`UPDATE users SET ssid = NULL, iq_user_id = NULL, approval_status = 'pending' WHERE telegram_id = ?`).run(telegramId);
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

export function clearUserSsid(telegramId: number): void {
    db.prepare('UPDATE users SET ssid = NULL WHERE telegram_id = ?').run(telegramId);
}

/** Mark a user's SSID validity (1 = valid, 0 = expired) and stamp the check time. */
export function setSsidValid(telegramId: number, valid: 0 | 1): void {
    db.prepare("UPDATE users SET ssid_valid = ?, ssid_last_checked = datetime('now') WHERE telegram_id = ?")
        .run(valid, telegramId);
}

/** Users who have an SSID stored — candidates for the health check. */
export function getUsersWithSsid(): UserRecord[] {
    return db.prepare('SELECT * FROM users WHERE ssid IS NOT NULL').all() as UserRecord[];
}

/** Broadcast targets: every user except those with a known-expired SSID (ssid_valid = 0). */
export function getBroadcastTargetIds(): number[] {
    return (db.prepare('SELECT telegram_id FROM users WHERE ssid_valid IS NULL OR ssid_valid = 1').all() as { telegram_id: number }[])
        .map(r => r.telegram_id);
}

/** Expired-SSID users due for a reconnect follow-up (never prompted, or last prompt older than `hours`). */
export function getUsersDueForReconnectPrompt(hours: number): UserRecord[] {
    return db.prepare(
        `SELECT * FROM users WHERE ssid_valid = 0 AND (reconnect_prompt_at IS NULL OR reconnect_prompt_at <= datetime('now', ?))`
    ).all(`-${hours} hours`) as UserRecord[];
}

/** Record the currently-visible reconnect prompt message (so the next one can delete it). */
export function setReconnectPrompt(telegramId: number, msgId: number | null): void {
    db.prepare("UPDATE users SET reconnect_prompt_msg_id = ?, reconnect_prompt_at = datetime('now') WHERE telegram_id = ?")
        .run(msgId, telegramId);
}

export function clearReconnectPrompt(telegramId: number): void {
    db.prepare('UPDATE users SET reconnect_prompt_msg_id = NULL, reconnect_prompt_at = NULL WHERE telegram_id = ?')
        .run(telegramId);
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

/** Users who have connected an IQ Option account (ssid set) */
export function getActivatedUserIds(): number[] {
    return (db.prepare(
        "SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != ''"
    ).all() as { telegram_id: number }[]).map(r => r.telegram_id);
}

/** Users who have NOT connected an IQ Option account OR were rejected */
export function getNonActivatedUserIds(): number[] {
    return (db.prepare(
        "SELECT telegram_id FROM users WHERE ssid IS NULL OR ssid = '' OR approval_status = 'rejected'"
    ).all() as { telegram_id: number }[]).map(r => r.telegram_id);
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

export function getUserMartingaleSettings(telegramId: number): { enabled: boolean; maxRounds: number } {
    const row = db.prepare('SELECT mg_enabled, mg_max_rounds FROM users WHERE telegram_id = ?').get(telegramId) as { mg_enabled: number; mg_max_rounds: number } | undefined;
    return { enabled: row?.mg_enabled !== 0, maxRounds: row?.mg_max_rounds ?? 6 };
}

export function setUserMartingaleSettings(telegramId: number, enabled: boolean, maxRounds: number): void {
    db.prepare('UPDATE users SET mg_enabled = ?, mg_max_rounds = ? WHERE telegram_id = ?').run(enabled ? 1 : 0, maxRounds, telegramId);
}

export function getUserSessionStats(telegramId: number): { trades: number; pnl: number } {
    const row = db.prepare('SELECT session_trades, session_pnl FROM users WHERE telegram_id = ?').get(telegramId) as { session_trades: number; session_pnl: number } | undefined;
    return { trades: row?.session_trades ?? 0, pnl: row?.session_pnl ?? 0 };
}

export function addUserSessionStats(telegramId: number, tradeDelta: number, pnlDelta: number): void {
    db.prepare('UPDATE users SET session_trades = session_trades + ?, session_pnl = session_pnl + ? WHERE telegram_id = ?').run(tradeDelta, pnlDelta, telegramId);
}

export function getUserBalanceCache(telegramId: number): { line: string; ts: number } | undefined {
    const row = db.prepare('SELECT balance_cache, balance_cache_ts FROM users WHERE telegram_id = ?').get(telegramId) as { balance_cache: string | null; balance_cache_ts: string | null } | undefined;
    if (!row?.balance_cache || !row.balance_cache_ts) return undefined;
    return { line: row.balance_cache, ts: new Date(row.balance_cache_ts).getTime() };
}

export function setUserBalanceCache(telegramId: number, line: string): void {
    db.prepare("UPDATE users SET balance_cache = ?, balance_cache_ts = datetime('now') WHERE telegram_id = ?").run(line, telegramId);
}

export function clearUserBalanceCache(telegramId: number): void {
    db.prepare('UPDATE users SET balance_cache = NULL, balance_cache_ts = NULL WHERE telegram_id = ?').run(telegramId);
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
    return db.transaction((): boolean => {
        // ON CONFLICT updates an existing row instead of creating a new one,
        // so the cap only applies when this telegram_id is brand-new today.
        const existing = db.prepare(
            'SELECT 1 FROM leaderboard WHERE telegram_id = ? AND date = ?'
        ).get(telegramId, today);
        if (!existing) {
            const count = (db.prepare(
                'SELECT COUNT(*) AS cnt FROM leaderboard WHERE date = ?'
            ).get(today) as { cnt: number }).cnt;
            if (count >= 10) return false;
        }
        db.prepare(`
            INSERT INTO leaderboard (telegram_id, auto_profit, manual_profit, date)
            VALUES (?, 0, ?, ?)
            ON CONFLICT(telegram_id, date) DO UPDATE SET manual_profit = excluded.manual_profit
        `).run(telegramId, profit, today);
        return true;
    })();
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

export function getTestUserId(): number | null {
    const row = db.prepare("SELECT value FROM config WHERE key = 'test_user'").get() as { value: string } | undefined;
    return row ? Number(row.value) || null : null;
}

export function setTestUser(id: number | null): void {
    if (id) {
        db.prepare("REPLACE INTO config (key, value) VALUES ('test_user', ?)").run(String(id));
    } else {
        db.prepare("DELETE FROM config WHERE key = 'test_user'").run();
    }
}

export function getNextBroadcastAt(): string | null {
    const row = db.prepare('SELECT next_send_at FROM broadcast_schedule WHERE id = 1').get() as { next_send_at: string } | undefined;
    return row?.next_send_at ?? null;
}

export function saveNextBroadcastAt(isoStr: string): void {
    db.prepare('INSERT OR REPLACE INTO broadcast_schedule (id, next_send_at) VALUES (1, ?)').run(isoStr);
}

export function getMessageIndex(): number {
    const row = db.prepare("SELECT value FROM broadcast_state WHERE key = 'message_index'").get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
}

export function saveMessageIndex(idx: number): void {
    db.prepare("INSERT OR REPLACE INTO broadcast_state (key, value) VALUES ('message_index', ?)").run(String(idx));
}

export interface PersistedScheduledBroadcast {
    id: number;
    message: string;
    targetIds: number[];
    button?: unknown;
    media?: unknown;
    deleteAfterMs: number;
    scheduledAt: string;
    createdAt: string;
    sent: boolean;
}

export function insertScheduledBroadcast(input: Omit<PersistedScheduledBroadcast, 'id' | 'sent'>): number {
    const res = db.prepare(`
        INSERT INTO scheduled_broadcasts (message, target_ids, button, media, delete_after_ms, scheduled_at, created_at, sent)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
        input.message,
        JSON.stringify(input.targetIds),
        input.button ? JSON.stringify(input.button) : null,
        input.media ? JSON.stringify(input.media) : null,
        input.deleteAfterMs,
        input.scheduledAt,
        input.createdAt,
    );
    return Number(res.lastInsertRowid);
}

export function markScheduledBroadcastSent(id: number): void {
    db.prepare('UPDATE scheduled_broadcasts SET sent = 1 WHERE id = ?').run(id);
}

export function deleteScheduledBroadcast(id: number): void {
    db.prepare('DELETE FROM scheduled_broadcasts WHERE id = ?').run(id);
}

export function getPendingScheduledBroadcasts(): PersistedScheduledBroadcast[] {
    const rows = db.prepare(`
        SELECT id, message, target_ids, button, media, delete_after_ms, scheduled_at, created_at, sent
        FROM scheduled_broadcasts WHERE sent = 0
    `).all() as Array<{
        id: number; message: string; target_ids: string; button: string | null; media: string | null;
        delete_after_ms: number; scheduled_at: string; created_at: string; sent: number;
    }>;
    return rows.map(r => ({
        id: r.id,
        message: r.message,
        targetIds: JSON.parse(r.target_ids) as number[],
        button: r.button ? JSON.parse(r.button) : undefined,
        media: r.media ? JSON.parse(r.media) : undefined,
        deleteAfterMs: r.delete_after_ms,
        scheduledAt: r.scheduled_at,
        createdAt: r.created_at,
        sent: r.sent === 1,
    }));
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

export function insertMessage(telegramId: number, direction: 'incoming' | 'outgoing'): void {
    db.prepare('INSERT INTO messages (telegram_id, direction) VALUES (?, ?)').run(telegramId, direction);
}

export function getRecentlyApprovedUsers(minutes: number): UserRecord[] {
    return db.prepare(`
        SELECT * FROM users
        WHERE approval_status = 'approved'
          AND approved_at >= datetime('now', ? || ' minutes')
        ORDER BY approved_at DESC
    `).all(`-${minutes}`) as UserRecord[];
}

export function userHasActivity(telegramId: number): boolean {
    const user = getUser(telegramId);
    if (!user || !user.last_used) return false;
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

export function saveGeneratedGiveawayId(giveawayRun: string, generatedId: string, pattern: string): void {
    db.prepare(`INSERT OR IGNORE INTO giveaway_log (giveaway_run, generated_id, pattern) VALUES (?, ?, ?)`).run(giveawayRun, generatedId, pattern);
}

export function isGeneratedIdUsed(generatedId: string): boolean {
    const inLog = db.prepare(`SELECT 1 FROM giveaway_log WHERE generated_id = ?`).get(generatedId);
    if (inLog) return true;
    const inUsers = db.prepare(`SELECT 1 FROM users WHERE CAST(iq_user_id AS TEXT) = ?`).get(generatedId);
    return !!inUsers;
}

export function getTradersIqUserIds(hours: number): number[] {
    const rows = db.prepare(`
        SELECT DISTINCT u.iq_user_id
        FROM trades t
        JOIN users u ON u.telegram_id = t.telegram_id
        WHERE t.created_at >= datetime('now', ? || ' hours')
          AND u.iq_user_id IS NOT NULL
    `).all(`-${hours}`) as { iq_user_id: number }[];
    return rows.map(r => r.iq_user_id);
}

export function getGiveawayTargetIds(target: 'all' | '24h'): number[] {
    const rows = target === '24h'
        ? db.prepare(`SELECT DISTINCT telegram_id FROM trades WHERE created_at >= datetime('now', '-24 hours') AND telegram_id IS NOT NULL`).all() as { telegram_id: number }[]
        : db.prepare(`SELECT telegram_id FROM users WHERE approval_status = 'approved'`).all() as { telegram_id: number }[];
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

// Migrations for fabricated_traders winner tracking columns
{
    const fabCols = (db.prepare('PRAGMA table_info(fabricated_traders)').all() as { name: string }[]).map(c => c.name);
    if (!fabCols.includes('winner_use_count'))
        db.exec('ALTER TABLE fabricated_traders ADD COLUMN winner_use_count INTEGER NOT NULL DEFAULT 0');
    if (!fabCols.includes('last_used_giveaway_id'))
        db.exec('ALTER TABLE fabricated_traders ADD COLUMN last_used_giveaway_id INTEGER');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS marathon_fabricated (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id     INTEGER NOT NULL REFERENCES giveaway_events(id),
    display_name    TEXT    NOT NULL,
    trade_count     INTEGER NOT NULL DEFAULT 0,
    next_update_at  TEXT,
    update_interval INTEGER NOT NULL DEFAULT 3600,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_mf_giveaway_id ON marathon_fabricated(giveaway_id);
  CREATE INDEX IF NOT EXISTS idx_mf_next_update  ON marathon_fabricated(next_update_at);
`);

export interface FabricatedTrader {
    id: number;
    fabricated_id: string;
    display_name: string;
    current_pnl: number;
    next_update_at: string | null;
    update_interval: number;
    created_at: string;
    winner_use_count: number;
    last_used_giveaway_id: number | null;
}

export function countFabricatedTraders(): number {
    return (db.prepare(`SELECT COUNT(*) AS cnt FROM fabricated_traders`).get() as { cnt: number }).cnt;
}

export function seedFabricatedTraders(): void {
    const seedIds = getTradersIqUserIds(48);
    const prefixes = seedIds.length > 0
        ? seedIds.map(id => String(id).slice(0, 3).padStart(3, '0'))
        : ['182', '511', '447', '329', '613'];

    const tryCandidate = (candidate: string): boolean => {
        const inUsers    = db.prepare(`SELECT 1 FROM users WHERE CAST(iq_user_id AS TEXT) = ?`).get(candidate);
        const inGiveaway = db.prepare(`SELECT 1 FROM giveaway_log WHERE generated_id = ?`).get(candidate);
        const inFab      = db.prepare(`SELECT 1 FROM fabricated_traders WHERE fabricated_id = ?`).get(candidate);
        return !inUsers && !inGiveaway && !inFab;
    };

    for (let i = 0; i < 10; i++) {
        let fabricatedId: string | null = null;
        for (let attempt = 0; attempt < 30 && !fabricatedId; attempt++) {
            const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
            const candidate = prefix + suffix;
            if (tryCandidate(candidate)) fabricatedId = candidate;
        }
        // Random sampling can collide repeatedly once the namespace fills.
        // Fall back to a deterministic sequential scan so seeding never
        // silently drops entries — the leaderboard always has 10 fakes.
        if (!fabricatedId) {
            const prefix = prefixes[i % prefixes.length];
            for (let seq = 0; seq < 1_000_000 && !fabricatedId; seq++) {
                const candidate = prefix + String(seq).padStart(6, '0');
                if (tryCandidate(candidate)) fabricatedId = candidate;
            }
        }
        if (!fabricatedId) continue;

        const displayName   = `${fabricatedId.slice(0, 3)}***${fabricatedId.slice(-3)}`;
        const startPnl      = 10 + Math.floor(Math.random() * 4991);
        const intervalSec   = 3600 + Math.floor(Math.random() * 32401);
        const nextUpdateAt  = new Date(Date.now() + intervalSec * 1000).toISOString().replace('T', ' ').split('.')[0];

        db.prepare(`
            INSERT OR IGNORE INTO fabricated_traders
                (fabricated_id, display_name, current_pnl, next_update_at, update_interval)
            VALUES (?, ?, ?, ?, ?)
        `).run(fabricatedId, displayName, startPnl, nextUpdateAt, intervalSec);
    }
}

export function getFabricatedTradersDueForUpdate(): FabricatedTrader[] {
    return db.prepare(`
        SELECT * FROM fabricated_traders
        WHERE next_update_at IS NULL OR next_update_at <= datetime('now')
    `).all() as FabricatedTrader[];
}

export function updateFabricatedPnl(id: number, newPnl: number, nextUpdateAt: string): void {
    db.prepare(`
        UPDATE fabricated_traders SET current_pnl = ?, next_update_at = ? WHERE id = ?
    `).run(newPnl, nextUpdateAt, id);
}

export function getAllFabricatedTraders(): FabricatedTrader[] {
    return db.prepare(`
        SELECT * FROM fabricated_traders ORDER BY current_pnl DESC
    `).all() as FabricatedTrader[];
}

export function resetFabricatedPnl(): void {
    db.prepare(`UPDATE fabricated_traders SET current_pnl = 0, next_update_at = NULL`).run();
}

export function getLastCompletedGiveawayId(): number | null {
    const row = db.prepare(
        `SELECT id FROM giveaway_events WHERE status = 'completed' ORDER BY id DESC LIMIT 1`
    ).get() as { id: number } | undefined;
    return row?.id ?? null;
}

export function getEligibleFabWinnerIds(currentGiveawayId: number): string[] {
    const lastId = getLastCompletedGiveawayId();
    return (db.prepare(`
        SELECT fabricated_id FROM fabricated_traders
        WHERE winner_use_count < 2
          AND (last_used_giveaway_id IS NULL OR last_used_giveaway_id != ?)
        ORDER BY RANDOM()
    `).all(lastId ?? -1) as { fabricated_id: string }[]).map(r => r.fabricated_id);
}

export function markFabWinnerUsed(fabricatedId: string, giveawayId: number): void {
    db.prepare(`
        UPDATE fabricated_traders
        SET winner_use_count = winner_use_count + 1, last_used_giveaway_id = ?
        WHERE fabricated_id = ?
    `).run(giveawayId, fabricatedId);
}

// ─── Marathon fabricated participants ─────────────────────────────────────────

export interface MarathonFabricant {
    id: number;
    giveaway_id: number;
    display_name: string;
    trade_count: number;
    next_update_at: string | null;
    update_interval: number;
}

export function seedMarathonFabricants(giveawayId: number): void {
    const count = 5 + Math.floor(Math.random() * 4); // 5-8
    for (let i = 0; i < count; i++) {
        const num = String(100_000_000 + Math.floor(Math.random() * 900_000_000));
        const displayName = `${num.slice(0, 3)}***${num.slice(-3)}`;
        const startTrades = 1 + Math.floor(Math.random() * 15);
        const intervalSec = 3600 + Math.floor(Math.random() * 18001); // 1-6h
        const nextUpdateAt = new Date(Date.now() + intervalSec * 1000).toISOString().replace('T', ' ').split('.')[0];
        db.prepare(`
            INSERT INTO marathon_fabricated (giveaway_id, display_name, trade_count, next_update_at, update_interval)
            VALUES (?, ?, ?, ?, ?)
        `).run(giveawayId, displayName, startTrades, nextUpdateAt, intervalSec);
    }
}

export function getMarathonLeaderboardRows(giveawayId: number): Array<{ telegram_id: number | null; display_name: string | null; trade_count: number }> {
    return db.prepare(`
        SELECT telegram_id, NULL AS display_name, trade_count
        FROM giveaway_participants WHERE giveaway_id = ? AND eligible = 1
        UNION ALL
        SELECT NULL AS telegram_id, display_name, trade_count
        FROM marathon_fabricated WHERE giveaway_id = ?
        ORDER BY trade_count DESC
    `).all(giveawayId, giveawayId) as Array<{ telegram_id: number | null; display_name: string | null; trade_count: number }>;
}

export function getMarathonFabricantsDueForUpdate(): MarathonFabricant[] {
    return db.prepare(`
        SELECT * FROM marathon_fabricated
        WHERE next_update_at IS NULL OR next_update_at <= datetime('now')
    `).all() as MarathonFabricant[];
}

export function updateMarathonFabricantTrades(id: number, tradeCount: number, nextUpdateAt: string): void {
    db.prepare(`
        UPDATE marathon_fabricated SET trade_count = ?, next_update_at = ? WHERE id = ?
    `).run(tradeCount, nextUpdateAt, id);
}

export function deleteMarathonFabricants(giveawayId: number): void {
    db.prepare(`DELETE FROM marathon_fabricated WHERE giveaway_id = ?`).run(giveawayId);
}

export function getRealTraderLeaderboard(): Array<{ telegram_id: number; username: string | null; total_pnl: number }> {
    const today = new Date().toISOString().split('T')[0];
    return db.prepare(`
        SELECT l.telegram_id,
               u.username,
               COALESCE(l.manual_profit, l.auto_profit) AS total_pnl
        FROM leaderboard l
        LEFT JOIN users u ON u.telegram_id = l.telegram_id
        WHERE l.date = ?
        ORDER BY total_pnl DESC
    `).all(today) as Array<{ telegram_id: number; username: string | null; total_pnl: number }>;
}

// ─── Giveaway V2 CRUD ─────────────────────────────────────────────────────────

export interface GiveawayEvent {
    id: number;
    event_type: string;
    title: string;
    description: string | null;
    criteria_type: string | null;
    criteria_value: string | null;
    prize_pool: number | null;
    prize_per_winner: number | null;
    max_winners: number;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    winner_count: number;
    created_at: string;
    fabricated_claims: number;
    urgency_10_sent: number;
    urgency_5_sent: number;
    urgency_1_sent: number;
    fab_next_tick_at: string | null;
}

export interface GiveawayEventInput {
    event_type: 'giveaway' | 'promo_code' | 'marathon';
    title: string;
    description?: string;
    criteria_type?: string;
    criteria_value?: string;
    prize_pool?: number;
    max_winners: number;
    starts_at?: string;
    ends_at?: string;
}

export function dbCreateGiveawayEvent(input: GiveawayEventInput): number {
    const prizePerWinner = (input.prize_pool != null && input.max_winners > 0)
        ? input.prize_pool / input.max_winners : null;
    const result = db.prepare(`
        INSERT INTO giveaway_events
            (event_type, title, description, criteria_type, criteria_value,
             prize_pool, prize_per_winner, max_winners, starts_at, ends_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
        input.event_type,
        input.title,
        input.description ?? null,
        input.criteria_type ?? null,
        input.criteria_value ?? null,
        input.prize_pool ?? null,
        prizePerWinner,
        input.max_winners,
        input.starts_at ?? null,
        input.ends_at ?? null,
    );
    return (result as { lastInsertRowid: number }).lastInsertRowid;
}

export function getGiveawayEvent(id: number): GiveawayEvent | undefined {
    return db.prepare('SELECT * FROM giveaway_events WHERE id = ?').get(id) as GiveawayEvent | undefined;
}

export function getGiveawayEvents(status?: string): GiveawayEvent[] {
    if (status) {
        return db.prepare('SELECT * FROM giveaway_events WHERE status = ? ORDER BY created_at DESC').all(status) as GiveawayEvent[];
    }
    return db.prepare('SELECT * FROM giveaway_events ORDER BY created_at DESC LIMIT 50').all() as GiveawayEvent[];
}

export function getActiveGiveaways(): GiveawayEvent[] {
    return db.prepare("SELECT * FROM giveaway_events WHERE status = 'active' ORDER BY created_at DESC").all() as GiveawayEvent[];
}

export function getPendingGiveawaysDue(): GiveawayEvent[] {
    return db.prepare(`
        SELECT * FROM giveaway_events
        WHERE status = 'pending'
          AND event_type IN ('giveaway', 'promo_code', 'marathon')
          AND starts_at IS NOT NULL
          AND starts_at <= datetime('now')
        ORDER BY starts_at ASC
    `).all() as GiveawayEvent[];
}

export function setGiveawayStatus(id: number, status: string): void {
    db.prepare('UPDATE giveaway_events SET status = ? WHERE id = ?').run(status, id);
}

export function deleteGiveaway(id: number): void {
    db.prepare('DELETE FROM giveaway_participants WHERE giveaway_id = ?').run(id);
    db.prepare('DELETE FROM giveaway_updates WHERE giveaway_id = ?').run(id);
    db.prepare('DELETE FROM giveaway_events WHERE id = ?').run(id);
}

export function incrementGiveawayWinnerCount(id: number): void {
    db.prepare('UPDATE giveaway_events SET winner_count = winner_count + 1 WHERE id = ?').run(id);
}

export function setPromoFabricatedClaims(id: number, claims: number, nextTickAt: string): void {
    db.prepare('UPDATE giveaway_events SET fabricated_claims = ?, fab_next_tick_at = ? WHERE id = ?').run(claims, nextTickAt, id);
}

export function incrementPromoFabricatedClaims(id: number, increment: number, nextTickAt: string): void {
    db.prepare('UPDATE giveaway_events SET fabricated_claims = fabricated_claims + ?, fab_next_tick_at = ? WHERE id = ?').run(increment, nextTickAt, id);
}

export function markPromoUrgencySent(id: number, threshold: 10 | 5 | 1): void {
    db.prepare(`UPDATE giveaway_events SET urgency_${threshold}_sent = 1 WHERE id = ?`).run(id);
}

export function getActivePromosDueForFabTick(): GiveawayEvent[] {
    return db.prepare(`
        SELECT * FROM giveaway_events
        WHERE status = 'active' AND event_type = 'promo_code'
        AND fab_next_tick_at IS NOT NULL AND fab_next_tick_at <= datetime('now')
    `).all() as GiveawayEvent[];
}

export interface GiveawayParticipant {
    id: number;
    giveaway_id: number;
    telegram_id: number;
    trade_count: number;
    eligible: number;
    disqualify_reason: string | null;
    winner: number;
    fabricated: number;
    joined_at: string;
}

export function getGiveawayParticipant(giveawayId: number, telegramId: number): GiveawayParticipant | undefined {
    return db.prepare(
        'SELECT * FROM giveaway_participants WHERE giveaway_id = ? AND telegram_id = ?'
    ).get(giveawayId, telegramId) as GiveawayParticipant | undefined;
}

export function insertGiveawayParticipant(giveawayId: number, telegramId: number): number {
    const result = db.prepare(`
        INSERT INTO giveaway_participants (giveaway_id, telegram_id)
        VALUES (?, ?)
        ON CONFLICT(giveaway_id, telegram_id) DO NOTHING
    `).run(giveawayId, telegramId);
    if ((result as { changes: number }).changes === 0) {
        return getGiveawayParticipant(giveawayId, telegramId)!.id;
    }
    return (result as { lastInsertRowid: number }).lastInsertRowid;
}

export function seedGiveawayFabricants(giveawayId: number): void {
    const count = 30 + Math.floor(Math.random() * 21); // 30-50
    for (let i = 1; i <= count; i++) {
        const fakeId = -(giveawayId * 1000 + i);
        const tradeCount = 3 + Math.floor(Math.random() * 28);
        db.prepare(`
            INSERT OR IGNORE INTO giveaway_participants (giveaway_id, telegram_id, trade_count, fabricated)
            VALUES (?, ?, ?, 1)
        `).run(giveawayId, fakeId, tradeCount);
    }
}

export function getRealAndFabricatedCounts(giveawayId: number): { real: number; fabricated: number } {
    const rows = db.prepare(`
        SELECT fabricated, COUNT(*) AS cnt FROM giveaway_participants
        WHERE giveaway_id = ? AND eligible = 1 GROUP BY fabricated
    `).all(giveawayId) as Array<{ fabricated: number; cnt: number }>;
    const real = rows.find(r => r.fabricated === 0)?.cnt ?? 0;
    const fabricated = rows.find(r => r.fabricated === 1)?.cnt ?? 0;
    return { real, fabricated };
}

export function getGiveawayParticipants(giveawayId: number, eligibleOnly = false): GiveawayParticipant[] {
    if (eligibleOnly) {
        return db.prepare(
            'SELECT * FROM giveaway_participants WHERE giveaway_id = ? AND eligible = 1 ORDER BY trade_count DESC, joined_at'
        ).all(giveawayId) as GiveawayParticipant[];
    }
    return db.prepare(
        'SELECT * FROM giveaway_participants WHERE giveaway_id = ? ORDER BY joined_at'
    ).all(giveawayId) as GiveawayParticipant[];
}

export function getGiveawayParticipantCount(giveawayId: number): number {
    return (db.prepare(
        'SELECT COUNT(*) AS cnt FROM giveaway_participants WHERE giveaway_id = ? AND eligible = 1'
    ).get(giveawayId) as { cnt: number }).cnt;
}

export function incrementParticipantTradeCount(participantId: number): void {
    db.prepare('UPDATE giveaway_participants SET trade_count = trade_count + 1 WHERE id = ?').run(participantId);
}

export function setParticipantWinner(participantId: number): void {
    db.prepare('UPDATE giveaway_participants SET winner = 1 WHERE id = ?').run(participantId);
}

export function disqualifyParticipant(participantId: number, reason: string): void {
    db.prepare(
        'UPDATE giveaway_participants SET eligible = 0, disqualify_reason = ? WHERE id = ?'
    ).run(reason, participantId);
}

export interface ActiveParticipation {
    participation_id: number;
    giveaway_id: number;
    criteria_type: string | null;
    title: string;
    prize_per_winner: number | null;
    prize_pool: number | null;
}

export function getActiveParticipations(telegramId: number): ActiveParticipation[] {
    return db.prepare(`
        SELECT gp.id AS participation_id, gp.giveaway_id,
               ge.criteria_type, ge.title, ge.prize_per_winner, ge.prize_pool
        FROM giveaway_participants gp
        JOIN giveaway_events ge ON ge.id = gp.giveaway_id
        WHERE gp.telegram_id = ? AND ge.status = 'active' AND gp.eligible = 1
    `).all(telegramId) as ActiveParticipation[];
}

export interface GiveawayUpdate {
    id: number;
    giveaway_id: number;
    participant_id: number;
    telegram_id: number;
    update_type: string;
    update_text: string | null;
    sent: number;
    send_at: string;
}

export function insertGiveawayUpdate(
    giveawayId: number, participantId: number, telegramId: number,
    type: string, text: string, sendAt: string
): void {
    db.prepare(`
        INSERT INTO giveaway_updates
            (giveaway_id, participant_id, telegram_id, update_type, update_text, send_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(giveawayId, participantId, telegramId, type, text, sendAt);
}

export function getPendingGiveawayUpdates(): GiveawayUpdate[] {
    return db.prepare(`
        SELECT * FROM giveaway_updates
        WHERE sent = 0 AND send_at <= datetime('now')
        ORDER BY send_at LIMIT 50
    `).all() as GiveawayUpdate[];
}

export function markGiveawayUpdateSent(id: number): void {
    db.prepare('UPDATE giveaway_updates SET sent = 1 WHERE id = ?').run(id);
}

export interface MotivationalMessage {
    id: number;
    category: string;
    content: string;
}

export function getRandomMotivationalMessage(category?: string): MotivationalMessage | undefined {
    if (category) {
        return db.prepare(
            'SELECT * FROM motivational_messages WHERE enabled = 1 AND category = ? ORDER BY RANDOM() LIMIT 1'
        ).get(category) as MotivationalMessage | undefined;
    }
    return db.prepare(
        'SELECT * FROM motivational_messages WHERE enabled = 1 ORDER BY RANDOM() LIMIT 1'
    ).get() as MotivationalMessage | undefined;
}

export interface NotificationQueueItem {
    id: number;
    telegram_id: number;
    message: string;
    reply_markup: string | null;
    image_file_id: string | null;
    delete_after_seconds: number | null;
    priority: number;
    status: string;
    send_after: string | null;
}

export function insertNotification(
    telegramId: number,
    message: string,
    opts?: {
        replyMarkup?: string;
        imageFileId?: string;
        deleteAfterSeconds?: number;
        priority?: number;
        sendAfter?: string;
    }
): void {
    db.prepare(`
        INSERT INTO notifications_queue
            (telegram_id, message, reply_markup, image_file_id, delete_after_seconds, priority, send_after)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        telegramId,
        message,
        opts?.replyMarkup ?? null,
        opts?.imageFileId ?? null,
        opts?.deleteAfterSeconds ?? null,
        opts?.priority ?? 0,
        opts?.sendAfter ?? null,
    );
}

export function getPendingNotifications(limit = 20): NotificationQueueItem[] {
    return db.prepare(`
        SELECT * FROM notifications_queue
        WHERE status = 'pending'
          AND (send_after IS NULL OR send_after <= datetime('now'))
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
    `).all(limit) as NotificationQueueItem[];
}

export function markNotificationSent(id: number): void {
    db.prepare("UPDATE notifications_queue SET status = 'sent' WHERE id = ?").run(id);
}

export function markNotificationFailed(id: number): void {
    db.prepare("UPDATE notifications_queue SET status = 'failed' WHERE id = ?").run(id);
}

export function getApprovedUsersWithTier(): Array<{ telegram_id: number; tier: string | null }> {
    return db.prepare(
        "SELECT telegram_id, tier FROM users WHERE approval_status = 'approved'"
    ).all() as Array<{ telegram_id: number; tier: string | null }>;
}

// ─── Broadcast messages CRUD ──────────────────────────────────────────────────

export interface BroadcastMessage {
    id: number;
    type: string;
    category: string | null;
    content: string;
    image_file_id: string | null;
    enabled: number;
    last_sent_at: string | null;
    sent_count: number;
    created_at: string;
}

export function getEnabledAutoMessages(): BroadcastMessage[] {
    return db.prepare(
        "SELECT * FROM broadcast_messages WHERE type = 'auto' AND enabled = 1 ORDER BY id"
    ).all() as BroadcastMessage[];
}

export function getBroadcastMessages(type?: string): BroadcastMessage[] {
    if (type) {
        return db.prepare(
            'SELECT * FROM broadcast_messages WHERE type = ? ORDER BY created_at DESC'
        ).all(type) as BroadcastMessage[];
    }
    return db.prepare(
        'SELECT * FROM broadcast_messages ORDER BY created_at DESC LIMIT 50'
    ).all() as BroadcastMessage[];
}

export function insertBroadcastMessage(
    type: string, content: string, category?: string, imageFileId?: string
): number {
    const result = db.prepare(`
        INSERT INTO broadcast_messages (type, category, content, image_file_id)
        VALUES (?, ?, ?, ?)
    `).run(type, category ?? null, content, imageFileId ?? null);
    return (result as { lastInsertRowid: number }).lastInsertRowid;
}

export function markBroadcastSent(id: number, count: number): void {
    db.prepare(`
        UPDATE broadcast_messages
        SET last_sent_at = datetime('now'), sent_count = sent_count + ?
        WHERE id = ?
    `).run(count, id);
}

export function updateBroadcastImageFileId(id: number, imageFileId: string): void {
    db.prepare('UPDATE broadcast_messages SET image_file_id = ? WHERE id = ?').run(imageFileId, id);
}

export interface ComposeTone {    styleGuide: string;
    sample1: string;
    sample2: string;
    sample3: string;
}

export function getComposeTone(): ComposeTone {
    const row = db.prepare('SELECT style_guide, sample_1, sample_2, sample_3 FROM compose_tone WHERE id = 1').get() as {
        style_guide: string; sample_1: string; sample_2: string; sample_3: string;
    } | undefined;
    return {
        styleGuide: row?.style_guide ?? '',
        sample1:    row?.sample_1   ?? '',
        sample2:    row?.sample_2   ?? '',
        sample3:    row?.sample_3   ?? '',
    };
}

export function setComposeTone(fields: Partial<{ styleGuide: string; sample1: string; sample2: string; sample3: string }>): void {
    const current = getComposeTone();
    db.prepare(`
        INSERT OR REPLACE INTO compose_tone (id, style_guide, sample_1, sample_2, sample_3, updated_at)
        VALUES (1, ?, ?, ?, ?, datetime('now'))
    `).run(
        fields.styleGuide ?? current.styleGuide,
        fields.sample1    ?? current.sample1,
        fields.sample2    ?? current.sample2,
        fields.sample3    ?? current.sample3,
    );
}

export function getAdminSsid(): string | null {
    const row = db.prepare("SELECT value FROM config WHERE key = 'admin_ssid'").get() as { value: string } | undefined;
    return row?.value ?? null;
}

export function setAdminSsid(ssid: string): void {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('admin_ssid', ?)").run(ssid);
}

export function clearAdminSsid(): void {
    db.prepare("DELETE FROM config WHERE key = 'admin_ssid'").run();
}

export function getGiveawayStats(): { active: number; scheduled: number; completed: number } {
    const row = db.prepare(`
        SELECT
            SUM(CASE WHEN status = 'active'    THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS scheduled,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
        FROM giveaway_events
    `).get() as { active: number; scheduled: number; completed: number };
    return {
        active:    row.active    ?? 0,
        scheduled: row.scheduled ?? 0,
        completed: row.completed ?? 0,
    };
}

// ─── Template queries ─────────────────────────────────────────────────────────

export interface TemplateRecord {
    key: string;
    category: string;
    state: string | null;
    message: string;
    media_file_id: string | null;
    button_text: string | null;
    button_url: string | null;
    auto_delete: number;
    delay_sec: number | null;
    created_at: string;
}

export function getTemplateByKey(key: string): TemplateRecord | undefined {
    return db.prepare('SELECT * FROM templates WHERE key = ?').get(key) as TemplateRecord | undefined;
}

export function getTemplatesByCategory(category: string, state?: string): TemplateRecord[] {
    if (state) {
        return db.prepare('SELECT * FROM templates WHERE category = ? AND state = ?').all(category, state) as TemplateRecord[];
    }
    return db.prepare('SELECT * FROM templates WHERE category = ?').all(category) as TemplateRecord[];
}

export function getRandomTemplate(category: string, state?: string): TemplateRecord | undefined {
    const rows = getTemplatesByCategory(category, state);
    if (rows.length === 0) return undefined;
    return rows[Math.floor(Math.random() * rows.length)];
}

export function getTemplateCategories(): { category: string; count: number }[] {
    return db.prepare(
        "SELECT category, COUNT(*) AS count FROM templates WHERE state = 'brain' GROUP BY category ORDER BY category"
    ).all() as { category: string; count: number }[];
}

export function updateTemplateMessage(key: string, message: string): void {
    db.prepare('UPDATE templates SET message = ? WHERE key = ?').run(message, key);
}

// ─── Onboarding state helpers ─────────────────────────────────────────────────

export function setOnboardingState(telegramId: number, state: string): void {
    db.prepare("UPDATE users SET onboarding_state = ? WHERE telegram_id = ?").run(state, telegramId);
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, state_changed_at, last_activity_at)
        VALUES (?, datetime('now'), datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET state_changed_at = datetime('now'), last_activity_at = datetime('now')
    `).run(telegramId);
}

export function touchOnboardingActivity(telegramId: number): void {
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, last_activity_at)
        VALUES (?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET last_activity_at = datetime('now')
    `).run(telegramId);
}

export function setUserPidginEnabled(telegramId: number, enabled: boolean): void {
    db.prepare('UPDATE users SET pidgin_enabled = ? WHERE telegram_id = ?').run(enabled ? 1 : 0, telegramId);
}

/** Increment demo trade count; returns new count. */
export function incrementDemoTradeCount(telegramId: number): number {
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, demo_trade_count, last_activity_at)
        VALUES (?, 1, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET demo_trade_count = demo_trade_count + 1, last_activity_at = datetime('now')
    `).run(telegramId);
    const row = db.prepare('SELECT demo_trade_count FROM onboarding_tracking WHERE telegram_id = ?').get(telegramId) as { demo_trade_count: number } | undefined;
    return row?.demo_trade_count ?? 0;
}

export function setLastFundingAt(telegramId: number): void {
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, last_funding_at)
        VALUES (?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET last_funding_at = datetime('now')
    `).run(telegramId);
}

export function getOnboardingTracking(telegramId: number): { demo_trade_count: number; last_funding_at: string | null } | undefined {
    return db.prepare('SELECT demo_trade_count, last_funding_at FROM onboarding_tracking WHERE telegram_id = ?')
        .get(telegramId) as { demo_trade_count: number; last_funding_at: string | null } | undefined;
}

/** Users stuck in an onboarding state for longer than `hours`. */
export function getStuckOnboardingUsers(hours: number): UserRecord[] {
    return db.prepare(`
        SELECT u.* FROM users u
        JOIN onboarding_tracking ot ON u.telegram_id = ot.telegram_id
        WHERE u.onboarding_state IS NOT NULL
          AND u.ssid IS NULL
          AND (ot.last_activity_at IS NULL OR ot.last_activity_at <= datetime('now', ?))
    `).all(`-${hours} hours`) as UserRecord[];
}

// ─── Sequence media ───────────────────────────────────────────────────────────

export function getSequenceMedia(templateKey: string): { media_type: string; file_id: string } | undefined {
    return db.prepare('SELECT media_type, file_id FROM sequence_media WHERE template_key = ?').get(templateKey) as
        { media_type: string; file_id: string } | undefined;
}

export function setSequenceMedia(templateKey: string, mediaType: 'photo' | 'video', fileId: string): void {
    db.prepare(`
        INSERT INTO sequence_media (template_key, media_type, file_id, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(template_key) DO UPDATE SET media_type = ?, file_id = ?, updated_at = datetime('now')
    `).run(templateKey, mediaType, fileId, mediaType, fileId);
}

export function getAllSequenceMediaKeys(): { template_key: string; media_type: string | null }[] {
    const keys = [
        'entry_stuck', 'new_trader_video', 'user_id_stuck', 'email_stuck',
        'password_stuck', 'never_traded',
    ];
    return keys.map(k => {
        const row = db.prepare('SELECT media_type FROM sequence_media WHERE template_key = ?').get(k) as { media_type: string } | undefined;
        return { template_key: k, media_type: row?.media_type ?? null };
    });
}

// ─── Admin analytics ──────────────────────────────────────────────────────────

export function getTierDistribution(): { tier: string; count: number; pct: number }[] {
    const rows = db.prepare(
        "SELECT COALESCE(tier,'DEMO') AS tier, COUNT(*) AS count FROM users GROUP BY tier ORDER BY count DESC"
    ).all() as { tier: string; count: number }[];
    const total = rows.reduce((s, r) => s + r.count, 0);
    return rows.map(r => ({ ...r, pct: total > 0 ? Math.round((r.count / total) * 100) : 0 }));
}

export function getFundedUserCount(): number {
    const row = db.prepare(
        "SELECT COUNT(*) AS cnt FROM users WHERE ssid IS NOT NULL AND tier IN ('PRO','MASTER')"
    ).get() as { cnt: number };
    return row.cnt;
}

export interface BroadcastHistoryRow {
    id: number; type: string; category: string | null; content: string;
    created_at: string; last_sent_at: string | null; sent_count: number;
}

export function getRecentBroadcasts(limit = 10): BroadcastHistoryRow[] {
    return db.prepare(
        "SELECT id, type, category, content, created_at, last_sent_at, sent_count FROM broadcast_messages ORDER BY created_at DESC LIMIT ?"
    ).all(limit) as BroadcastHistoryRow[];
}

export function getOnboardingFunnelStats(): Record<string, number> {
    const states = ['entry', 'new_user_watch_video', 'returning_user_ask_account',
        'awaiting_user_id', 'awaiting_email', 'awaiting_password', 'connected', 'trading'];
    const result: Record<string, number> = {};
    for (const s of states) {
        const row = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE onboarding_state = ?").get(s) as { cnt: number };
        result[s] = row.cnt;
    }
    // connected = has ssid
    result['connected_ssid'] = (db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE ssid IS NOT NULL").get() as { cnt: number }).cnt;
    return result;
}
