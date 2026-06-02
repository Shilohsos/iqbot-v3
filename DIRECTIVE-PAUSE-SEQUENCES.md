# Quick Follow-Up Directive — Pause Toggle for New Sequences

**Merge master first.**

## Context
Master wants to pause the new sequences (onboarding, re-engagement, funding, LLM brain) until videos/images are ready for integration. Auto-broadcast has been disabled via DB (`broadcast_messages.enabled=0`).

## Required

Add a **pause check** at the top of every new sequence entry point. Check config key `features_paused`. When value is `"1"`, skip execution silently.

### Where to add checks

**1. `src/onboarding.ts` — `startNewOnboarding()`**
```typescript
export async function startNewOnboarding(ctx: Context, telegramId: number): Promise<void> {
    const config = getConfig('features_paused');
    if (config === '1') return; // PAUSED
    // ... existing code
}
```

**2. `src/bot.ts` — Re-engagement loop (~line 4529)**
```typescript
backgroundIntervals.push(setInterval(async () => {
    if (getConfig('features_paused') === '1') return;
    // ... existing code
}, 6 * 60 * 60_000));
```

**3. `src/bot.ts` — Funding sequence (triggered after demo trades)**
- Find where `checkFundingSequence` is called. Add:
```typescript
if (getConfig('features_paused') === '1') return;
```

**4. `src/classifier.ts` — LLM brain (free text handler)**
- At the start of the classifier function:
```typescript
const config = getConfig('features_paused');
if (config === '1') return null; // PAUSED — don't respond
```

### Note
- The pause flag already exists in DB: `config` table, key=`features_paused`, value=`"1"`
- To resume later, just set: `UPDATE config SET value='0' WHERE key='features_paused';`
- SSID health check, auto-promote, and reconnect prompts should **keep running** — they're stability features, not marketing sequences.
