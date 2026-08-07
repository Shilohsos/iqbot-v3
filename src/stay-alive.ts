// @ts-nocheck
/**
 * Stay-Alive subsystem (Upgrade Phases A–D).
 * - Restart taxonomy
 * - Safe exit (never mid-pinned gale)
 * - Metrics snapshot for external monitor
 */
import fs from 'fs';
import path from 'path';

const METRICS_PATH = '/root/iqbot-v3/upgrades/metrics/stay-alive.json';
const REASON_LOG = '/root/iqbot-v3/upgrades/metrics/restart-reasons.log';

/** @type {{ reason: string, at: string } | null} */
let lastExitIntent = null;
let metricsTimer = null;

/** @type {() => { poolSize: number, pinned: number, memoryMB: number }} */
let statsProvider = () => ({
    poolSize: 0,
    pinned: 0,
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
});

export function setStatsProvider(fn) {
    statsProvider = fn;
}

export function ensureMetricsDir() {
    const dir = path.dirname(METRICS_PATH);
    fs.mkdirSync(dir, { recursive: true });
}

export function logRestartReason(reason, extra = '') {
    ensureMetricsDir();
    const line = `${new Date().toISOString()}\t${reason}\t${extra}\trss_mb=${Math.round(process.memoryUsage().rss / 1048576)}\n`;
    try {
        fs.appendFileSync(REASON_LOG, line);
    } catch { /* */ }
    console.error(`[stay-alive] EXIT_INTENT reason=${reason} ${extra}`);
}

export function writeMetrics(extra = {}) {
    ensureMetricsDir();
    const mem = process.memoryUsage();
    const base = statsProvider();
    const payload = {
        ts: new Date().toISOString(),
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        rssMB: Math.round(mem.rss / 1048576),
        heapUsedMB: Math.round(mem.heapUsed / 1048576),
        heapTotalMB: Math.round(mem.heapTotal / 1048576),
        externalMB: Math.round((mem.external || 0) / 1048576),
        poolSize: base.poolSize,
        pinned: base.pinned,
        lastExitIntent,
        ...extra,
    };
    try {
        fs.writeFileSync(METRICS_PATH, JSON.stringify(payload, null, 2));
    } catch { /* */ }
    return payload;
}

export function startMetricsLoop(intervalMs = 30_000) {
    if (metricsTimer) return;
    writeMetrics({ event: 'start' });
    metricsTimer = setInterval(() => {
        const m = writeMetrics();
        // Soft warning only — never exit on memory here (PM2 seatbelt is last resort)
        if (m.rssMB >= 750) {
            console.warn(`[stay-alive] HIGH_RSS rssMB=${m.rssMB} pinned=${m.pinned} pool=${m.poolSize}`);
        }
    }, intervalMs);
    if (typeof metricsTimer.unref === 'function') metricsTimer.unref();
}

/**
 * Exit only when safe. If gale pins > 0, wait up to maxWaitMs then force.
 */
export async function safeExit(reason, { maxWaitMs = 120_000, getPinned = () => 0 } = {}) {
    lastExitIntent = { reason, at: new Date().toISOString() };
    logRestartReason(reason, `pinned=${getPinned()}`);
    writeMetrics({ event: 'exit_intent', reason });

    const start = Date.now();
    while (getPinned() > 0 && Date.now() - start < maxWaitMs) {
        console.warn(`[stay-alive] defer exit (${reason}) — ${getPinned()} pinned session(s), waiting…`);
        await new Promise(r => setTimeout(r, 3000));
    }
    if (getPinned() > 0) {
        logRestartReason(reason, `FORCE_WITH_PINS pinned=${getPinned()}`);
    }
    // small delay for log flush
    await new Promise(r => setTimeout(r, 500));
    process.exit(1);
}

export function bootBanner() {
    const rss = Math.round(process.memoryUsage().rss / 1048576);
    console.log(`[stay-alive] boot pid=${process.pid} rssMB=${rss} node=${process.version}`);
    logRestartReason('boot', `pid=${process.pid}`);
}
