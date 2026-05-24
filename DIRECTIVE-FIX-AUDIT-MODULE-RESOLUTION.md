# Patch: Fix audit SDK module resolution — temp file inside project dir

## Problem
The audit script creates the temp TypeScript file in `/tmp/` which causes two failures:
1. `better-sqlite3` module can't be resolved (it's in the project's `node_modules/`, not global)
2. Absolute paths in imports (e.g. `from '/root/iqbot-v3/src/index.ts'`) work but relative is cleaner

Error:
```
Error: Cannot find module 'better-sqlite3'
```

## Fix
Two changes in `scripts/audit.cjs`:

### 1. Create temp file inside project directory
Change the temp file path from `/tmp/` to `BOT_DIR`:
```js
const tmpFile = path.join(BOT_DIR, `tmp_sdk_test_${Date.now()}.ts`);
```

### 2. Use relative imports in generated TypeScript
Change the import paths from absolute to relative:
```ts
// Before:
import { ClientSdk, SsidAuthMethod } from '/root/iqbot-v3/src/index.ts';
import { WS_URL, PLATFORM_ID, IQ_HOST } from '/root/iqbot-v3/src/protocol.ts';
const env = readFileSync('/root/iqbot-v3/.env', 'utf-8');
new Database('/root/iqbot-v3/iqbot-v3.db');

// After (relative to BOT_DIR):
import { ClientSdk, SsidAuthMethod } from './src/index.ts';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './src/protocol.ts';
const env = readFileSync('./.env', 'utf-8');
new Database('./iqbot-v3.db');
```

### 3. (Optional) Remove `env: { ...process.env }` from spawnSync
Not strictly necessary but cleaner — `cwd: BOT_DIR` is sufficient with relative paths.

## Verification
```bash
cd /root/iqbot-v3 && node scripts/audit.cjs
```
SDK section should show:
```
✅ Admin fallback SSID: EXPIRED (or VALID)
✅ Sample: N valid / M dead (X not tested)
```

No crash. No "Cannot find module" or "Transform failed" errors.
