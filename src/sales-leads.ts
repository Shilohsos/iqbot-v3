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

// Scanner state: the resume cursor and outage tracking. Kept in its own table so
// the cursor survives restarts AND covers messages that matched nothing —
// MAX(channel_msg_id) from lead_events only advances on an FTD/redep, so it would
// re-scan every non-event message forever and could not bound an outage gap.
db.exec(`
    CREATE TABLE IF NOT EXISTS sales_scan_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
`);

function getScanState(key: string): string | null {
    try {
        const row = db.prepare('SELECT value FROM sales_scan_state WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value ?? null;
    } catch { return null; }
}

function setScanState(key: string, value: string): void {
    try {
        db.prepare(`INSERT INTO sales_scan_state (key, value) VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
    } catch { /* state is best-effort — never break a scan on it */ }
}

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
    try {
        await Promise.race([
            _gramClient.connect(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('GramJS connect timeout')), 15_000)),
        ]);
    } catch (err) {
        // Reset so the next scan tick retries fresh (never hold a half-open socket).
        _gramClient = null;
        throw err;
    }
    return _gramClient;
}

/** Newest message id already scanned. Everything above it is unseen. */
function getScanCursor(): number {
    const v = getScanState('last_scanned_msg_id');
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Messages fetched per page while catching up after an outage. */
const SCAN_PAGE = 100;
/** Ceiling on pages in one scan so a long outage cannot block a tick forever.
 *  Whatever is left is picked up on the next tick — the cursor only advances
 *  over messages actually processed, so nothing is skipped. */
const SCAN_MAX_PAGES = 20;

/**
 * Scan the affiliate channel for new FTD/redep events.
 *
 * Resumes from the persisted cursor: pages backwards from the newest message
 * until it reaches the last id already scanned, so an outage of ANY length is
 * fully caught up instead of silently losing everything older than a fixed
 * window. (The previous implementation read a flat `limit: 50` with no cursor —
 * during the 17h outage every event beyond the newest 50 messages would have
 * been missed permanently.) `INSERT OR IGNORE` on the unique channel_msg_id
 * still guarantees idempotency if a page is re-read.
 *
 * THROWS on connect failure so the caller can apply backoff and raise the
 * outage alarm — swallowing it is what made the scanner fail silently.
 */
export async function scanChannelForLeads(): Promise<{ newFtd: number; newRedep: number }> {
    const channelId = process.env.AFFILIATE_CHANNEL_ID;
    if (!channelId) {
        console.error('[sales-leads] AFFILIATE_CHANNEL_ID not set');
        return { newFtd: 0, newRedep: 0 };
    }

    // Deliberately NOT caught here: startLeadScanner() needs the failure to
    // drive backoff + the >60min admin alert.
    const client: TelegramClient = await getGramClient();

    let countFtd = 0;
    let countRedep = 0;

    try {
        const cursor = getScanCursor();
        const messages: any[] = [];
        let offsetId = 0; // 0 = newest
        let newestSeen = 0;
        for (let page = 0; page < SCAN_MAX_PAGES; page++) {
            const batch: any[] = await client.getMessages(channelId, {
                limit: cursor === 0 ? 50 : SCAN_PAGE,
                ...(offsetId ? { offsetId } : {}),
            }) as any;
            if (!batch || batch.length === 0) break;
            for (const m of batch) {
                if (m?.id > newestSeen) newestSeen = m.id;
                if (cursor > 0 && m?.id <= cursor) continue; // already scanned
                messages.push(m);
                if (m?.id != null && (offsetId === 0 || m.id < offsetId)) offsetId = m.id;
            }
            const oldest = batch[batch.length - 1]?.id ?? 0;
            // First run (no cursor): one page only — do not archive all history.
            if (cursor === 0) break;
            if (oldest <= cursor) break; // caught up to the cursor
            offsetId = oldest;
            if (page === SCAN_MAX_PAGES - 1) {
                console.warn(`[sales-leads] catch-up hit the ${SCAN_MAX_PAGES}-page cap — continuing next tick`);
            }
        }

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
        // Advance the cursor ONLY after the page loop completed without throwing,
        // so a mid-scan failure re-reads that range next tick rather than skipping it.
        if (newestSeen > 0) setScanState('last_scanned_msg_id', String(newestSeen));
    } catch (err: any) {
        console.error('[sales-leads] Channel scan error:', err.message);
        throw err; // let the caller back off / alarm — never fail silently
    }

    if (countFtd > 0 || countRedep > 0) {
        console.log(`[sales-leads] Scanned: ${countFtd} new FTDs, ${countRedep} new redeps`);
    }

    return { newFtd: countFtd, newRedep: countRedep };
}

// ─── Self-healing scanner loop (directive 4b) ────────────────────────────────
//
// The sales bot OWNS the shared Telegram session, so this client stays connected
// between ticks by design. What it must survive is losing the session anyway —
// AUTH_KEY_DUPLICATED from another consumer, a DC hiccup, a network blip.
//
//   • backoff   — 2 → 4 → 8 → 15 min, hard-capped at 15 so it always keeps trying
//   • resume    — the cursor above replays everything missed during the outage
//   • alarm     — one admin ping when no successful scan for >60 min, and one
//                 recovery notice; never a repeating spam

const SCAN_INTERVAL_MS = 2 * 60_000;
const BACKOFF_MS = [2 * 60_000, 4 * 60_000, 8 * 60_000, 15 * 60_000];
const MAX_BACKOFF_MS = 15 * 60_000;
const OUTAGE_ALERT_MS = 60 * 60_000;
const ADMIN_TELEGRAM_ID = 1615652240;

let scannerStarted = false;
let consecutiveFailures = 0;
let lastSuccessAt = Date.now();
let outageAlerted = false;

/** Minutes since the last successful scan — surfaced in logs and the alert. */
function minutesDown(): number {
    return Math.round((Date.now() - lastSuccessAt) / 60_000);
}

async function runScanTick(notify: (text: string) => Promise<void>): Promise<number> {
    try {
        const { newFtd, newRedep } = await scanChannelForLeads();
        const wasDown = consecutiveFailures > 0;
        consecutiveFailures = 0;
        lastSuccessAt = Date.now();
        setScanState('last_success_at', new Date().toISOString());
        if (wasDown) {
            console.log(`[sales-leads] scanner RECOVERED (caught up ${newFtd} FTD / ${newRedep} redep)`);
            if (outageAlerted) {
                outageAlerted = false;
                await notify(`✅ Sales scanner recovered — caught up ${newFtd} FTD / ${newRedep} redep from the outage.`);
            }
        }
        return SCAN_INTERVAL_MS;
    } catch (err: any) {
        consecutiveFailures++;
        const msg = err?.message ?? String(err);
        const isDup = /AUTH_KEY_DUPLICATED/i.test(msg);
        const delay = BACKOFF_MS[Math.min(consecutiveFailures - 1, BACKOFF_MS.length - 1)] ?? MAX_BACKOFF_MS;
        console.error(`[sales-leads] ${new Date().toISOString()} scan FAILED (#${consecutiveFailures}${isDup ? ', AUTH_KEY_DUPLICATED' : ''}): ${msg} — retrying in ${Math.round(delay / 60_000)}min, down ${minutesDown()}min`);

        if (!outageAlerted && Date.now() - lastSuccessAt > OUTAGE_ALERT_MS) {
            outageAlerted = true;
            await notify(
                `⚠️ Sales scanner down ${minutesDown()} min.\n\n` +
                `Last error: ${msg}\n` +
                (isDup ? `Cause: another bot took the shared Telegram session (AUTH_KEY_DUPLICATED).\n` : '') +
                `Events are NOT lost — the scanner resumes from its cursor once it reconnects.`,
            );
        }
        return Math.min(delay, MAX_BACKOFF_MS);
    }
}

/**
 * Start the self-healing scan loop. Idempotent: a second call is a no-op, so
 * wiring it from more than one entry point can never double-scan.
 *
 * `bot` is optional purely so the loop can run in environments without a
 * Telegraf instance; without it the outage alert degrades to a log line.
 */
export function startLeadScanner(bot?: { telegram: { sendMessage: (id: number, text: string) => Promise<unknown> } }): void {
    if (scannerStarted) return;
    scannerStarted = true;

    const notify = async (text: string): Promise<void> => {
        if (!bot) { console.error(`[sales-leads] ALERT (no bot wired): ${text}`); return; }
        try { await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, text); }
        catch (e: any) { console.error(`[sales-leads] admin alert failed: ${e?.message ?? e}`); }
    };

    const schedule = (delay: number): void => {
        setTimeout(() => { void runScanTick(notify).then(schedule); }, delay);
    };

    const resumeFrom = getScanCursor();
    console.log(`[sales-leads] scanner started (2min tick, backoff to 15min, alert >60min; cursor=${resumeFrom || 'none — first run'})`);
    schedule(0);
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
