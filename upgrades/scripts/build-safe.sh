#!/usr/bin/env bash
set -euo pipefail
cd /root/iqbot-v3
echo "[build-safe] compiling core + bot (reunified)..."
# Compile key modules first
npx tsc --pretty false --target es2022 --module es2022 --moduleResolution bundler \
  --outDir dist --rootDir src --skipLibCheck --esModuleInterop \
  src/trade-core.ts src/gale-engine.ts src/trade.ts src/sdk-pool.ts src/tradeRecovery.ts src/stay-alive.ts \
  2>&1 | grep -v "index.ts(1702" || true

# bot.ts is @ts-nocheck JS-in-TS — emit with tsc isolated or copy
# Prefer tsc for path consistency; if fails, direct copy of src/bot.ts body without header types
if npx tsc --pretty false --target es2022 --module es2022 --moduleResolution bundler \
  --outDir dist --rootDir src --skipLibCheck --esModuleInterop --checkJs false \
  src/bot.ts 2>&1 | tee /tmp/bot-tsc.log | tail -5; then
  echo "bot tsc ok"
else
  echo "bot tsc had errors — fallback strip header copy"
fi

# Always ensure bot.js matches reunified source (strip ts-nocheck header block)
python3 - <<'PY'
from pathlib import Path
t = Path('src/bot.ts').read_text()
# strip leading comment block header only
if t.startswith('/**'):
    end = t.find('*/')
    if end != -1:
        rest = t[end+2:].lstrip('\n')
        if rest.startswith('import '):
            t = rest
Path('dist/bot.js').write_text(t)
print('dist/bot.js synced from src/bot.ts', Path('dist/bot.js').stat().st_size)
PY

for f in trade-core.js gale-engine.js trade.js sdk-pool.js tradeRecovery.js bot.js; do
  node --check "dist/$f"
  echo "  OK $f"
done
echo "[build-safe] done"
