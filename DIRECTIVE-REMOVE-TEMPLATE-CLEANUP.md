# IMPORTANT: Merge master first
## DIRECTIVE: REMOVE-OVERZEALOUS-TEMPLATE-CLEANUP
## Problem: The DELETE in seedTemplates() removes templates we want to keep

### What happened

The `DELETE FROM templates WHERE category IN (...)` runs unconditionally on every restart. It was meant to clean up junk categories that the SQL seed files re-insert. But many of those category names match templates we actually want to keep (like `bot_strategy`, `bot_not_working`, etc. — they were re-categorized during our cleanup).

Result: after deploy, only 34 templates survive instead of 78+. The missing categories include LLM brain templates that the LLM routing module uses.

### Fix

**File:** `src/db.ts` — `seedTemplates()` function

Remove the entire `DELETE` block. The guard (`if (cnt > 0) return`) alone is sufficient to prevent re-seeding on restart. No cleanup query needed.

```typescript
export function seedTemplates(): void {
    // Guard: skip re-seed if templates already exist
    const cnt = (db.prepare('SELECT COUNT(*) AS cnt FROM templates').get() as { cnt: number }).cnt;
    if (cnt > 0) {
        console.log(`[db] templates: ${cnt} rows (skipping re-seed)`);
        return;
    }
    // ... rest of existing seed logic unchanged
}
```

### Restoring missing templates from seed

After removing the DELETE, we also need to restore the LLM brain templates. The seed files contain many categories. We need to surgically INSERT only the categories our cleanup kept, without re-inserting the ones we deliberately removed (pricing_tiers, withdrawal, etc.).

**Add after the guard** (so it runs once on a fresh empty DB, and is a no-op on subsequent restarts):

```typescript
// After seed runs, remove categories we deliberately don't want
db.exec(`
    DELETE FROM templates WHERE category IN (
        'pricing_tiers', 'upgrade_migration', 'funding_deposit',
        'withdrawal', 'scam_legit', 'risk_safety'
    )
`);
```

Only keep the 6 truly unwanted categories. Remove all others from the list.

### Testing

1. Current DB has 34 templates. After fix, those 34 remain + the missing brain categories get restored (since DELETE no longer removes them).
2. Verify by restarting and checking template count — should be higher than 34.
3. Future restarts: guard fires (`cnt > 0`), seed is skipped, DELETE is gone — count stays stable.
