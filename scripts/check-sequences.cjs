#!/usr/bin/env node
const Database = require('better-sqlite3');
const db = new Database('iqbot-v3.db');

console.log('=== USER SEGMENTS ===');
const s1 = db.prepare("SELECT COUNT(*) c FROM users WHERE ssid IS NULL OR ssid = '' OR ssid_valid = 0").get();
const s2 = db.prepare("SELECT COUNT(*) c FROM users WHERE tier = 'DEMO'").get();
const s3 = db.prepare("SELECT COUNT(*) c FROM users WHERE tier IN ('PRO','MASTER')").get();
console.log('S1 non_activated:', s1.c, '| S2 non_funded(DEMO):', s2.c, '| S3 funded(PRO/MASTER):', s3.c);

console.log('\n=== FUNDING CYCLE ===');
const fc = db.prepare('SELECT COUNT(*) c FROM funding_cycle').get();
const fcDue = db.prepare("SELECT COUNT(*) c FROM funding_cycle WHERE datetime(next_run_at) <= datetime('now')").get();
console.log('Entries:', fc.c, '| Due now:', fcDue.c);

console.log('\n=== RECONNECT CYCLE ===');
const rc = db.prepare('SELECT COUNT(*) c FROM reconnect_cycle').get();
const rcDue = db.prepare("SELECT COUNT(*) c FROM reconnect_cycle WHERE datetime(next_run_at) <= datetime('now')").get();
console.log('Entries:', rc.c, '| Due now:', rcDue.c);

console.log('\n=== RE-ENGAGE TRACKING ===');
const rt = db.prepare('SELECT COUNT(*) c FROM reengage_tracking').get();
console.log('Entries:', rt.c);

console.log('\n=== NOTIFICATIONS QUEUE ===');
const nq = db.prepare("SELECT COUNT(*) c FROM notifications_queue WHERE status = 'pending'").get();
console.log('Pending:', nq.c);

console.log('\n=== AUTO-BROADCAST ===');
const bc = db.prepare("SELECT * FROM broadcast_state").all();
bc.forEach(b => console.log(b.key, '=', b.value));
const lastBc = db.prepare('SELECT * FROM broadcast_messages ORDER BY id DESC LIMIT 1').get();
if (lastBc) console.log('Last broadcast msg:', lastBc.id, '| sent_at:', lastBc.sent_at);

console.log('\n=== GIVEAWAY EVENTS ===');
const ge = db.prepare('SELECT id, name, status FROM giveaway_events ORDER BY id DESC LIMIT 3').all();
ge.forEach(g => console.log('  #' + g.id, g.status, '|', g.name || '(unnamed)'));

console.log('\n=== TEMPLATE CATEGORIES ===');
const cats = db.prepare('SELECT category, COUNT(*) c FROM templates GROUP BY category ORDER BY c DESC').all();
cats.forEach(c => console.log(' ', c.category, ':', c.c));

db.close();
