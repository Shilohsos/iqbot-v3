const msg = 
`*📹 How to fund & withdraw*\\\n` +
`[Watch video](https://youtu.be/b0s1lnZgqAI?si=bGWHTnsA7qIujtMc)\n\n` +
`*Q: What is Smart Recovery?*\\\n` +
`If a trade loses, the bot doubles the next stake to recover the loss\\. Up to 6 rounds\\.\n\n` +
`*Q: Demo vs Live?*\\\n` +
`Demo uses practice balance\\. Live uses your real IQ Option balance\\.\n\n` +
`*Q: How do I withdraw?*\\\n` +
`All funds stay in your IQ Option account — withdraw directly from there\\.\n\n` +
`*Q: Why is my session expired?*\\\n` +
`IQ Option sessions expire after inactivity\\. Use /connect to reconnect\\.\n\n` +
`*Q: How do I upgrade my tier?*\\\n` +
`Deposit \\$10\\+ for PRO or \\$50\\+ for MASTER\\. Your tier upgrades automatically\\.`;

console.log('OUTPUT:');
console.log(msg);
console.log('\n--- Checking reserved chars ---');
const reserved = ['-', '+', '.', '!'];
for (const ch of reserved) {
    for (let i = 0; i < msg.length; i++) {
        if (msg[i] === ch && (i === 0 || msg[i-1] !== '\\')) {
            console.log(`UNESCAPED '${ch}' at pos ${i}: ...${msg.substring(Math.max(0,i-10), i+10).replace(/\n/g,'\\n')}...`);
        }
    }
}
