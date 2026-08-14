const { createSdk } = require('./dist/trade.js');
const { runAdminAnalysis } = require('./dist/admin-analysis.js');
const { getAdminSsid } = require('./dist/db.js');

const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms)),
]);

(async () => {
  const ssid = getAdminSsid();
  const sdk = await createSdk(ssid);
  try {
    const actives = await withTimeout(sdk.blitzOptions(), 15000, 'blitzOptions');
    console.log('actives:', actives.length);
    for (const name of ['USDCAD-OTC', 'GBPJPY-OTC', 'GBPUSD-OTC']) {
      const active = actives.find(a => a.name === name);
      if (!active) { console.log(`${name}: NOT IN ACTIVES`); continue; }
      try {
        const candles = await withTimeout(sdk.candles(), 10000, 'candles facade');
        const hist = await withTimeout(candles.getCandles(active.id, 120, { count: 200 }), 15000, 'getCandles');
        const a = runAdminAnalysis(hist);
        console.log(`${name}: direction=${a.direction} confidence=${a.confidence}%`);
      } catch (e) { console.log(`${name}: analysis error: ${e.message}`); }
    }
  } finally {
    try { await sdk.shutdown(); } catch {}
    process.exit(0);
  }
})();
