import { StringSession as GramSession } from 'telegram/sessions/index.js';
import fs from 'fs';

const env = fs.readFileSync('/root/iqbot-v3/.env', 'utf8');
const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
const v3session = get('TELETHON_SESSION');

const relaySrc = fs.readFileSync('/root/10xrelay_bot/10xrelay.py', 'utf8');
const m = relaySrc.match(/SESSION_STRING\s*=\s*["']([^"']+)["']/);
const relaySession = m ? m[1] : '';

// GramJS decode returns the auth key as an array-like
const gKeyBytes = GramSession.decode(v3session);
const gHex = Buffer.from(gKeyBytes).toString('hex').slice(0, 32);
console.log('v3 key:', gHex, 'len:', gKeyBytes.length);

// Telethon v1: auth_key(256) + dc_id(4)
function telethonDecode(s) {
    const buf = Buffer.from(s, 'base64');
    if (buf.length >= 260) {
        return { authKey: buf.subarray(0, 256), dc: buf.readInt32LE(256) };
    }
    return null;
}
const td = telethonDecode(relaySession);
if (td) {
    const tHex = Buffer.from(td.authKey).toString('hex').slice(0, 32);
    console.log('relay key:', tHex, 'dc:', td.dc);
    console.log('SAME KEY:', gHex === tHex);
} else {
    console.log('relay decode failed, raw b64 len:', Buffer.from(relaySession, 'base64').length);
}
process.exit(0);
