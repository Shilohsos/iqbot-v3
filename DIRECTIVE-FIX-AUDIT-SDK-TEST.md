# Patch: Fix audit script SDK test — replace `require('dist/')` with `tsx`

## Problem
The audit script (`scripts/audit.cjs`) crashes on the SDK test section because the bot runs via `tsx` (TypeScript executor) and `dist/` doesn't exist. Line 90-91 tries to `require()` compiled JS files that were never built:

```js
const { ClientSdk, SsidAuthMethod } = require(path.join(BOT_DIR, 'dist/index.js'));
const { WS_URL, PLATFORM_ID, IQ_HOST } = require(path.join(BOT_DIR, 'dist/protocol.js'));
```

## Fix
Replace the SDK test section (lines 86-124) with a child_process spawn of `tsx` that runs a small inline TypeScript snippet.

1. Convert the SDK test block to spawn `npx tsx -e "..."` with the TypeScript code passed via `-e`
2. Capture stdout/stderr, parse the JSON result
3. Keep the same reporting format (valid/dead counts, admin SSID check, individual user results)

The inline script should:
- Import `ClientSdk`, `SsidAuthMethod` from `src/` (TypeScript source)
- Import `WS_URL`, `PLATFORM_ID`, `IQ_HOST` from `src/protocol.ts`
- Test admin fallback SSID from env
- Test random user SSIDs (same logic as current)
- Output JSON with results for the parent process to parse

## Alternative (simpler)
If the above is too complex, just wrap the entire SDK section in a try/catch that calls:

```bash
cd /root/iqbot-v3 && npx tsx -e "
const { ClientSdk, SsidAuthMethod } = require('./src/index.ts');
...
"
```

and parse the output.

## Verification
- Run `node scripts/audit.cjs` — SDK test section should complete without crash
- Should show valid/dead SSID counts
- Admin fallback SSID should be tested
