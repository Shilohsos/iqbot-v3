import { getConfig, getFunnelPipeline } from '../dist/db.js';

const url = getConfig('funnel_url') ?? 'Not set';
const p = getFunnelPipeline();
const pct = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) : '0.0';
const recentLines = p.recent_events.slice(0, 5).map(e =>
  `• ${e.event_type}${e.source ? ` (${e.source})` : ''} — ${e.created_at.slice(11, 16)}`
).join('\\n');

const msg = [
  `🔻 *Conversion Funnel*`,
  `🌐 Landing Page: ${url}`,
  ``,
  `*📈 Today*`,
  `👁️ Page Views: ${p.page_views_today}`,
  `📥 Channel Joins: ${p.channel_joins_today}`,
  `🔗 Connects: ${p.connects_today}`,
  `💰 Funded: ${p.funded_today}`,
  ``,
  `*📊 Conversion Rates*`,
  `Views → Joins: ${pct(p.channel_joins_today, p.page_views_today)}%`,
  `Joins → Connects: ${pct(p.connects_today, p.channel_joins_today)}%`,
  `Connects → Funded: ${pct(p.funded_today, p.connects_today)}%`,
  ``,
  `*📅 This Week*`,
  `👁️ Views: ${p.page_views_this_week}`,
  `📥 Joins: ${p.channel_joins_this_week}`,
  `🔗 Connects: ${p.connects_this_week}`,
  `💰 Funded: ${p.funded_this_week}`,
  ``,
  `*🕐 Recent Activity*`,
  recentLines || '— none yet',
].join('\\n');

// Use actual newlines (what it should be)
const msg2 = [
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
  recentLines || '— none yet',
].join('\n');

// Check if underscores could trigger italic in Telegram Markdown
// Telegram Markdown treats _ as italic ONLY at word boundaries
// But let's check if any event_type or source has _ at word boundary
for (const e of p.recent_events.slice(0, 5)) {
  const line = `• ${e.event_type}${e.source ? ` (${e.source})` : ''} — ${e.created_at.slice(11, 16)}`;
  // Check if any _ is preceded by space or start of string
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '_' && (i === 0 || line[i-1] === ' ')) {
      console.log('WORD BOUNDARY _ in line:', line);
    }
  }
}

console.log('=== LITERAL \\n message ===');
console.log('Length:', msg.length, 'Bytes:', Buffer.byteLength(msg));
console.log('Raw excerpt (bytes 505-515):', JSON.stringify(Buffer.from(msg).slice(505, 515).toString()));
console.log('Asterisks:', (msg.match(/\*/g) || []).length, '(should be even)');
console.log();

console.log('=== ACTUAL newline message ===');
console.log(msg2);
console.log();
console.log('Asterisks in actual-newline version:', (msg2.match(/\*/g) || []).length, '(should be even)');
