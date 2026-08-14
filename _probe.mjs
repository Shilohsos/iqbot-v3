// Live probe: what confidence does the PRO engine return for Shara's 3 assets at 2m?
import { createSdk } from './dist/trade.js';
import { runAdminAnalysis } from './dist/admin-analysis.js';
import { getAdminSsid } from './dist/db.js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(readFileSync('/root/iqbot-v3/.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const ssid = getAdminSsid() || env.IQ_SSID;

const assets = ['USDCAD-OTC', 'GBPJPY-OTC', 'GBPUSD-OTC'];
const tf = 120;

const sdk = await createSdk(ssid);
try {
  const actives = await sdk.blitzOptions();
  for (const name of assets) {
    const active = actives.find(a => a.name === name);
    if (!active) { console.log(`${name}: NOT IN ACTIVES`); continue; }
    try {
      const candles = await sdk.candles();
      const hist = await candles.getCandles(active.id, tf, { count: 200 });
      const a = runAdminAnalysis(hist);
      console.log(`${name}: direction=${a.direction} confidence=${a.confidence}% (score=${a.score})`);
    } catch (e) { console.log(`${name}: analysis error: ${e.message}`); }
  }
} finally {
  try { await sdk.shutdown(); } catch {}
  process.exit(0);
}
