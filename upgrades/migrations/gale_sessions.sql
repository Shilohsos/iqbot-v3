-- Gale session persistence table
-- Stores in-flight martingale chain state so it survives restarts
CREATE TABLE IF NOT EXISTS gale_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    base_amount REAL NOT NULL,
    current_amount REAL NOT NULL,
    current_round INTEGER NOT NULL DEFAULT 1,
    effective_rounds INTEGER NOT NULL,
    timeframe_sec INTEGER NOT NULL DEFAULT 60,
    balance_type TEXT NOT NULL DEFAULT 'demo',
    currency TEXT NOT NULL DEFAULT 'USD',
    ssid TEXT,
    log_msg_id INTEGER,           -- the trade session card message ID
    sent_messages TEXT,            -- JSON array of message IDs to clean up
    status TEXT NOT NULL DEFAULT 'active',  -- active | resuming | completed | aborted
    total_pnl REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gale_sessions_telegram ON gale_sessions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_gale_sessions_status ON gale_sessions(status);
