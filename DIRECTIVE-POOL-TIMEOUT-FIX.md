# DIRECTIVE: Add 180s Timeout to SDK Pool Connection

## Problem

The SDK pool's `get()` method creates a new `ClientSdk` without any timeout. `ClientSdk.create()` uses `ws` library WebSocket internally, which has **no default connection timeout**. If IQ Option is slow to respond, the SDK creation hangs indefinitely — the `get()` promise never resolves or rejects, and the user sees "Could not connect to IQ Option" after a long wait or eventual OS-level timeout.

The original code (before the pool) had a 180s `Promise.race` wrapping `createSdk()`:
```typescript
sdk = await Promise.race([
    createSdk(ssid),
    new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out')), 180_000)
    ),
]);
```

This timeout was lost when the pool was introduced.

## Fix

Wrap the `ClientSdk.create()` call in `src/sdk-pool.ts` with a 180s `Promise.race`:

**`src/sdk-pool.ts` line 44:**

```typescript
// Before:
const sdk = await ClientSdk.create(
    WS_URL, PLATFORM_ID,
    new SsidAuthMethod(ssid),
    { host: IQ_HOST }
);

// After:
const sdk = await Promise.race([
    ClientSdk.create(
        WS_URL, PLATFORM_ID,
        new SsidAuthMethod(ssid),
        { host: IQ_HOST }
    ),
    new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out')), 180_000)
    ),
]) as ClientSdk;
```

Note: The `as ClientSdk` type assertion is needed because `Promise.race` infers `ClientSdk | never` which collapses to `ClientSdk`.

## Acceptance Criteria

- [ ] SDK creation in pool has 180s timeout
- [ ] If connection takes >180s, `get()` rejects with "Connection timed out"
- [ ] The pair handler catches this and shows "Could not connect to IQ Option"
- [ ] `npx tsc` passes clean
- [ ] PM2 restart → bot starts clean
