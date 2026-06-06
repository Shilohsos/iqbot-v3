import { getConfig, getFunnelPipeline } from '../dist/db.js';

const url = getConfig('funnel_url') ?? 'Not set';
const p = getFunnelPipeline();
const pct = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) : '0.0';
const recentLines = p.recent_events.slice(0, 5).map(e =>
  `• ${e.event_type.replace(/_/g, ' ')}${e.source ? ` (${e.source.replace(/_/g, ' ')})` : ''} — ${e.created_at.slice(11, 16)}`
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

const buf = Buffer.from(msg, 'utf8');
console.log('Bytes:', buf.length);

// Check for Markdown-special chars near offset 509
const start = Math.max(0, 509 - 30);
const end = Math.min(buf.length, 509 + 30);
const snippet = buf.slice(start, end).toString('utf8');
console.log('Around 509:', JSON.stringify(snippet));

// Find any _ * ` [ in the whole message with their byte positions
for (let i = 0; i < msg.length; i++) {
  const c = msg[i];
  if ('_*`['.includes(c)) {
    const bytePos = Buffer.byteLength(msg.slice(0, i));
    const pre = msg[i-1] || 'START';
    const post = msg[i+1] || 'END';
    console.log(`  Byte ${bytePos}: '${c}' (before: '${pre}', after: '${post}')`);
  }
}
