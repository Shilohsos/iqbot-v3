# DIRECTIVE: V4 LLM System Monitor — Real-Time Health Watchdog

## Context

A separate monitoring service that watches the entire system — bot, database, SDK connections, VPS resources. When something breaks, it alerts Master via Telegram immediately. Uses Deepseek V4 Flash to analyze error patterns and provide actionable summaries (not just raw logs).

This runs as a **standalone PM2 process** — separate from the bot, so it can detect when the bot itself is down.

## 1. Architecture

```
Monitor Process (PM2: iqbot-v3-monitor)
├── Every 30s: Health checks
│   ├── PM2 status (is bot running?)
│   ├── Database connectivity
│   ├── SDK WebSocket health
│   ├── Disk space / Memory
│   └── Trade success rate (last 5 min)
├── Every 5 min: Log analysis
│   ├── Scan bot logs for errors
│   ├── Count error types
│   └── LLM summarizes patterns
├── On critical: Telegram alert
│   └── Immediate: "⚠️ Bot is DOWN"
├── On warning: Batched alert every 15 min
│   └── "3 trade timeouts in 15 min"
└── Daily: Full health report at 9 AM
```

## 2. New File: `src/monitor.ts`

```typescript
import 'dotenv/config';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// ─── Config ──────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_USER_ID || '1615652240');
const DB_PATH = process.env.DB_PATH || path.resolve('iqbot-v3.db');
const LOG_DIR = process.env.LOG_DIR || '/root/iqbot-v3/logs';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

// ─── Alert Types ────────────────────────────────────────────────────
type AlertLevel = 'critical' | 'warning' | 'info';

interface Alert {
  level: AlertLevel;
  component: string;
  message: string;
  timestamp: Date;
  count?: number;
}

// Rate-limited alert queue (prevents spam)
const recentAlerts: Map<string, number> = new Map();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min between same alert

// ─── Health Checks ─────────────────────────────────────────────────

async function checkPM2Status(): Promise<string | null> {
  try {
    const output = execSync('pm2 jlist', { encoding: 'utf8' });
    const processes = JSON.parse(output) as Array<{ name: string; pm2_env: { status: string; restarts: number; uptime: number } }>;

    const bot = processes.find(p => p.name === 'iqbot-v3-bot');
    if (!bot) return 'Bot process not found in PM2';
    if (bot.pm2_env.status !== 'online') return `Bot status: ${bot.pm2_env.status}`;

    // Check restart count spiking (crash loop)
    const restarts = bot.pm2_env.restarts;
    if (restarts > 10) return `Bot restart count high: ${restarts}`;

    // Check uptime too low (just restarted)
    if (bot.pm2_env.uptime < 60000) return `Bot uptime < 1 min (recent restart)`;

    return null; // OK
  } catch (err) {
    return `PM2 check failed: ${err}`;
  }
}

function checkDatabase(): string | null {
  try {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT COUNT(*) AS cnt FROM users").get() as { cnt: number };
    db.close();
    if (row.cnt < 0) return 'Database returned negative count';
    return null; // OK
  } catch (err) {
    return `Database unreachable: ${err}`;
  }
}

function checkTrades(seconds: number = 300): string | null {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'ERROR' OR status = 'TIMEOUT' THEN 1 ELSE 0 END) AS errors
      FROM trades
      WHERE created_at >= datetime('now', ? || ' seconds')
    `).get(`-${seconds}`) as { total: number; errors: number };

    db.close();

    if (row.total === 0 && row.errors === 0) return null; // no trades = nothing to alert

    if (row.errors > 0) {
      const rate = (row.errors / Math.max(row.total, 1)) * 100;
      if (rate > 50 && row.total >= 3) return `Trade error rate ${rate.toFixed(0)}% (${row.errors}/${row.total} in ${seconds}s)`;
      if (row.errors >= 3) return `${row.errors} trade errors in ${seconds}s`;
    }
    return null;
  } catch (err) {
    return `Trade check failed: ${err}`;
  }
}

function checkLogs(minutes: number = 5): string | null {
  try {
    const logFile = path.join(LOG_DIR, 'bot-out.log');
    if (!fs.existsSync(logFile)) return null;

    const now = Date.now();
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    // Only analyze recent lines (last 5 min worth)
    const recentLines = lines.slice(-200);

    const errors: string[] = [];
    for (const line of recentLines) {
      if (line.includes('[error]') || line.includes('Error') || line.includes('unhandled') || line.includes('fatal')) {
        errors.push(line.slice(0, 200));
      }
    }

    if (errors.length === 0) return null;
    return `Log errors (${minutes}m):\n${errors.join('\n')}`;
  } catch {
    return null;
  }
}

function checkDisk(): string | null {
  try {
    const output = execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: 'utf8' }).trim();
    const pct = parseInt(output);
    if (pct > 90) return `Disk usage: ${pct}% (CRITICAL)`;
    if (pct > 80) return `Disk usage: ${pct}%`;
    return null;
  } catch {
    return null;
  }
}

function checkMemory(): string | null {
  try {
    const output = execSync("free -m | awk 'NR==2{printf \"%.0f\", $3*100/$2}'", { encoding: 'utf8' }).trim();
    const pct = parseInt(output);
    if (pct > 95) return `Memory usage: ${pct}% (CRITICAL)`;
    if (pct > 85) return `Memory usage: ${pct}%`;
    return null;
  } catch {
    return null;
  }
}

// ─── LLM Analysis ──────────────────────────────────────────────────

async function analyzeWithLLM(errors: string[]): Promise<string> {
  if (!DEEPSEEK_API_KEY) return errors.join('\n');

  const systemPrompt = `You are a system monitor for a trading bot. Analyze these recent errors and provide:
1. Root cause (1 sentence)
2. Severity: CRITICAL / WARNING / INFO
3. Action needed (1 sentence)
4. Impact on users (1 sentence)

Be brutally concise. Under 150 words total.`;

  const userPrompt = `Recent errors from 10x IQ Option trading bot:\n\n${errors.join('\n')}\n\nAnalysis:`;

  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 250,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return errors.join('\n');
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch {
    return errors.join('\n');
  }
}

// ─── Alert Sender ──────────────────────────────────────────────────

async function sendAlert(alert: Alert): Promise<void> {
  // Deduplicate
  const key = `${alert.component}:${alert.level}:${alert.message.slice(0, 50)}`;
  const lastSent = recentAlerts.get(key);
  if (lastSent && Date.now() - lastSent < ALERT_COOLDOWN_MS) return; // skip duplicate within cooldown
  recentAlerts.set(key, Date.now());

  const emoji = alert.level === 'critical' ? '🚨' : alert.level === 'warning' ? '⚠️' : 'ℹ️';
  const level = alert.level.toUpperCase();

  const text = [
    `${emoji} *${level}* — ${alert.component}`,
    '',
    alert.message,
  ].join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
    console.log(`[monitor] alert sent: ${alert.component} [${alert.level}]`);
  } catch (err) {
    console.error('[monitor] failed to send alert:', err);
  }
}

// ─── Main Monitor Loop ────────────────────────────────────────────

const errorCounters: Map<string, number> = new Map();
const logErrorBuffer: string[] = [];

async function runHealthCheck(): Promise<void> {
  const alerts: Alert[] = [];

  // 1. PM2 check
  const pm2Status = checkPM2Status();
  if (pm2Status) {
    alerts.push({ level: 'critical', component: 'PM2/Bot', message: pm2Status, timestamp: new Date() });
  }

  // 2. DB check
  const dbStatus = checkDatabase();
  if (dbStatus) {
    alerts.push({ level: 'critical', component: 'Database', message: dbStatus, timestamp: new Date() });
  }

  // 3. Trade errors
  const tradeStatus = checkTrades();
  if (tradeStatus) {
    alerts.push({ level: 'warning', component: 'Trades', message: tradeStatus, timestamp: new Date() });
  }

  // 4. Disk
  const diskStatus = checkDisk();
  if (diskStatus) {
    const level = diskStatus.includes('CRITICAL') ? 'critical' : 'warning';
    alerts.push({ level, component: 'Disk', message: diskStatus, timestamp: new Date() });
  }

  // 5. Memory
  const memStatus = checkMemory();
  if (memStatus) {
    const level = memStatus.includes('CRITICAL') ? 'critical' : 'warning';
    alerts.push({ level, component: 'Memory', message: memStatus, timestamp: new Date() });
  }

  // Send alerts
  for (const alert of alerts) {
    await sendAlert(alert);
  }

  // Log summary
  if (alerts.length > 0) {
    console.log(`[monitor] ${alerts.length} alerts found`);
  }
}

async function runLogAnalysis(): Promise<void> {
  const logErrors = checkLogs(5);
  if (!logErrors) return;

  logErrorBuffer.push(logErrors);
  if (logErrorBuffer.length > 3) logErrorBuffer.shift();

  // Analyze with LLM if errors accumulate
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

// ─── Daily Report (at 9 AM) ──────────────────────────────────────

function getDailyStats(): string {
  const db = new Database(DB_PATH, { readonly: true });

  const users = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM users
  `).get() as { total: number; approved: number; pending: number };

  const trades = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) AS losses,
           COALESCE(SUM(pnl), 0) AS totalPnl
    FROM trades WHERE date(created_at) = date('now')
  `).get() as { total: number; wins: number; losses: number; totalPnl: number };

  const pnlSign = trades.totalPnl >= 0 ? '+' : '';
  const winRate = trades.total > 0 ? ((trades.wins / trades.total) * 100).toFixed(0) : '0';

  db.close();

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
  const morningReport = getDailyStats();
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_ID,
        text: morningReport,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    console.error('[monitor] daily report failed:', err);
  }
}

// ─── Startup ──────────────────────────────────────────────────────

console.log('🟢 10x System Monitor started');
console.log(`Admin ID: ${ADMIN_ID}`);

// 30-second health checks
setInterval(runHealthCheck, 30_000);

// 5-minute log analysis
setInterval(runLogAnalysis, 5 * 60_000);

// Daily report at 9:00 AM (check every minute)
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 9 && now.getMinutes() === 0) {
    sendDailyReport();
  }
}, 60_000);

// Initial check on startup
runHealthCheck();
```

## 3. PM2 Configuration

Add to PM2:

```bash
pm2 start src/monitor.ts --name iqbot-v3-monitor --interpreter tsx
```

Or update `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    { name: 'iqbot-v3-bot', script: 'src/index.ts', interpreter: 'tsx', env: { NODE_ENV: 'production' } },
    { name: 'iqbot-v3-monitor', script: 'src/monitor.ts', interpreter: 'tsx', env: { NODE_ENV: 'production' } },
  ],
};
```

## 4. .env Requirements

Already present:
```
DEEPSEEK_API_KEY=sk-34e52c08be514f1ca3b549fb235622f0
BOT_TOKEN=<already set>
ADMIN_USER_ID=1615652240
DB_PATH=/root/iqbot-v3/iqbot-v3.db
```

Need to add:
```
LOG_DIR=/root/.pm2/logs
```

Or wherever PM2 logs are stored.

## 5. Alert Levels Defined

| Level | Triggers | Delivery |
|-------|----------|----------|
| **Critical** | Bot down, DB unreachable, disk 90%+, memory 95%+ | Immediate Telegram |
| **Warning** | Trade errors >3 in 5 min, memory 85%+, disk 80%+, restart loops | Immediate Telegram |
| **Info** | Daily report, routine events | 9 AM daily |

## 6. Files

| File | Action |
|------|--------|
| `src/monitor.ts` | **NEW** — standalone monitor |
| `ecosystem.config.js` | Update — add monitor process |
| `src/bot.ts` | No changes needed (separate process) |

## 7. SystemD Alternative (Recommended)

For maximum reliability, run the monitor via systemd so it survives even PM2 failure:

```bash
cat > /etc/systemd/system/iqbot-monitor.service << 'EOF'
[Unit]
Description=10x Bot System Monitor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/iqbot-v3
ExecStart=/usr/bin/npx tsx src/monitor.ts
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl enable iqbot-monitor
systemctl start iqbot-monitor
```

**But:** PM2 is also acceptable. Choose PM2 for simplicity, systemd for resilience.

---

**Deploy:** 
```bash
pm2 start src/monitor.ts --name iqbot-v3-monitor --interpreter tsx
pm2 save
```

**Test:**
- Stop the bot (`pm2 stop iqbot-v3-bot`) → monitor alerts within 30s
- Corrupt the DB → monitor alerts
- Wait for daily report at 9 AM
