# Directive: LLM Brain Routes Repeated User ID Failures

## IMPORTANT: Merge master first
```
git checkout master && git pull origin master
git checkout -b claude/user-id-brain-reroute-UyN4I
```

---

**Problem:** The `awaiting_user_id` handler (bot.ts:4161) hardcodes attempt count as `1` on every fail. The 3-tier escalation never fires. User gets the same "try again" message forever. The LLM brain never sees these messages because the state machine returns early.

**Fix:** Track fail count. After 2 failures, route to the LLM brain. The brain detects frustration and routes to: create account, contact admin, or try again with better instructions.

---

## Change 1: Add fail count to DB

**File:** `src/db.ts`

### 1a. Migration

Somewhere near the existing `onboarding_tracking` migration (around line 192 area):

```typescript
// Migration: add user_id_fail_count column
const otCols = (db.prepare('PRAGMA table_info(onboarding_tracking)').all() as { name: string }[]).map(c => c.name);
if (!otCols.includes('user_id_fail_count')) {
    db.exec('ALTER TABLE onboarding_tracking ADD COLUMN user_id_fail_count INTEGER NOT NULL DEFAULT 0');
}
```

### 1b. Helper functions

```typescript
export function getUserIdFailCount(telegramId: number): number {
    const row = db.prepare(
        'SELECT user_id_fail_count FROM onboarding_tracking WHERE telegram_id = ?'
    ).get(telegramId) as { user_id_fail_count: number } | undefined;
    return row?.user_id_fail_count ?? 0;
}

export function incrementUserIdFailCount(telegramId: number): number {
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, user_id_fail_count, last_activity_at)
        VALUES (?, 1, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
            user_id_fail_count = user_id_fail_count + 1,
            last_activity_at = datetime('now')
    `).run(telegramId);
    return getUserIdFailCount(telegramId);
}

export function resetUserIdFailCount(telegramId: number): void {
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, user_id_fail_count)
        VALUES (?, 0)
        ON CONFLICT(telegram_id) DO UPDATE SET user_id_fail_count = 0
    `).run(telegramId);
}
```

---

## Change 2: Update `awaiting_user_id` handler in bot.ts

**File:** `src/bot.ts` — around lines 4161-4183

### 2a. Update imports (near top)

Add to the existing import from `./db.js`:
```typescript
    incrementUserIdFailCount, getUserIdFailCount, resetUserIdFailCount,
```

And add `getBrainFlow` import if not already there (should be at line 111):
```typescript
import { getBrainFlow, type UserContext } from './classifier.js';
```

### 2b. Replace the fail path (lines 4174-4182)

**Current code (lines 4174-4182):**
```typescript
            } else {
                await handleUserIdFailed(ctx, ctx.from!.id, 1);
                setOnboardingState(ctx.from!.id, 'awaiting_user_id');
            }
        } catch {
            await handleUserIdFailed(ctx, ctx.from!.id, 1);
            setOnboardingState(ctx.from!.id, 'awaiting_user_id');
        }
        return;
```

**New code:**
```typescript
            } else {
                const failCount = incrementUserIdFailCount(ctx.from!.id);
                if (failCount < 2) {
                    // First failure — normal retry
                    await handleUserIdFailed(ctx, ctx.from!.id, failCount);
                    setOnboardingState(ctx.from!.id, 'awaiting_user_id');
                } else {
                    // Repeated failures — route to LLM brain
                    await handleUserIdBrainRoute(ctx, ctx.from!.id, text, failCount);
                }
            }
        } catch {
            const failCount = incrementUserIdFailCount(ctx.from!.id);
            if (failCount < 2) {
                await handleUserIdFailed(ctx, ctx.from!.id, failCount);
                setOnboardingState(ctx.from!.id, 'awaiting_user_id');
            } else {
                await handleUserIdBrainRoute(ctx, ctx.from!.id, text, failCount);
            }
        }
        return;
```

### 2c. Add the brain route handler function

Add this function somewhere in bot.ts (before the `on('text')` handler, near other helper functions):

```typescript
/**
 * Repeated User ID failures — route to LLM brain for contextual handling.
 * The brain can suggest: try again with better instructions, create a new account,
 * or contact admin.
 */
async function handleUserIdBrainRoute(ctx: Context, telegramId: number, lastInput: string, failCount: number): Promise<void> {
    // Build a context for the brain describing the situation
    const brainCtx: UserContext = {
        onboarding_state: 'awaiting_user_id',
        ssid_valid: null,
        has_ssid: false,
        demo_trade_count: null,
        tier: 'DEMO',
        // Extra context conveyed via the user message + state
    };

    try {
        const brainResult = await getBrainFlow(telegramId, lastInput, brainCtx).catch(
            () => ({ flow: 'help_contact', message: '', shouldReply: true })
        );
        
        if (brainResult.shouldReply && brainResult.flow) {
            const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
            const replyText = brainResult.message || 'Having trouble? Contact admin for help 👇💜';
            
            const markup: any = {};
            if (typeof btn.action === 'string') {
                markup.reply_markup = { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] };
            } else {
                markup.reply_markup = { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
            }
            
            await ctx.reply(replyText, markup);
        } else {
            // Fallback: prompt to create account or contact admin
            await ctx.reply(
                "Still having trouble with your User ID? Let's get you sorted 💜\n\n👇 You can:",
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🆕 Create a new account', url: AFFILIATE_LINK }],
                            [{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }],
                            [{ text: '🔄 Try again', callback_data: 'ui:connect' }],
                        ]
                    }
                }
            );
        }
    } catch {
        // Ultimate fallback
        await ctx.reply(
            "Having trouble connecting? Contact admin for help 👇💜",
            { reply_markup: { inline_keyboard: [[{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }]] } }
        );
    }
    
    // Keep state as awaiting_user_id so next valid input still works
    setOnboardingState(telegramId, 'awaiting_user_id');
}
```

---

## Change 3: Update LLM brain (classifier.ts)

**File:** `src/classifier.ts`

### 3a. Add new flow to VALID_FLOWS

```typescript
const VALID_FLOWS = new Set([
    'start_trading',
    'reconnect',
    'continue_onboarding',
    'verify_user_id',
    'fund_account',
    'go_home',
    'help_contact',
    'help_user_id',  // ← add this
]);
```

### 3b. Update UserContext interface

```typescript
export interface UserContext {
    onboarding_state: string | null;
    ssid_valid: number | null;
    has_ssid: boolean;
    demo_trade_count: number | null;
    tier: string;
    user_id_fail_count?: number;  // ← add this (optional for backward compat)
}
```

### 3c. Update system prompt

Add to the `Available flows` section in SYSTEM_PROMPT:
```
- help_user_id — User keeps failing User ID verification. They need help creating an account or admin assistance.
```

Add to `Rules` section:
```
7. If user is stuck on User ID verification and keeps failing → help_user_id
```

Add example message:
```
{"flow": "help_user_id", "message": "Having trouble with your User ID? Let's get you a fresh account 👇"}
```

### 3d. Update the context string passed to DeepSeek (line 90-96)

Add `user_id_fail_count`:
```typescript
const contextStr = [
    `User state: onboarding="${context.onboarding_state ?? 'none'}",`,
    `ssid_valid=${context.ssid_valid ?? 'null'},`,
    `has_ssid=${context.has_ssid},`,
    `demo_trade_count=${context.demo_trade_count ?? 0},`,
    `tier=${context.tier}`,
    context.user_id_fail_count ? `, user_id_fail_count=${context.user_id_fail_count}` : '',
].join(' ');
```

---

## Change 4: Add FLOW_BUTTONS entry in bot.ts

**File:** `src/bot.ts` (around line 130-138)

Add to `FLOW_BUTTONS`:
```typescript
    help_user_id:         { text: '🆕 Create Account', action: { url: AFFILIATE_LINK } },
```

---

## Verification

1. Build: `npx tsc --noEmit`
2. Restart: `pm2 restart iqbot-v3-bot --update-env`
3. Test: Send invalid User IDs 3+ times to the bot as Shara
   - First 2 attempts: normal retry message
   - 3rd attempt: should show LLM brain response with options
4. Check DB: `sqlite3 iqbot-v3.db "SELECT telegram_id, user_id_fail_count FROM onboarding_tracking WHERE user_id_fail_count > 0"`
