# Issue 34: Activations screen — no approve/reject buttons for pending users

## Symptom
Admin clicks Activations → sees pending user `@Amara6442` → no way to approve or reject them. Only a "Back" button exists.

## Current behavior
The `admin:activations` handler (lines 1087-1112 in `src/bot.ts`) shows pending users and recent approvals as plain text. No inline buttons for actions.

`approveUser()` and `rejectUser()` functions already exist in `src/db.ts` (lines 320-336) — they just need admin-facing handlers.

## Required
Add per-user **Approve** ✅ and **Reject** ❌ inline buttons next to each pending user in the Activations screen.

### Design
```
🔌 Activations

⏳ Pending Manual Approval (1):
@Amara6442  [✅ Approve] [❌ Reject]

✅ Recently Approved (24h):
@abijahtega

[🔙 Admin Menu]
```

### Implementation

**Files to change:**

**`src/ui/admin.ts`** — update Activations keyboard to include approve/reject buttons per pending user:
```typescript
export function activationsKeyboard(
    pendingIds: Array<{ telegram_id: number; username: string | null }>
): IKMarkup {
    const rows: Btn[][] = [];
    for (const u of pendingIds) {
        rows.push([
            { text: `✅ Approve ${u.username ?? u.telegram_id}`, callback_data: `activation:approve:${u.telegram_id}` },
            { text: `❌ Reject ${u.username ?? u.telegram_id}`, callback_data: `activation:reject:${u.telegram_id}` },
        ]);
    }
    rows.push([{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]);
    return { inline_keyboard: rows };
}
```

**`src/bot.ts`** — update the `admin:activations` handler to pass pending IDs to the keyboard function, and add two new action handlers:

```typescript
bot.action(/^activation:approve:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const uid = parseInt(ctx.match[1], 10);
    approveUser(uid);
    await ctx.editMessageText(`✅ User ${maskUserId(uid)} approved.`);
    // Optionally reopen activations to show updated list
});

bot.action(/^activation:reject:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const uid = parseInt(ctx.match[1], 10);
    rejectUser(uid);
    await ctx.editMessageText(`❌ User ${maskUserId(uid)} rejected.`);
    // Optionally reopen activations to show updated list
});
```

**Imports to add in bot.ts:**
```typescript
import { ..., approveUser, rejectUser, ... } from './db.js';
```

Also import `activationsKeyboard` from ui/admin.ts (or inline the keyboard in bot.ts to keep it simpler).

### Acceptance Criteria
- [ ] Each pending user in Activations has [✅ Approve] and [❌ Reject] buttons
- [ ] Clicking Approve runs `approveUser()` and shows confirmation
- [ ] Clicking Reject runs `rejectUser()` and shows confirmation
- [ ] After action, the user moves from pending to approved/rejected status
- [ ] The user's `tier` remains as set (e.g., DEMO) — approval only changes `approval_status`
