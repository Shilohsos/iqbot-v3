import Database from 'better-sqlite3';
import path from 'node:path';
import { readFileSync } from 'node:fs';
const DB_PATH = process.env.DB_PATH ?? path.resolve('iqbot-v3.db');
export const db = new Database(DB_PATH);
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
if (!existingCols.includes('external_id')) {
    db.exec('ALTER TABLE trades ADD COLUMN external_id INTEGER');
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
// Product access model (replaces tier system — directive: product restructure)
if (!finalUserCols.includes('access_level'))
    db.exec("ALTER TABLE users ADD COLUMN access_level TEXT NOT NULL DEFAULT 'signals'");
if (!finalUserCols.includes('access_expires_at'))
    db.exec('ALTER TABLE users ADD COLUMN access_expires_at TEXT');
if (!finalUserCols.includes('signals_used_today'))
    db.exec('ALTER TABLE users ADD COLUMN signals_used_today INTEGER NOT NULL DEFAULT 0');
if (!finalUserCols.includes('signals_date'))
    db.exec('ALTER TABLE users ADD COLUMN signals_date TEXT');
if (!finalUserCols.includes('funded_balance_usd'))
    db.exec('ALTER TABLE users ADD COLUMN funded_balance_usd REAL NOT NULL DEFAULT 0');
if (!finalUserCols.includes('total_signals_used'))
    db.exec('ALTER TABLE users ADD COLUMN total_signals_used INTEGER NOT NULL DEFAULT 0');
if (!finalUserCols.includes('live_signals_used'))
    db.exec('ALTER TABLE users ADD COLUMN live_signals_used INTEGER NOT NULL DEFAULT 0');
// onboarding_tracking lazy migration — add last_followup_msg_id for existing DBs
try {
    const otCols = db.prepare("PRAGMA table_info(onboarding_tracking)").all().map(r => r.name);
    if (!otCols.includes('last_followup_msg_id'))
        db.exec('ALTER TABLE onboarding_tracking ADD COLUMN last_followup_msg_id INTEGER');
    if (!otCols.includes('user_id_fail_count'))
        db.exec('ALTER TABLE onboarding_tracking ADD COLUMN user_id_fail_count INTEGER NOT NULL DEFAULT 0');
}
catch { }
// Clean [link] placeholders from follow-up templates (idempotent)
try {
    db.exec(`
        UPDATE templates SET message = TRIM(REPLACE(REPLACE(REPLACE(message,
            '· See what they''re saying: [link]', ''),
            '· Real results: [link]', ''),
            '─  Tap below. First trade is on the house.', ''))
        WHERE key IN ('followup_never_traded', 'reengage_never_traded');
    `);
}
catch { }
// V4 tier migration: NEWBIE → DEMO (run-once, idempotent)
db.prepare("UPDATE users SET tier = 'DEMO' WHERE tier = 'NEWBIE'").run();
// Product-restructure migration: map legacy tiers onto access levels (directive §7).
// Idempotent — only touches rows still sitting at the default 'signals' so we never
// stomp an access level that a balance check or token grant has since raised.
try {
    db.prepare("UPDATE users SET access_level = 'ai_trading' WHERE tier IN ('PRO','MASTER','ADMIN') AND access_level = 'signals'").run();
}
catch { }
// Auto Trading session persistence (directive §5.5). One active session per user.
db.exec(`
  CREATE TABLE IF NOT EXISTS auto_trading_sessions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id         INTEGER NOT NULL UNIQUE,
    currency            TEXT    NOT NULL,
    amount              REAL    NOT NULL,
    assets              TEXT    NOT NULL,            -- JSON array of asset names
    timeframe           INTEGER NOT NULL,
    gale_rounds         INTEGER NOT NULL DEFAULT 3,
    status              TEXT    NOT NULL DEFAULT 'running', -- running | paused | stopped
    current_asset_index INTEGER NOT NULL DEFAULT 0,
    trades_done         INTEGER NOT NULL DEFAULT 0,
    evaluations         INTEGER NOT NULL DEFAULT 0,
    pnl                 REAL    NOT NULL DEFAULT 0,
    mode                TEXT    NOT NULL DEFAULT 'live',  -- demo | live
    mg_active           INTEGER NOT NULL DEFAULT 0,       -- 1 = martingale sequence in progress
    mg_next_amount      REAL    NOT NULL DEFAULT 0,       -- stake for the next gale round
    status_msg_id       INTEGER,                          -- live status card message id
    last_error          TEXT,
    started_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    last_trade_at       TEXT
  )
`);
// auto_trading_sessions lazy migration — bring older DBs up to the current schema.
// Every column added after the original DDL MUST have an ALTER here, or a fresh
// deploy that later upgrades breaks with "no such column" (audit C1).
try {
    const atsCols = db.prepare("PRAGMA table_info(auto_trading_sessions)").all().map(r => r.name);
    if (!atsCols.includes('evaluations'))
        db.exec('ALTER TABLE auto_trading_sessions ADD COLUMN evaluations INTEGER NOT NULL DEFAULT 0');
    if (!atsCols.includes('mode'))
        db.exec("ALTER TABLE auto_trading_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'live'");
    if (!atsCols.includes('mg_active'))
        db.exec('ALTER TABLE auto_trading_sessions ADD COLUMN mg_active INTEGER NOT NULL DEFAULT 0');
    if (!atsCols.includes('mg_next_amount'))
        db.exec('ALTER TABLE auto_trading_sessions ADD COLUMN mg_next_amount REAL NOT NULL DEFAULT 0');
    if (!atsCols.includes('status_msg_id'))
        db.exec('ALTER TABLE auto_trading_sessions ADD COLUMN status_msg_id INTEGER');
}
catch (e) {
    console.error('[db] auto_trading_sessions migration failed:', e instanceof Error ? e.message : e);
}
// Clear orphaned martingale state on any non-running session at startup. A
// stopped/paused session with mg_active=1 would otherwise fire a large recovery
// trade if resumed (audit C3 — e.g. a 40,000 NGN pending stake).
try {
    db.exec("UPDATE auto_trading_sessions SET mg_active = 0, mg_next_amount = 0 WHERE status != 'running' AND mg_active = 1");
}
catch (e) {
    console.error('[db] orphaned-martingale cleanup failed:', e instanceof Error ? e.message : e);
}
// Prune long-dead 'stopped' auto-trading sessions (terminal; a new run upserts a
// fresh row). Paused sessions are kept — the user may resume them (audit M2).
try {
    db.exec("DELETE FROM auto_trading_sessions WHERE status = 'stopped' AND COALESCE(last_trade_at, started_at) < datetime('now', '-7 days')");
}
catch (e) {
    console.error('[db] stale auto-session cleanup failed:', e instanceof Error ? e.message : e);
}
// Signal tracking — result checking at expiry, martingale progression
db.exec(`
  CREATE TABLE IF NOT EXISTS signal_tracking (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id  INTEGER NOT NULL,
    pair         TEXT    NOT NULL,
    direction    TEXT    NOT NULL,
    timeframe    INTEGER NOT NULL,
    entry_time   TEXT    NOT NULL,
    expiry_time  TEXT    NOT NULL,
    round        INTEGER NOT NULL DEFAULT 0,
    max_rounds   INTEGER NOT NULL DEFAULT 3,
    entry_price  REAL,
    status       TEXT    NOT NULL DEFAULT 'active',   -- active | won | lost
    result       TEXT,
    card_chat_id INTEGER,                              -- chat where the signal card lives
    card_msg_id  INTEGER,                              -- message_id of the signal card
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
// signal_tracking lazy migration — add card message columns for existing DBs
try {
    const stCols = db.prepare("PRAGMA table_info(signal_tracking)").all().map(r => r.name);
    if (!stCols.includes('card_chat_id'))
        db.exec('ALTER TABLE signal_tracking ADD COLUMN card_chat_id INTEGER');
    if (!stCols.includes('card_msg_id'))
        db.exec('ALTER TABLE signal_tracking ADD COLUMN card_msg_id INTEGER');
}
catch { }
// Indexes for the hot query paths (audit M1). Created after the tables exist —
// each in its own exec so one failure doesn't skip the rest.
for (const idx of [
    'CREATE INDEX IF NOT EXISTS idx_ats_status ON auto_trading_sessions(status)',
    'CREATE INDEX IF NOT EXISTS idx_sigtrack_status_expiry ON signal_tracking(status, expiry_time)',
    'CREATE INDEX IF NOT EXISTS idx_sigtrack_telegram ON signal_tracking(telegram_id)',
    'CREATE INDEX IF NOT EXISTS idx_users_ssid_valid ON users(ssid_valid)',
    'CREATE INDEX IF NOT EXISTS idx_users_access_level ON users(access_level)',
]) {
    try {
        db.exec(idx);
    }
    catch (e) {
        console.error('[db] index failed:', idx, e instanceof Error ? e.message : e);
    }
}
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
  CREATE TABLE IF NOT EXISTS funding_cycle (
    telegram_id   INTEGER PRIMARY KEY,
    last_sent_at  TEXT,
    last_msg_id   INTEGER,
    next_run_at   TEXT
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS reconnect_cycle (
    telegram_id   INTEGER PRIMARY KEY,
    last_state    TEXT,
    last_msg_id   INTEGER,
    next_run_at   TEXT
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_prompt (
    telegram_id   INTEGER PRIMARY KEY,
    last_msg_id   INTEGER,
    next_run_at   TEXT,
    variant       INTEGER NOT NULL DEFAULT 0
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS onboarding_tracking (
    telegram_id       INTEGER PRIMARY KEY,
    entry_sent_at     TEXT,
    state_changed_at  TEXT,
    last_followup_at  TEXT,
    last_followup_msg_id INTEGER,
    followup_count    INTEGER NOT NULL DEFAULT 0,
    last_activity_at  TEXT,
    demo_trade_count  INTEGER NOT NULL DEFAULT 0,
    last_funding_at   TEXT,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS reengage_tracking (
    telegram_id INTEGER PRIMARY KEY,
    last_msg_id INTEGER,
    last_segment TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);
// Migration: add variant column for 3-message cycling
{
    const rtCols = db.prepare('PRAGMA table_info(reengage_tracking)').all().map(c => c.name);
    if (!rtCols.includes('variant')) {
        db.exec('ALTER TABLE reengage_tracking ADD COLUMN variant INTEGER NOT NULL DEFAULT 0');
    }
}
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_demo_tracking (
    telegram_id INTEGER,
    date TEXT,
    trade_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (telegram_id, date)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_product_usage (
    telegram_id INTEGER,
    date TEXT,
    product TEXT NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 0,
    minutes_used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (telegram_id, date, product)
  )
`);
export function seedTemplates() {
    // Guard: skip re-seed if templates already exist
    const cnt = db.prepare('SELECT COUNT(*) AS cnt FROM templates').get().cnt;
    if (cnt > 0) {
        console.log(`[db] templates: ${cnt} rows (skipping re-seed)`);
        return;
    }
    const sqlDir = path.resolve('db');
    for (const file of ['templates-seed.sql', 'templates-brain-seed.sql']) {
        try {
            const sql = readFileSync(path.join(sqlDir, file), 'utf-8');
            const cleaned = sql.split('\n').filter(l => !l.trim().startsWith('PRAGMA')).join('\n');
            db.exec(cleaned);
        }
        catch (err) {
            console.warn(`[db] seedTemplates: could not load ${file}:`, err instanceof Error ? err.message : err);
        }
    }
    // On fresh DB only: remove categories we deliberately don't use
    db.exec(`
        DELETE FROM templates WHERE category IN (
            'pricing_tiers', 'upgrade_migration', 'funding_deposit',
            'withdrawal', 'scam_legit', 'risk_safety'
        )
    `);
    const count = db.prepare('SELECT COUNT(*) AS cnt FROM templates').get().cnt;
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
// Migration: add source column if missing
{
    const feCols = db.prepare('PRAGMA table_info(funnel_events)').all().map(c => c.name);
    if (!feCols.includes('source'))
        db.exec('ALTER TABLE funnel_events ADD COLUMN source TEXT');
}
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
// Admin broadcast drafts — survive restarts
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_broadcasts (
    chat_id         INTEGER PRIMARY KEY,
    message         TEXT    NOT NULL DEFAULT '',
    target_ids      TEXT    NOT NULL DEFAULT '[]',
    button          TEXT,
    media           TEXT,
    delete_after_ms INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT 0
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_telegram_id ON trades(telegram_id, created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_martingale_run ON trades(martingale_run)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_funnel_events_type ON funnel_events(event_type, created_at)`);
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
    const cols = db.prepare('PRAGMA table_info(giveaway_events)').all().map(c => c.name);
    if (!cols.includes('fabricated_claims'))
        db.exec('ALTER TABLE giveaway_events ADD COLUMN fabricated_claims  INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('urgency_10_sent'))
        db.exec('ALTER TABLE giveaway_events ADD COLUMN urgency_10_sent    INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('urgency_5_sent'))
        db.exec('ALTER TABLE giveaway_events ADD COLUMN urgency_5_sent     INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('urgency_1_sent'))
        db.exec('ALTER TABLE giveaway_events ADD COLUMN urgency_1_sent     INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('fab_next_tick_at'))
        db.exec('ALTER TABLE giveaway_events ADD COLUMN fab_next_tick_at   TEXT');
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
db.exec(`
  CREATE TABLE IF NOT EXISTS broadcast_user_messages (
    telegram_id INTEGER PRIMARY KEY,
    message_id  INTEGER NOT NULL,
    sent_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
{
    const bmCols = db.prepare('PRAGMA table_info(broadcast_messages)').all().map(c => c.name);
    if (!bmCols.includes('sent_count'))
        db.exec('ALTER TABLE broadcast_messages ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0');
}
{
    const tmplCols = db.prepare('PRAGMA table_info(templates)').all().map(c => c.name);
    if (!tmplCols.includes('button_callback'))
        db.exec('ALTER TABLE templates ADD COLUMN button_callback TEXT');
}
//  KILLED 2026-08-07: auto-broadcast seed removed per Master — no automatic broadcasts.
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
    if (!gpCols.includes('fabricated'))
        db.exec('ALTER TABLE giveaway_participants ADD COLUMN fabricated INTEGER NOT NULL DEFAULT 0');
    if (!gpCols.includes('won_at'))
        db.exec('ALTER TABLE giveaway_participants ADD COLUMN won_at TEXT');
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
            ['persuasion', "Giveaway is still on — you still have a chance to win *${prize_per_winner}*. Don't sit this one out ─ "],
            ['urgency', "··· Winners will be selected soon. You can still participate and claim your share of *${prize_pool}*."],
            ['social_proof', " *${count}* traders already joined this giveaway. Every second you wait = less chance to win."],
            ['persuasion', "Someone's going to win *${prize_per_winner}*. Why not you? Join now ─ "],
            ['urgency', "⚠️ Last chance! Winners picked in *${time_left}*. Tap Participate now."],
            ['social_proof', " *${recent_winner}* just claimed a prize last giveaway. This could be you next."],
            ['persuasion', "Trade more, win more. The *${title}* giveaway rewards the most active traders "],
            ['urgency', "Not in yet? *${spots_left}* winners will split *${prize_pool}*. Your move ─ "],
        ];
        const ins = db.prepare('INSERT INTO motivational_messages (category, content) VALUES (?, ?)');
        for (const [cat, content] of templates)
            ins.run(cat, content);
    }
}
const insertStmt = db.prepare(`
    INSERT INTO trades (telegram_id, pair, direction, amount, status, pnl, trade_id, error, martingale_run, external_id)
    VALUES (@telegram_id, @pair, @direction, @amount, @status, @pnl, @trade_id, @error, @martingale_run, @external_id)
`);
export function insertTrade(t) {
    if (t.telegram_id != null) {
        db.prepare(`INSERT OR IGNORE INTO users (telegram_id, created_at, last_used) VALUES (?, datetime('now'), datetime('now'))`)
            .run(t.telegram_id);
    }
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
        external_id: t.external_id ?? null,
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
                COUNT(*)        AS rounds,
                (SELECT pair      FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS pair,
                (SELECT direction FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS direction,
                (SELECT amount    FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS amount,
                (SELECT status    FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS status
            FROM trades t1
            WHERE martingale_run IS NOT NULL
            GROUP BY martingale_run
            UNION ALL
            SELECT CAST(id AS TEXT) AS martingale_run, created_at, pnl, telegram_id, 1 AS rounds, pair, direction, amount, status
            FROM trades WHERE martingale_run IS NULL
        )
        SELECT NULL AS id, telegram_id, pair, direction, amount, status, pnl, NULL AS trade_id, NULL AS error, martingale_run, created_at, rounds
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
export function findUsersByIqUserId(iqUserId) {
    return db.prepare('SELECT * FROM users WHERE iq_user_id = ? ORDER BY last_used DESC LIMIT 10').all(iqUserId);
}
export function saveUserIqUserId(telegramId, iqUserId) {
    db.prepare('UPDATE users SET iq_user_id = ? WHERE telegram_id = ?').run(iqUserId, telegramId);
}
export function saveUser(user) {
    db.prepare(`
        INSERT INTO users (telegram_id, ssid, last_used)
        VALUES (@telegram_id, @ssid, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET ssid = @ssid, last_used = datetime('now')
    `).run(user);
}
export function saveUserCred(telegramId, cred, email) {
    db.prepare('UPDATE users SET cred = ?, email = ? WHERE telegram_id = ?').run(cred, email, telegramId);
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
export function rejectUser(telegramId) {
    db.prepare(`UPDATE users SET approval_status = 'rejected' WHERE telegram_id = ?`).run(telegramId);
}
export function resetUser(telegramId) {
    db.prepare(`UPDATE users SET ssid = NULL, iq_user_id = NULL, approval_status = 'pending', onboarding_state = NULL WHERE telegram_id = ?`).run(telegramId);
    db.prepare(`DELETE FROM onboarding_tracking WHERE telegram_id = ?`).run(telegramId);
    db.prepare(`DELETE FROM daily_demo_tracking WHERE telegram_id = ?`).run(telegramId);
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
export function clearUserSsid(telegramId) {
    db.prepare('UPDATE users SET ssid = NULL WHERE telegram_id = ?').run(telegramId);
}
/** Mark a user's SSID validity (1 = valid, 0 = expired) and stamp the check time. */
export function setSsidValid(telegramId, valid) {
    db.prepare("UPDATE users SET ssid_valid = ?, ssid_last_checked = datetime('now') WHERE telegram_id = ?")
        .run(valid, telegramId);
}
/** Users who have an SSID stored — candidates for the health check. */
export function getUsersWithSsid() {
    return db.prepare('SELECT * FROM users WHERE ssid IS NOT NULL').all();
}
/** Broadcast targets: only funded users (PRO/MASTER with SSID), excluding admin. */
export function getBroadcastTargetIds() {
    const adminId = parseInt(process.env.ADMIN_USER_ID ?? '1615652240', 10);
    return db.prepare("SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != '' AND (funded_balance_usd > 0 OR access_level IN ('ai_trading','auto_trading')) AND telegram_id != ?").all(adminId).map(r => r.telegram_id);
}
/** Expired-SSID users due for a reconnect follow-up (never prompted, or last prompt older than `hours`). */
export function getUsersDueForReconnectPrompt(hours) {
    return db.prepare(`SELECT * FROM users WHERE ssid_valid = 0 AND (reconnect_prompt_at IS NULL OR reconnect_prompt_at <= datetime('now', ?))`).all(`-${hours} hours`);
}
/** Record the currently-visible reconnect prompt message (so the next one can delete it). */
export function setReconnectPrompt(telegramId, msgId) {
    db.prepare("UPDATE users SET reconnect_prompt_msg_id = ?, reconnect_prompt_at = datetime('now') WHERE telegram_id = ?")
        .run(msgId, telegramId);
}
export function clearReconnectPrompt(telegramId) {
    db.prepare('UPDATE users SET reconnect_prompt_msg_id = NULL, reconnect_prompt_at = NULL WHERE telegram_id = ?')
        .run(telegramId);
}
// ── Product access model ───────────────────────────────────────────────────────
export function setUserAccessLevel(telegramId, accessLevel, expiresAt) {
    if (expiresAt) {
        db.prepare('UPDATE users SET access_level = ?, access_expires_at = ? WHERE telegram_id = ?').run(accessLevel, expiresAt, telegramId);
    }
    else {
        db.prepare('UPDATE users SET access_level = ? WHERE telegram_id = ?').run(accessLevel, telegramId);
    }
}
/** Downgrade users whose token-granted access has expired. Returns count of downgraded. */
export function downgradeExpiredAccess() {
    const result = db.prepare(`        UPDATE users SET access_level = 'signals', access_expires_at = NULL
        WHERE access_expires_at IS NOT NULL
          AND access_expires_at < datetime('now')
          AND access_level IN ('ai_trading','auto_trading')
    `).run();
    return result.changes;
}
/** Cache the user's funded USD balance and (optionally) bump their access level.
 *  When accessLevel is provided, access_expires_at is also written: callers pass
 *  the token expiry to preserve it, or omit it to clear a stale expiry (the common
 *  balance-derived case). */
export function setUserFundedBalance(telegramId, fundedUsd, accessLevel, accessExpiresAt) {
    if (accessLevel) {
        db.prepare('UPDATE users SET funded_balance_usd = ?, access_level = ?, access_expires_at = ? WHERE telegram_id = ?')
            .run(fundedUsd, accessLevel, accessExpiresAt ?? null, telegramId);
    }
    else {
        db.prepare('UPDATE users SET funded_balance_usd = ? WHERE telegram_id = ?').run(fundedUsd, telegramId);
    }
}
/**
 * Returns the user's signal usage for today, resetting the counter when the
 * stored date is not today. `used` is post-reset, so callers can compare against
 * the daily cap directly.
 */
export function getSignalUsage(telegramId) {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare('SELECT signals_used_today, signals_date FROM users WHERE telegram_id = ?')
        .get(telegramId);
    if (!row || row.signals_date !== today) {
        db.prepare("UPDATE users SET signals_used_today = 0, signals_date = ? WHERE telegram_id = ?")
            .run(today, telegramId);
        return { used: 0, date: today };
    }
    return { used: row.signals_used_today ?? 0, date: today };
}
/** Increment today's signal counter (resetting first if the date rolled over). */
export function incrementSignalUsage(telegramId) {
    const { used } = getSignalUsage(telegramId);
    const next = used + 1;
    db.prepare('UPDATE users SET signals_used_today = ? WHERE telegram_id = ?').run(next, telegramId);
    return next;
}
/** Lifetime total signals a user has generated (never resets). */
export function getTotalSignalCount(telegramId) {
    const row = db.prepare('SELECT total_signals_used FROM users WHERE telegram_id = ?')
        .get(telegramId);
    return row?.total_signals_used ?? 0;
}
export function incrementTotalSignalCount(telegramId) {
    const next = getTotalSignalCount(telegramId) + 1;
    db.prepare('UPDATE users SET total_signals_used = ? WHERE telegram_id = ?').run(next, telegramId);
    return next;
}
/** Total signals consumed across all users today — for the admin panel. */
export function getTotalSignalsToday() {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare('SELECT COALESCE(SUM(signals_used_today), 0) AS n FROM users WHERE signals_date = ?')
        .get(today);
    return row.n;
}
// ── Auto Trading sessions ──────────────────────────────────────────────────────
export function upsertAutoSession(s) {
    const mode = s.mode ?? 'live';
    db.prepare(`
        INSERT INTO auto_trading_sessions
            (telegram_id, currency, amount, assets, timeframe, gale_rounds, status,
             current_asset_index, trades_done, evaluations, pnl, last_error, started_at, last_trade_at, mode, status_msg_id)
        VALUES (@telegram_id, @currency, @amount, @assets, @timeframe, @gale_rounds, 'running',
                0, 0, 0, 0, NULL, datetime('now'), NULL, @mode, NULL)
        ON CONFLICT(telegram_id) DO UPDATE SET
            currency = excluded.currency, amount = excluded.amount, assets = excluded.assets,
            timeframe = excluded.timeframe, gale_rounds = excluded.gale_rounds,
            status = 'running', current_asset_index = 0, trades_done = 0, evaluations = 0, pnl = 0,
            last_error = NULL, started_at = datetime('now'), last_trade_at = NULL, mode = excluded.mode,
            status_msg_id = NULL
    `).run({ ...s, assets: JSON.stringify(s.assets), mode });
}
export function getAutoSession(telegramId) {
    return db.prepare('SELECT * FROM auto_trading_sessions WHERE telegram_id = ?')
        .get(telegramId);
}
export function getRunningAutoSessions() {
    return db.prepare("SELECT * FROM auto_trading_sessions WHERE status = 'running'")
        .all();
}
export function setAutoSessionStatus(telegramId, status, lastError) {
    db.prepare('UPDATE auto_trading_sessions SET status = ?, last_error = ? WHERE telegram_id = ?')
        .run(status, lastError ?? null, telegramId);
}
/** Persist progress after a settled run: advance the asset cursor and accumulate stats. */
export function recordAutoSessionTrade(telegramId, nextAssetIndex, pnlDelta) {
    db.prepare(`
        UPDATE auto_trading_sessions
        SET current_asset_index = ?, trades_done = trades_done + 1,
            pnl = pnl + ?, last_trade_at = datetime('now')
        WHERE telegram_id = ?
    `).run(nextAssetIndex, pnlDelta, telegramId);
}
/** A market check that did NOT place a trade (e.g. low confidence): advance the
 *  asset cursor and bump the evaluations counter — never trades_done. */
export function recordAutoSessionEvaluation(telegramId, nextAssetIndex) {
    db.prepare(`
        UPDATE auto_trading_sessions
        SET current_asset_index = ?, evaluations = evaluations + 1,
            last_trade_at = datetime('now')
        WHERE telegram_id = ?
    `).run(nextAssetIndex, telegramId);
}
/** Persist martingale gale state so a restart can resume mid-sequence. */
export function setAutoSessionMgState(telegramId, active, nextAmount) {
    // Never throw: this is called from inside the auto-trading error handler, and a
    // DB error here must not bypass reconnect/notify/circuit-breaker logic (audit C4).
    try {
        db.prepare(`
            UPDATE auto_trading_sessions
            SET mg_active = ?, mg_next_amount = ?
            WHERE telegram_id = ?
        `).run(active ? 1 : 0, nextAmount ?? 0, telegramId);
    }
    catch (e) {
        console.error(`[db] setAutoSessionMgState failed for ${telegramId}:`, e instanceof Error ? e.message : e);
    }
}
// ── Signal tracking ──────────────────────────────────────────────────────────
export function insertSignalTrack(r) {
    const info = db.prepare(`
        INSERT INTO signal_tracking
            (telegram_id, pair, direction, timeframe, entry_time, expiry_time,
             round, max_rounds, entry_price, card_chat_id, card_msg_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(r.telegram_id, r.pair, r.direction, r.timeframe, r.entry_time, r.expiry_time, r.round, r.max_rounds, r.entry_price, r.card_chat_id ?? null, r.card_msg_id ?? null);
    return Number(info.lastInsertRowid);
}
export function getExpiredActiveSignals() {
    return db.prepare("SELECT * FROM signal_tracking WHERE status = 'active' AND expiry_time <= datetime('now')").all();
}
export function updateSignalTrackResult(id, status, result) {
    db.prepare('UPDATE signal_tracking SET status = ?, result = ? WHERE id = ?')
        .run(status, result, id);
}
/** Repoint a tracking record at a freshly-sent card message (dedup fallback). */
export function updateSignalTrackCard(id, chatId, msgId) {
    db.prepare('UPDATE signal_tracking SET card_chat_id = ?, card_msg_id = ? WHERE id = ?')
        .run(chatId, msgId, id);
}
export function getActiveSignalTrack(telegramId) {
    return db.prepare("SELECT * FROM signal_tracking WHERE telegram_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(telegramId);
}
export function cancelActiveSignalTracks(telegramId) {
    db.prepare("UPDATE signal_tracking SET status = 'lost', result = 'cancelled' WHERE telegram_id = ? AND status = 'active'")
        .run(telegramId);
}
export function getAllActiveSignalTracks() {
    return db.prepare("SELECT * FROM signal_tracking WHERE status = 'active' ORDER BY expiry_time ASC").all();
}
export function getAllUsers() {
    return db.prepare('SELECT * FROM users ORDER BY last_used DESC').all();
}
export function getAllUserIds() {
    const adminId = parseInt(process.env.ADMIN_USER_ID ?? '1615652240', 10);
    return db.prepare('SELECT telegram_id FROM users WHERE telegram_id != ?').all(adminId).map(r => r.telegram_id);
}
/** Users who have connected an IQ Option account (ssid set) */
export function getActivatedUserIds() {
    return db.prepare("SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != ''").all().map(r => r.telegram_id);
}
/** Users who have NOT connected an IQ Option account OR were rejected */
export function getNonActivatedUserIds() {
    return db.prepare("SELECT telegram_id FROM users WHERE ssid IS NULL OR ssid = '' OR approval_status = 'rejected'").all().map(r => r.telegram_id);
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
        SELECT * FROM users WHERE approval_status IN ('pending') ORDER BY created_at DESC
    `).all();
}
export function getApprovalStats() {
    const row = db.prepare(`
        SELECT
            SUM(CASE WHEN approval_status = 'approved'  THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN approval_status = 'pending'   THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN approval_status = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
            COUNT(*)                                                         AS total
        FROM users
    `).get();
    return {
        approved: row.approved ?? 0,
        pending: row.pending ?? 0,
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
    // All users can appear on the leaderboard now (directive §8.2) — no tier gate.
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
    return db.transaction(() => {
        // ON CONFLICT updates an existing row instead of creating a new one,
        // so the cap only applies when this telegram_id is brand-new today.
        const existing = db.prepare('SELECT 1 FROM leaderboard WHERE telegram_id = ? AND date = ?').get(telegramId, today);
        if (!existing) {
            const count = db.prepare('SELECT COUNT(*) AS cnt FROM leaderboard WHERE date = ?').get(today).cnt;
            if (count >= 10)
                return false;
        }
        db.prepare(`
            INSERT INTO leaderboard (telegram_id, auto_profit, manual_profit, date)
            VALUES (?, 0, ?, ?)
            ON CONFLICT(telegram_id, date) DO UPDATE SET manual_profit = excluded.manual_profit
        `).run(telegramId, profit, today);
        return true;
    })();
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
export function logPageVisit(source) {
    db.prepare('INSERT INTO funnel_events (event_type, source) VALUES (?, ?)').run('page_visit', source ?? null);
}
export function getFunnelPipeline() {
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const count = (sql, param) => {
        const row = param !== undefined
            ? db.prepare(sql).get(param)
            : db.prepare(sql).get();
        return row?.cnt ?? 0;
    };
    const recent = db.prepare(`SELECT event_type, created_at, source FROM funnel_events ORDER BY created_at DESC LIMIT 20`).all();
    return {
        page_views_today: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'page_visit' AND date(created_at) = date('now')`),
        page_views_this_week: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'page_visit' AND created_at >= ?`, weekAgo),
        channel_joins_today: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'channel_join_approved' AND date(created_at) = date('now')`),
        channel_joins_this_week: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'channel_join_approved' AND created_at >= ?`, weekAgo),
        connects_today: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'user_connected' AND date(created_at) = date('now')`),
        connects_this_week: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'user_connected' AND created_at >= ?`, weekAgo),
        funded_today: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'user_funded' AND date(created_at) = date('now')`),
        funded_this_week: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'user_funded' AND created_at >= ?`, weekAgo),
        recent_events: recent,
    };
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
export function getTestUserId() {
    const row = db.prepare("SELECT value FROM config WHERE key = 'test_user'").get();
    return row ? Number(row.value) || null : null;
}
export function setTestUser(id) {
    if (id) {
        db.prepare("REPLACE INTO config (key, value) VALUES ('test_user', ?)").run(String(id));
    }
    else {
        db.prepare("DELETE FROM config WHERE key = 'test_user'").run();
    }
}
export function getLastBroadcastMsgId(telegramId) {
    const row = db.prepare('SELECT message_id FROM broadcast_user_messages WHERE telegram_id = ?').get(telegramId);
    return row?.message_id ?? null;
}
export function saveLastBroadcastMsgId(telegramId, messageId) {
    db.prepare(`
        INSERT INTO broadcast_user_messages (telegram_id, message_id, sent_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
            message_id = excluded.message_id,
            sent_at = excluded.sent_at
    `).run(telegramId, messageId);
}
export function getNextBroadcastAt() {
    const row = db.prepare('SELECT next_send_at FROM broadcast_schedule WHERE id = 1').get();
    return row?.next_send_at ?? null;
}
export function saveNextBroadcastAt(isoStr) {
    db.prepare('INSERT OR REPLACE INTO broadcast_schedule (id, next_send_at) VALUES (1, ?)').run(isoStr);
}
export function getMessageIndex() {
    const row = db.prepare("SELECT value FROM broadcast_state WHERE key = 'message_index'").get();
    return row ? parseInt(row.value, 10) : 0;
}
export function saveMessageIndex(idx) {
    db.prepare("INSERT OR REPLACE INTO broadcast_state (key, value) VALUES ('message_index', ?)").run(String(idx));
}
export function insertScheduledBroadcast(input) {
    const res = db.prepare(`
        INSERT INTO scheduled_broadcasts (message, target_ids, button, media, delete_after_ms, scheduled_at, created_at, sent)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(input.message, JSON.stringify(input.targetIds), input.button ? JSON.stringify(input.button) : null, input.media ? JSON.stringify(input.media) : null, input.deleteAfterMs, input.scheduledAt, input.createdAt);
    return Number(res.lastInsertRowid);
}
export function markScheduledBroadcastSent(id) {
    db.prepare('UPDATE scheduled_broadcasts SET sent = 1 WHERE id = ?').run(id);
}
export function deleteScheduledBroadcast(id) {
    db.prepare('DELETE FROM scheduled_broadcasts WHERE id = ?').run(id);
}
export function getPendingScheduledBroadcasts() {
    const rows = db.prepare(`
        SELECT id, message, target_ids, button, media, delete_after_ms, scheduled_at, created_at, sent
        FROM scheduled_broadcasts WHERE sent = 0
    `).all();
    return rows.map(r => ({
        id: r.id,
        message: r.message,
        targetIds: JSON.parse(r.target_ids),
        button: r.button ? JSON.parse(r.button) : undefined,
        media: r.media ? JSON.parse(r.media) : undefined,
        deleteAfterMs: r.delete_after_ms,
        scheduledAt: r.scheduled_at,
        createdAt: r.created_at,
        sent: r.sent === 1,
    }));
}
export function savePendingBroadcast(chatId, data) {
    db.prepare(`
        INSERT OR REPLACE INTO pending_broadcasts (chat_id, message, target_ids, button, media, delete_after_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(chatId, data.message, JSON.stringify(data.targetIds), data.button ? JSON.stringify(data.button) : null, data.media ? JSON.stringify(data.media) : null, data.deleteAfterMs ?? 0, data.createdAt ?? Date.now());
}
export function getPendingBroadcast(chatId) {
    return db.prepare('SELECT * FROM pending_broadcasts WHERE chat_id = ?').get(chatId);
}
export function deletePendingBroadcast(chatId) {
    db.prepare('DELETE FROM pending_broadcasts WHERE chat_id = ?').run(chatId);
}
export function loadAllPendingBroadcasts() {
    const map = new Map();
    const rows = db.prepare('SELECT * FROM pending_broadcasts').all();
    for (const r of rows) {
        map.set(r.chat_id, {
            message: r.message,
            targetIds: JSON.parse(r.target_ids),
            button: r.button ? JSON.parse(r.button) : undefined,
            media: r.media ? JSON.parse(r.media) : undefined,
            deleteAfterMs: r.delete_after_ms || undefined,
            createdAt: r.created_at || undefined,
        });
    }
    return map;
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
            0 AS manual_pending
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
// Migrations for fabricated_traders winner tracking columns
{
    const fabCols = db.prepare('PRAGMA table_info(fabricated_traders)').all().map(c => c.name);
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
export function countFabricatedTraders() {
    return db.prepare(`SELECT COUNT(*) AS cnt FROM fabricated_traders`).get().cnt;
}
export function seedFabricatedTraders() {
    const seedIds = getTradersIqUserIds(48);
    const prefixes = seedIds.length > 0
        ? seedIds.map(id => String(id).slice(0, 3).padStart(3, '0'))
        : ['182', '511', '447', '329', '613'];
    const tryCandidate = (candidate) => {
        const inUsers = db.prepare(`SELECT 1 FROM users WHERE CAST(iq_user_id AS TEXT) = ?`).get(candidate);
        const inGiveaway = db.prepare(`SELECT 1 FROM giveaway_log WHERE generated_id = ?`).get(candidate);
        const inFab = db.prepare(`SELECT 1 FROM fabricated_traders WHERE fabricated_id = ?`).get(candidate);
        return !inUsers && !inGiveaway && !inFab;
    };
    for (let i = 0; i < 10; i++) {
        let fabricatedId = null;
        for (let attempt = 0; attempt < 30 && !fabricatedId; attempt++) {
            const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
            const candidate = prefix + suffix;
            if (tryCandidate(candidate))
                fabricatedId = candidate;
        }
        // Random sampling can collide repeatedly once the namespace fills.
        // Fall back to a deterministic sequential scan so seeding never
        // silently drops entries — the leaderboard always has 10 fakes.
        if (!fabricatedId) {
            const prefix = prefixes[i % prefixes.length];
            for (let seq = 0; seq < 1_000_000 && !fabricatedId; seq++) {
                const candidate = prefix + String(seq).padStart(6, '0');
                if (tryCandidate(candidate))
                    fabricatedId = candidate;
            }
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
export function getLastCompletedGiveawayId() {
    const row = db.prepare(`SELECT id FROM giveaway_events WHERE status = 'completed' ORDER BY id DESC LIMIT 1`).get();
    return row?.id ?? null;
}
export function getEligibleFabWinnerIds(currentGiveawayId) {
    const lastId = currentGiveawayId;
    return db.prepare(`
        SELECT fabricated_id FROM fabricated_traders
        WHERE winner_use_count < 2
          AND (last_used_giveaway_id IS NULL OR last_used_giveaway_id != ?)
        ORDER BY RANDOM()
    `).all(lastId ?? -1).map(r => r.fabricated_id);
}
export function markFabWinnerUsed(fabricatedId, giveawayId) {
    db.prepare(`
        UPDATE fabricated_traders
        SET winner_use_count = winner_use_count + 1, last_used_giveaway_id = ?
        WHERE fabricated_id = ?
    `).run(giveawayId, fabricatedId);
}
export function seedMarathonFabricants(giveawayId) {
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
export function getMarathonLeaderboardRows(giveawayId) {
    return db.prepare(`
        SELECT telegram_id, NULL AS display_name, trade_count
        FROM giveaway_participants WHERE giveaway_id = ? AND eligible = 1
        UNION ALL
        SELECT NULL AS telegram_id, display_name, trade_count
        FROM marathon_fabricated WHERE giveaway_id = ?
        ORDER BY trade_count DESC
    `).all(giveawayId, giveawayId);
}
export function getMarathonFabricantsDueForUpdate() {
    return db.prepare(`
        SELECT * FROM marathon_fabricated
        WHERE next_update_at IS NULL OR next_update_at <= datetime('now')
    `).all();
}
export function updateMarathonFabricantTrades(id, tradeCount, nextUpdateAt) {
    db.prepare(`
        UPDATE marathon_fabricated SET trade_count = ?, next_update_at = ? WHERE id = ?
    `).run(tradeCount, nextUpdateAt, id);
}
export function deleteMarathonFabricants(giveawayId) {
    db.prepare(`DELETE FROM marathon_fabricated WHERE giveaway_id = ?`).run(giveawayId);
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
          AND l.telegram_id NOT IN (1615652240, 6622587977, 8986669286, 6683209485, 8471649166)
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
export function getPendingGiveawaysDue() {
    return db.prepare(`
        SELECT * FROM giveaway_events
        WHERE status = 'pending'
          AND event_type IN ('giveaway', 'promo_code', 'marathon')
          AND starts_at IS NOT NULL
          AND starts_at <= datetime('now')
        ORDER BY starts_at ASC
    `).all();
}
export function setGiveawayStatus(id, status) {
    db.prepare('UPDATE giveaway_events SET status = ? WHERE id = ?').run(status, id);
}
export function deleteGiveaway(id) {
    db.prepare('DELETE FROM giveaway_participants WHERE giveaway_id = ?').run(id);
    db.prepare('DELETE FROM giveaway_updates WHERE giveaway_id = ?').run(id);
    db.prepare('DELETE FROM giveaway_events WHERE id = ?').run(id);
}
export function incrementGiveawayWinnerCount(id) {
    db.prepare('UPDATE giveaway_events SET winner_count = winner_count + 1 WHERE id = ?').run(id);
}
export function setPromoFabricatedClaims(id, claims, nextTickAt) {
    db.prepare('UPDATE giveaway_events SET fabricated_claims = ?, fab_next_tick_at = ? WHERE id = ?').run(claims, nextTickAt, id);
}
export function incrementPromoFabricatedClaims(id, increment, nextTickAt) {
    db.prepare('UPDATE giveaway_events SET fabricated_claims = fabricated_claims + ?, fab_next_tick_at = ? WHERE id = ?').run(increment, nextTickAt, id);
}
export function markPromoUrgencySent(id, threshold) {
    db.prepare(`UPDATE giveaway_events SET urgency_${threshold}_sent = 1 WHERE id = ?`).run(id);
}
export function getActivePromosDueForFabTick() {
    return db.prepare(`
        SELECT * FROM giveaway_events
        WHERE status = 'active' AND event_type = 'promo_code'
        AND fab_next_tick_at IS NOT NULL AND fab_next_tick_at <= datetime('now')
    `).all();
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
export function seedGiveawayFabricants(giveawayId) {
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
export function getRealAndFabricatedCounts(giveawayId) {
    const rows = db.prepare(`
        SELECT fabricated, COUNT(*) AS cnt FROM giveaway_participants
        WHERE giveaway_id = ? AND eligible = 1 GROUP BY fabricated
    `).all(giveawayId);
    const real = rows.find(r => r.fabricated === 0)?.cnt ?? 0;
    const fabricated = rows.find(r => r.fabricated === 1)?.cnt ?? 0;
    return { real, fabricated };
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
export function getMarathonParticipantCount(giveawayId) {
    const real = db.prepare('SELECT COUNT(*) AS cnt FROM giveaway_participants WHERE giveaway_id = ? AND eligible = 1').get(giveawayId).cnt;
    const fab = db.prepare('SELECT COUNT(*) AS cnt FROM marathon_fabricated WHERE giveaway_id = ?').get(giveawayId).cnt;
    return real + fab;
}
export function incrementParticipantTradeCount(participantId) {
    db.prepare('UPDATE giveaway_participants SET trade_count = trade_count + 1 WHERE id = ?').run(participantId);
}
export function setParticipantWinner(participantId) {
    db.prepare('UPDATE giveaway_participants SET winner = 1, won_at = datetime(\'now\') WHERE id = ?').run(participantId);
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
        INSERT OR IGNORE INTO notifications_queue
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
export function getComposeTone() {
    const row = db.prepare('SELECT style_guide, sample_1, sample_2, sample_3 FROM compose_tone WHERE id = 1').get();
    return {
        styleGuide: row?.style_guide ?? '',
        sample1: row?.sample_1 ?? '',
        sample2: row?.sample_2 ?? '',
        sample3: row?.sample_3 ?? '',
    };
}
export function setComposeTone(fields) {
    const current = getComposeTone();
    db.prepare(`
        INSERT OR REPLACE INTO compose_tone (id, style_guide, sample_1, sample_2, sample_3, updated_at)
        VALUES (1, ?, ?, ?, ?, datetime('now'))
    `).run(fields.styleGuide ?? current.styleGuide, fields.sample1 ?? current.sample1, fields.sample2 ?? current.sample2, fields.sample3 ?? current.sample3);
}
export function getAdminSsid() {
    const row = db.prepare("SELECT value FROM config WHERE key = 'admin_ssid'").get();
    return row?.value ?? null;
}
export function setAdminSsid(ssid) {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('admin_ssid', ?)").run(ssid);
}
export function clearAdminSsid() {
    db.prepare("DELETE FROM config WHERE key = 'admin_ssid'").run();
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
export function getTemplateByKey(key) {
    return db.prepare('SELECT * FROM templates WHERE key = ?').get(key);
}
export function getTemplatesByCategory(category, state) {
    if (state) {
        return db.prepare('SELECT * FROM templates WHERE category = ? AND state = ?').all(category, state);
    }
    return db.prepare('SELECT * FROM templates WHERE category = ?').all(category);
}
export function getRandomTemplate(category, state) {
    const rows = getTemplatesByCategory(category, state);
    if (rows.length === 0)
        return undefined;
    return rows[Math.floor(Math.random() * rows.length)];
}
export function getTemplateCategories() {
    return db.prepare("SELECT category, COUNT(*) AS count FROM templates WHERE state = 'brain' GROUP BY category ORDER BY category").all();
}
export function updateTemplateMessage(key, message) {
    db.prepare('UPDATE templates SET message = ? WHERE key = ?').run(message, key);
}
// ─── Onboarding state helpers ─────────────────────────────────────────────────
export function setOnboardingState(telegramId, state) {
    db.prepare("INSERT OR IGNORE INTO users (telegram_id, ssid) VALUES (?, '')").run(telegramId);
    db.prepare("UPDATE users SET onboarding_state = ? WHERE telegram_id = ?").run(state, telegramId);
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, state_changed_at, last_activity_at)
        VALUES (?, datetime('now'), datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET state_changed_at = datetime('now'), last_activity_at = datetime('now')
    `).run(telegramId);
}
export function touchOnboardingActivity(telegramId) {
    db.prepare("INSERT OR IGNORE INTO users (telegram_id, ssid) VALUES (?, '')").run(telegramId);
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, last_activity_at)
        VALUES (?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET last_activity_at = datetime('now')
    `).run(telegramId);
}
export function setUserPidginEnabled(telegramId, enabled) {
    db.prepare('UPDATE users SET pidgin_enabled = ? WHERE telegram_id = ?').run(enabled ? 1 : 0, telegramId);
}
/** Increment demo trade count; returns new count. */
export function incrementDemoTradeCount(telegramId) {
    db.prepare("INSERT OR IGNORE INTO users (telegram_id, ssid) VALUES (?, '')").run(telegramId);
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, demo_trade_count, last_activity_at)
        VALUES (?, 1, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET demo_trade_count = demo_trade_count + 1, last_activity_at = datetime('now')
    `).run(telegramId);
    const row = db.prepare('SELECT demo_trade_count FROM onboarding_tracking WHERE telegram_id = ?').get(telegramId);
    return row?.demo_trade_count ?? 0;
}
export function getDemoTradeCount(telegramId) {
    const row = db.prepare('SELECT demo_trade_count FROM onboarding_tracking WHERE telegram_id = ?').get(telegramId);
    return row?.demo_trade_count ?? 0;
}
export function setLastFundingAt(telegramId) {
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, last_funding_at)
        VALUES (?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET last_funding_at = datetime('now')
    `).run(telegramId);
}
export function getOnboardingTracking(telegramId) {
    return db.prepare('SELECT demo_trade_count, last_funding_at, last_followup_msg_id FROM onboarding_tracking WHERE telegram_id = ?')
        .get(telegramId);
}
export function setLastFollowupMsgId(telegramId, messageId) {
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, last_followup_msg_id)
        VALUES (?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET last_followup_msg_id = ?
    `).run(telegramId, messageId, messageId);
}
export function getUserIdFailCount(telegramId) {
    const row = db.prepare('SELECT user_id_fail_count FROM onboarding_tracking WHERE telegram_id = ?').get(telegramId);
    return row?.user_id_fail_count ?? 0;
}
export function incrementUserIdFailCount(telegramId) {
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, user_id_fail_count, last_activity_at)
        VALUES (?, 1, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
            user_id_fail_count = user_id_fail_count + 1,
            last_activity_at = datetime('now')
    `).run(telegramId);
    return getUserIdFailCount(telegramId);
}
export function resetUserIdFailCount(telegramId) {
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, user_id_fail_count)
        VALUES (?, 0)
        ON CONFLICT(telegram_id) DO UPDATE SET user_id_fail_count = 0
    `).run(telegramId);
}
// ─── Funding cycle ────────────────────────────────────────────────────────────
export function getFundingCycle(telegramId) {
    return db.prepare('SELECT last_sent_at, last_msg_id, next_run_at FROM funding_cycle WHERE telegram_id = ?').get(telegramId);
}
export function upsertFundingCycle(telegramId, last_sent_at, last_msg_id, next_run_at) {
    db.prepare(`
        INSERT INTO funding_cycle (telegram_id, last_sent_at, last_msg_id, next_run_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            last_sent_at = excluded.last_sent_at,
            last_msg_id  = excluded.last_msg_id,
            next_run_at  = excluded.next_run_at
    `).run(telegramId, last_sent_at, last_msg_id, next_run_at);
}
export function getFundingCycleDueUsers() {
    return db.prepare(`SELECT telegram_id FROM funding_cycle WHERE next_run_at IS NOT NULL AND next_run_at <= datetime('now')`).all();
}
export function getDemoUsersWithTrades() {
    return db.prepare(`SELECT DISTINCT u.telegram_id FROM users u INNER JOIN daily_demo_tracking ddt ON ddt.telegram_id = u.telegram_id WHERE COALESCE(u.funded_balance_usd,0) <= 0 AND (u.access_level IS NULL OR u.access_level = 'signals') AND u.ssid_valid = 1 AND ddt.trade_count > 0`).all();
}
export function getLastTradeTime(telegramId) {
    const row = db.prepare(`SELECT MAX(created_at) AS last_at FROM trades WHERE telegram_id = ?`).get(telegramId);
    return row?.last_at ? new Date(row.last_at) : null;
}
// ─── Reconnect cycle ──────────────────────────────────────────────────────────
export function getReconnectCycle(telegramId) {
    return db.prepare('SELECT last_state, last_msg_id, next_run_at FROM reconnect_cycle WHERE telegram_id = ?').get(telegramId);
}
export function upsertReconnectCycle(telegramId, last_state, last_msg_id, next_run_at) {
    db.prepare(`
        INSERT INTO reconnect_cycle (telegram_id, last_state, last_msg_id, next_run_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            last_state  = excluded.last_state,
            last_msg_id = excluded.last_msg_id,
            next_run_at = excluded.next_run_at
    `).run(telegramId, last_state, last_msg_id, next_run_at);
}
export function getReconnectCycleDueUsers() {
    return db.prepare(`SELECT telegram_id FROM reconnect_cycle WHERE next_run_at IS NOT NULL AND next_run_at <= datetime('now')`).all();
}
export function getSsidExpiredUsers() {
    return db.prepare(`SELECT telegram_id FROM users WHERE ssid_valid = 0 AND ssid IS NOT NULL AND ssid != '' AND approval_status = 'approved'`).all();
}
export function getUserIdRejectedUsers() {
    return db.prepare(`
        SELECT u.telegram_id FROM users u
        JOIN onboarding_tracking ot ON ot.telegram_id = u.telegram_id
        WHERE ot.user_id_fail_count >= 3 AND u.onboarding_state = 'awaiting_user_id'
    `).all();
}
export function getLoginFailedUsers() {
    return db.prepare(`
        SELECT u.telegram_id FROM users u
        LEFT JOIN onboarding_tracking ot ON ot.telegram_id = u.telegram_id
        WHERE u.onboarding_state IN ('awaiting_password', 'awaiting_email')
        AND (ot.last_activity_at IS NULL OR ot.last_activity_at < datetime('now', '-30 minutes'))
        AND (u.ssid IS NULL OR u.ssid = '')
    `).all();
}
export function getAbandonedOnboardingUsers() {
    return db.prepare(`
        SELECT u.telegram_id FROM users u
        LEFT JOIN onboarding_tracking ot ON ot.telegram_id = u.telegram_id
        WHERE u.onboarding_state IN ('awaiting_user_id', 'awaiting_email', 'awaiting_password')
        AND (ot.last_activity_at IS NULL OR ot.last_activity_at < datetime('now', '-6 hours'))
    `).all();
}
export function getNeverConnectedUsers() {
    return db.prepare(`
        SELECT telegram_id FROM users
        WHERE approval_status = 'approved'
        AND (ssid IS NULL OR ssid = '')
        AND (onboarding_state IS NULL OR onboarding_state = '')
        AND last_used > datetime('now', '-30 days')
    `).all();
}
/** Users stuck in an onboarding state for longer than `hours`. */
export function getStuckOnboardingUsers(hours) {
    return db.prepare(`
        SELECT u.* FROM users u
        JOIN onboarding_tracking ot ON u.telegram_id = ot.telegram_id
        WHERE u.onboarding_state IS NOT NULL
          AND u.ssid IS NULL
          AND (ot.last_activity_at IS NULL OR ot.last_activity_at <= datetime('now', ?))
    `).all(`-${hours} hours`);
}
/** Users who are connected but have never taken a demo trade. */
export function getConnectedNonTraders(hours) {
    const since = `-${hours} hours`;
    return db.prepare(`
        SELECT u.* FROM users u
        LEFT JOIN onboarding_tracking ot ON u.telegram_id = ot.telegram_id
        WHERE u.ssid IS NOT NULL AND u.ssid != ''
          AND u.approval_status = 'approved'
          AND (ot.demo_trade_count IS NULL OR ot.demo_trade_count = 0)
          AND (ot.last_activity_at IS NULL OR ot.last_activity_at <= datetime('now', ?))
    `).all(since);
}
/** Users who have taken at least one demo trade. */
export function getDemoTraders() {
    return db.prepare(`
        SELECT u.* FROM users u
        JOIN onboarding_tracking ot ON u.telegram_id = ot.telegram_id
        WHERE u.ssid IS NOT NULL AND u.ssid != ''
          AND u.approval_status = 'approved'
          AND COALESCE(u.funded_balance_usd,0) <= 0 AND (u.access_level IS NULL OR u.access_level = 'signals')
          AND ot.demo_trade_count >= 1
    `).all();
}
export function setReengageMsgId(telegramId, msgId, segment) {
    db.prepare(`
        INSERT INTO reengage_tracking (telegram_id, last_msg_id, last_segment, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET last_msg_id = ?, last_segment = ?, updated_at = datetime('now')
    `).run(telegramId, msgId, segment, msgId, segment);
}
export function getReengageTracking(telegramId) {
    return db.prepare('SELECT last_msg_id, last_segment FROM reengage_tracking WHERE telegram_id = ?').get(telegramId);
}
export function getReengageVariant(telegramId) {
    const row = db.prepare('SELECT variant FROM reengage_tracking WHERE telegram_id = ?').get(telegramId);
    return row?.variant ?? 0;
}
/** Advances the variant counter (0→1→2→0) and returns the NEW value to use for this send. */
export function cycleReengageVariant(telegramId) {
    const current = getReengageVariant(telegramId);
    const next = (current + 1) % 3;
    db.prepare(`
        INSERT INTO reengage_tracking (telegram_id, variant, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET variant = excluded.variant, updated_at = excluded.updated_at
    `).run(telegramId, next);
    return next;
}
export function getDailyDemoCount(telegramId) {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare('SELECT trade_count FROM daily_demo_tracking WHERE telegram_id = ? AND date = ?')
        .get(telegramId, today);
    return row?.trade_count ?? 0;
}
export function incrementDailyDemoCount(telegramId) {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
        INSERT INTO daily_demo_tracking (telegram_id, date, trade_count)
        VALUES (?, ?, 1)
        ON CONFLICT(telegram_id, date) DO UPDATE SET trade_count = trade_count + 1
    `).run(telegramId, today);
    return getDailyDemoCount(telegramId);
}
// ─── Daily product usage tracking (mode system 2026-06-15) ──────────────────
export function getProductUsage(telegramId, product) {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare('SELECT usage_count, minutes_used FROM daily_product_usage WHERE telegram_id = ? AND date = ? AND product = ?').get(telegramId, today, product);
    return { used: row?.usage_count ?? 0, minutes: row?.minutes_used ?? 0 };
}
export function incrementProductUsage(telegramId, product) {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
        INSERT INTO daily_product_usage (telegram_id, date, product, usage_count, minutes_used)
        VALUES (?, ?, ?, 1, 0)
        ON CONFLICT(telegram_id, date, product) DO UPDATE SET usage_count = usage_count + 1
    `).run(telegramId, today, product);
    return getProductUsage(telegramId, product).used;
}
export function addProductMinutes(telegramId, product, minutes) {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
        INSERT INTO daily_product_usage (telegram_id, date, product, usage_count, minutes_used)
        VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(telegram_id, date, product) DO UPDATE SET minutes_used = minutes_used + ?
    `).run(telegramId, today, product, minutes, minutes);
    return getProductUsage(telegramId, product).minutes;
}
export function setProductMinutes(telegramId, product, minutes) {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
        INSERT INTO daily_product_usage (telegram_id, date, product, usage_count, minutes_used)
        VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(telegram_id, date, product) DO UPDATE SET minutes_used = ?
    `).run(telegramId, today, product, minutes, minutes);
}
/** Live signals counter — tracks how many LIVE signals a funded user has used today.
 *  First SIGNALS_PREMIUM_COUNT (5) get premium analysis; after that, drainage. */
export function getLiveSignalsUsed(telegramId) {
    const row = db.prepare('SELECT live_signals_used FROM users WHERE telegram_id = ?')
        .get(telegramId);
    return row?.live_signals_used ?? 0;
}
export function incrementLiveSignalsUsed(telegramId) {
    db.prepare('UPDATE users SET live_signals_used = live_signals_used + 1 WHERE telegram_id = ?').run(telegramId);
    return getLiveSignalsUsed(telegramId);
}
/** Reset live signals counter — call daily or when balance drops below threshold. */
export function resetLiveSignalsUsed(telegramId) {
    db.prepare('UPDATE users SET live_signals_used = 0 WHERE telegram_id = ?').run(telegramId);
}
// ─── Sequence media ───────────────────────────────────────────────────────────
export function getSequenceMedia(templateKey) {
    return db.prepare('SELECT media_type, file_id FROM sequence_media WHERE template_key = ?').get(templateKey);
}
export function setSequenceMedia(templateKey, mediaType, fileId) {
    db.prepare(`
        INSERT INTO sequence_media (template_key, media_type, file_id, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(template_key) DO UPDATE SET media_type = ?, file_id = ?, updated_at = datetime('now')
    `).run(templateKey, mediaType, fileId, mediaType, fileId);
}
export function getAllSequenceMediaKeys() {
    const keys = [
        { key: 'entry_stuck', desc: 'User didn\'t respond to welcome' },
        { key: 'new_trader_video', desc: 'How it works explainer video' },
        { key: 'user_id_stuck', desc: 'User stopped at User ID step' },
        { key: 'email_stuck', desc: 'User stopped at email step' },
        { key: 'password_stuck', desc: 'User stopped at password step' },
        { key: 'never_traded', desc: 'Connected but never traded' },
    ];
    return keys.map(k => {
        const row = db.prepare('SELECT media_type FROM sequence_media WHERE template_key = ?').get(k.key);
        return { template_key: k.key, media_type: row?.media_type ?? null, description: k.desc };
    });
}
// ─── Admin analytics ──────────────────────────────────────────────────────────
export function getAccessDistribution() {
    const rows = db.prepare("SELECT COALESCE(access_level,'signals') AS access_level, COUNT(*) AS count FROM users GROUP BY access_level ORDER BY count DESC").all();
    const total = rows.reduce((s, r) => s + r.count, 0);
    return rows.map(r => ({ ...r, pct: total > 0 ? Math.round((r.count / total) * 100) : 0 }));
}
export function getFundedUserCount() {
    const row = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE ssid IS NOT NULL AND (funded_balance_usd > 0 OR access_level IN ('ai_trading','auto_trading'))").get();
    return row.cnt;
}
export function getFundedUserIds() {
    return db.prepare("SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != '' AND (funded_balance_usd > 0 OR access_level IN ('ai_trading','auto_trading'))").all().map(r => r.telegram_id);
}
export function getNonFundedUserIds() {
    return db.prepare("SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != '' AND approval_status = 'approved' AND COALESCE(funded_balance_usd,0) <= 0 AND (access_level IS NULL OR access_level = 'signals')").all().map(r => r.telegram_id);
}
export function getRecentBroadcasts(limit = 10) {
    return db.prepare("SELECT id, type, category, content, created_at, last_sent_at, sent_count FROM broadcast_messages ORDER BY created_at DESC LIMIT ?").all(limit);
}
export function getOnboardingFunnelStats() {
    const states = ['entry', 'new_user_watch_video', 'returning_user_ask_account',
        'awaiting_user_id', 'awaiting_email', 'awaiting_password', 'connected', 'trading'];
    const result = {};
    for (const s of states) {
        const row = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE onboarding_state = ?").get(s);
        result[s] = row.cnt;
    }
    // connected = has ssid
    result['connected_ssid'] = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE ssid IS NOT NULL").get().cnt;
    return result;
}
export function getMarketPulseStats() {
    const today = new Date().toISOString().split('T')[0];
    const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const activeTraders = db.prepare('SELECT COUNT(DISTINCT telegram_id) AS c FROM daily_demo_tracking WHERE date = ? AND trade_count > 0').get(today).c;
    const demoToday = db.prepare('SELECT COALESCE(SUM(trade_count), 0) AS c FROM daily_demo_tracking WHERE date = ?').get(today).c;
    const usersAtLimit = db.prepare('SELECT COUNT(*) AS c FROM daily_demo_tracking WHERE date = ? AND trade_count >= 10').get(today).c;
    const totalConnects = db.prepare('SELECT COUNT(*) AS c FROM users WHERE ssid_valid = 1').get().c;
    const fundedUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE (funded_balance_usd > 0 OR access_level IN ('ai_trading','auto_trading'))").get().c;
    const recentTrades = db.prepare("SELECT COUNT(*) AS c FROM trades WHERE created_at >= datetime('now', '-24 hours')").get().c;
    return {
        total_users: totalUsers,
        active_traders: activeTraders,
        demo_trades: demoToday,
        users_at_limit: usersAtLimit,
        total_connects: totalConnects,
        funded_users: fundedUsers,
        recent_trades: recentTrades,
    };
}
// ─── Pending prompt cycle ────────────────────────────────────────────────────
/** Users stuck at awaiting_user_id — started onboarding, never sent their ID. */
export function getAwaitingUserIdUsers() {
    return db.prepare(`
        SELECT telegram_id FROM users
        WHERE approval_status = 'pending'
          AND onboarding_state = 'awaiting_user_id'
        ORDER BY created_at ASC
    `).all();
}
export function getPendingPrompt(telegramId) {
    return db.prepare('SELECT last_msg_id, next_run_at, variant FROM pending_prompt WHERE telegram_id = ?').get(telegramId);
}
export function upsertPendingPrompt(telegramId, last_msg_id, next_run_at, variant) {
    db.prepare(`
        INSERT INTO pending_prompt (telegram_id, last_msg_id, next_run_at, variant)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            last_msg_id = excluded.last_msg_id,
            next_run_at = excluded.next_run_at,
            variant      = excluded.variant
    `).run(telegramId, last_msg_id, next_run_at, variant);
}
export function getPendingPromptDueUsers() {
    return db.prepare(`SELECT telegram_id FROM pending_prompt WHERE next_run_at IS NOT NULL AND next_run_at <= datetime('now')`).all();
}
export function getSessionTrades(telegramId) {
    const row = db.prepare('SELECT session_trades FROM users WHERE telegram_id = ?').get(telegramId);
    return row?.session_trades ?? 0;
}
export function createMarathonConfig(giveawayId, minBalanceUsd, minTrades, minGrowthMultiplier) {
    const result = db.prepare(`
        INSERT INTO marathon_config (giveaway_id, min_balance_usd, min_trades, min_growth_multiplier, status)
        VALUES (?, ?, ?, ?, 'active')
    `).run(giveawayId, minBalanceUsd, minTrades, minGrowthMultiplier);
    return Number(result.lastInsertRowid);
}
export function getActiveMarathonConfig() {
    return db.prepare(`SELECT * FROM marathon_config WHERE status = 'active' ORDER BY id DESC LIMIT 1`).get();
}
export function getMarathonConfig(id) {
    return db.prepare(`SELECT * FROM marathon_config WHERE id = ?`).get(id);
}
export function setMarathonConfigStatus(id, status) {
    db.prepare(`UPDATE marathon_config SET status = ? WHERE id = ?`).run(status, id);
}
export function getMarathonParticipant(marathonConfigId, telegramId) {
    return db.prepare(`SELECT * FROM marathon_participants WHERE marathon_config_id = ? AND telegram_id = ?`).get(marathonConfigId, telegramId);
}
export function insertMarathonParticipant(marathonConfigId, telegramId, startBalanceUsd) {
    const sessionTrades = getSessionTrades(telegramId);
    db.prepare(`
        INSERT INTO marathon_participants (marathon_config_id, telegram_id, start_balance_usd, current_balance_usd, trades_done, growth_multiplier, start_session_trades)
        VALUES (?, ?, ?, ?, 0, 0, ?)
    `).run(marathonConfigId, telegramId, startBalanceUsd, startBalanceUsd, sessionTrades);
}
export function updateMarathonParticipantBalance(marathonConfigId, telegramId, currentBalanceUsd, tradesDone) {
    const p = getMarathonParticipant(marathonConfigId, telegramId);
    if (!p)
        return;
    const growth = p.start_balance_usd > 0 ? currentBalanceUsd / p.start_balance_usd : 0;
    db.prepare(`
        UPDATE marathon_participants SET current_balance_usd = ?, trades_done = ?, growth_multiplier = ? WHERE id = ?
    `).run(currentBalanceUsd, tradesDone, growth, p.id);
}
export function markMarathonParticipantQualified(marathonConfigId, telegramId) {
    db.prepare(`UPDATE marathon_participants SET qualified = 1, qualified_at = datetime('now') WHERE marathon_config_id = ? AND telegram_id = ?`).run(marathonConfigId, telegramId);
}
export function markMarathonParticipantBlown(marathonConfigId, telegramId) {
    db.prepare(`UPDATE marathon_participants SET blown_account = 1 WHERE marathon_config_id = ? AND telegram_id = ?`).run(marathonConfigId, telegramId);
}
export function incrementMarathonPush(marathonConfigId, telegramId) {
    db.prepare(`UPDATE marathon_participants SET push_count = push_count + 1, last_push_at = datetime('now') WHERE marathon_config_id = ? AND telegram_id = ?`).run(marathonConfigId, telegramId);
}
export function getActiveMarathonParticipants() {
    return db.prepare(`SELECT * FROM marathon_participants WHERE blown_account = 0 ORDER BY trades_done DESC`).all();
}
export function getMarathonLeaderboard(marathonConfigId) {
    const rows = db.prepare(`
        SELECT telegram_id, trades_done, growth_multiplier, current_balance_usd
        FROM marathon_participants
        WHERE marathon_config_id = ? AND blown_account = 0
        ORDER BY trades_done DESC, growth_multiplier DESC
    `).all(marathonConfigId);
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
