import { createSdk } from './node_modules/@quadcode-tech/client-sdk-js/dist/index.js';

const SSID = '23bcfb0d4feea0d60ea4be84a1ae7e87ab3235d2b2530c2ec24a6a8bb3f8f594';
const USER = '@sophia_ava24';

async function main() {
  console.log(`Checking live balance for ${USER}...`);
  try {
    const sdk = createSdk({
      ssid: SSID,
    });

    const balances = await sdk.balances();
    const all = balances.getBalances();

    for (const b of all) {
      const type = b.type === undefined || b.type === 0 ? 'Practice' : 'Real';
      console.log(`${type}: ${b.currency} ${b.amount} (id: ${b.id})`);
    }
  } catch (e) {
    console.error('ERROR:', e.message || e);
  }
  process.exit(0);
}

setTimeout(() => { console.error('TIMEOUT 12s'); process.exit(1); }, 12000);
main();
