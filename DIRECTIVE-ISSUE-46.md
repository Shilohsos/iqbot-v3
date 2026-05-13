# Issue 46 — /start lag: SDK WebSocket blocks response for up to 90 seconds

**Problem:** `sendStartMenu()` at line 382 creates a new `ClientSdk` WebSocket connection to IQ Option on EVERY `/start` to fetch the user's balance. This hangs for 30-90 seconds if IQ Option is slow or the SSID is expired, blocking the entire response. With multiple users, the event queue backs up and every user experiences lag.

**Fix in `src/bot.ts`:**

**Option A: Add timeout + cache (recommended)**

Add a simple in-memory balance cache with a 60-second TTL. On cache miss, fetch with a 5-second timeout. On timeout/cache hit, show menu without balance.

Add near the top of the file (after the other Map declarations):
```typescript
const balanceCache = new Map<number, { balance: string; fetchedAt: number }>();
const BALANCE_CACHE_TTL = 60_000; // 1 minute
const SDK_TIMEOUT_MS = 5_000; // 5 seconds
```

In `sendStartMenu()`, replace lines 381-395 (the SDK balance fetch block) with:
```typescript
    let balanceLine = '';
    const cached = balanceCache.get(telegramId);
    if (cached && Date.now() - cached.fetchedAt < BALANCE_CACHE_TTL) {
        balanceLine = cached.balance;
    } else {
        const ssid = getSsidForUser(telegramId);
        if (ssid) {
            try {
                const sdk = await Promise.race([
                    ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST }),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SDK timeout')), SDK_TIMEOUT_MS)),
                ]);
                try {
                    const all = (await sdk.balances()).getBalances();
                    const demo = all.find(b => b.type === BalanceType.Demo);
                    const real = all.find(b => b.type === BalanceType.Real);
                    balanceLine = [demo ? `Practice $${demo.amount.toFixed(2)}` : '', real ? `Real $${real.amount.toFixed(2)}` : ''].filter(Boolean).join(' | ');
                    balanceCache.set(telegramId, { balance: balanceLine, fetchedAt: Date.now() });
                } finally { await sdk.shutdown(); }
            } catch {
                // Timeout or connection error — show menu without balance
            }
        }
    }
```

This ensures:
- Balance is cached for 60 seconds — no repeated SDK connections
- SDK connection has a 5-second hard timeout
- On timeout, the menu shows immediately without balance
- Cache survives between calls during active use

**Option B: Simpler — just remove balance display from start menu**

If the balance isn't critical on every `/start`, remove the SDK balance fetch entirely and show the menu without it. The user can see their balance when they trade.
