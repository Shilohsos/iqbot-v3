const fs = require('fs');
const js = fs.readFileSync('dist/bot.js', 'utf8');

// Find all MarkdownV2 messages - both template literals and regular strings
// Approach: find parse_mode: 'MarkdownV2' and backtrack to find the message text
const lines = js.split('\n');
let found = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("parse_mode: 'MarkdownV2'") || lines[i].includes('parse_mode:"MarkdownV2"')) {
        found++;
        // Backtrack up to 5 lines to find the message
        let context = '';
        for (let j = Math.max(0, i-5); j <= i; j++) {
            context += lines[j] + '\n';
        }
        console.log(`\n=== MSG ${found} (line ${i+1}) ===`);
        console.log(context.slice(-300));
    }
}
console.log(`\nTotal: ${found} MarkdownV2 messages`);
