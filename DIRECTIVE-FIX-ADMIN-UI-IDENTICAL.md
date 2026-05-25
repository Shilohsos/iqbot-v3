# Directive: Fix Admin Trading Portal — Identical UI, Super-profitable Engine

## Goal
The admin trading portal (from previous directive) was implemented with a **separate UI** (admin-specific cards, badges, analysis breakdowns). This must be **removed**. The admin must see the **exact same UI/UX as users** — same buttons, same images, same messages, same flow. The only difference is the **engine behind the scenes** (admin SSID + admin analysis).

**Also critical:** Admin trades must execute **instantly**, just like users. No added delays.

---

## What to Remove

### 1. Remove `AdminTradeState` interface and `adminTradeSessions`
File: `src/bot.ts`

Remove:
```typescript
interface AdminTradeState {
    step: 'amount' | 'timeframe' | 'pair' | 'custom_amount';
    amount?: number;
    timeframe?: number;
}
const adminTradeSessions = makeSessionMap<AdminTradeState>('admin_trade');
```

### 2. Remove `buildAdminCard()` function
File: `src/bot.ts`

Remove the entire function — it shows "ADMIN TRADE" badges, "Pre-Analysis:" with indicator breakdown, and "SKIPPED" with analysis reasons. Users do NOT see this.

### 3. Remove `runAdminTrade()` function
File: `src/bot.ts`

Remove the entire function — it has its own custom execution flow with admin-specific messaging. Admin should use the **same** trade execution path as users.

### 4. Remove admin keyboard imports and functions
File: `src/ui/admin.ts`

Remove:
- `adminAmountKeyboard()`
- `adminTimeframeKeyboard()`
- `adminPairKeyboard()`

File: `src/bot.ts` imports — remove references to these three.

### 5. Remove admin-specific callback handlers
File: `src/bot.ts`

Remove all:
- `admin:trade_new`
- `admin_amt:*`
- `admin_tf:*`
- `admin_pair:*`

### 6. Remove admin text input handlers
File: `src/bot.ts`

Remove:
- The `admin_amount_custom` text handler in the admin sessions section
- The `adminTradeSessions` text handler in the standalone section

---

## What to Modify

### 7. `/trade` command handler — merge into single handler
File: `src/bot.ts`

Currently there are **two** `bot.command('trade', ...)` handlers (Claude added a second one). **Merge into ONE**:

```
bot.command('trade', async ctx => {
    if (ctx.from!.id === getAdminId()) {
        // Admin: skip mode selection, go straight to amount
        // Use SAME WizardState, SAME wizardSessions, SAME amountKeyboard
        wizardSessions.set(ctx.chat.id, { step: 'amount', mode: 'live' });
        await ctx.reply('Enter trade amount (USD):', { reply_markup: amountKeyboard('USD') });
        return;
    }
    // User: unchanged
    if (!await requireApproval(ctx)) return;
    ...
});
```

### 8. Pair selection handler — silent engine swap
File: `src/bot.ts` (around line 975, the `bot.action(/^pair:(.+)$/, ...)` handler)

When the pair is selected and trade execution begins, **silently** swap SSID and analysis for admin:

**a) SSID:**
```typescript
const isAdmin = ctx.from!.id === getAdminId();
const ssid = isAdmin ? getAdminSsid() : getSsidForUser(ctx.from!.id);
```

**b) SDK creation:**
```typescript
if (isAdmin) {
    sdk = await createSdk(ssid);  // Admin creates fresh SDK
} else {
    sdk = await sdkPool.get(ctx.from!.id, ssid);  // Users use pool
}
```

**c) Skip tier validation for admin** (admin has access to everything):
```typescript
if (!isAdmin) {
    // existing tier validation code
}
```

**d) Admin analysis — silent swap:**
```typescript
if (isAdmin) {
    const adminResult = await adminAnalyze(sdk, pair);
    if (adminResult.skipped) {
        // Show simple message — NO analysis breakdown, NO badges
        await ctx.reply('⚠️ No clear signal right now. Try a different pair or timeframe.');
        return;
    }
    analysis = {
        direction: adminResult.direction,
        confidence: adminResult.confidence,
        reason: adminResult.reason,
    };
} else {
    analysis = await analyzePairWithSdk(sdk, pair, timeframe, analysisTier);
}
```

**e) SDK cleanup for admin:**
```typescript
if (isAdmin) {
    tradePromise.finally(() => sdk.shutdown().catch(() => {}));
} else {
    tradePromise.finally(() => sdkPool.release(ctx.from!.id));
}
```

### 9. Concurrent trade limit — bypass for admin
For the concurrent trade limit check (after opportunity found), admin should have no limit:
```typescript
const maxConcurrent = isAdmin ? 999 : getTierConfig(normalizeTier(getUser(ctx.from!.id)?.tier)).maxConcurrentTrades;
```

### 10. Keep `admin:trade_connect` handler
This is the "Connect Account" button when admin uses /trade without connecting first. Keep this handler.

---

## Key Principles

| Requirement | Implementation |
|------------|---------------|
| Same UI as users | Admin uses `wizardSessions`, `amountKeyboard()`, same images, same result messages |
| No admin badges | No "ADMIN TRADE", no crown emoji, no "Pre-Analysis" sections |
| Better analysis | Uses `adminAnalyze()` — 6 indicators × 3 timeframes — silently |
| Skip silently | Simple message: "No clear signal right now." No analysis details shown |
| Instant execution | Same path as users — no custom execution function, no added steps |
| Recovery max 3 rounds | Recovery only if re-analysis ≥90% confidence (already in adminAnalyze) |
| Admin SSID | Stored via /connect, pulled via `getAdminSsid()` |

## Files to Change
- `src/bot.ts` — merge /trade handler, remove admin-specific code, add silent engine swap
- `src/ui/admin.ts` — remove 3 keyboard functions
