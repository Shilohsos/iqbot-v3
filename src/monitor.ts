import 'dotenv/config';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// ─── Config ───────────────────────────────────────────────────────────────────

const BOT_TOKEN   = process.env.BOT_TOKEN;
const ADMIN_ID    = parseInt(process.env.ADMIN_USER_ID ?? '1615652240', 10);
const DB_PATH     = process.env.DB_PATH     ?? path.resolve('iqbot-v3.db');
const LOG_DIR     = process.env.LOG_DIR     ?? '/root/.pm2/logs';

const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL    ?? 'deepseek-chat';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

// ─── Alert Types ──────────────────────────────────────────────────────────────

type AlertLevel = 'critical' | 'warning' | 'info';

interface Alert {
    level: AlertLevel;
    component: string;
    message: string;
    timestamp: Date;
}

// 5-minute cooldown between identical alerts
const recentAlerts  = new Map<string, number>();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

// ─── Health Checks ────────────────────────────────────────────────────────────

function checkPM2Status(): string | null {
    try {
        const output    = execSync('pm2 jlist', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const processes = JSON.parse(output) as Array<{
            name: string;
            pm2_env: { status: string; restart_time: number; pm_uptime: number };
        }>;

        const bot = processes.find(p => p.name === 'iqbot-v3-bot');
        if (!bot) return 'Bot process not found in PM2';
        if (bot.pm2_env.status !== 'online') return `Bot status: ${bot.pm2_env.status}`;

        const restarts = bot.pm2_env.restart_time;
        if (restarts > 10) return `Bot restart count high: ${restarts}`;

        const uptimeMs = Date.now() - bot.pm2_env.pm_uptime;
        if (uptimeMs < 60_000) return `Bot uptime < 1 min (recent restart, ${restarts} restarts total)`;

        return null;
    } catch (err) {
        return `PM2 check failed: ${err instanceof Error ? err.message : err}`;
    }
}

function checkDatabase(): string | null {
    try {
        const db  = new Database(DB_PATH, { readonly: true, fileMustExist: true });
        const row = db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
        db.close();
        if (row.cnt < 0) return 'Database returned negative count';
        return null;
    } catch (err) {
        return `Database unreachable: ${err instanceof Error ? err.message : err}`;
    }
}

function checkTrades(seconds = 300): string | null {
    try {
        const db  = new Database(DB_PATH, { readonly: true });
        const row = db.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'ERROR' OR status = 'TIMEOUT' THEN 1 ELSE 0 END) AS errors
            FROM trades
            WHERE created_at >= datetime('now', ? || ' seconds')
        `).get(`-${seconds}`) as { total: number; errors: number };
        db.close();

        if (!row || (row.total === 0 && row.errors === 0)) return null;

        if (row.errors > 0) {
            const rate = (row.errors / Math.max(row.total, 1)) * 100;
            if (rate > 50 && row.total >= 3)
                return `Trade error rate ${rate.toFixed(0)}% (${row.errors}/${row.total} in ${seconds}s)`;
            if (row.errors >= 3)
                return `${row.errors} trade errors in last ${seconds}s`;
        }
        return null;
    } catch (err) {
        return `Trade check failed: ${err instanceof Error ? err.message : err}`;
    }
}

function checkLogs(): string | null {
    try {
        const candidates = [
            path.join(LOG_DIR, 'iqbot-v3-bot-out.log'),
            path.join(LOG_DIR, 'bot-out.log'),
        ];
        const logFile = candidates.find(f => fs.existsSync(f));
        if (!logFile) return null;

        const content     = fs.readFileSync(logFile, 'utf8');
        const recentLines = content.split('\n').filter(Boolean).slice(-200);

        const errors: string[] = [];
        for (const line of recentLines) {
            if (/\[error\]|Error:|unhandled|fatal|FATAL/i.test(line)) {
                errors.push(line.slice(0, 200));
            }
        }
        if (errors.length === 0) return null;
        return `${errors.length} log error(s):\n${errors.slice(0, 5).join('\n')}`;
    } catch {
        return null;
    }
}

function checkDisk(): string | null {
    try {
        const output = execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const pct    = parseInt(output);
        if (pct > 90) return `Disk usage: ${pct}% (CRITICAL)`;
        if (pct > 80) return `Disk usage: ${pct}%`;
        return null;
    } catch {
        return null;
    }
}

function checkMemory(): string | null {
    try {
        const output = execSync("free -m | awk 'NR==2{printf \"%.0f\", $3*100/$2}'", { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const pct    = parseInt(output);
        if (pct > 95) return `Memory usage: ${pct}% (CRITICAL)`;
        if (pct > 85) return `Memory usage: ${pct}%`;
        return null;
    } catch {
        return null;
    }
}

// ─── LLM Analysis ────────────────────────────────────────────────────────────

async function analyzeWithLLM(errors: string[]): Promise<string> {
    if (!DEEPSEEK_API_KEY || errors.length === 0) return errors.join('\n');

    const systemPrompt =
        `You are a system monitor for a trading bot. Analyze these recent errors and provide:
1. Root cause (1 sentence)
2. Severity: CRITICAL / WARNING / INFO
3. Action needed (1 sentence)
4. Impact on users (1 sentence)

Be brutally concise. Under 150 words total.`;

    const userPrompt = `Recent errors from 10x IQ Option trading bot:\n\n${errors.join('\n')}\n\nAnalysis:`;

    try {
        const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userPrompt },
                ],
                max_tokens: 250,
                temperature: 0.3,
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return errors.join('\n');
        const data = await res.json() as { choices: Array<{ message: { content: string } }> };
        return data.choices[0].message.content.trim();
    } catch {
        return errors.join('\n');
    }
}

// ─── Alert Sender ─────────────────────────────────────────────────────────────

async function sendAlert(alert: Alert): Promise<void> {
    const key      = `${alert.component}:${alert.level}:${alert.message.slice(0, 50)}`;
    const lastSent = recentAlerts.get(key);
    if (lastSent && Date.now() - lastSent < ALERT_COOLDOWN_MS) return;
    recentAlerts.set(key, Date.now());

    const emoji = alert.level === 'critical' ? '🚨' : alert.level === 'warning' ? '⚠️' : 'ℹ️';
    const text  = `${emoji} *${alert.level.toUpperCase()}* — ${alert.component}\n\n${alert.message}`;

    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: ADMIN_ID, text, parse_mode: 'Markdown' }),
        });
        console.log(`[monitor] alert sent: ${alert.component} [${alert.level}]`);
    } catch (err) {
        console.error('[monitor] failed to send alert:', err instanceof Error ? err.message : err);
    }
}

// ─── Main Loops ───────────────────────────────────────────────────────────────

const logErrorBuffer: string[] = [];

async function runHealthCheck(): Promise<void> {
    const checks: Array<{ fn: () => string | null; component: string; level: AlertLevel }> = [
        { fn: checkPM2Status, component: 'PM2/Bot',  level: 'critical' },
        { fn: checkDatabase,  component: 'Database', level: 'critical' },
        { fn: checkTrades,    component: 'Trades',   level: 'warning'  },
        { fn: checkDisk,      component: 'Disk',     level: 'warning'  },
        { fn: checkMemory,    component: 'Memory',   level: 'warning'  },
    ];

    for (const { fn, component, level } of checks) {
        const result = fn();
        if (!result) continue;
        const effectiveLevel: AlertLevel =
            result.includes('CRITICAL') ? 'critical' : level;
        await sendAlert({ level: effectiveLevel, component, message: result, timestamp: new Date() });
    }
}

async function runLogAnalysis(): Promise<void> {
    const logErrors = checkLogs();
    if (!logErrors) return;

    logErrorBuffer.push(logErrors);
    if (logErrorBuffer.length > 3) logErrorBuffer.shift();

    const allErrors = logErrorBuffer.join('\n\n');
    if (allErrors.length > 100) {
        const analysis = await analyzeWithLLM([allErrors]);
        await sendAlert({
            level: 'warning',
            component: 'Log Analysis',
            message: analysis,
            timestamp: new Date(),
        });
        logErrorBuffer.length = 0;
    }
}

// ─── Daily Report ─────────────────────────────────────────────────────────────

function getDailyStats(): string {
    const db = new Database(DB_PATH, { readonly: true });

    const users = db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS approved,
               SUM(CASE WHEN approval_status = 'pending'  THEN 1 ELSE 0 END) AS pending
        FROM users
    `).get() as { total: number; approved: number; pending: number };

    const trades = db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status = 'WIN'  THEN 1 ELSE 0 END) AS wins,
               SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) AS losses,
               COALESCE(SUM(pnl), 0) AS totalPnl
        FROM trades WHERE date(created_at) = date('now')
    `).get() as { total: number; wins: number; losses: number; totalPnl: number };

    db.close();

    const pnlSign = trades.totalPnl >= 0 ? '+' : '';
    const winRate = trades.total > 0 ? ((trades.wins / trades.total) * 100).toFixed(0) : '0';

    return [
        `📊 *10x Bot Daily Report*`,
        ``,
        `👥 *Users:* ${users.total} total | ✅ ${users.approved} approved | ⏳ ${users.pending} pending`,
        ``,
        `📈 *Today's Trades:* ${trades.total} total`,
        `• Wins: ${trades.wins} (${winRate}%)`,
        `• Losses: ${trades.losses}`,
        `• PnL: ${pnlSign}$${trades.totalPnl.toFixed(2)}`,
        ``,
        `🟢 System: Online`,
    ].join('\n');
}

async function sendDailyReport(): Promise<void> {
    const text = getDailyStats();
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: ADMIN_ID, text, parse_mode: 'Markdown' }),
        });
        console.log('[monitor] daily report sent');
    } catch (err) {
        console.error('[monitor] daily report failed:', err instanceof Error ? err.message : err);
    }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

console.log('[monitor] 🟢 10x System Monitor started');
console.log(`[monitor] Admin ID: ${ADMIN_ID} | DB: ${DB_PATH}`);

// Run immediately on start
runHealthCheck().catch(err => console.error('[monitor] startup check failed:', err));

// 30-second health checks
setInterval(() => { runHealthCheck().catch(err => console.error('[monitor] health check error:', err)); }, 30_000);

// 5-minute log analysis
setInterval(() => { runLogAnalysis().catch(err => console.error('[monitor] log analysis error:', err)); }, 5 * 60_000);

// Daily report at 9:00 AM (polled every minute)
let lastDailyDate = '';
setInterval(() => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    if (now.getHours() === 9 && now.getMinutes() === 0 && today !== lastDailyDate) {
        lastDailyDate = today;
        sendDailyReport().catch(err => console.error('[monitor] daily report error:', err));
    }
}, 60_000);
