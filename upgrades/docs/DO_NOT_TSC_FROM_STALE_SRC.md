# CRITICAL
Until Phase 1 reunification is complete:
- `src/bot.ts` is STALE vs production `dist/bot.js`
- Running bare `npx tsc` will DESTROY live settlement patches
- Build only new modules: `npx tsc src/trade-core.ts src/gale-engine.ts --outDir dist --esModuleInterop --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck`
- Or use upgrades/build-core.sh
