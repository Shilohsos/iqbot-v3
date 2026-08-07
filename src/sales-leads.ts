// src/sales-leads.ts — Lead tracking for sales team
// Scans affiliate channel, stores FTD/redep events, handles attribution.

import { db } from './db.js';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

// ─── DB Schema (self-initializing) ───────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS lead_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type      TEXT NOT NULL,              -- 'ftd' or 'redep'
        iq_user_id      INTEGER NOT NULL,
        amount          REAL NOT NULL,
        country         TEXT,
        afftrack        TEXT,
        channel_msg_id  INTEGER UNIQUE,             -- deduplication key
        event_date      TEXT NOT NULL,
        claimed         INTEGER NOT NULL DEFAULT 0,
        claimed_by      TEXT,                       -- rep name: Eniola, Gift, Blessing
        claimed_at      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);

// Ensure indexes exist (idempotent)
try { db.exec('CREATE INDEX IF NOT EXISTS idx_lead_events_iq ON lead_events(iq_user_id)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_lead_events_claimed ON lead_events(claimed)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_lead_events_type ON lead_events(event_type, claimed)'); } catch {}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LeadEvent {
    id: number;
    event_type: 'ftd' | 'redep';
    iq_user_id: number;
    amount: number;
    country: string | null;
    afftrack: string | null;
    channel_msg_id: number;
    event_date: string;
    claimed: 0 | 1;
    claimed_by: string | null;
    claimed_at: string | null;
}

export interface RepStats {
    name: string;
    ftd_count: number;
    ftd_volume: number;
    redep_count: number;
    redep_volume: number;
    total_count: number;
    total_volume: number;
}

export interface WeeklyReport {
    week_start: string;
    week_end: string;
    reps: RepStats[];
    total_ftds: number;
    total_redeps: number;
    total_volume: number;
}

// ─── Channel Scanner ─────────────────────────────────────────────────────────

let _gramClient: TelegramClient | null = null;

async function getGramClient(): Promise<TelegramClient> {
    if (_gramClient?.connected) return _gramClient;

    const session = process.env.TELETHON_SESSION;
    const apiId = parseInt(process.env.TELEGRAM_API_ID ?? '', 10);
    const apiHash = process.env.TELEGRAM_API_HASH;

    if (!session || isNaN(apiId) || !apiHash) {
        throw new Error('Missing GramJS env vars');
    }

    _gramClient = new TelegramClient(new StringSession(session), apiId, apiHash, {
        connectionRetries: 2,
        baseLogger: undefined as never,
    });
    await _gramClient.connect();
    return _gramClient;
}

/**
 * Scan the affiliate channel for new FTD/redep events.
 * Only inserts events we haven't seen before (by channel_msg_id).
 */
export async function scanChannelForLeads(): Promise<{ newFtd: number; newRedep: number }> {
    const channelId = process.env.AFFILIATE_CHANNEL_ID;
    if (!channelId) {
        console.error('[sales-leads] AFFILIATE_CHANNEL_ID not set');
        return { newFtd: 0, newRedep: 0 };
    }

    let client: TelegramClient;
    try {
        client = await getGramClient();
    } catch (err: any) {
        console.error('[sales-leads] GramJS connect failed:', err.message);
        return { newFtd: 0, newRedep: 0 };
    }

    let countFtd = 0;
    let countRedep = 0;

    try {
        const messages = await client.getMessages(channelId, { limit: 50 });

        const insertStmt = db.prepare(`
            INSERT OR IGNORE INTO lead_events (event_type, iq_user_id, amount, country, afftrack, channel_msg_id, event_date)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const msg of messages) {
            if (!msg.text) continue;

            const ftdMatch = msg.text.match(/^ftd:\s*(\d+)\s+amount:\s*([\d.]+)\s+country:\s*(\w+)\s+afftrack:\s*(.*)/);
            if (ftdMatch) {
                const result = insertStmt.run(
                    'ftd',
                    parseInt(ftdMatch[1], 10),
                    parseFloat(ftdMatch[2]),
                    ftdMatch[3] || null,
                    ftdMatch[4]?.trim() || null,
                    msg.id,
                    new Date(msg.date * 1000).toISOString()
                );
                if (result.changes > 0) countFtd++;
                continue;
            }

            const redepMatch = msg.text.match(/^redep:\s*(\d+)\s+amount:\s*([\d.]+)\s+afftrack:\s*(.*?)\s+country:\s*(\w+)/);
            if (redepMatch) {
                const result = insertStmt.run(
                    'redep',
                    parseInt(redepMatch[1], 10),
                    parseFloat(redepMatch[2]),
                    redepMatch[4] || null,
                    redepMatch[3]?.trim() || null,
                    msg.id,
                    new Date(msg.date * 1000).toISOString()
                );
                if (result.changes > 0) countRedep++;
            }
        }
    } catch (err: any) {
        console.error('[sales-leads] Channel scan error:', err.message);
    }

    if (countFtd > 0 || countRedep > 0) {
        console.log(`[sales-leads] Scanned: ${countFtd} new FTDs, ${countRedep} new redeps`);
    }

    return { newFtd: countFtd, newRedep: countRedep };
}

// ─── Queries for Sales Bot ────────────────────────────────────────────────────

/** Look up the most recent unclaimed event for an IQ user ID. */
export function getLatestUnclaimed(iqUserId: number): LeadEvent | null {
    return db.prepare(`
        SELECT * FROM lead_events
        WHERE iq_user_id = ? AND claimed = 0
        ORDER BY event_date DESC
        LIMIT 1
    `).get(iqUserId) as LeadEvent | null;
}

/** Look up ALL unclaimed events for an IQ user ID. */
export function getAllUnclaimed(iqUserId: number): LeadEvent[] {
    return db.prepare(`
        SELECT * FROM lead_events
        WHERE iq_user_id = ? AND claimed = 0
        ORDER BY event_date DESC
    `).all(iqUserId) as LeadEvent[];
}

/** Claim an event for a rep. */
export function claimLead(eventId: number, repName: string): boolean {
    const result = db.prepare(`
        UPDATE lead_events SET claimed = 1, claimed_by = ?, claimed_at = datetime('now')
        WHERE id = ? AND claimed = 0
    `).run(repName, eventId);
    return result.changes > 0;
}

/** Get a specific event by ID. */
export function getEventById(eventId: number): LeadEvent | null {
    return db.prepare('SELECT * FROM lead_events WHERE id = ?').get(eventId) as LeadEvent | null;
}

// ─── Reporting ────────────────────────────────────────────────────────────────

const TEAM_NAMES = ['Team A', 'Team B', 'Team C'];

/** Convert a JS Date to SQLite datetime string (YYYY-MM-DD HH:MM:SS). */
function toSqliteDatetime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
           `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Get weekly stats for all reps (Monday 00:00 to Sunday 23:59 UTC). */
export function getWeeklyReport(): WeeklyReport {
    // Calculate current week's Monday at 00:00 UTC
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - daysSinceMonday);
    monday.setUTCHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 7);
    sunday.setUTCHours(23, 59, 59, 999);

    const weekStart = monday.toISOString().split('T')[0];
    const weekEnd = sunday.toISOString().split('T')[0];

    const sqliteMonday = toSqliteDatetime(monday);
    const sqliteSunday = toSqliteDatetime(sunday);

    const reps: RepStats[] = [];
    let totalFtds = 0;
    let totalRedeps = 0;
    let totalVolume = 0;

    for (const name of TEAM_NAMES) {
        const ftdRow = db.prepare(`
            SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as vol
            FROM lead_events
            WHERE claimed_by = ? AND event_type = 'ftd'
              AND claimed_at >= ? AND claimed_at <= ?
        `).get(name, sqliteMonday, sqliteSunday) as { cnt: number; vol: number };

        const redepRow = db.prepare(`
            SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as vol
            FROM lead_events
            WHERE claimed_by = ? AND event_type = 'redep'
              AND claimed_at >= ? AND claimed_at <= ?
        `).get(name, sqliteMonday, sqliteSunday) as { cnt: number; vol: number };

        const ftdCount = ftdRow.cnt;
        const ftdVol = ftdRow.vol;
        const redepCount = redepRow.cnt;
        const redepVol = redepRow.vol;

        reps.push({
            name,
            ftd_count: ftdCount,
            ftd_volume: Math.round(ftdVol * 100) / 100,
            redep_count: redepCount,
            redep_volume: Math.round(redepVol * 100) / 100,
            total_count: ftdCount + redepCount,
            total_volume: Math.round((ftdVol + redepVol) * 100) / 100,
        });

        totalFtds += ftdCount;
        totalRedeps += redepCount;
        totalVolume += ftdVol + redepVol;
    }

    // Sort by FTD count (events) — primary KPI for weekly contest; redep volume as tiebreak
    reps.sort((a, b) => b.ftd_count - a.ftd_count || b.redep_volume - a.redep_volume);

    return {
        week_start: weekStart,
        week_end: weekEnd,
        reps,
        total_ftds: totalFtds,
        total_redeps: totalRedeps,
        total_volume: Math.round(totalVolume * 100) / 100,
    };
}

/** Get leaderboard sorted by FTD count (for weekly contest). */
export function getLeaderboard(): RepStats[] {
    const report = getWeeklyReport();
    return report.reps;
}

/** Get an individual rep's current week stats. */
export function getRepStats(name: string): RepStats | null {
    const report = getWeeklyReport();
    return report.reps.find(r => r.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/** Get TOTAL stats for a rep for the current week (shortcut). */
export function getRepWeeklyCount(repName: string): { ftd: number; redep: number } {
    const stats = getRepStats(repName);
    return stats ? { ftd: stats.ftd_count, redep: stats.redep_count } : { ftd: 0, redep: 0 };
}

/** Get all claimed events for this week (for verification). */
export function getWeeklyClaimedEvents(): LeadEvent[] {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - daysSinceMonday);
    monday.setUTCHours(0, 0, 0, 0);

    return db.prepare(`
        SELECT * FROM lead_events
        WHERE claimed = 1 AND claimed_at >= ?
        ORDER BY claimed_at DESC
        LIMIT 100
    `).all(toSqliteDatetime(monday)) as LeadEvent[];
}

// ─── Config Helpers (uses existing config table from db.ts) ─────────────────

export function getKpiTargets(): { ftd: number; redep: number } {
    const ftd = parseInt(db.prepare('SELECT value FROM config WHERE key = ?').get('kpi_ftd_target')?.value ?? '0', 10);
    const redep = parseInt(db.prepare('SELECT value FROM config WHERE key = ?').get('kpi_redep_target')?.value ?? '0', 10);
    return { ftd, redep };
}

export function setKpiTargets(ftd: number, redep: number): void {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('kpi_ftd_target', String(ftd));
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('kpi_redep_target', String(redep));
}

export function getContestConfig(): { prize: number; description: string } {
    const prize = parseInt(db.prepare('SELECT value FROM config WHERE key = ?').get('contest_prize')?.value ?? '0', 10);
    const desc = db.prepare('SELECT value FROM config WHERE key = ?').get('contest_description')?.value ?? '';
    return { prize, description: desc };
}

export function setContestConfig(prize: number, description: string): void {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('contest_prize', String(prize));
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('contest_description', description);
}

export function getAdminId(): number {
    return parseInt(db.prepare('SELECT value FROM config WHERE key = ?').get('sales_admin_id')?.value ?? '7679722084', 10);
}

export function setAdminId(id: number): void {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('sales_admin_id', String(id));
}

// ─── Rep Telegram ID Registry ─────────────────────────────────────────────

export function getRepTelegramId(name: string): number | null {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(`rep_tgid:${name.toLowerCase()}`) as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : null;
}

export function setRepTelegramId(name: string, id: number): void {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(`rep_tgid:${name.toLowerCase()}`, String(id));
}

export function getAllRepIds(): { name: string; telegramId: number }[] {
    return TEAM_NAMES
        .map(name => ({ name, telegramId: getRepTelegramId(name) }))
        .filter((r): r is { name: string; telegramId: number } => r.telegramId !== null);
}
