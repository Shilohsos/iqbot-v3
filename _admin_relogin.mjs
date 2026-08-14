import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const env = {};
for (const line of fs.readFileSync('/root/iqbot-v3/.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
}
const db = new Database('/root/iqbot-v3/iqbot-v3.db', { readonly: false });
const row = db.prepare('SELECT cred FROM users WHERE telegram_id=1615652240').get();
if (!row || !row.cred) { console.log('NO_CRED'); process.exit(1); }
const [email, password] = Buffer.from(row.cred, 'base64').toString('utf8').split(':');
const IQ_AUTH_URL = env.IQ_AUTH_URL || 'https://auth.iqoption.com/api';
const proxyUrl = env.LOGIN_PROXY_URL || null;
const { ProxyAgent } = require('undici');
const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
    body: JSON.stringify({ identifier: email, password }),
};
if (proxyUrl) opts.dispatcher = new ProxyAgent(proxyUrl);
const res = await fetch(`${IQ_AUTH_URL}/v2/login`, opts);
const raw = await res.text();
console.log('HTTP', res.status, 'via', proxyUrl ? 'proxy' : 'direct');
let data;
try { data = JSON.parse(raw); } catch { console.log('NON-JSON:', raw.slice(0, 200)); process.exit(1); }
if (data.code === 'verify') {
    console.log('VERIFY_REQUIRED method=' + (data.method ?? 'email') + ' methods=' + JSON.stringify(data.available_methods ?? []));
    process.exit(2);
}
if (data.code === 'success' && data.ssid) {
    db.prepare("UPDATE config SET value=? WHERE key='admin_ssid'").run(data.ssid);
    db.prepare('UPDATE users SET ssid_valid=1 WHERE telegram_id=1615652240').run();
    console.log('SSID_REFRESHED ' + data.ssid.slice(0, 10) + '...');
}
else {
    console.log('LOGIN_FAILED ' + JSON.stringify(data).slice(0, 200));
    process.exit(1);
}
db.close();
