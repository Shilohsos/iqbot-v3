import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { db } from './db.js';

export interface AffiliateResult {
    found: boolean;
    data?: { message: string; date: string } | null;
}

// Singleton client — stays connected across multiple checks.
let _client: TelegramClient | null = null;

async function getClient(): Promise<TelegramClient> {
    if (_client?.connected) return _client;

    const sessionString = process.env.TELETHON_SESSION ?? '';
    const apiId = parseInt(process.env.TELEGRAM_API_ID ?? '', 10);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';

    if (!sessionString || isNaN(apiId) || !apiHash) {
        throw new Error('Missing env: TELETHON_SESSION, TELEGRAM_API_ID, or TELEGRAM_API_HASH');
    }

    _client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 3,
        baseLogger: undefined as never,
    });

    try {
        await Promise.race([
            _client.connect(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('GramJS connect timeout')), 15_000)),
        ]);
    } catch (err) {
        // The TCP socket may already be ESTABLISHED while the MTProto handshake
        // hangs — kill it so the session is never held by a half-open connection
        // (that would AUTH_KEY_DUPLICATED every other client on this session).
        try {
            const conn = (_client as any)._connection;
            if (conn?._socket?.destroy) conn._socket.destroy();
        } catch { /* best-effort */ }
        _client = null;
        throw err;
    }
    return _client;
}

/** Total wall-clock budget for one verification. The user must never wait longer
 *  than the pre-existing 15s cap, so search + backfill share this budget and the
 *  call degrades to whatever the local archive holds once it is spent. */
const VERIFY_BUDGET_MS = 15_000;
/** Messages per backfill page. */
const BACKFILL_PAGE = 200;
/** Ceiling on messages archived in a single verification call. */
const BACKFILL_MAX_MESSAGES = 5_000;
/** Stop starting new pages when less than this remains of the budget. */
const PAGE_MIN_REMAINING_MS = 2_000;

/** IQ Option user IDs on the affiliate channel are 9 digits beginning "19".
 *  Matching on a word boundary catches `ID: 195190255`, `user_id:195190255`,
 *  and punctuation-wrapped payloads that a plain includes() would still find but
 *  which we must also be able to EXTRACT for the archive. */
const ID_RE = /\b(19\d{7})\b/g;

function extractIds(text: string): string[] {
    const out = new Set<string>();
    for (const m of text.matchAll(ID_RE)) out.add(m[1]);
    return [...out];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
    ]);
}

/** Release the shared Telegram session after every check. The SALES bot scans the
 *  affiliate channel continuously with the SAME TELETHON_SESSION string — if this
 *  client stays connected, Telegram kills the sales bot's connection with
 *  AUTH_KEY_DUPLICATED and reps cannot claim events. Connect-per-check only. */
function releaseClient(): void {
    const c = _client;
    _client = null;
    if (!c) return;
    const killSocket = () => {
        try {
            const conn = (c as any)._connection;
            if (conn?._socket?.destroy) conn._socket.destroy();
        } catch { /* best-effort */ }
    };
    try {
        if (c.connected) {
            // Graceful disconnect can hang on a flaky socket — force-close after 2s
            // so the session is NEVER held hostage (AUTH_KEY_DUPLICATED for sales bot).
            Promise.race([
                c.disconnect(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('disconnect timeout')), 2000)),
            ]).catch(() => {
                try { c.destroy?.(); } catch { /* best-effort */ }
                killSocket();
            });
        } else {
            // Half-open state: `connected` is false but the TCP socket may still be
            // ESTABLISHED — Telegram's DC still counts it and rejects everyone else.
            // Destroy the raw socket unconditionally.
            try { c.destroy?.(); } catch { /* best-effort */ }
            killSocket();
        }
    } catch { /* best-effort */ }
}

/** GramJS exposes message text as `.text`; `.message` is the raw field. Media
 *  posts carry their caption in the same place, so read both. */
function msgText(msg: { text?: string; message?: string }): string {
    return msg.text ?? msg.message ?? '';
}

function msgDateIso(msg: { date?: number }): string {
    return msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString();
}

// ─── Local archive ──────────────────────────────────────────────────────────

interface ArchiveRow { raw_text: string; msg_date: string | null }

/** Look the ID up in the durable archive: exact extracted-ID match first (indexed),
 *  then a raw-text LIKE as a backstop for any format the regex did not extract. */
function findLocal(userIdStr: string): ArchiveRow | null {
    try {
        const exact = db.prepare(
            'SELECT raw_text, msg_date FROM affiliate_messages WHERE iq_user_id = ? ORDER BY channel_msg_id DESC LIMIT 1'
        ).get(userIdStr) as ArchiveRow | undefined;
        if (exact) return exact;
        const like = db.prepare(
            "SELECT raw_text, msg_date FROM affiliate_messages WHERE raw_text LIKE ? ORDER BY channel_msg_id DESC LIMIT 1"
        ).get(`%${userIdStr}%`) as ArchiveRow | undefined;
        return like ?? null;
    } catch {
        // Archive table unavailable — the Telegram layers still answer.
        return null;
    }
}

/** Persist one channel message. Rows are written per extracted ID (a message
 *  listing several IDs yields several rows); a message with none is stored with
 *  iq_user_id '' so it still records how far back the archive reaches. */
function persistMessage(msg: { id?: number; text?: string; message?: string; date?: number }): void {
    const channelMsgId = msg.id;
    if (channelMsgId == null) return;
    const text = msgText(msg);
    const date = msgDateIso(msg);
    const ids = extractIds(text);
    const stmt = db.prepare(
        'INSERT OR IGNORE INTO affiliate_messages (channel_msg_id, iq_user_id, raw_text, msg_date) VALUES (?, ?, ?, ?)'
    );
    try {
        if (ids.length === 0) stmt.run(channelMsgId, '', text, date);
        else for (const id of ids) stmt.run(channelMsgId, id, text, date);
    } catch { /* archive write is best-effort — never fail a verification on it */ }
}

/** Oldest message id already archived — the resume cursor for backfill. */
function oldestArchivedId(): number | null {
    try {
        const row = db.prepare('SELECT MIN(channel_msg_id) AS m FROM affiliate_messages').get() as { m: number | null } | undefined;
        return row?.m ?? null;
    } catch {
        return null;
    }
}

// Only one backfill may run at a time: concurrent verifications would otherwise
// paginate the same range in parallel and burn the rate limit for nothing.
let backfilling = false;

/**
 * Walk the channel backwards from the oldest already-archived message, persisting
 * every message, until the ID turns up, the budget runs out, or the ceiling is hit.
 *
 * Progress is durable and the cursor is derived from the archive itself, so a run
 * cut short by the budget is not wasted — the next verification resumes exactly
 * where this one stopped, and the archive converges to the full history across
 * calls without any single user ever waiting longer than the 15s cap.
 */
async function backfillArchive(
    client: TelegramClient,
    channelId: string,
    userIdStr: string,
    deadline: number,
): Promise<ArchiveRow | null> {
    if (backfilling) return null;
    backfilling = true;
    let scanned = 0;
    let pages = 0;
    try {
        let offsetId = oldestArchivedId() ?? 0; // 0 = start from the newest message
        while (scanned < BACKFILL_MAX_MESSAGES) {
            const remaining = deadline - Date.now();
            if (remaining < PAGE_MIN_REMAINING_MS) {
                console.warn(`[affiliate] backfill budget spent after ${scanned} msgs (${pages} pages) — archive advanced, resuming next call`);
                break;
            }
            const batch = await withTimeout(
                client.getMessages(channelId, { limit: BACKFILL_PAGE, offsetId }),
                Math.min(remaining, 10_000),
                'GramJS backfill getMessages',
            );
            if (!batch || batch.length === 0) {
                console.log(`[affiliate] backfill reached the start of channel history after ${scanned} msgs`);
                break;
            }
            pages++;
            for (const m of batch) {
                persistMessage(m as never);
                scanned++;
                const id = (m as { id?: number }).id;
                if (id != null && (offsetId === 0 || id < offsetId)) offsetId = id;
            }
            const hit = findLocal(userIdStr);
            if (hit) {
                console.log(`[affiliate] backfill HIT for ${userIdStr} after ${scanned} msgs (${pages} pages)`);
                return hit;
            }
        }
    } catch (e) {
        console.warn(`[affiliate] backfill failed after ${scanned} msgs: ${e instanceof Error ? e.message : e}`);
    } finally {
        backfilling = false;
    }
    return findLocal(userIdStr);
}

/**
 * Search the affiliate tracking channel for a given IQ Option User ID.
 * Throws if required env vars are missing or the Telegram session is invalid.
 *
 * Four layers, cheapest first:
 *   0. local archive           — instant, no network, permanent once seen
 *   1. Telegram server search  — the ENTIRE channel history, not a window
 *   2. resumable backfill      — archives history and re-checks
 *   3. lead_events             — deposit history (unchanged, deposits only)
 */
export async function checkAffiliate(iqUserId: number): Promise<AffiliateResult> {
    const channelId = process.env.AFFILIATE_CHANNEL_ID ?? '';
    if (!channelId) throw new Error('AFFILIATE_CHANNEL_ID not set');

    const userIdStr = String(iqUserId);
    const deadline = Date.now() + VERIFY_BUDGET_MS;

    // ── Layer 0: durable local archive ─────────────────────────────────────
    const cached = findLocal(userIdStr);
    if (cached) {
        return { found: true, data: { message: cached.raw_text, date: cached.msg_date ?? new Date().toISOString() } };
    }

    let client: TelegramClient | undefined;
    let killWatchdog: ReturnType<typeof setTimeout> | undefined;
    try {
        client = await getClient();
    // ── Layer 1: Telegram-side full-history search ─────────────────────────
    // Server-side search covers the channel's ENTIRE history, so a registration
    // that scrolled out of the old 1000-message window is found regardless of age.
    // HARD WATCHDOG: even if every await hangs, never let a socket outlive the
    // check — an ESTABLISHED socket with this session AUTH_KEY_DUPLICATEs every
    // other client (sales bot scanner). Kill unconditionally after budget + 5s.
    killWatchdog = setTimeout(() => {
        try {
            const conn = (client as any)?._connection;
            if (conn?._socket?.destroy) conn._socket.destroy();
            (client as any)?.destroy?.();
        } catch { /* best-effort */ }
    }, VERIFY_BUDGET_MS + 5_000);
    try {
        const results = await withTimeout(
            client.getMessages(channelId, { search: userIdStr, limit: 10 }),
            Math.min(Math.max(deadline - Date.now(), 1_000), 15_000),
            'GramJS search getMessages',
        );
        for (const msg of (results ?? []) as any[]) {
            const text = msgText(msg as never);
            if (text.includes(userIdStr) || extractIds(text).includes(userIdStr)) {
                persistMessage(msg as never); // archive it so this never costs a round-trip again
                console.log(`[affiliate] search HIT for ${userIdStr} (msg ${(msg as { id?: number }).id ?? 'n/a'})`);
                return { found: true, data: { message: text, date: msgDateIso(msg as never) } };
            }
        }
        console.log(`[affiliate] search MISS for ${userIdStr} — paginating channel history`);
    } catch (e) {
        // Search unavailable (rate limit, timeout, older server) — fall through.
        console.warn(`[affiliate] search failed for ${userIdStr}: ${e instanceof Error ? e.message : e}`);
    }

    // ── Layer 2: resumable backfill of the channel into the local archive ──
    const archived = await backfillArchive(client!, channelId, userIdStr, deadline);
    if (archived) {
        return { found: true, data: { message: archived.raw_text, date: archived.msg_date ?? new Date().toISOString() } };
    }

    // ── Layer 3: lead_events (deposits only — unchanged) ───────────────────
    // Retained as the last layer: it covers IDs that deposited but whose channel
    // message is somehow unreadable. It cannot cover a fresh registration, which
    // is precisely why the layers above exist.
    try {
        const hist = db.prepare(
            `SELECT event_type, amount, event_date, channel_msg_id
             FROM lead_events
             WHERE iq_user_id = ?
             ORDER BY event_date DESC
             LIMIT 1`
        ).get(iqUserId) as { event_type: string; amount: string; event_date: string; channel_msg_id?: number } | undefined;
        if (hist) {
            return {
                found: true,
                data: {
                    message: `[history] ${hist.event_type} ${hist.amount} on ${hist.event_date} (msg ${hist.channel_msg_id ?? 'n/a'})`,
                    date: hist.event_date,
                },
            };
        }
    }
    catch {
        // lead_events table may not exist in every deployment — channel scan is the primary check.
    }

    console.warn(`[affiliate] NOT FOUND for ${userIdStr} after search + backfill + lead_events`);
    return { found: false, data: null };
    } finally {
        clearTimeout(killWatchdog);
        releaseClient();
    }
}
