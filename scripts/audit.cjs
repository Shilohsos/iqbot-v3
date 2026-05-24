#!/usr/bin/env node
/**
 * IQ Bot V3 — Full Audit Script
 * Runs every 12 hours via cron. Reports only — never fixes.
 */
const { execSync, spawnSync } = require('child_process');
const path = require('path');

const BOT_DIR = '/root/iqbot-v3';
const MAX_SSID_TEST = 5; // Test up to 5 random SSIDs per run

async function main() {
    const report = [];
    const errors = [];
    const warnings = [];

    report.push('╔════════════════════════════════════════╗');
    report.push('║     IQ Bot V3 — Full Audit Report      ║');
    report.push('╚════════════════════════════════════════╝');
    report.push(`Timestamp: ${new Date().toISOString().replace('T', ' ').split('.')[0]}`);
    report.push('');

    // ─── 1. PM2 Process Status ──────────────────────────────────────
    report.push('─── 1. PM2 Process Status ───');
    try {
        const pm2 = execSync('pm2 show iqbot-v3-bot --no-color 2>/dev/null', { cwd: BOT_DIR, timeout: 10000 }).toString();
        const status = (pm2.match(/status\s+│\s+(\S+)/) || [])[1];
        const uptimeMatch = pm2.match(/uptime\s+│\s+([\dhms]+)/);
        const uptime = uptimeMatch ? uptimeMatch[1] : '?';
        const restarts = (pm2.match(/restarts\s+│\s+(\d+)/) || [])[1];
        const memMatch = pm2.match(/memory\s+│\s+([\d.]+[KMG]?b)/);
        const mem = memMatch ? memMatch[1] : '?';
        const unstable = (pm2.match(/unstable restarts\s+│\s+(\d+)/) || [])[1];

        if (status === 'online') {
            report.push(`  ✅ Process: ONLINE (uptime: ${uptime}, mem: ${mem})`);
        } else {
            errors.push(`  ❌ Process: ${status}`);
        }
        report.push(`     Restarts: ${restarts} | Unstable: ${unstable || 0}`);
    } catch (e) {
        errors.push(`  ❌ PM2 check failed: ${e.message.slice(0, 100)}`);
    }
    report.push('');

    // ─── 2. Telegram Bot Token ──────────────────────────────────────
    report.push('─── 2. Telegram Bot Connectivity ───');
    try {
        const env = execSync('grep BOT_TOKEN .env', { cwd: BOT_DIR, timeout: 5000 }).toString().trim();
        const token = env.split('=')[1];
        if (!token) throw new Error('BOT_TOKEN not found');
        const res = execSync(`curl -s --max-time 5 "https://api.telegram.org/bot${token}/getMe"`, { timeout: 10000 }).toString();
        const data = JSON.parse(res);
        if (data.ok) {
            report.push(`  ✅ Bot @${data.result.username} — API reachable`);
        } else {
            errors.push(`  ❌ Telegram API error: ${data.description}`);
        }
    } catch (e) {
        errors.push(`  ❌ Telegram check failed: ${e.message.slice(0, 100)}`);
    }
    report.push('');

    // ─── 3. Database Health ─────────────────────────────────────────
    report.push('─── 3. Database Health ───');
    let ssidCount = 0;
    try {
        const dbPath = path.join(BOT_DIR, 'iqbot-v3.db');
        if (!require('fs').existsSync(dbPath)) throw new Error('DB file not found');
        const db = require('better-sqlite3')(dbPath);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
        report.push(`  ✅ Tables (${tables.length}): ${tables.join(', ')}`);
        const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        const sc = db.prepare('SELECT COUNT(*) as c FROM users WHERE ssid IS NOT NULL').get().c;
        ssidCount = sc;
        const tradeCount = db.prepare('SELECT COUNT(*) as c FROM trades').get().c;
        const todaysTrades = db.prepare("SELECT COUNT(*) as c FROM trades WHERE date(created_at) = date('now')").get().c;
        report.push(`     Users: ${userCount} total | ${ssidCount} with SSID | ${userCount - ssidCount} without`);
        report.push(`     Trades: ${tradeCount} total | ${todaysTrades} today`);
        db.close();
    } catch (e) {
        errors.push(`  ❌ DB check failed: ${e.message.slice(0, 100)}`);
    }
    report.push('');

    // ─── 4. SDK Connection Tests (random sample) ──────────────────────
    report.push('─── 4. IQ Option SDK Connections (sample) ───');
    try {
        const os = require('os');
        const tmpFile = path.join(os.tmpdir(), `iq_sdk_test_${Date.now()}.ts`);
        const tsCode = [
            `import { ClientSdk, SsidAuthMethod } from '${BOT_DIR}/src/index.ts';`,
            `import { WS_URL, PLATFORM_ID, IQ_HOST } from '${BOT_DIR}/src/protocol.ts';`,
            `import Database from 'better-sqlite3';`,
            `import { readFileSync } from 'fs';`,
            ``,
            `const MAX = ${MAX_SSID_TEST};`,
            ``,
            `(async () => {`,
            `  const out: Record<string, any> = { adminSsid: null as boolean | null, valid: 0, dead: 0, deadUsers: [] as any[], remaining: 0 };`,
            ``,
            `  try {`,
            `    const env = readFileSync('${BOT_DIR}/.env', 'utf-8');`,
            `    const ssid = env.split('\\n').find((l: string) => l.startsWith('IQ_SSID='))?.split('=')[1]?.trim();`,
            `    if (ssid) {`,
            `      try {`,
            `        const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });`,
            `        await sdk.shutdown();`,
            `        out.adminSsid = true;`,
            `      } catch { out.adminSsid = false; }`,
            `    }`,
            `  } catch {}`,
            ``,
            `  const db = new Database('${BOT_DIR}/iqbot-v3.db');`,
            `  const { c: total } = db.prepare('SELECT COUNT(*) as c FROM users WHERE ssid IS NOT NULL').get() as { c: number };`,
            `  const users = db.prepare('SELECT telegram_id, username, ssid FROM users WHERE ssid IS NOT NULL ORDER BY RANDOM() LIMIT ?').all(MAX) as Array<{ telegram_id: number; username: string | null; ssid: string }>;`,
            `  db.close();`,
            `  out.remaining = total - users.length;`,
            ``,
            `  for (const u of users) {`,
            `    try {`,
            `      const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(u.ssid), { host: IQ_HOST });`,
            `      await sdk.balances();`,
            `      await sdk.shutdown();`,
            `      out.valid++;`,
            `    } catch {`,
            `      out.dead++;`,
            `      out.deadUsers.push({ telegram_id: u.telegram_id, username: u.username });`,
            `    }`,
            `  }`,
            ``,
            `  process.stdout.write(JSON.stringify(out) + '\\n');`,
            `})();`,
        ].join('\n');

        require('fs').writeFileSync(tmpFile, tsCode);
        try {
            const proc = spawnSync('npx', ['tsx', tmpFile], {
                cwd: BOT_DIR,
                timeout: 120_000,
                encoding: 'utf-8',
                env: { ...process.env },
            });
            if (proc.status !== 0) throw new Error(proc.stderr?.slice(0, 300) || 'tsx exited non-zero');
            const lastLine = (proc.stdout || '').trim().split('\n').at(-1) || '';
            const data = JSON.parse(lastLine);

            if (data.adminSsid === true)  report.push('  ✅ Admin fallback SSID: VALID');
            else if (data.adminSsid === false) warnings.push('  ⚠️ Admin fallback SSID: EXPIRED (run /connect to refresh)');

            for (const u of data.deadUsers || []) {
                errors.push(`  ❌ User ${u.telegram_id} (${u.username || '?'}): SSID DEAD`);
            }
            report.push(`  ✅ Sample: ${data.valid} valid / ${data.dead} dead (${data.remaining} not tested)`);
        } finally {
            try { require('fs').unlinkSync(tmpFile); } catch {}
        }
    } catch (e) {
        errors.push(`  ❌ SDK test failed: ${e.message.slice(0, 100)}`);
    }
    report.push('');

    // ─── 5. Error Log Scan ─────────────────────────────────────────
    report.push('─── 5. Recent Error Logs (last 6h) ───');
    try {
        const logPath = path.join(BOT_DIR, 'logs/bot-error.log');
        if (require('fs').existsSync(logPath)) {
            const log = require('fs').readFileSync(logPath, 'utf-8');
            const authErrors = (log.match(/authentication is failed/g) || []).length;
            const crashErrors = (log.match(/\buncaughtException\b/g) || []).length;
            const rejectErrors = (log.match(/\bunhandledRejection\b/g) || []).length;
            const timeoutErrors = (log.match(/timed out after/g) || []).length;
            
            if (authErrors > 0) errors.push(`  ❌ ${authErrors} 'authentication is failed' errors found`);
            if (crashErrors > 0) errors.push(`  ❌ ${crashErrors} uncaught exceptions found`);
            if (rejectErrors > 0) report.push(`  ⚠️ ${rejectErrors} unhandled rejections (check if serious)`);
            report.push(`     Auth: ${authErrors} | Timeouts: ${timeoutErrors} | Crashes: ${crashErrors} | Rejections: ${rejectErrors}`);
            if (authErrors === 0 && crashErrors === 0) report.push('  ✅ No critical errors');
        } else {
            warnings.push('  ⚠️ Error log file not found');
        }
    } catch (e) {
        warnings.push(`  ⚠️ Log scan failed: ${e.message.slice(0, 80)}`);
    }
    report.push('');

    // ─── 6. Server Resources ─────────────────────────────────────────
    report.push('─── 6. Server Resources ───');
    try {
        const mem = execSync('free -m | grep Mem', { timeout: 5000 }).toString().trim();
        const memMatch = mem.match(/\s+(\d+)\s+(\d+)\s+(\d+)/);
        if (memMatch) {
            const used = parseInt(memMatch[2]);
            const total = parseInt(memMatch[1]);
            const pct = Math.round((used / total) * 100);
            report.push(`  ✅ Memory: ${used}MB / ${total}MB (${pct}%)`);
            if (pct > 90) warnings.push(`  ⚠️ Memory usage at ${pct}%`);
        }
        const disk = execSync('df -h / | tail -1', { timeout: 5000 }).toString().trim();
        const diskParts = disk.split(/\s+/);
        if (diskParts.length >= 5) {
            report.push(`     Disk: ${diskParts[2]} used / ${diskParts[1]} total (${diskParts[4]})`);
        }
        const load = execSync('cat /proc/loadavg | cut -d" " -f1-3', { timeout: 5000 }).toString().trim();
        report.push(`     Load: ${load}`);
    } catch (e) {
        warnings.push(`  ⚠️ Server resource check failed`);
    }
    report.push('');

    // ─── Summary ──────────────────────────────────────────────────────
    report.push('══════════════════════════════════════════');
    if (errors.length === 0 && warnings.length === 0) {
        report.push('   ✅ ALL CHECKS PASSED — No issues found');
    } else {
        if (errors.length > 0) {
            report.push(`   ❌ ${errors.length} Error(s):`);
            report.push(...errors);
        }
        if (warnings.length > 0) {
            report.push(`   ⚠️ ${warnings.length} Warning(s):`);
            report.push(...warnings);
        }
    }
    report.push('══════════════════════════════════════════');
    report.push('');
    report.push('Note: This is a read-only audit. No fixes applied.');
    report.push(`Next audit in ~12 hours.`);

    console.log(report.join('\n'));
}

main().catch(e => {
    console.error('AUDIT FAILED:', e.message);
    process.exit(1);
});
