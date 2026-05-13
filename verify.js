const Database = require('better-sqlite3');
const db = new Database('iqbot-v3.db', { readonly: true });

const old = db.prepare('SELECT COUNT(*) as c, SUM(CASE WHEN status = \'WIN\' THEN 1 ELSE 0 END) as wins, SUM(CASE WHEN status = \'LOSS\' THEN 1 ELSE 0 END) as losses FROM trades').get();
console.log('Old (per-trade):', old.c, 'trades |', old.wins, 'W /', old.losses, 'L');

const newStats = db.prepare(`
  WITH circle_results AS (
    SELECT martingale_run,
      (SELECT status FROM trades t2 WHERE t2.martingale_run = t1.martingale_run ORDER BY t2.created_at DESC LIMIT 1) AS final_status
    FROM trades t1 WHERE martingale_run IS NOT NULL GROUP BY martingale_run
    UNION ALL
    SELECT CAST(id AS TEXT), status FROM trades WHERE martingale_run IS NULL
  )
  SELECT COUNT(*) as c,
    SUM(CASE WHEN final_status = 'WIN'  THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN final_status = 'LOSS' THEN 1 ELSE 0 END) as losses,
    SUM(CASE WHEN final_status = 'TIE'  THEN 1 ELSE 0 END) as ties
  FROM circle_results
`).get();
console.log('New (per-circle):', newStats.c, 'circles |', newStats.wins, 'W /', newStats.losses, 'L /', newStats.ties, 'T');

const lb = db.prepare('SELECT telegram_id, auto_profit, manual_profit FROM leaderboard ORDER BY COALESCE(manual_profit, auto_profit) DESC').all();
console.log('\nLeaderboard:');
lb.forEach(e => console.log('  UID:', e.telegram_id, 'auto:', e.auto_profit, 'manual:', e.manual_profit));
db.close();
