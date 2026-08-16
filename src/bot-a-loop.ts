// Bot A — hourly smart engagement loop (DIRECTIVE-BOT-A-HOURLY-SMART-LOOP.md).
//
// Once per hour per user: if they have NOT traded in the last 60 minutes, send
// ONE personalized nudge (image + caption + buttons). The new message replaces
// the previous one (cancel-out), so a user never has more than one Bot A
// message visible at a time.
//
// All copy, buttons and placeholder pools live in the DB (bot_a_templates /
// bot_a_pools) so operations can edit them without a code change. This module
// owns only the machinery: eligibility, segment routing, never-same-twice
// rotation, the 24/day cap, cancel-out, and the send. The neutral seeds in
// seedBotATemplates() exist purely so the loop is functional before operations
// writes real copy — they are structural, not marketing.
//
// bot.ts wires this with one import + one startBotALoop(bot) call at boot.

import type { Telegraf } from 'telegraf';
import path from 'node:path';
import { db, getConfig, getTestUserId } from './db.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';

// ─── Tuning ─────────────────────────────────────────────────────────────────

/** Tick cadence. The loop is hourly PER USER; the 60s tick is just the sweep
 *  granularity — per-user pacing comes from the 60-minute activity window. */
const TICK_MS = 60_000;
/** Users examined per tick. Sized so a full sweep of ~3,000 users completes in
 *  ~30 minutes — this lets the PENDING segment honor its aggressive 30-min
 *  cadence without starving the approved rotation. */
const BATCH_SIZE = 100;
/** Delay between sends inside a batch — Telegram rate-limit courtesy. */
const SEND_DELAY_MS = 60;
/** A trade within this window means the user is active → no nudge. */
const ACTIVITY_WINDOW_MIN = 60;
/** Hard per-user daily ceiling. */
const DAILY_CAP = 24;
/** Never stack a nudge on top of a check-in this fresh. */
const CHECKIN_QUIET_MIN = 30;

// Same allowlist as bot.ts's maintenance gate, duplicated locally rather than
// imported exactly as checkin.ts does it (bot.ts does not export the constant).
const MAINTENANCE_ALLOWED_IDS = new Set<number>([6622587977, getAdminId()]);

/** Archetypes rotated for funded-idle users. J (live session) and L (Yacht Club
 *  watcher) are driven elsewhere and deliberately excluded. G and H are segment
 *  destinations, not rotation members. */
const FUNDED_IDLE_ARCHETYPES = ['A', 'B', 'C', 'D', 'E', 'F', 'I', 'K', 'M', 'N', 'O', 'P'];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BotATemplate {
    copy: string;
    buttons: string;
    image_file: string;
}

interface ButtonSpec {
    text: string;
    callback?: string;
    url?: string;
}

interface SentRow {
    telegram_id: number;
    message_id: number | null;
    last_archetype: string | null;
    sent_count: number;
    sent_date: string;
    last_sent_at: string | null;
}

// ─── Template + pool read path ──────────────────────────────────────────────

/** Read a template. Returns null when the key is absent so callers can skip
 *  rather than invent copy. */
export function getBotATemplate(key: string): BotATemplate | null {
    const row = db.prepare('SELECT copy, buttons, image_file FROM bot_a_templates WHERE key = ?')
        .get(key) as BotATemplate | undefined;
    return row ?? null;
}

/** Neutral fallbacks for the placeholder pools — used only when operations has
 *  not seeded the row yet (Part 6). */
const POOL_FALLBACKS: Record<string, string[]> = {
    names: ['a member'],
    amounts: ['+$350'],
};

export function getBotAPool(key: string): string[] {
    const row = db.prepare('SELECT items FROM bot_a_pools WHERE key = ?').get(key) as { items: string } | undefined;
    if (row?.items) {
        try {
            const parsed = JSON.parse(row.items);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
        } catch (e) {
            logger.warn('bot-a', `pool ${key} is not valid JSON — using fallback: ${e instanceof Error ? e.message : e}`);
        }
    }
    return POOL_FALLBACKS[key] ?? [];
}

// ─── Structural seeds (Part 7) ──────────────────────────────────────────────
// Deliberately generic. Operations overwrites every row after merge; these only
// keep the loop functional in the meantime.

const TRADE_BTN = JSON.stringify([[{ text: '✦ Trade Now', callback: 'ui:trade' }]]);

const SEED_TEMPLATES: Array<{ key: string; copy: string; buttons: string; image_file: string }> = [
    { key: 'A', copy: 'A fresh {confidence}% setup is waiting. Trade now ─', buttons: TRADE_BTN, image_file: 'a-streak-going-cold.jpg' },
    { key: 'B', copy: 'Your balance is ready and the market is moving. Start now ─', buttons: TRADE_BTN, image_file: 'b-capital-at-rest.jpg' },
    { key: 'C', copy: 'Opportunity closing in {countdown} minutes ✦ {pair} · {tf} · Bot\'s read: {confidence}%', buttons: TRADE_BTN, image_file: 'c-opportunity-closing.jpg' },
    { key: 'D', copy: '{name} banked {amount} today ✦ Your turn ─', buttons: TRADE_BTN, image_file: 'd-real-results.jpg' },
    { key: 'E', copy: '{count} users fired live trades in the last hour ✦ Join them ─', buttons: TRADE_BTN, image_file: 'e-live-trades.jpg' },
    { key: 'F', copy: 'Up or down? {pair} · {tf} — your call. Bot\'s read: {confidence}%', buttons: TRADE_BTN, image_file: 'f-up-or-down.jpg' },
    { key: 'G', copy: 'Access is by invitation only ✦ Connect your account and it\'s yours.', buttons: JSON.stringify([[{ text: '⟡ Connect Account', url: 'https://t.me/Shiloh10xbot?start' }]]), image_file: 'g-invitation-only.jpg' },
    { key: 'H', copy: 'Practice balances don\'t move your life. Fund & go live ─', buttons: JSON.stringify([[{ text: '✦ Fund Account', url: 'https://iqoption.com/pwa/payments/deposit' }]]), image_file: 'h-what-if-this-was-real.jpg' },
    { key: 'I', copy: 'TOP PICK {confidence}% ✦ {pair} — the engine\'s strongest read right now.', buttons: TRADE_BTN, image_file: 'i-top-pick.jpg' },
    { key: 'J', copy: 'A live session is running ✦ Join now ─', buttons: TRADE_BTN, image_file: 'j-live-now.jpg' },
    { key: 'K', copy: 'Last trade: {days} days ago ✦ The engine doesn\'t sleep. One trade ─', buttons: TRADE_BTN, image_file: 'k-engine-doesnt-sleep.jpg' },
    { key: 'L', copy: 'The Yacht Club is open ✦ Take a look ─', buttons: TRADE_BTN, image_file: 'l-yacht-club.jpg' },
    { key: 'M', copy: 'Today\'s goal: +${goal} ✦ You\'re at ${progress}% of the way there. Chase it ─', buttons: TRADE_BTN, image_file: 'm-todays-goal.jpg' },
    { key: 'N', copy: 'A new event window just opened ✦ Check your eligibility ─', buttons: TRADE_BTN, image_file: 'n-giveaway-open.jpg' },
    { key: 'O', copy: 'Sequence done. New setup loading ✦ Next opportunity ─', buttons: TRADE_BTN, image_file: 'o-new-setup-loading.jpg' },
];

let seedChecked = false;

/** Lazily seed structural templates on first use, and only when the table is
 *  empty — an operations-seeded table is never touched. */
export function seedBotATemplates(): void {
    if (seedChecked) return;
    seedChecked = true;
    try {
        const row = db.prepare('SELECT COUNT(*) AS n FROM bot_a_templates').get() as { n: number } | undefined;
        if ((row?.n ?? 0) > 0) return;
        const insert = db.prepare('INSERT OR IGNORE INTO bot_a_templates (key, copy, buttons, image_file) VALUES (?, ?, ?, ?)');
        for (const t of SEED_TEMPLATES) insert.run(t.key, t.copy, t.buttons, t.image_file);
        logger.info('bot-a', `seeded ${SEED_TEMPLATES.length} structural templates (operations will overwrite)`);
    } catch (e) {
        logger.warn('bot-a', `template seed failed: ${e instanceof Error ? e.message : e}`);
    }
}

// ─── Placeholders (Part 6) ──────────────────────────────────────────────────

function randInt(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

const PAIRS = ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDCAD', 'GBPJPY'];
const TFS = ['30s', '1m', '2m'];
const GOALS = ['50', '100', '150'];

/** No-repeat pool bag, persisted in bot_a_pools (bag + bag_idx) so the cycle
 *  survives restarts: each pool cycles through a shuffled copy of itself and
 *  only reshuffles when the bag is exhausted — no name or amount repeats until
 *  every item has been used once, across bot restarts too. */
function pickNoRepeat(poolKey: string): string {
    const row = db.prepare('SELECT items, bag, bag_idx FROM bot_a_pools WHERE key = ?')
        .get(poolKey) as { items: string; bag: string; bag_idx: number } | undefined;
    let items: string[] = [];
    if (row?.items) {
        try {
            const parsed = JSON.parse(row.items);
            if (Array.isArray(parsed) && parsed.length > 0) items = parsed.map(String);
        } catch { /* fall through */ }
    }
    if (items.length === 0) return poolKey === 'names' ? 'a member' : '+$350';
    if (items.length === 1) return items[0];

    let bag: string[] = [];
    try {
        const parsed = JSON.parse(row?.bag ?? '');
        if (Array.isArray(parsed) && parsed.length === items.length) bag = parsed.map(String);
    } catch { /* fresh bag below */ }
    if (bag.length === 0) bag = [...items].sort(() => Math.random() - 0.5);

    let idx = row?.bag_idx ?? 0;
    if (!Number.isInteger(idx) || idx < 0 || idx >= bag.length) idx = 0;
    const v = bag[idx];
    idx = (idx + 1) % bag.length;
    if (idx === 0) bag = [...items].sort(() => Math.random() - 0.5); // exhausted → reshuffle

    db.prepare('UPDATE bot_a_pools SET bag = ?, bag_idx = ? WHERE key = ?')
        .run(JSON.stringify(bag), idx, poolKey);
    return v;
}

/** Daily-rotating spot price for the limited-time window templates: the value
 *  is drawn once per Lagos day from the 'spots' pool and reused all day, so the
 *  offer amount fluctuates daily but never mid-day. The WINDOW (how long the
 *  offer stays valid) is drawn with the spot: a fresh expiry in hours, stored
 *  in config so the access gate can honor it and expire it. */
const WINDOW_HOURS = [2, 3, 4, 6];

function ensureSpotWindow(poolKey: string, prefix: string): { spot: string; windowLabel: string; expiresAt: string } {
    const expKey = `${prefix}_expires`;
    const durKey = `${prefix}_duration`;
    const spotKey = `${prefix}_spot`;
    const dailyKey = prefix === 'promo_private' ? 'spot_private' : 'spot_autopilot';

    const now = new Date();
    const existing = db.prepare('SELECT value FROM config WHERE key = ?').get(expKey) as { value: string } | undefined;
    let expiresAt: string | null = null;
    if (existing?.value) {
        const exp = new Date(existing.value);
        if (!isNaN(exp.getTime()) && exp > now) expiresAt = existing.value;
    }
    const hours = WINDOW_HOURS[Math.floor(Math.random() * WINDOW_HOURS.length)];
    if (!expiresAt) {
        expiresAt = new Date(now.getTime() + hours * 3_600_000).toISOString();
        db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(expKey, expiresAt);
        db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(durKey, `${hours} hour${hours > 1 ? 's' : ''}`);
    }
    const windowLabel = (db.prepare('SELECT value FROM config WHERE key = ?').get(durKey) as { value: string } | undefined)?.value ?? `${hours} hours`;

    const today = lagosDate();
    const row = db.prepare('SELECT date, value FROM bot_a_daily WHERE key = ?').get(dailyKey) as { date: string; value: string } | undefined;
    let spot: string;
    if (row && row.date === today && row.value) {
        spot = row.value;
    } else {
        const spots = getBotAPool(poolKey);
        spot = spots.length > 0 ? pick(spots) : '$20';
        db.prepare(`INSERT INTO bot_a_daily (key, date, value) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET date = excluded.date, value = excluded.value`).run(dailyKey, today, spot);
    }
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(spotKey, spot.replace('$', ''));
    return { spot, windowLabel, expiresAt };
}

/** Substitute every supported token. `daysSinceLastTrade` comes from the
 *  activity check so {days} reflects the user's real gap (clamped 1–9). */
function resolvePlaceholders(copy: string, daysSinceLastTrade: number): string {
    const privateWindow = ensureSpotWindow('spots', 'promo_private');
    const autoWindow = ensureSpotWindow('autospots', 'promo_auto');
    return copy
        .replace(/\{confidence\}/g, () => String(randInt(80, 97)))
        .replace(/\{countdown\}/g, () => String(randInt(2, 5)))
        .replace(/\{pair\}/g, () => `${pick(PAIRS)}-OTC`)
        .replace(/\{tf\}/g, () => pick(TFS))
        .replace(/\{gale\}/g, () => String(randInt(2, 4)))
        .replace(/\{days\}/g, () => String(daysSinceLastTrade))
        .replace(/\{name\}/g, () => pickNoRepeat('names'))
        .replace(/\{amount\}/g, () => pickNoRepeat('amounts'))
        .replace(/\{spot\}/g, () => privateWindow.spot)
        .replace(/\{window\}/g, () => privateWindow.windowLabel)
        .replace(/\{autospot\}/g, () => autoWindow.spot)
        .replace(/\{autowindow\}/g, () => autoWindow.windowLabel)
        .replace(/\{count\}/g, () => String(randInt(15, 40)))
        .replace(/\{goal\}/g, () => pick(GOALS))
        .replace(/\{progress\}/g, () => String(randInt(20, 60)));
}

/** Build an inline keyboard from the template's buttons JSON. Accepts both the
 *  array-of-arrays form and a flat array (each button on its own row). Invalid
 *  JSON or unusable entries yield no keyboard rather than a failed send. */
type InlineButton = { text: string; url: string } | { text: string; callback_data: string };

function buildKeyboard(buttonsJson: string): { inline_keyboard: InlineButton[][] } | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(buttonsJson || '[]');
    } catch (e) {
        logger.warn('bot-a', `buttons JSON invalid — sending without keyboard: ${e instanceof Error ? e.message : e}`);
        return undefined;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    const rows = (Array.isArray(parsed[0]) ? parsed : parsed.map(b => [b])) as ButtonSpec[][];
    const keyboard = rows
        .map(row => (Array.isArray(row) ? row : [row])
            .filter((b): b is ButtonSpec => !!b && typeof b.text === 'string' && (!!b.callback || !!b.url))
            .map(b => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.callback as string })))
        .filter(row => row.length > 0);
    return keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;
}

// ─── Time helpers ───────────────────────────────────────────────────────────

/** Lagos calendar date (fixed UTC+1, no DST) — same derivation checkin.ts uses
 *  so the daily cap rolls over on the same boundary as the check-ins. */
function lagosDate(): string {
    return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

/** SQLite datetime('now')-format stamp for `minutes` ago, UTC. */
function utcMinutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

// ─── Per-user state ─────────────────────────────────────────────────────────

function readSent(telegramId: number): SentRow | null {
    return (db.prepare('SELECT * FROM bot_a_sent WHERE telegram_id = ?').get(telegramId) as SentRow | undefined) ?? null;
}

function recordSent(telegramId: number, messageId: number | null, archetype: string, today: string, prior: SentRow | null): void {
    // sent_count restarts whenever the stored date is not today, so the cap is
    // per-Lagos-day rather than lifetime.
    const nextCount = prior && prior.sent_date === today ? prior.sent_count + 1 : 1;
    db.prepare(`
        INSERT INTO bot_a_sent (telegram_id, message_id, last_archetype, sent_count, sent_date, last_sent_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
            message_id = excluded.message_id, last_archetype = excluded.last_archetype,
            sent_count = excluded.sent_count, sent_date = excluded.sent_date,
            last_sent_at = excluded.last_sent_at
    `).run(telegramId, messageId, archetype, nextCount, today);
}

// ─── Eligibility ────────────────────────────────────────────────────────────

interface Candidate {
    telegram_id: number;
    ssid: string | null;
    funded_balance_usd: number | null;
    approval_status: string | null;
}

/** Approved AND pending users, admin excluded, restricted to the maintenance
 *  allowlist when the gate is on and to the test user when test mode is set.
 *  The allowlist and test filters are applied IN SQL so the batch LIMIT can
 *  never starve them. Pending users (never finished connect/approval) are
 *  included so the loop can chase them with the connect nudge. */
function getCandidates(limit: number): Candidate[] {
    const params: Array<string | number> = [];
    let extraSql = '';

    const testUserId = getTestUserId();
    if (testUserId) {
        extraSql += ' AND u.telegram_id = ?';
        params.push(testUserId);
    } else if (getConfig('maintenance_gate') === '1') {
        const ids = [...MAINTENANCE_ALLOWED_IDS];
        extraSql += ` AND u.telegram_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
    }

    params.push(getAdminId(), limit);
    return db.prepare(`
        SELECT u.telegram_id AS telegram_id, u.ssid AS ssid, u.funded_balance_usd AS funded_balance_usd,
               u.approval_status AS approval_status
        FROM users u
        WHERE u.approval_status IN ('approved', 'pending')${extraSql}
          AND u.telegram_id != ?
        ORDER BY COALESCE((SELECT s.last_sent_at FROM bot_a_sent s WHERE s.telegram_id = u.telegram_id), ''), u.telegram_id
        LIMIT ?
    `).all(...params) as Candidate[];
}

/** Most recent trade timestamp, or null when the user has never traded. */
function lastTradeAt(telegramId: number): string | null {
    const row = db.prepare('SELECT MAX(created_at) AS ts FROM trades WHERE telegram_id = ?')
        .get(telegramId) as { ts: string | null } | undefined;
    return row?.ts ?? null;
}

/** ISO-8601 UTC timestamp `minutes` ago — for julianday() comparisons, which
 *  parse both the ISO 'T/Z' format (trades.created_at) and SQLite's space
 *  format (checkin_sent.sent_at) correctly. Mixing raw string formats broke
 *  the activity check: 'T' sorts above ' ' so every ISO timestamp looked
 *  "newer" than a space-format cutoff on the same day. */
function isoMinutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** True when the user traded inside the activity window (→ skip silently). */
function tradedRecently(telegramId: number): boolean {
    const row = db.prepare('SELECT MAX(julianday(created_at)) AS ts FROM trades WHERE telegram_id = ? AND julianday(created_at) >= julianday(?)')
        .get(telegramId, isoMinutesAgo(ACTIVITY_WINDOW_MIN)) as { ts: number | null } | undefined;
    return !!row?.ts;
}

/** True when a check-in landed within the quiet window (→ don't stack on it). */
function checkinTooFresh(telegramId: number): boolean {
    try {
        const row = db.prepare('SELECT 1 AS hit FROM checkin_sent WHERE telegram_id = ? AND julianday(sent_at) >= julianday(?) LIMIT 1')
            .get(telegramId, isoMinutesAgo(CHECKIN_QUIET_MIN)) as { hit: number } | undefined;
        return !!row;
    } catch (e) {
        // checkin_sent is created by checkin.ts's own init; if it is not there
        // yet, there is no check-in to collide with.
        logger.warn('bot-a', `check-in coexistence probe failed (treating as clear): ${e instanceof Error ? e.message : e}`);
        return false;
    }
}

/** Days since the user's last trade, clamped to the 1–9 range {days} expects. */
function daysSinceLastTrade(lastTs: string | null): number {
    if (!lastTs) return 9;
    const parsed = Date.parse(lastTs.includes('T') ? lastTs : lastTs.replace(' ', 'T') + 'Z');
    if (!isFinite(parsed)) return 9;
    const days = Math.floor((Date.now() - parsed) / 86_400_000);
    return Math.min(9, Math.max(1, days));
}

/** Segment → archetype set (Part 5.4). */
function eligibleArchetypes(c: Candidate): string[] {
    // Pending (never approved) → chase them to finish the connect/approval.
    // Connected-but-unapproved users get R (fast-track) instead of the connect
    // chase — asking them to "link" an account they already linked is wrong.
    if (c.approval_status === 'pending') {
        const hasSsid = !!c.ssid && c.ssid !== '';
        return hasSsid ? ['R'] : ['Q1', 'Q2', 'Q3'];
    }
    const hasSsid = !!c.ssid && c.ssid !== '';
    if (!hasSsid) return ['G'];
    if ((c.funded_balance_usd ?? 0) <= 0) return ['H'];
    return FUNDED_IDLE_ARCHETYPES;
}

/** Never the same archetype twice in a row: drop `last` from the pool unless it
 *  is the only option (single-member segments G/H repeat by design). */
function chooseArchetype(eligible: string[], last: string | null): string {
    const pool = eligible.length > 1 && last ? eligible.filter(k => k !== last) : eligible;
    return pick(pool.length > 0 ? pool : eligible);
}

// ─── Send ───────────────────────────────────────────────────────────────────

async function sendNudge(bot: Telegraf, uid: number, key: string, tpl: BotATemplate, days: number): Promise<number | null> {
    const caption = resolvePlaceholders(tpl.copy, days);
    const replyMarkup = buildKeyboard(tpl.buttons);
    const extra: Record<string, unknown> = {};
    if (replyMarkup) extra.reply_markup = replyMarkup;

    if (tpl.image_file) {
        try {
            const file = path.resolve(process.cwd(), 'assets', 'bot-a', tpl.image_file);
            const msg = await bot.telegram.sendPhoto(uid, { source: file }, { caption, ...extra });
            return msg?.message_id ?? null;
        } catch (e) {
            // Missing file or photo-send failure — fall through to plain text so
            // the nudge still lands.
            logger.warn('bot-a', `photo send failed for ${uid} (${tpl.image_file}), falling back to text: ${e instanceof Error ? e.message : e}`);
        }
    }
    const msg = await bot.telegram.sendMessage(uid, caption, extra);
    return msg?.message_id ?? null;
}

// ─── Tick ───────────────────────────────────────────────────────────────────

let ticking = false;

async function tick(bot: Telegraf): Promise<void> {
    // 5.3.1 — global pause short-circuits the whole tick.
    if (getConfig('features_paused') === '1') return;

    seedBotATemplates();
    const today = lagosDate();
    const candidates = getCandidates(BATCH_SIZE);
    if (candidates.length === 0) return;

    let sent = 0;
    for (const c of candidates) {
        const uid = c.telegram_id;
        try {
            // Active in the last hour → silent skip, no state change.
            if (tradedRecently(uid)) continue;

            const prior = readSent(uid);
            // Segment-aware limits: pending users get the aggressive 30-min
            // cadence (48/day cap) — everyone else stays hourly (24/day).
            const isPending = c.approval_status === 'pending';
            const pacingMin = isPending ? 30 : ACTIVITY_WINDOW_MIN;
            const cap = isPending ? 48 : DAILY_CAP;
            // Daily cap (per Lagos date — a stale date means today's count is 0).
            if (prior && prior.sent_date === today && prior.sent_count >= cap) continue;
            // Per-user pacing: a nudge sent inside the pacing window blocks the
            // next one regardless of the tick cadence.
            if (prior?.last_sent_at && Date.parse(prior.last_sent_at.replace(' ', 'T') + 'Z') > Date.now() - pacingMin * 60_000) continue;
            // Never stack on a fresh check-in.
            if (checkinTooFresh(uid)) continue;

            const key = chooseArchetype(eligibleArchetypes(c), prior?.last_archetype ?? null);
            const tpl = getBotATemplate(key);
            if (!tpl) {
                logger.warn('bot-a', `template ${key} missing — skipping ${uid}`);
                continue;
            }

            // Cancel-out: remove the previous nudge before the new one lands.
            if (prior?.message_id) {
                try { await bot.telegram.deleteMessage(uid, prior.message_id); }
                catch { /* already gone or too old to delete */ }
            }

            const days = daysSinceLastTrade(lastTradeAt(uid));
            let messageId: number | null = null;
            try {
                messageId = await sendNudge(bot, uid, key, tpl, days);
            }
            catch (e) {
                // Blocked/deactivated users and transient send errors must never
                // break the sweep — AND must still be recorded, otherwise they
                // sit at the front of the never-sent queue forever and starve
                // every real user behind them.
                logger.warn('bot-a', `send failed ${uid}: ${e instanceof Error ? e.message : e}`);
            }
            recordSent(uid, messageId, key, today, prior);
            if (messageId !== null)
                sent++;
            logger.info('bot-a', `sent ${key} to ${uid}${messageId === null ? ' (failed, recorded)' : ''}`);
        } catch (e) {
            // Blocked/deactivated users and transient send errors must never
            // break the sweep for everyone behind them.
            logger.warn('bot-a', `send failed ${uid}: ${e instanceof Error ? e.message : e}`);
        }
        await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    }
    if (sent > 0) logger.info('bot-a', `tick complete — ${sent}/${candidates.length} nudged`);
}

/** Start the loop. Idempotent: a second call is a no-op so a double-wire can
 *  never double the send rate. */
let started = false;

export function startBotALoop(bot: Telegraf): void {
    if (started) return;
    started = true;
    setInterval(() => {
        if (ticking) return;
        ticking = true;
        tick(bot)
            .catch(e => logger.error('bot-a', `tick failed: ${e instanceof Error ? e.message : e}`))
            .finally(() => { ticking = false; });
    }, TICK_MS);
    logger.info('bot-a', 'hourly smart loop started (60s tick, 24/day cap)');
}
