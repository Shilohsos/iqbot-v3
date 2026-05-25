# DIRECTIVE: Admin "New Opportunity" Button — Bypass Onboarding

## Problem
When admin clicks "🔄 New Opportunity" (`ui:trade`), `requireApproval()` checks the DB for `approval_status`. Admin has no user row with `approval_status = 'approved'`, so it falls through to `startOnboarding()` — showing sign-in/setup flow instead of the trade wizard.

## Fix
In `src/bot.ts`, function `requireApproval()` (line 721), add admin bypass as the FIRST check:

### Current (line 721-735):
```ts
async function requireApproval(ctx: Context): Promise<boolean> {
    const user = getUser(ctx.from!.id);
    if (!user || user.approval_status === 'pending') { await startOnboarding(ctx); return false; }
    ...
}
```

### New:
```ts
async function requireApproval(ctx: Context): Promise<boolean> {
    // Admin bypass — skip all approval/onboarding checks
    if (ctx.from!.id === getAdminId()) return true;

    const user = getUser(ctx.from!.id);
    if (!user || user.approval_status === 'pending') { await startOnboarding(ctx); return false; }
    ...
}
```

## Trade Mode (Already Works)
`tradeModeKeyboard()` already shows both "Trade Live" and "Trade Demo" buttons. No change needed — admin just couldn't reach it because of the onboarding gate above.

## Verify
After fix, admin clicks "🔄 New Opportunity" → goes straight to `Trade live | Trade Demo` selection → enters wizard flow.
