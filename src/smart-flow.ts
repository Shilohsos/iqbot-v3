// Smart Flow — recommendation-driven Private Trader entry (DIRECTIVE-SMART-FLOW.md).
//
// Opening Private Trader shows a personalized setup card first: a live balance
// read plus a suggested stake, assets and timeframe, with a one-tap Start or a
// "Choose manually" fallback into the existing wizard.
//
// It is RECOMMENDATION ONLY. Nothing here executes a trade and nothing fires on
// its own — the scan runs solely when the user opens the flow, and only when the
// cache is missing, older than 6h, or the live balance has halved since the last
// scan. "Start with this setup" seeds the existing wizard and hands off at the
// asset step; the user still picks a pair and a recovery level before anything
// is placed, exactly as in the manual flow.
//
// bot.ts wires this module in four places: initSmartFlowDb() at boot, the two
// SDK/wizard dependency injections below (so this module never opens its own SDK
// connections and never touches wizard internals), and ONE callback route
// (`smart:*`) to handleSmartFlowCallback.

import { db, getConfig, getUser } from './db.js';
import { AI_TRADING_MIN_USD, AUTO_TRADING_MIN_USD, CURRENCY_SYMBOLS, fmtBalance } from './access.js';
import { tfLabel } from './menu.js';
import { getAdminId } from './ui/admin.js';
import { logger } from './logger.js';
const DEPOSIT_URL = 'https://iqoption.com/pwa/payments/deposit';

/** Recommendation cache freshness — a scan older than this is refreshed on open. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** A live balance at or below this fraction of the cached one forces a rescan. */
const BALANCE_DROP_RATIO = 0.5;
/** Suggested stake as a fraction of the live balance. */
const STAKE_PCT = 0.05;
/** Timeframe ladder for the two recommendations (seconds). */
const TIMEFRAME_LADDER = [30, 60, 120, 300];
/** History window for the most-traded pair / most-used timeframe. */
const HISTORY_DAYS = 7;
const SUGGESTED_ASSET_COUNT = 3;

const DEFAULT_ASSETS = ['EURUSD-OTC', 'XAUUSD-OTC', 'GBPJPY-OTC'];
const DEFAULT_TIMEFRAME_SEC = 60;

/** Privileged (admin-level) accounts: stake cap and banned assets/timeframes
 *  apply to admin + PRIVILEGED_USERS (mirrors bot.ts PRIVILEGED_USERS + getAdminId). */
const PRIVILEGED_IDS = new Set([6622587977, 8986669286, 6683209485]);
const PRIV_STAKE_CAP_USD = 700;
const PRIV_BANNED_ASSETS = new Set(['EURGBP', 'BTCUSD', 'XAUUSD']);
/** Allowed timeframe pairs for privileged accounts — must include 2m or 5m. */
const PRIV_TIMEFRAME_PAIRS = [
    [120, 60],   // 2m + 1m
    [30, 300],   // 30s + 5m
    [120, 300],  // 2m + 5m
];
/** Rotating stake-percentage sets — the suggested amounts vary between scans
 *  instead of always being 3/5/7% of the balance. */
const STAKE_PCT_SETS = [
    [0.03, 0.05, 0.07],
    [0.02, 0.04, 0.06],
    [0.04, 0.06, 0.08],
];
/** Rotating cap spreads for large balances — when every percentage hits the
 *  $700 cap, the buttons still differ across scans. */
const CAP_SPREAD_SETS = [
    [0.5, 0.75, 1],
    [0.4, 0.6, 0.8],
    [0.6, 0.8, 1],
];

/**
 * Deterministic rotation seed — changes once per cache window (6h) so each
 * fresh scan recommends a different timeframe pair / asset order / amounts,
 * but the card stays stable within the window. Mirrors needsRescan's TTL.
 */
function rotationSeed(): number {
    return Math.floor(Date.now() / CACHE_TTL_MS);
}

// Same allowlist as bot.ts's maintenance gate (MAINTENANCE_ALLOWED_IDS) —
// duplicated locally rather than imported, matching how checkin.ts mirrors it
// (bot.ts doesn't export module-private constants). The gate middleware already
// blocks non-allowlisted callbacks; this is defence in depth for the entry point.
const MAINTENANCE_ALLOWED_IDS = new Set([6622587977, getAdminId()]);

function maintenanceBlocks(uid: number): boolean {
    return getConfig('maintenance_gate') === '1' && !MAINTENANCE_ALLOWED_IDS.has(uid);
}

// ─── DB ─────────────────────────────────────────────────────────────────────

export interface SmartRecommendation {
    /** 'practice' below the live minimum, otherwise 'live'. */
    tier: 'practice' | 'live';
    /** Suggested stake in account currency — null on the practice path. */
    stake: number | null;
    /** Three selectable stakes (low / suggested / high) in account currency. */
    stakes: number[];
    assets: string[];
    timeframeSec: number;
    /** Two selectable timeframes (seconds). */
    timeframesSec: number[];
    /** True at the Autopilot threshold, where the card offers the product choice. */
    autopilotEligible: boolean;
    currency: string;
    /** USD-normalized live balance at scan time. Kept so the ≥50%-drop rule can
     *  compare like with like: thresholds and the drop check are USD, while
     *  stake and every displayed figure stay in the account currency. */
    scanLiveUsd: number;
}

interface CacheRow {
    telegram_id: number;
    last_scan_at: string | null;
    balance_live: number | null;
    balance_demo: number | null;
    recommendations: string | null;
    updated_at: string | null;
}

/** Table lives in db.ts (created at import); this only verifies it is present so
 *  a boot against a stale database fails loudly here rather than mid-flow. */
export function initSmartFlowDb(): void {
    const ok = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='smart_flow_cache'").get();
    if (!ok) throw new Error('smart_flow_cache missing — db.ts schema did not run');
}

function readCache(telegramId: number): CacheRow | null {
    return (db.prepare('SELECT * FROM smart_flow_cache WHERE telegram_id = ?').get(telegramId) as CacheRow | undefined) ?? null;
}

function writeCache(telegramId: number, live: number, demo: number, rec: SmartRecommendation): void {
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO smart_flow_cache (telegram_id, last_scan_at, balance_live, balance_demo, recommendations, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            last_scan_at = excluded.last_scan_at, balance_live = excluded.balance_live,
            balance_demo = excluded.balance_demo, recommendations = excluded.recommendations,
            updated_at = excluded.updated_at
    `).run(telegramId, now, live, demo, JSON.stringify(rec), now);
}

/** Most-traded pairs and most-used timeframe over the last 7 days. */
function readHistory(telegramId: number): { pairs: string[]; timeframeSec: number | null } {
    const since = `-${HISTORY_DAYS} days`;
    const pairRows = db.prepare(`
        SELECT pair, COUNT(*) AS n FROM trades
        WHERE telegram_id = ? AND created_at >= datetime('now', ?) AND pair IS NOT NULL
        GROUP BY pair ORDER BY n DESC, pair
    `).all(telegramId, since) as { pair: string; n: number }[];
    const tfRow = db.prepare(`
        SELECT timeframe_sec AS tf, COUNT(*) AS n FROM trades
        WHERE telegram_id = ? AND created_at >= datetime('now', ?) AND timeframe_sec IS NOT NULL
        GROUP BY timeframe_sec ORDER BY n DESC, tf
        LIMIT 1
    `).get(telegramId, since) as { tf: number; n: number } | undefined;
    return { pairs: pairRows.map(r => r.pair), timeframeSec: tfRow?.tf ?? null };
}

// ─── Dependency injection (bot.ts owns the SDK and the wizard) ───────────────

export interface SmartScanResult {
    /** Live (real) balance in account currency. */
    live: { amount: number; currency: string } | null;
    /** Practice (demo) balance in account currency. */
    demo: { amount: number; currency: string } | null;
    /** Tickers currently purchasable, for market-aware asset filtering. Null when
     *  the actives lookup failed — callers then skip filtering rather than
     *  wrongly discarding every pair. */
    openPairs: string[] | null;
}

type Scanner = (uid: number) => Promise<SmartScanResult | null>;
type WizardStarter = (ctx: any, rec: SmartRecommendation) => Promise<void>;

let scanner: Scanner | null = null;
let wizardStarter: WizardStarter | null = null;

/** In-flight selection state for the two-step start flow (timeframe → stake). */
const pendingTfChoice = new Map<number, SmartRecommendation>();
const pendingCustomStake = new Map<number, { rec: SmartRecommendation; timeframeSec: number; awaitingText?: boolean }>();

/** Wired once at boot: bot.ts supplies the SDK balance + open-actives read. */
export function setSmartFlowScanner(fn: Scanner): void { scanner = fn; }

/** Wired once at boot: bot.ts seeds its wizard session from the recommendation
 *  and hands the user to the existing asset step. */
export function setSmartFlowWizardStarter(fn: WizardStarter): void { wizardStarter = fn; }

// ─── Recommendation logic ───────────────────────────────────────────────────

const norm = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');

/** Drop pairs whose market is closed; fall back to open defaults, then to the
 *  raw defaults when the actives lookup is unavailable. */
function filterOpen(candidates: string[], openPairs: string[] | null, banned: Set<string> | null): string[] {
    const ban = banned ?? new Set<string>();
    const clean = (list: string[]) => list.filter(p => !ban.has(norm(p)));
    if (!openPairs) return clean(candidates).slice(0, SUGGESTED_ASSET_COUNT); // actives unknown — don't over-filter
    const openSet = new Set(openPairs.map(norm));
    const open = clean(candidates).filter(p => openSet.has(norm(p)));
    if (open.length > 0) return open.slice(0, SUGGESTED_ASSET_COUNT);
    const openDefaults = clean(DEFAULT_ASSETS).filter(p => openSet.has(norm(p)));
    if (openDefaults.length > 0) return openDefaults.slice(0, SUGGESTED_ASSET_COUNT);
    // Everything we know about is closed — surface whatever the platform has open.
    return clean(openPairs).slice(0, SUGGESTED_ASSET_COUNT);
}

/**
 * Tier thresholds are USD ($100 / $500 from PRODUCT_LIMITS), so they are applied
 * to the USD-normalized balance — an NGN account holding ₦150,000 is ~$100, and
 * comparing the raw 150000 against 500 would wrongly unlock Autopilot. The stake
 * and every displayed figure stay in the user's own currency.
 */
function buildRecommendation(liveUsd: number, liveNative: number, currency: string, telegramId: number, openPairs: string[] | null): SmartRecommendation {
    const privileged = telegramId === getAdminId() || PRIVILEGED_IDS.has(telegramId);
    const banned = privileged ? PRIV_BANNED_ASSETS : null;
    const history = readHistory(telegramId);
    // Rotate the asset suggestion order per scan window so the card is not
    // identical every time — most-used pairs still lead, but a different slice
    // of the pool gets surfaced each window.
    const rot = rotationSeed() % 3;
    const candidates = history.pairs.length > 0
        ? [...history.pairs.slice(rot), ...history.pairs.slice(0, rot), ...DEFAULT_ASSETS.filter(d => !history.pairs.includes(d))]
        : DEFAULT_ASSETS;
    const assets = filterOpen(candidates, openPairs, banned);
    let timeframeSec = history.timeframeSec ?? DEFAULT_TIMEFRAME_SEC;
    let timeframesSec: number[];
    if (privileged) {
        // Must include 2m (120) or 5m (300): rotate across the allowed pairs so
        // the SAME pair is not recommended every scan. The user's usual
        // timeframe still anchors the rotation (start at its pair, then cycle).
        const pairs = PRIV_TIMEFRAME_PAIRS;
        const startIdx = Math.max(0, pairs.findIndex(p => p.includes(timeframeSec)));
        const idx = (startIdx + rot) % pairs.length;
        timeframesSec = pairs[idx];
        timeframeSec = timeframesSec[0];
    } else {
        // Rotate the ladder start so the recommendation varies per window.
        const ladderIdx = TIMEFRAME_LADDER.includes(timeframeSec)
            ? (TIMEFRAME_LADDER.indexOf(timeframeSec) + rot) % TIMEFRAME_LADDER.length
            : rot % TIMEFRAME_LADDER.length;
        timeframesSec = [TIMEFRAME_LADDER[ladderIdx], TIMEFRAME_LADDER[(ladderIdx + 1) % TIMEFRAME_LADDER.length]];
    }
    // Three selectable stakes — percentage sets rotate per scan window so the
    // amounts are not identical every time.
    const pctSet = STAKE_PCT_SETS[rot % STAKE_PCT_SETS.length];
    let stakes = pctSet.map(pct => Math.max(1, Math.round(liveNative * pct)));
    if (privileged && liveUsd > 0) {
        // Cap in native currency equivalent of $700 USD.
        const capNative = Math.max(1, Math.round(PRIV_STAKE_CAP_USD * (liveNative / liveUsd)));
        stakes = stakes.map(s => Math.min(s, capNative)).map(s => Math.max(1, s));
        // All three hit the cap (large balance) — spread them under it so the
        // buttons stay distinct, rotating the spread each window.
        if (stakes[0] === stakes[stakes.length - 1]) {
            const spread = CAP_SPREAD_SETS[rot % CAP_SPREAD_SETS.length];
            stakes = spread.map(f => Math.max(1, Math.round(capNative * f)));
        }
    }

    // Grandfather gate (DIRECTIVE-UPGRADE-TOKEN-SYSTEM.md): pre-reset-date users
    // who already hold ai_trading/auto_trading keep their level regardless of
    // current balance — same rule as resolveAccess in access.ts. Without this the
    // smart-flow card would show the practice/fund card to existing users whose
    // live balance dropped below the new $100/$500 minimums.
    const user = getUser(telegramId);
    const resetDate = getConfig('upgrade_token_reset_date');
    const windowActive = !!resetDate && !isNaN(new Date(resetDate).getTime()) && new Date() < new Date(resetDate);
    const grandfatheredLevel = windowActive && (user?.access_level === 'ai_trading' || user?.access_level === 'auto_trading')
        ? user.access_level
        : null;

    if (liveUsd < AI_TRADING_MIN_USD && !grandfatheredLevel) {
        return { tier: 'practice', stake: null, stakes: [], assets, timeframeSec, timeframesSec, autopilotEligible: false, currency, scanLiveUsd: liveUsd };
    }
    return {
        tier: 'live',
        stake: stakes[1] ?? Math.max(1, Math.round(liveNative * STAKE_PCT)),
        stakes,
        assets,
        timeframeSec,
        timeframesSec,
        autopilotEligible: liveUsd >= AUTO_TRADING_MIN_USD || grandfatheredLevel === 'auto_trading',
        currency,
        scanLiveUsd: liveUsd,
    };
}

/** Cache-freshness rule: rescan when absent or older than 6h (the ≥50%-drop
 *  trigger is evaluated separately, in resolveSetup). */
function needsRescan(cache: CacheRow | null): boolean {
    if (!cache || !cache.last_scan_at || !cache.recommendations) return true;
    const age = Date.now() - new Date(cache.last_scan_at).getTime();
    return !isFinite(age) || age > CACHE_TTL_MS;
}

/** True when the balance has at least halved since the scan the cache was built
 *  from. Both figures are USD so currency never distorts the ratio. */
function balanceDropped(scanLiveUsd: number | null | undefined, currentUsd: number): boolean {
    if (scanLiveUsd == null || scanLiveUsd <= 0) return false;
    return currentUsd <= scanLiveUsd * BALANCE_DROP_RATIO;
}

// ─── Card rendering ─────────────────────────────────────────────────────────

/** Whole-unit money with thousands separators — the suggested stake is always a
 *  round number, so it renders as `$62` / `₦9,000` rather than `$62.00`.
 *  Balances keep their cents via fmtBalance. */
function fmtWholeMoney(amount: number, currency: string): string {
    const sym = (currency && CURRENCY_SYMBOLS[currency]) || currency || '$';
    return `${sym}${Math.round(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function moneyLine(live: number | null, demo: number | null, currency: string): string {
    const parts: string[] = [];
    if (live != null) parts.push(`Balance: ${fmtBalance({ amount: live, currency })}`);
    if (demo != null) parts.push(`Practice ${fmtBalance({ amount: demo, currency })}`);
    return parts.join(' · ');
}

function buildCard(rec: SmartRecommendation, live: number | null, demo: number | null, stale: boolean): { text: string; keyboard: any } {
    const lines: string[] = ['✦ Your setup for this session', ''];
    lines.push(moneyLine(live, demo, rec.currency), '');

    if (rec.tier === 'practice') {
        lines.push('Product: ⟡ Private Trader · Practice');
        lines.push(`You are below the live minimum (${fmtBalance({ amount: AI_TRADING_MIN_USD, currency: 'USD' })}).`);
        lines.push('Practice mode and No-charge Signals stay open to you.');
    } else {
        lines.push('Product: ⟡ Private Trader');
        const stakeList = (rec.stakes && rec.stakes.length > 0 ? rec.stakes : [rec.stake ?? 0]).map(s => fmtWholeMoney(s, rec.currency)).join(' · ');
        lines.push(`Suggested stake: ${stakeList}`);
    }
    // A malformed cached row must never crash the card (DIRECTIVE-STABILITY Part 5):
    // parseRec rejects rows missing `assets`, and this fallback covers any other
    // path that hands the renderer a recommendation without them.
    const assets = Array.isArray(rec.assets) && rec.assets.length > 0 ? rec.assets : ['EURUSD-OTC'];
    lines.push(`Suggested assets: ${assets.join(' · ')}`);
    const tfs = rec.timeframesSec && rec.timeframesSec.length > 0 ? rec.timeframesSec : [rec.timeframeSec];
    lines.push(`Timeframes: ${tfs.map(tf => tfLabel(tf)).join(' · ')}`);

    if (rec.autopilotEligible) {
        lines.push('', 'Also available: ✦ Autopilot — hands-free, it runs the session for you.');
    }
    if (stale) {
        lines.push('', '· Live read unavailable — showing your last saved scan.');
    }
    lines.push('', 'Recommendation only · Nothing is guaranteed.');

    const rows: any[][] = [];
    if (rec.tier === 'practice') {
        rows.push([{ text: '✦ Fund Account', url: DEPOSIT_URL }]);
        rows.push([{ text: "· Today's Signals", callback_data: 'ui:signals' }]);
        rows.push([{ text: '⟡ Choose manually', callback_data: 'ui:trade' }]);
    } else {
        rows.push([{ text: '✦ Start with this setup', callback_data: 'smart:start' }]);
        if (rec.autopilotEligible) rows.push([{ text: '✦ Autopilot', callback_data: 'ui:auto' }]);
        rows.push([{ text: '⟡ Choose manually', callback_data: 'ui:trade' }]);
    }
    return { text: lines.join('\n'), keyboard: { inline_keyboard: rows } };
}

// ─── Flow ───────────────────────────────────────────────────────────────────

function parseRec(raw: string | null | undefined): SmartRecommendation | null {
    if (!raw) return null;
    try {
        const rec = JSON.parse(raw) as SmartRecommendation;
        // Schema guard: caches written before the 2-timeframe/3-stake change lack
        // these fields, and older rows can also lack `assets` (the production
        // buildCard TypeError — DIRECTIVE-STABILITY Part 5). Treat any such row
        // as stale so the next open rescans and writes a current-schema row
        // instead of crashing the card renderer.
        if (!Array.isArray(rec.stakes) || !Array.isArray(rec.timeframesSec)) return null;
        if (!Array.isArray(rec.assets) || rec.assets.length === 0) return null;
        return rec;
    } catch { return null; }
}

/**
 * Resolve the recommendation, scanning only when the cache is missing, older
 * than 6h, or the balance has halved (§3).
 *
 * The drop check reads `users.funded_balance_usd` — the DB-cached USD balance
 * other paths already keep current (periodic sync, post-trade sync, check-in
 * scans). That keeps the "reuse the cache, no SDK call" promise intact while
 * still catching a collapsed balance, which is impossible if the cached path
 * never looks at a balance at all.
 *
 * `stale` marks a render that wanted fresh data but fell back to the snapshot.
 */
async function resolveSetup(telegramId: number): Promise<{ rec: SmartRecommendation; live: number | null; demo: number | null; stale: boolean } | null> {
    const cache = readCache(telegramId);
    const cachedRec = parseRec(cache?.recommendations);
    const currentUsd = getUser(telegramId)?.funded_balance_usd ?? 0;

    if (!needsRescan(cache) && cachedRec && !balanceDropped(cachedRec.scanLiveUsd, currentUsd)) {
        return { rec: cachedRec, live: cache!.balance_live, demo: cache!.balance_demo, stale: false };
    }

    const scan = scanner ? await scanner(telegramId).catch(err => {
        logger.warn('smart-flow', `scan failed for ${telegramId}: ${err instanceof Error ? err.message : err}`);
        return null;
    }) : null;

    if (!scan || (!scan.live && !scan.demo)) {
        // SDK unavailable — fall back to the cached snapshot with a note (§3).
        if (cachedRec) return { rec: cachedRec, live: cache!.balance_live, demo: cache!.balance_demo, stale: true };
        return null;
    }

    const currency = scan.live?.currency ?? scan.demo?.currency ?? getUser(telegramId)?.currency ?? 'USD';
    const liveNative = scan.live?.amount ?? 0;
    const demoNative = scan.demo?.amount ?? 0;
    // The scanner refreshes funded_balance_usd as part of the live read, so this
    // is the USD value matching the balance we just fetched.
    const liveUsd = getUser(telegramId)?.funded_balance_usd ?? 0;
    const rec = buildRecommendation(liveUsd, liveNative, currency, telegramId, scan.openPairs);
    writeCache(telegramId, liveNative, demoNative, rec);
    return { rec, live: liveNative, demo: demoNative, stale: false };
}

async function openSmartFlow(ctx: any): Promise<void> {
    const uid = ctx.from?.id;
    if (uid == null) return;
    await ctx.answerCbQuery().catch(() => { });

    if (maintenanceBlocks(uid)) {
        await ctx.reply("Can't use now. Update in the way").catch(() => { });
        return;
    }

    const user = getUser(uid);
    const hasValidSsid = user?.ssid && user.ssid_valid !== 0;
    if (!hasValidSsid) {
        const isExpired = !!user?.ssid;
        await ctx.reply(
            isExpired
                ? '✦ Your IQ Option session expired. Reconnect to continue trading'
                : '⚠️ You need to connect your IQ Option account first.\nTap Connect below to get started',
            { reply_markup: { inline_keyboard: [[{ text: isExpired ? '✦ Reconnect' : '✦ Connect Account', callback_data: 'ui:connect' }]] } },
        ).catch(() => { });
        return;
    }

    const setup = await resolveSetup(uid);
    if (!setup) {
        // No live read and nothing cached — never a dead end; offer the wizard.
        await ctx.reply('· Could not read your balance right now.', {
            reply_markup: { inline_keyboard: [[{ text: '⟡ Choose manually', callback_data: 'ui:trade' }]] },
        }).catch(() => { });
        return;
    }

    const { text, keyboard } = buildCard(setup.rec, setup.live, setup.demo, setup.stale);
    await cleanupFlowMsgs(ctx, uid);
    // Card carries the L4 wizard-entry graphic, caption + buttons in one message.
    if (photoSender) {
        const m = await photoSender(ctx, 'L4.png', text, keyboard).catch(() => undefined);
        trackFlowMsg(uid, m);
        return;
    }
    await ctx.reply(text, { reply_markup: keyboard }).catch(() => { });
}

/** Start with this setup — lets the user pick one of two recommended timeframes
 *  and one of three recommended stakes (or set their own) before handing off to
 *  the existing wizard. Never places a trade. */
async function startWithSetup(ctx: any): Promise<void> {
    const uid = ctx.from?.id;
    if (uid == null) return;
    await ctx.answerCbQuery().catch(() => { });

    if (maintenanceBlocks(uid)) {
        await ctx.reply("Can't use now. Update in the way").catch(() => { });
        return;
    }

    const rec = parseRec(readCache(uid)?.recommendations);
    if (!rec || rec.tier !== 'live' || !wizardStarter) {
        await ctx.reply('· That setup is no longer current.', {
            reply_markup: { inline_keyboard: [[{ text: '⟡ Choose manually', callback_data: 'ui:trade' }]] },
        }).catch(() => { });
        return;
    }
    // Step 1 of 2 — timeframe selection (two recommendations).
    pendingTfChoice.set(uid, rec);
    const tfButtons = rec.timeframesSec.map(tf => [{ text: `⟡ ${tfLabel(tf)}`, callback_data: `smart:tf:${tf}` }]);
    await cleanupFlowMsgs(ctx, uid);
    // Timeframe pick carries the L5 TIMEFRAME graphic, caption + buttons in one message.
    if (photoSender) {
        const m = await photoSender(ctx, 'L5.png', '✦ Choose your timeframe', { inline_keyboard: tfButtons }).catch(() => undefined);
        trackFlowMsg(uid, m);
        return;
    }
    await ctx.reply('✦ Choose your timeframe', { reply_markup: { inline_keyboard: tfButtons } }).catch(() => { });
}

/** Step 2 of 2 — stake selection (three recommendations + set my own). */
async function chooseStake(ctx: any, uid: number, rec: SmartRecommendation, tfSec: number): Promise<void> {
    pendingTfChoice.delete(uid);
    // NOTE: pendingCustomStake must NOT be cleared here — the `smart:tf` handler
    // saves the selection immediately before calling this, and `smart:stake`
    // reads it back on the next tap. Deleting it here breaks every stake button.
    const stakeButtons = rec.stakes.map(s => [{ text: `✦ ${fmtWholeMoney(s, rec.currency)}`, callback_data: `smart:stake:${s}` }]);
    stakeButtons.push([{ text: '⟡ Set my own', callback_data: 'smart:stake:custom' }]);
    await cleanupFlowMsgs(ctx, uid);
    // Stake pick stays a text prompt (no dedicated graphic) — previous section is removed.
    const m = await ctx.reply(`✦ Choose your stake per trade\n· Timeframe: ${tfLabel(tfSec)}`, { reply_markup: { inline_keyboard: stakeButtons } }).catch(() => undefined);
    trackFlowMsg(uid, m);
}

/** Hand off to the wizard with the chosen stake + timeframe. */
async function applyStake(ctx: any, uid: number, rec: SmartRecommendation, tfSec: number, stake: number): Promise<void> {
    pendingCustomStake.delete(uid);
    if (!wizardStarter) return;
    await cleanupFlowMsgs(ctx, uid);
    await wizardStarter(ctx, { ...rec, stake, timeframeSec: tfSec });
}

// ─── Section-clean chat flow ────────────────────────────────────────────────
// Each step deletes the previous step's message(s) before showing the next, so
// the setup sequence never leaves a stack of stale prompts in the chat. The
// card, the timeframe pick, the stake pick and the "type your stake" prompt all
// get cleaned as the user advances; the wizard hand-off message is handled by
// the wizard itself (it tracks lastImageMsgId).
const flowMsgs = new Map<number, { chatId: number; msgId: number }[]>();

function trackFlowMsg(uid: number, m: any): void {
    if (!m?.message_id) return;
    const chatId = m.chat?.id ?? m.chat_id;
    if (!chatId) return;
    const list = flowMsgs.get(uid) ?? [];
    list.push({ chatId, msgId: m.message_id });
    flowMsgs.set(uid, list);
}

async function cleanupFlowMsgs(ctx: any, uid: number): Promise<void> {
    const list = flowMsgs.get(uid) ?? [];
    flowMsgs.delete(uid);
    for (const { chatId, msgId } of list) {
        try { await ctx.telegram.deleteMessage(chatId, msgId); } catch { }
    }
}

/** bot.ts calls this on wizard hand-off so the wizard's own card lifecycle
 *  (lastImageMsgId) can also clean the smart-flow prompts if any remain. */
export function getFlowMsgs(uid: number): { chatId: number; msgId: number }[] {
    const list = flowMsgs.get(uid) ?? [];
    flowMsgs.delete(uid);
    return list;
}

/** Photo sender injected from bot.ts (uses the asset file_id cache). Sends a
 *  photo with an optional caption + inline keyboard; returns the message. */
let photoSender: ((ctx: any, assetName: string, caption?: string, keyboard?: any) => Promise<any>) | null = null;
export function setSmartFlowPhotoSender(fn: (ctx: any, assetName: string, caption?: string, keyboard?: any) => Promise<any>): void {
    photoSender = fn;
}

/** Single router for every `smart:*` callback — registered once from bot.ts. */
export async function handleSmartFlowCallback(ctx: any): Promise<void> {
    const data: string = ctx.callbackQuery?.data ?? '';
    const parts = data.split(':');
    const action = parts[1];
    const uid = ctx.from?.id;
    try {
        switch (action) {
            case 'open': return await openSmartFlow(ctx);
            case 'start': return await startWithSetup(ctx);
            case 'tf': {
                if (uid == null) return;
                await ctx.answerCbQuery().catch(() => { });
                const tfSec = parseInt(parts[2], 10);
                const rec = pendingTfChoice.get(uid) ?? parseRec(readCache(uid)?.recommendations);
                if (!rec || !isFinite(tfSec)) { await ctx.answerCbQuery('Session expired — start over.').catch(() => { }); return; }
                pendingCustomStake.set(uid, { rec, timeframeSec: tfSec });
                return await chooseStake(ctx, uid, rec, tfSec);
            }
            case 'stake': {
                if (uid == null) return;
                await ctx.answerCbQuery().catch(() => { });
                const sel = pendingCustomStake.get(uid);
                if (!sel) { await ctx.answerCbQuery('Session expired — start over.').catch(() => { }); return; }
                const raw = parts[2];
                if (raw === 'custom') {
                    pendingCustomStake.set(uid, { rec: sel.rec, timeframeSec: sel.timeframeSec, awaitingText: true });
                    await cleanupFlowMsgs(ctx, uid);
                    const pm = await ctx.reply(`✦ Type your stake (${CURRENCY_SYMBOLS[sel.rec.currency] ?? '$'} numbers only):`).catch(() => undefined);
                    trackFlowMsg(uid, pm);
                    return;
                }
                const stake = parseFloat(raw);
                if (!isFinite(stake) || stake <= 0) { await ctx.answerCbQuery('Invalid amount — try again.').catch(() => { }); return; }
                return await applyStake(ctx, uid, sel.rec, sel.timeframeSec, stake);
            }
            default:
                await ctx.answerCbQuery().catch(() => { });
        }
    } catch (err) {
        logger.error('smart-flow', `callback failed for action=${action}`, err);
        await ctx.answerCbQuery('Something went wrong. Try again.').catch(() => { });
    }
}

/** Text interceptor for the "Set my own" stake — wired in bot.ts's text handler
 *  right after the check-in interceptor. Returns true when it consumed the text. */
export async function tryHandleSmartFlowText(ctx: any): Promise<boolean> {
    const uid = ctx.from?.id;
    if (uid == null) return false;
    const sel = pendingCustomStake.get(uid);
    if (!sel || !sel.awaitingText) return false;
    const text = (ctx.message?.text ?? '').trim();
    const amount = parseFloat(text);
    if (!isFinite(amount) || amount <= 0) {
        await ctx.reply('Please enter a valid positive number (e.g. 75).').catch(() => { });
        return true;
    }
    await applyStake(ctx, uid, sel.rec, sel.timeframeSec, amount);
    return true;
}
