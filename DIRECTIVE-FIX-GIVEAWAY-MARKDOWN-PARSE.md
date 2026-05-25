# DIRECTIVE: Fix Giveaway Detail — Markdown Parse Error on Underscores

## Problem
Giveaway detail view (`giveaway_view:{id}`) fails silently with:
```
400: Bad Request: can't parse entities: Can't find end of the entity at byte offset 167
```

## Root Cause
Line 2334 inserts raw `criteria_type` into a Markdown-parsed message. When `criteria_type` contains underscores (e.g., `new_user`, `min_balance`, `top_traders`), Telegram's MarkdownV1 parser treats `_` as italic start. No closing `_` → parse error → message fails.

```ts
event.criteria_type ? `Criteria: ${event.criteria_type} = ${event.criteria_value ?? ''}` : '',
// Produces: "Criteria: new_user = 2" → new_ starts italic → broken
```

## Fix
**Option A (quick):** Escape underscores in the criteria line:
```ts
event.criteria_type ? `Criteria: ${event.criteria_type.replace(/_/g, '\\_')} = ${event.criteria_value ?? ''}` : '',
```

**Option B (comprehensive):** Escape all user-supplied fields (title, description, criteria_type, criteria_value) that might contain Markdown special chars. Add a helper:
```ts
function escapeMd(text: string): string {
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
```
Then wrap all dynamic fields: `escapeMd(event.title)`, `escapeMd(event.criteria_type)`, etc.

## Also
Same issue could affect other Markdown-parsed messages using raw DB fields — search for `parse_mode: 'Markdown'` combined with user-supplied strings (especially giveaway titles, descriptions, criteria values, and anything containing `_`, `*`, `[`, `]`, `` ` ``).
