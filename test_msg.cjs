const msg = `🤖 *AI Trading* — Semi\\-auto trading \\- Fund *\\$10\\+* into IQ Option\\.`;
console.log('OUTPUT:', msg);
console.log('HEX:', Buffer.from(msg).toString('hex'));
// Check for unescaped reserved chars
const reserved = ['-', '+', '.', '!', '(', ')', '[', ']', '_', '*', '~', '>', '#', '=', '|', '{', '}'];
for (const ch of reserved) {
    for (let i = 0; i < msg.length; i++) {
        if (msg[i] === ch && (i === 0 || msg[i-1] !== '\\')) {
            console.log(`UNESCAPED '${ch}' at pos ${i}: ...${msg.substring(Math.max(0,i-5), i+5)}...`);
        }
    }
}
