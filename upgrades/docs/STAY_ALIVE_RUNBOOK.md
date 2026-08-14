# Stay-Alive Runbook

## What “bot stopped” usually means
1. **PM2 memory seatbelt** fired (should be rare after 1G + Phase B)
2. **safeExit** after Telegram dead (3× getMe) or event-loop stall (5 min) or polling fatal
3. **Manual / deploy restart**

## Check now
```bash
pm2 list
pm2 describe iqbot-v3-bot
cat /root/iqbot-v3/upgrades/metrics/stay-alive.json
tail -20 /root/iqbot-v3/upgrades/metrics/restart-reasons.log
tail -20 /root/iqbot-v3/upgrades/metrics/stay-alive-alerts.log
grep "max-memory-restart" /root/.pm2/pm2.log | tail -5
```

## Restart reasons (taxonomy)
| reason | meaning |
|--------|---------|
| boot | process started |
| watchdog_stall | event loop hung ≥5 min |
| keepalive_telegram_dead | getMe failed 3× |
| polling_fatal | Telegram long-poll died |
| FORCE_WITH_PINS | exited while gale still pinned (last resort) |
| manual | human/pm2 restart |

## Live session rules
- Do **not** `pm2 restart iqbot-v3-bot` during live gale demos
- Prefer waiting for `pinned: 0` in stay-alive.json
- Monitor RSS; WARN ≥750MB, CRIT ≥900MB

## Safe deploy
```bash
# wait until pinned=0
cat upgrades/metrics/stay-alive.json | grep pinned
npm run build:safe   # or targeted compile
pm2 reload ecosystem.config.cjs
```

## Rollback
```bash
cp -a upgrades/release-pre-upgrade/dist/* dist/
pm2 restart iqbot-v3-bot
```

## Phase map
- **A** PM2 1G, kill_timeout 30s, multi-strike exits, taxonomy
- **B** pool 28, idle 3m, job diet, balance scan cap
- **C** safeExit waits for pins (pragmatic isolation)
- **D** metrics file + iqbot-stay-alive monitor + this runbook
