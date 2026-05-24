# Patch: Fix audit SDK test — wrap top-level await in async IIFE

## Problem
The audit script (`scripts/audit.cjs`) generates a temp TypeScript file that uses top-level `await` statements. The installed `tsx` (via esbuild) doesn't support top-level await with the CJS output format, causing:

```
Error: Transform failed with 2 errors:
Top-level await is currently not supported with the "cjs" output format
```

## Fix
In `scripts/audit.cjs`, wrap the generated TypeScript code in an async IIFE so `await` is inside an async function context instead of at the module top level.

**Current code (lines 100-130):**
The generated TS code currently has `await` calls directly inside `try` blocks at the top level:

```ts
try {
    const sdk = await ClientSdk.create(...);    // ❌ top-level await
    await sdk.shutdown();                        // ❌ top-level await
} catch {}
```

**Fix:** Wrap the entire executable block in an async IIFE:

```ts
(async () => {
    try {
        const sdk = await ClientSdk.create(...);    // ✅ inside async function
        await sdk.shutdown();                        // ✅ inside async function
    } catch {}
    process.stdout.write(JSON.stringify(out) + '\n');
})();
```

### Specific changes in audit.cjs:

1. After line 98 (`const out: Record<string, any> = ...`), insert:
   ```
   (async () => {
   ```

2. Before the final `process.stdout.write(JSON.stringify(out) + '\\n')`, insert the closing:
   ```
   })();
   ```

3. Ensure `process.stdout.write(JSON.stringify(out) + '\\n')` is inside the IIFE (before the closing `})()`).

## Verification
1. Run `node scripts/audit.cjs`
2. SDK test section should complete without crash
3. Should show admin SSID status and valid/dead user counts
