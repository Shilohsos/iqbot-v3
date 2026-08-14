#!/usr/bin/env node
/**
 * Upgrade acceptance / soak checker (read-only).
 * Usage: node upgrades/scripts/acceptance-check.mjs
 */
import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';

const db = new Database('/root/iqbot-v3/iqbot-v3.db', { readonly: true });
const since = process.argv[2] || new Date(Date.now() - 24 * 3600e3).toISOString();

console.log('=== 10x Upgrade Acceptance Check ===');
console.log('Since:', since);

const byStatus = db.prepare(
  `SELECT status, COUNT(*) c FROM trades WHERE created_at > ? GROUP BY status ORDER BY c DESC`
).all(since);
console.log('\nTrades by status:');
for (const r of byStatus) console.log(`  ${r.status}: ${r.c}`);

// Wrong-gale heuristic: LOSS at 2x amount within 8 min after a WIN same user+pair
const chains = db.prepare(`
  SELECT a.id as win_id, a.telegram_id, a.pair, a.amount as win_amt, a.created_at as win_at,
         b.id as next_id, b.amount as next_amt, b.status as next_status, b.created_at as next_at
  FROM trades a
  JOIN trades b
    ON b.telegram_id = a.telegram_id
   AND b.pair = a.pair
   AND b.id > a.id
   AND b.created_at > a.created_at
   AND b.created_at <= datetime(a.created_at, '+8 minutes')
   AND ABS(b.amount - a.amount * 2) < 0.02
  WHERE a.status = 'WIN' AND a.created_at > ?
  ORDER BY a.created_at DESC
  LIMIT 20
`).all(since);

console.log('\nPost-WIN 2x stake within 8m (possible false gale):', chains.length);
for (const c of chains.slice(0, 10)) {
  console.log(`  user=${c.telegram_id} ${c.pair} WIN$${c.win_amt} @${c.win_at} → ${c.next_status}$${c.next_amt} @${c.next_at}`);
}

// Anchor incident must stay unique historical
const anchor = db.prepare(`
  SELECT id, amount, status, pnl FROM trades
  WHERE telegram_id = 6622587977 AND external_id = 14116829477
`).get();
console.log('\nAnchor $400 WIN row:', anchor || 'missing');

// Auto pauses
const pauses = db.prepare(`
  SELECT COALESCE(last_error,'(null)') e, COUNT(*) c
  FROM auto_trading_sessions GROUP BY 1 ORDER BY c DESC
`).all();
console.log('\nAuto session last_error:');
for (const p of pauses) console.log(`  ${p.e}: ${p.c}`);

// Admin SSID match
const u = db.prepare(`SELECT ssid FROM users WHERE telegram_id = 1615652240`).get();
const a = db.prepare(`SELECT value FROM config WHERE key = 'admin_ssid'`).get();
console.log('\nAdmin SSID match:', u?.ssid && a?.value && u.ssid === a.value);

// Core files present
const cores = ['/root/iqbot-v3/dist/trade-core.js', '/root/iqbot-v3/dist/gale-engine.js', '/root/iqbot-v3/dist/trade.js'];
console.log('\nCore artifacts:');
for (const f of cores) console.log(`  ${f}: ${existsSync(f) ? 'OK' : 'MISSING'}`);

// SLO summary
const wins = byStatus.find(x => x.status === 'WIN')?.c || 0;
const losses = byStatus.find(x => x.status === 'LOSS')?.c || 0;
const inflight = byStatus.find(x => x.status === 'in_flight')?.c || 0;
console.log('\n=== SLO snapshot ===');
console.log(`WIN+LOSS settled: ${wins + losses}`);
console.log(`in_flight stuck: ${inflight}`);
console.log(`false-gale suspects (24h window query): ${chains.length}`);
console.log(chains.length === 0 ? 'PASS: no post-WIN 2x pattern in window' : 'REVIEW: inspect chains above');

db.close();
