import { createSdk } from './src/trade.js';
import { BalanceType } from './src/index.js';

const SSID = '23bcfb0d4feea0d60ea41147c189196n';

async function main() {
  const sdk = await createSdk(SSID);
  const balances = await sdk.balances();
  const all = balances.getBalances();
  
  console.log(`\n=== @sophia_ava24 LIVE BALANCE ===`);
  for (const b of all) {
    const typeName = b.type === 0 ? 'Practice' : b.type === 1 ? 'Real' : `Unknown(${b.type})`;
    console.log(`  ${typeName}: ${b.currency || 'USD'} ${b.amount}  (type=${b.type}, id=${b.id})`);
  }
  console.log(`BalanceType.Real = ${BalanceType.Real}`);
  console.log(`===========================\n`);
  process.exit(0);
}

setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 15000);
main();
