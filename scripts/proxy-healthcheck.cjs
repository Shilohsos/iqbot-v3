#!/usr/bin/env node
// Proxy health check — runs every 30min via cron
// 2 consecutive failures → rotate to next proxy in pool
const fs = require('fs');
const path = require('path');
const { ProxyAgent } = require('undici');

const ENV_FILE = path.resolve(__dirname, '..', '.env');
const STATE_FILE = path.resolve(__dirname, '..', '.proxy-state.json');
const LOG_PREFIX = `[proxy-health ${new Date().toISOString()}]`;

const PROXY_POOL = [
  '89.32.200.192:6648',
  '154.6.11.116:5585',
  '82.23.221.140:6470',
  '31.58.24.215:6286',
  '104.239.44.239:6161',
  '181.214.13.60:5901',
  '166.88.83.42:6699',
  '45.38.78.64:6001',
  '104.143.244.125:6073',
  '192.177.103.211:6704',
];
const PROXY_CRED = 'pzxyatji:tqz8zcybhmj7';
const TEST_URL = 'https://auth.iqoption.com/api/v2/login';
const MAX_FAILURES = 2;

function log(msg) { console.log(`${LOG_PREFIX} ${msg}`); }

function readEnv() {
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  const match = raw.match(/^LOGIN_PROXY_URL=(.+)$/m);
  return match ? match[1].trim() : null;
}

function writeEnv(newUrl) {
  let raw = fs.readFileSync(ENV_FILE, 'utf8');
  if (raw.includes('LOGIN_PROXY_URL=')) {
    raw = raw.replace(/^LOGIN_PROXY_URL=.+$/m, `LOGIN_PROXY_URL=${newUrl}`);
  } else {
    raw += `\nLOGIN_PROXY_URL=${newUrl}\n`;
  }
  fs.writeFileSync(ENV_FILE, raw, 'utf8');
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { currentIndex: 0, consecutiveFailures: 0 }; }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function testProxy(proxyUrl) {
  try {
    const agent = new ProxyAgent(proxyUrl);
    const res = await fetch(TEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'test', password: 'test' }),
      dispatcher: agent,
      signal: AbortSignal.timeout(10000),
    });
    return res.status === 401 || res.status === 200;
  } catch {
    return false;
  }
}

async function main() {
  const state = readState();
  let idx = state.currentIndex;
  if (idx >= PROXY_POOL.length) idx = 0;

  const proxyHost = PROXY_POOL[idx];
  const proxyUrl = `http://${PROXY_CRED}@${proxyHost}`;
  const currentEnv = readEnv();

  // Ensure .env matches pool
  if (currentEnv !== proxyUrl) {
    log(`Syncing .env to pool[${idx}]: ${proxyHost}`);
    writeEnv(proxyUrl);
    require('child_process').execSync('pm2 restart iqbot-v3-bot --update-env', { stdio: 'pipe' });
    log('Bot restarted after env sync');
  }

  log(`Testing proxy[${idx}]: ${proxyHost}`);
  const ok = await testProxy(proxyUrl);

  if (ok) {
    state.consecutiveFailures = 0;
    log(` OK (failures reset)`);
  } else {
    state.consecutiveFailures++;
    log(` FAIL (${state.consecutiveFailures}/${MAX_FAILURES})`);

    if (state.consecutiveFailures >= MAX_FAILURES) {
      idx = (idx + 1) % PROXY_POOL.length;
      const nextHost = PROXY_POOL[idx];
      const nextUrl = `http://${PROXY_CRED}@${nextHost}`;
      log(`Rotating to pool[${idx}]: ${nextHost}`);
      writeEnv(nextUrl);
      state.currentIndex = idx;
      state.consecutiveFailures = 0;
      require('child_process').execSync('pm2 restart iqbot-v3-bot --update-env', { stdio: 'pipe' });
      log(`Bot restarted with new proxy: ${nextHost}`);
    }
  }

  writeState(state);
}

main().catch(e => log(`Unhandled error: ${e.message}`));
