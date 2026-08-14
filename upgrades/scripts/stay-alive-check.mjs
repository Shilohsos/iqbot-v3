#!/usr/bin/env node
/** Stay-alive acceptance snapshot */
import fs from 'fs';
import { execSync } from 'child_process';

console.log('=== Stay-Alive Acceptance ===');
try {
  const j = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
  for (const name of ['iqbot-v3-bot', 'iqbot-stay-alive']) {
    const a = j.find(x => x.name === name);
    if (!a) { console.log(name, 'MISSING'); continue; }
    const e = a.pm2_env || {};
    console.log(name, {
      status: e.status,
      restarts: e.restart_time,
      memMB: Math.round((a.monit?.memory || 0) / 1e6),
      maxMem: e.max_memory_restart,
    });
  }
} catch (e) {
  console.log('pm2 error', e.message);
}

const mpath = '/root/iqbot-v3/upgrades/metrics/stay-alive.json';
if (fs.existsSync(mpath)) {
  const m = JSON.parse(fs.readFileSync(mpath, 'utf8'));
  console.log('metrics', { rssMB: m.rssMB, pinned: m.pinned, pool: m.poolSize, uptimeSec: m.uptimeSec, ts: m.ts });
} else console.log('metrics: not yet');

let memKills = 0;
try {
  memKills = execSync('grep -c "exceeds --max-memory-restart" /root/.pm2/pm2.log || true', { encoding: 'utf8' }).trim();
} catch { /* */ }
console.log('historical_memory_kills_in_pm2_log', memKills);
console.log('runbook', '/root/iqbot-v3/upgrades/docs/STAY_ALIVE_RUNBOOK.md');
