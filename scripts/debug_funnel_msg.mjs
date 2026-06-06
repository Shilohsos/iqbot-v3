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

// Check if this would parse as Telegram Markdown
// In Telegram Markdown mode, only _ * ` [ are special
// _ at word boundaries = italic, ** or * = bold, ` = code, [text](url) = link

console.log('=== MSG LENGTH:', msg.length, 'BYTES:', Buffer.byteLength(msg));
console.log();

// Check for unclosed *
let asteriskCount = 0;
for (const c of msg) if (c === '*') asteriskCount++;
console.log('Asterisks:', asteriskCount, '=>', asteriskCount % 2 === 0 ? 'PAIRED' : 'UNPAIRED');

// Check for [ without ]
let bracketDepth = 0;
let lastOpenBracket = -1;
for (let i = 0; i < msg.length; i++) {
  if (msg[i] === '[') { bracketDepth++; lastOpenBracket = i; }
  if (msg[i] === ']') bracketDepth--;
}
console.log('Bracket depth:', bracketDepth, bracketDepth === 0 ? 'OK' : 'UNCLOSED [' + ' at byte ' + Buffer.byteLength(msg.slice(0, lastOpenBracket)));

// Check if any URL in the message has _ that could be interpreted as italic
// Telegram Markdown usually requires _ at word boundaries
// But let's check
const urlMatch = msg.match(/https?:\/\/[^\s]+/g);
if (urlMatch) {
  for (const u of urlMatch) {
    if (u.includes('_')) console.log('URL with underscore:', u);
  }
}

// Simulate what Telegram's Markdown parser would do with special characters
// In Markdown mode: _ * ` [ are entity starters
const entities = [];
for (let i = 0; i < msg.length; i++) {
  const bytePos = Buffer.byteLength(msg.slice(0, i));
  if (msg[i] === '*' && (i === 0 || msg[i-1] === ' ' || msg[i-1] === '\n' || msg[i-1] === '\\')) {
    // Check if it could open bold
    const closing = msg.indexOf('*', i + 1);
    if (closing > i && closing - i < 50) {
      entities.push({ type: 'bold', open: bytePos, close: Buffer.byteLength(msg.slice(0, closing)) });
    }
  }
}
console.log();
console.log('Potential bold entities:', JSON.stringify(entities));
