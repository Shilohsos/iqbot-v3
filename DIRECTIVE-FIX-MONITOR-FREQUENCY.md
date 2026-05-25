# Directive: Fix Monitor Alert Frequency + Reset Restart Counter

## Problem
The monitor is sending "CRITICAL — Bot restart count high: 108" alerts every 5 minutes. Two issues:

1. **Restart count inflated** — 108 restarts from deployments, not crashes. Counter needs resetting.
2. **Alert too frequent** — Health checks every 30s + log analysis every 5min generates alerts constantly. Should be **4 times a day** (every 6 hours).

## Fix 1: Reset PM2 restart counter
Run `pm2 reset iqbot-v3-bot` to reset the counter to 0. This clears the inflated deployment count.

## Fix 2: Reduce alert frequency (4x/day)
In `src/monitor.ts`, change:
```typescript
// Current: 5-minute log analysis
setInterval(() => { runLogAnalysis().catch(...); }, 5 * 60_000);

// Replace with: every 6 hours (4x/day)
setInterval(() => { runLogAnalysis().catch(...); }, 6 * 60 * 60_000);
```

## Fix 3: Make restart alert smarter
Current: alerts if **total** restarts > threshold (includes all deployment restarts)
Fix: Only alert if **new restarts within the last analysis window** exceed threshold, not total restarts.

In `runLogAnalysis()`, change the restart check to calculate `restarts_in_last_period = current_restarts - last_known_restarts` and alert only if that delta exceeds threshold.

## File to Change
- `src/monitor.ts` — change log analysis interval to 6h, make restart alert incremental
