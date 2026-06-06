import { getConfig, getFunnelPipeline } from '../dist/db.js';

const url = getConfig('funnel_url') ?? 'Not set';
const p = getFunnelPipeline();
const pct = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) : '0.0';
const recentLines = p.recent_events.slice(0, 5).map(e =>
  `• ${e.event_type.replace(/_/g, ' ')}${e.source ? ` (${e.source})` : ''} — ${e.created_at.slice(11, 16)}`
).join('\\n');

const msg = [
  `🔻 *Conversion Funnel*`,
  `🌐 Landing Page: ${url}`,
  '',
  `*📈 Today*`,
  `👁️ Page Views: ${p.page_views_today}`,
  `📥 Channel Joins: ${p.channel_joins_today}`,
  `🔗 Connects: ${p.connects_today}`,
  `💰 Funded: ${p.funded_today}`,
  '',
  `*📊 Conversion Rates*`,
  `Views → Joins: ${pct(p.channel_joins_today, p.page_views_today)}%`,
  `Joins → Connects: ${pct(p.connects_today, p.channel_joins_today)}%`,
  `Connects → Funded: ${pct(p.funded_today, p.connects_today)}%`,
  '',
  `*📅 This Week*`,
  `👁️ Views: ${p.page_views_this_week}`,
  `📥 Joins: ${p.channel_joins_this_week}`,
  `🔗 Connects: ${p.connects_this_week}`,
  `💰 Funded: ${p.funded_this_week}`,
  '',
  `*🕐 Recent Activity*`,
  recentLines || '- none yet',
].join('\\n');

// Check total bytes
console.log('Bytes:', Buffer.byteLength(msg));

// Check all special chars and their byte positions
for (let i = 0; i < msg.length; i++) {
  const c = msg[i];
  if ('_*`['.includes(c)) {
    console.log(`Char '${c}' at text pos ${i}, byte pos ${Buffer.byteLength(msg.slice(0, i))}`);
  }
}

// Count asterisks
const ast = [...msg.matchAll(/\*/g)];
console.log('Asterisks:', ast.length, ast.length % 2 === 0 ? 'PAIRED' : 'UNPAIRED');
if (ast.length % 2 !== 0) {
  console.log('UNPAIRED! Last at byte pos:', Buffer.byteLength(msg.slice(0, ast[ast.length-1].index)));
}
