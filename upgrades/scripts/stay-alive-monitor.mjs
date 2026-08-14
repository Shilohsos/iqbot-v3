#!/usr/bin/env node
/**
 * Stay-Alive external monitor (Phase D).
 * - Reads upgrades/metrics/stay-alive.json
 * - Logs alerts; never talks to IQ
 * - Optional: append to stay-alive-alerts.log
 */
import fs from 'fs';
import path from 'path';

const METRICS = '/root/iqbot-v3/upgrades/metrics/stay-alive.json';
const ALERTS = '/root/iqbot-v3/upgrades/metrics/stay-alive-alerts.log';
const RSS_WARN = 750;
const RSS_CRIT = 900;
const STALE_MS = 120_000; // metrics older than 2 min → bot maybe dead

function alert(level, msg) {
  const line = `${new Date().toISOString()}\t${level}\t${msg}\n`;
  console.log(`[stay-alive-monitor] ${level}: ${msg}`);
  try {
    fs.mkdirSync(path.dirname(ALERTS), { recursive: true });
    fs.appendFileSync(ALERTS, line);
  } catch { /* */ }
}

function tick() {
  try {
    if (!fs.existsSync(METRICS)) {
      alert('WARN', 'metrics file missing — bot not writing stay-alive.json yet');
      return;
    }
    const st = fs.statSync(METRICS);
    const age = Date.now() - st.mtimeMs;
    if (age > STALE_MS) {
      alert('CRIT', `metrics stale ${Math.round(age / 1000)}s — process may be hung or dead`);
      return;
    }
    const m = JSON.parse(fs.readFileSync(METRICS, 'utf8'));
    if (m.rssMB >= RSS_CRIT) alert('CRIT', `RSS ${m.rssMB}MB pinned=${m.pinned} pool=${m.poolSize}`);
    else if (m.rssMB >= RSS_WARN) alert('WARN', `RSS ${m.rssMB}MB pinned=${m.pinned} pool=${m.poolSize}`);
    if (m.pinned > 8) alert('WARN', `high pin count ${m.pinned}`);
    if (m.poolSize > 35) alert('WARN', `pool large ${m.poolSize}`);
    // heartbeat line for pm2 logs
    if (process.env.VERBOSE) {
      console.log(`[stay-alive-monitor] ok rss=${m.rssMB} pinned=${m.pinned} pool=${m.poolSize} up=${m.uptimeSec}s`);
    }
  } catch (e) {
    alert('ERROR', e instanceof Error ? e.message : String(e));
  }
}

console.log('[stay-alive-monitor] started');
tick();
setInterval(tick, 30_000);
