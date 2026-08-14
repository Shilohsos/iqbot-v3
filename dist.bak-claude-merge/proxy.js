import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Mirrors scripts/proxy-healthcheck.cjs — same pool, credentials, and state file
// so the cron health-check and the in-process rotation stay in sync via .proxy-state.json.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_FILE = path.resolve(__dirname, '..', '.env');
const STATE_FILE = path.resolve(__dirname, '..', '.proxy-state.json');
const PROXY_POOL = [
    '89.32.200.192:6648',
    '154.6.11.116:5585',
    '82.23.221.140:6470',
    '89.45.125.59:5785',
    '31.58.24.215:6286',
    '62.105.202.3:5646',
    '104.239.44.239:6161',
    '192.177.103.211:6704',
    '181.214.13.60:5901',
    '104.143.244.125:6073',
    '166.88.83.42:6699',
    '31.59.33.26:6602',
    '104.239.37.62:5714',
    '154.6.59.166:6634',
    '82.23.222.235:6541',
    '209.127.183.146:5520',
    '104.233.15.248:5971',
    '45.38.78.64:6001',
    '104.253.219.34:6443',
    '46.202.68.180:7925',
    '173.0.10.224:6400',
    '92.113.246.129:5714',
    '161.123.130.227:5898',
    '104.143.224.146:6007',
    '107.175.56.130:6403',
    '82.22.210.134:7976',
    '104.238.8.179:6037',
    '45.95.13.19:5704',
    '173.239.219.59:5968',
    '107.174.136.248:6190',
    '172.102.223.100:5611',
    '213.169.229.106:7246',
    '213.169.215.67:5207',
    '194.116.250.231:6689',
    '82.24.239.145:7002',
    '82.21.218.45:6397',
    '107.175.56.193:6466',
    '193.187.114.84:6099',
    '82.119.203.232:6376',
    '191.96.130.15:5778',
    '82.24.249.150:5987',
    '45.150.177.205:5578',
    '108.165.63.76:5813',
    '198.23.214.130:6397',
    '191.101.26.110:5849',
    '45.150.176.175:6048',
    '45.61.121.145:6744',
    '142.147.244.110:6354',
    '142.202.255.21:6261',
    '172.84.191.173:7651',
    '82.24.239.120:6977',
    '45.61.125.187:6198',
    '85.198.45.201:6125',
    '161.123.65.134:6843',
    '148.135.191.12:5571',
    '161.123.115.248:5269',
    '216.173.72.29:6648',
    '38.154.206.27:9518',
    '89.249.192.218:6617',
    '45.147.187.56:6429',
    '166.88.169.226:6833',
    '154.6.116.248:6217',
    '173.211.68.11:6293',
    '46.203.159.115:6716',
    '171.22.248.251:6143',
    '191.96.202.58:6104',
    '204.93.187.198:8208',
    '45.43.83.14:6297',
    '64.137.89.177:6250',
    '154.29.235.136:6477',
    '185.171.254.32:6064',
    '192.177.103.186:6679',
    '84.33.241.65:6422',
    '80.96.70.36:6026',
    '23.26.94.125:6107',
    '152.232.121.179:6071',
    '45.41.179.156:6691',
    '107.181.142.112:5705',
    '171.22.251.85:5615',
    '216.74.114.248:6531',
    '107.175.208.25:5966',
    '45.43.83.210:6493',
    '142.147.128.73:6573',
    '91.123.10.76:6618',
    '92.112.236.226:6658',
    '31.59.18.129:6710',
    '31.58.20.147:5831',
    '82.22.215.106:7437',
    '104.239.81.4:6539',
    '136.0.108.160:5836',
    '46.202.248.123:8384',
    '107.174.194.124:5566',
    '204.93.187.13:8023',
    '185.72.240.44:7080',
    '154.29.235.219:6560',
    '140.99.193.99:7477',
    '82.26.221.220:5561',
    '45.56.175.72:5746'
];
const PROXY_CRED = 'pzxyatji:tqz8zcybhmj7';
let currentProxyUrl = process.env.LOGIN_PROXY_URL;
let rotationInFlight = false;
/** Current proxy URL — reflects in-process rotations without a restart. */
export function getProxyUrl() {
    return currentProxyUrl;
}
function readState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    catch {
        return { currentIndex: 0, consecutiveFailures: 0 };
    }
}
function writeState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}
function writeEnv(newUrl) {
    let raw = fs.readFileSync(ENV_FILE, 'utf8');
    if (raw.includes('LOGIN_PROXY_URL=')) {
        raw = raw.replace(/^LOGIN_PROXY_URL=.+$/m, `LOGIN_PROXY_URL=${newUrl}`);
    }
    else {
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
export async function triggerProxyRotation() {
    if (rotationInFlight)
        return;
    rotationInFlight = true;
    try {
        const state = readState();
        const nextIdx = ((state.currentIndex ?? 0) + 1) % PROXY_POOL.length;
        const nextUrl = `http://${PROXY_CRED}@${PROXY_POOL[nextIdx]}`;
        writeEnv(nextUrl);
        writeState({ currentIndex: nextIdx, consecutiveFailures: 0 });
        currentProxyUrl = nextUrl;
        console.log(`[proxy] rotated to pool[${nextIdx}]: ${PROXY_POOL[nextIdx]} (in-process, no restart)`);
    }
    catch (err) {
        console.error(`[proxy] rotation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    finally {
        rotationInFlight = false;
    }
}
