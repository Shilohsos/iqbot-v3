# DIRECTIVE — YACHT ENGINE PART 4: PRE-WARM THE LIVE MIRROR (≤1s AFTER ENTRY)

**Date:** 2026-08-31
**Branch:** feature/yacht-demo-stake (continues after Part 3)

## Why — the mirror still enters ~5.8s late

Part 3 fixed the timing class (mirror no longer enters at expiry), but the
measured gap on the real broker is still ~5.8s:

```
14:01:24  [yacht] placing NZDUSD-OTC call stake=10 gale=3 tf=30s   ← demo entry
14:01:29  [yacht] live mirror: NZDUSD-OTC BUY $49.94 … tf=30s      ← +5.8s
14:02:03  [yacht] live mirror result: … LOSS
14:02:33  [yacht] result NZDUSD-OTC → WIN rounds=2
```

The demo buy fires instantly at countdown 0:00 because its SDK is already
warmed (`getYachtSdk()` — long-lived). The mirror, fired at the same instant,
must still open a NEW WebSocket (`createYachtSdk`) and read the live balance
(`compoundingLiveStake`) before it can buy — that is the ~5.8s. On a 30s
timeframe that is a materially different window.

Requirement (Master): **the mirror buy must land ≤1s after the demo entry.**

## Fix — pre-warm the mirror during the entry hold

The engine knows `entryAt` at post time (post + 60s). Use that window to
prepare the mirror so that at 0:00 it only has to place the buy.

### 1. Module state for the prepared mirror

```ts
let mirrorPrep: { sdk: YachtSdk; stake: number; balance: number; ratio: number; readyAt: number } | null = null;
```

### 2. Kick off preparation right after the setup is posted — BEFORE nudges

In `runOneSetup`, immediately after the `setup #N posted` log line (and before
`sendSetupNudges()` — nudges can take ~57s, which is the entire hold), fire:

```ts
mirrorPrep = null;
void prepareLiveMirror(setup);
```

`prepareLiveMirror` is a NEW function (never throws — every failure logs and
clears `mirrorPrep`):

```ts
async function prepareLiveMirror(setup: GeneratedSetup): Promise<void> {
    try {
        const sdk = await withTimeout(createYachtSdk('live mirror'), 60_000, 'live mirror sdk');
        const calc = await compoundingLiveStake(sdk);
        if (!calc) {
            try { await withTimeout(Promise.resolve(sdk.shutdown()), 10_000, 'live mirror shutdown'); } catch { }
            logger.warn('yacht', `live mirror prep skipped ${setup.pair} — live balance unavailable`);
            return;
        }
        mirrorPrep = { sdk, stake: calc.stake, balance: calc.balance, ratio: calc.ratio, readyAt: Date.now() };
    } catch (e) {
        logger.warn('yacht', `live mirror prep failed ${setup.pair}: ${errText(e)}`);
    }
}
```

### 3. At entry, placeLiveMirror consumes the prep INSTEAD of building fresh

Rewrite `placeLiveMirror`:

```ts
async function placeLiveMirror(setup: GeneratedSetup): Promise<void> {
    let sdk: YachtSdk | null = null;
    try {
        const prep = mirrorPrep;
        if (prep && Date.now() - prep.readyAt < 90_000) {
            // Prepared during the entry hold: SDK warm, stake computed. Just buy.
            sdk = prep.sdk;
            mirrorPrep = null;
            logger.info('yacht', `live mirror: ${setup.pair} ${dirLabel(setup.direction)} $${prep.stake.toFixed(2)} (${(prep.ratio * 100).toFixed(4)}% of $${prep.balance.toFixed(2)}) tf=${setup.timeframeSec}s`);
            const result = await withTimeout(
                executeTradeWithSdk(sdk, {
                    pair: setup.pair,
                    direction: setup.direction,
                    amount: prep.stake,
                    timeframeSec: setup.timeframeSec,
                    balanceType: 'live',
                }),
                LIVE_MIRROR_TIMEOUT_MS + setup.timeframeSec * 1000,
                'live mirror',
            );
            // (identical cleanup of the telegram_id NULL trades row as today)
        } else {
            if (prep) {
                // Stale prep (should never happen — 90s window vs 60s hold): shut
                // it down and fall through to the direct path.
                const stale = prep.sdk;
                mirrorPrep = null;
                try { await withTimeout(Promise.resolve(stale.shutdown()), 10_000, 'live mirror shutdown'); } catch { }
                logger.warn('yacht', `live mirror prep stale — rebuilding (${setup.pair})`);
            }
            // Fallback: the OLD direct path (create SDK + compoundingLiveStake +
            // buy), kept verbatim from Part 3 so a failed prep never means a
            // missed mirror. Log the latency so we can measure the gap:
            const t0 = Date.now();
            ... (existing Part 3 body) ...
            logger.warn('yacht', `live mirror built fresh in ${Date.now() - t0}ms — prep was unavailable (${setup.pair})`);
        }
    } catch (e) {
        logger.warn('yacht', `live mirror failed ${setup.pair}: ${errText(e)} — continuing`);
    } finally {
        if (sdk) {
            try { await withTimeout(Promise.resolve(sdk.shutdown()), 10_000, 'live mirror shutdown'); }
            catch (e) { logger.warn('yacht', `live mirror sdk shutdown failed: ${errText(e)}`); }
        }
    }
}
```

### 4. Cleanup on abort / fatal

If the setup is aborted before entry (channel-post failure, fatal, watchdog
interrupt, engine pause), the prepared SDK would leak. Add to the existing
abort/fatal paths (and the chain-timeout path) before returning:

```ts
if (mirrorPrep) {
    const p = mirrorPrep.sdk;
    mirrorPrep = null;
    try { await withTimeout(Promise.resolve(p.shutdown()), 10_000, 'live mirror shutdown'); } catch { }
}
```

Also clear `mirrorPrep` when the engine pauses or drops the session
(`dropYachtSdk` should also null `mirrorPrep` and shut its SDK down, since a
dropped session means the credentials may have gone stale).

### 5. Safety properties to keep

- The mirror NEVER blocks the demo chain: prep is `void`-fired; at entry the
  buy path is the only awaited part, and it is inside the fire-and-forget
  `placeLiveMirror` (never awaited by the setup flow).
- Pre-warm starts after the post, in parallel with nudges — it must not
  serialize with `sendSetupNudges()`.
- Only ONE mirror SDK exists at a time (`mirrorPrep` holds it; stale prep is
  shut down before the fallback path builds a fresh one).
- Compounding unchanged: stake = ratio × balance, ratio seeded 50 ÷ balance,
  $50 first stake, no martingale, no stop.
- The prep read of the balance happens up to ~60s before entry; the stake
  moves with the balance and the ratio is stable, so a 60s-old balance is fine
  (the old live mirror line already used a balance read at entry; a $100 move
  changes a 0.05% stake by $0.05). Do NOT add a second balance read at entry —
  that read is the latency we are removing.

## Verification checklist

- [ ] Prep starts immediately after the setup post (log: `live mirror prep …`)
      and finishes BEFORE the entry hold expires
- [ ] At entry, mirror buys using the prepared SDK/stake — no createSdk, no
      balances() call in the hot path
- [ ] Measured gap between `placing … stake=10` and `live mirror: …` is ≤1s
      on the real broker
- [ ] Stale/aborted/fatal paths shut the prepared SDK down (no socket leak)
- [ ] Fallback path intact when prep fails (mirror still fires, logs latency)
- [ ] No martingale, no stop, silent, no DB trace, channel untouched
- [ ] `node --check` clean on dist output
