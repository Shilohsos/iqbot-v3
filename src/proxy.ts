import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Mirrors scripts/proxy-healthcheck.cjs — same pool, credentials, and state file
// so the cron health-check and the in-process rotation stay in sync via .proxy-state.json.
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ENV_FILE   = path.resolve(__dirname, '..', '.env');
const STATE_FILE = path.resolve(__dirname, '..', '.proxy-state.json');

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

let currentProxyUrl: string | undefined = process.env.LOGIN_PROXY_URL;
let rotationInFlight = false;

/** Current proxy URL — reflects in-process rotations without a restart. */
export function getProxyUrl(): string | undefined {
    return currentProxyUrl;
}

interface ProxyState { currentIndex: number; consecutiveFailures: number; }

function readState(): ProxyState {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as ProxyState; }
    catch { return { currentIndex: 0, consecutiveFailures: 0 }; }
}

function writeState(state: ProxyState): void {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function writeEnv(newUrl: string): void {
    let raw = fs.readFileSync(ENV_FILE, 'utf8');
    if (raw.includes('LOGIN_PROXY_URL=')) {
        raw = raw.replace(/^LOGIN_PROXY_URL=.+$/m, `LOGIN_PROXY_URL=${newUrl}`);
    } else {
        raw += `\nLOGIN_PROXY_URL=${newUrl}\n`;
    }
    fs.writeFileSync(ENV_FILE, raw, 'utf8');
}

/**
 * Rotate to the next proxy in the pool. Updates .env + .proxy-state.json for
 * persistence (and so the health-check cron sees the same index), and swaps the
 * in-memory URL so the NEXT login uses it immediately — no pm2 restart, which
 * would otherwise drop active trades and sessions. Fire-and-forget; guarded
 * against concurrent rotation so a burst of failures rotates only once.
 */
export async function triggerProxyRotation(): Promise<void> {
    if (rotationInFlight) return;
    rotationInFlight = true;
    try {
        const state = readState();
        const nextIdx = ((state.currentIndex ?? 0) + 1) % PROXY_POOL.length;
        const nextUrl = `http://${PROXY_CRED}@${PROXY_POOL[nextIdx]}`;
        writeEnv(nextUrl);
        writeState({ currentIndex: nextIdx, consecutiveFailures: 0 });
        currentProxyUrl = nextUrl;
        console.log(`[proxy] rotated to pool[${nextIdx}]: ${PROXY_POOL[nextIdx]} (in-process, no restart)`);
    } catch (err) {
        console.error(`[proxy] rotation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        rotationInFlight = false;
    }
}
