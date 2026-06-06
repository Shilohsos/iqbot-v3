import { getFunnelPipeline } from '../dist/db.js';

const p = getFunnelPipeline();
const recentLines = p.recent_events.slice(0, 5).map(e =>
  '• ' + e.event_type + (e.source ? ' (' + e.source + ')' : '') + ' — ' + e.created_at.slice(11, 16)
).join('\\n');

const msg = [
  '🔻 *Conversion Funnel*',
  '🌐 Landing Page: https://10xpremium.online/',
  '',
  '*📈 Today*',
  '👁️ Page Views: ' + p.page_views_today,
  '📥 Channel Joins: ' + p.channel_joins_today,
  '🔗 Connects: ' + p.connects_today,
  '💰 Funded: ' + p.funded_today,
  '',
  '*📊 Conversion Rates*',
  'Views → Joins: ' + ((p.channel_joins_today / p.page_views_today) * 100).toFixed(1) + '%',
  'Joins → Connects: ' + ((p.connects_today / p.channel_joins_today) * 100).toFixed(1) + '%',
  'Connects → Funded: ' + ((p.funded_today / p.connects_today) * 100).toFixed(1) + '%',
  '',
  '*📅 This Week*',
  '👁️ Views: ' + p.page_views_this_week,
  '📥 Joins: ' + p.channel_joins_this_week,
  '🔗 Connects: ' + p.connects_this_week,
  '💰 Funded: ' + p.funded_this_week,
  '',
  '*🕐 Recent Activity*',
  recentLines || '— none yet',
].join('\\n');

const buf = Buffer.from(msg, 'utf8');
console.log('Total bytes:', buf.length);

// Context around offset 509
const start = Math.max(0, 509 - 40);
const end = Math.min(buf.length, 509 + 40);
console.log('Context[509]:', JSON.stringify(buf.slice(start, end).toString('utf8')));

// Check for unclosed entities - scan for *, _, `, [
const asterisks = [...msg.matchAll(/\*/g)].map(m => m.index);
console.log('Asterisk positions (' + asterisks.length + '):', asterisks);
console.log('Paired:', asterisks.length % 2 === 0);

// Check if any _ is at word boundary (preceded by space or start)
let entityStart = null;
for (let i = 0; i < msg.length; i++) {
  const c = msg[i];
  if (c === '*') {
    if (entityStart === null) entityStart = i;
    else entityStart = null;
  }
}
console.log('Unclosed * at:', entityStart);

// Scan for potential MarkdownV2 chars that might be interpreted
// In Markdown mode: only _ * ` [ are special
const special = [];
for (let i = 0; i < msg.length; i++) {
  if ('_*`['.includes(msg[i])) {
    special.push({ idx: i, char: msg[i], byteIdx: Buffer.byteLength(msg.slice(0, i)) });
  }
}
console.log('Special chars at byte positions:', special.filter(s => s.byteIdx > 490 && s.byteIdx < 530));
