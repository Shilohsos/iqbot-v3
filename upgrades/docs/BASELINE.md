# BASELINE.md — Pre-Upgrade Metrics
Generated (UTC): 2026-07-29T13:37:33.134453+00:00
Incident anchor: Shara 6622587977 $100→$200→$400 WIN then false $800 (2026-07-29)

## Trade outcomes last 24h
- LOSS: 962
- WIN: 919
- TIE: 19
- in_flight: 2

## Trade outcomes last 7d
- LOSS: 4889
- WIN: 4746
- TIE: 94
- in_flight: 2

## Auto sessions by status
- paused: 48
- stopped: 11

## Auto last_error distribution
- insufficient_balance: 26
- (null): 20
- demo_limit: 8
- repeated_timeouts: 3
- reconnect_failed: 1
- connect_failed: 1

## Users
- total=2302 with_ssid=888 valid=888 funded=222

## Admin SSID split
- users.ssid prefix: [('d2869d43f4f347eb',)]
- config.admin_ssid prefix: [('56c6174b14f325a3',)]
- match: False

## Config flags
- admin_analysis_all=true
- features_paused=0
- test_mode=off

## Acceptance incident chain (must never recur)
- id=87532 amt=100.0 status=LOSS pnl=0.0 ext=14116810875 at=2026-07-29T12:11:39.657Z
- id=87540 amt=200.0 status=LOSS pnl=0.0 ext=14116820417 at=2026-07-29T12:16:45.582Z
- id=87550 amt=400.0 status=WIN pnl=732.0 ext=14116829477 at=2026-07-29T12:21:51.369Z
- id=87569 amt=800.0 status=LOSS pnl=0.0 ext=14116842672 at=2026-07-29T12:28:32.454Z

## Log pattern counts (last ~5000 pm2 lines)
- `Result timeout`: 3
- `TIMEOUT recovered`: 3
- `TIMEOUT:runMartingale`: 3
- `WebSocket disconnected`: 11
- `ssidMatch=false`: 7
- `force-evict`: 5
- `trade run failed`: 3
- `repeated_`: 0
- `reconnect_failed`: 0
- `SSID cleared`: 16
- `authentication`: 13

## File truth
- src/bot.ts: 368334 bytes, 7516 lines
- dist/bot.js: 419680 bytes, 8058 lines
- src/trade.ts: 22493 bytes, 483 lines
- dist/trade.js: 21638 bytes, 420 lines

## Freeze decisions (Phase 0)
- New features: FROZEN until Phase 2 SLOs
- Swarm/Copy: SOFT FREEZE (no expansion; existing code stays)
- Signals choice: C hybrid deferred; Phase 4 default lean A (direction-honest) pending Master confirm
- Strict mode: NO gale double without FINAL (Phase 2 law)
- Backup: upgrades/release-pre-upgrade/
