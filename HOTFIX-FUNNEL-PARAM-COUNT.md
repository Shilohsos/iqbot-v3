# HOTFIX: getFunnelPipeline crashes with "Too many parameter values"

## Bug

`getFunnelPipeline()` in `src/db.ts` has a helper function:

```typescript
const count = (sql: string, param?: string): number =>
    (db.prepare(sql).get(param) as { cnt: number }).cnt ?? 0;
```

When called without a parameter (queries without `?` placeholders), it passes `undefined` to `.get()`, which better-sqlite3 interprets as "too many parameter values provided" and throws a `RangeError`.

This causes `bot.action('admin:funnel', ...)` to crash, making the Funnel button unresponsive when tapped.

## Fix

Change the `count` helper to only pass `param` when it's defined:

```typescript
const count = (sql: string, param?: string): number => {
    const row = param !== undefined
        ? (db.prepare(sql).get(param) as { cnt: number })
        : (db.prepare(sql).get() as { cnt: number });
    return row?.cnt ?? 0;
};
```

## Files to modify

- `src/db.ts` — line 1105-1106

## Deploy

1. `npx tsc`
2. `pm2 restart iqbot-v3-bot --update-env`
