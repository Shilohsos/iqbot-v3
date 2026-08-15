import { createRequire } from 'module';
const require = createRequire('/root/iqbot-v3/_seed_bot_a.mjs');
const Database = require('better-sqlite3');
const db = new Database('/root/iqbot-v3/iqbot-v3.db', { readonly: false });

const T = (buttons) => JSON.stringify(buttons);
const TRADE = [{ text: '✦ Trade Now', callback: 'ui:trade' }];

const templates = {
    A: { copy: '✦ Your streak is going cold\n\nThe engine just scanned {pair} — {confidence}%.\n\nIt won\u2019t wait forever.\n\nOne trade \u2500', buttons: T([TRADE]), image_file: 'a-streak-going-cold.jpg' },
    B: { copy: '✦ Your balance has been sitting still\n\nSince your last trade, the market kept moving.\n\nMoney at rest doesn\u2019t compound.\n\nStart now \u2500', buttons: T([TRADE]), image_file: 'b-capital-at-rest.jpg' },
    C: { copy: '✦ Opportunity closing soon\n\n{pair} · {tf}\n\nBot\u2019s read: {confidence}%\n\nWindow: {countdown} minutes \u2500', buttons: T([TRADE]), image_file: 'c-opportunity-closing.jpg' },
    D: { copy: '✦ {name} banked {amount} today\n\nSame engine. Same seat.\n\nThe next name on the board should be yours.\n\nTrade now \u2500', buttons: T([TRADE]), image_file: 'd-real-results.jpg' },
    E: { copy: '✦ {count} users fired live trades this hour\n\nNone of them were you. Yet.\n\nThe room is moving.\n\nJoin it \u2500', buttons: T([TRADE]), image_file: 'e-live-trades.jpg' },
    F: { copy: '✦ Up or down — your call\n\n{pair} · {tf}\n\nBot\u2019s read: {confidence}%\n\nDecide \u2500', buttons: T([TRADE]), image_file: 'f-up-or-down.jpg' },
    G: { copy: '✦ Access is by invitation only\n\nLink your IQ Option account — the door opens right after.\n\nTakes about 2 minutes \u2500', buttons: T([[{ text: '\u27e1 Connect Account', callback: 'ui:connect' }]]), image_file: 'g-invitation-only.jpg' },
    H: { copy: '✦ Every trade so far was practice money\n\nWhat if the last one was real?\n\nFund and find out \u2500', buttons: T([[{ text: '\u2726 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit' }]]), image_file: 'h-what-if-this-was-real.jpg' },
    I: { copy: '✦ TOP PICK — {pair}\n\nConfidence: {confidence}%\n\nThe engine\u2019s strongest read right now.\n\nTrade it \u2500', buttons: T([TRADE]), image_file: 'i-top-pick.jpg' },
    J: { copy: '✦ Shiloh is live right now\n\nWatching the market with the engine.\n\nJoin the room \u2500', buttons: T([[{ text: '\u27e2 Watch Live', url: 'https://t.me/xyachtclub' }]]), image_file: 'j-live-now.jpg' },
    K: { copy: '✦ Last trade: {days} days ago\n\nThe engine doesn\u2019t sleep.\n\nNeither should your balance \u2500', buttons: T([TRADE]), image_file: 'k-engine-doesnt-sleep.jpg' },
    L: { copy: '✦ Inside the circle, the engine moves daily\n\nWithdrawals. Live sessions. Signals.\n\nThe Yacht Club \u2500', buttons: T([[{ text: '\u27e2 Check the Yacht Club', url: 'https://t.me/xyachtclub' }]]), image_file: 'l-yacht-club.jpg' },
    M: { copy: '✦ Today\u2019s goal: +${goal}\n\nYou\u2019re at {progress}% of the way there.\n\nChase it \u2500', buttons: T([TRADE]), image_file: 'm-todays-goal.jpg' },
    N: { copy: '✦ LIMITED-TIME WINDOW\n\nAutopilot usually unlocks at $200 funded.\n\nRight now: {autospot} gets you in.\n\nFund & lock it in \u2500', buttons: T([[{ text: '\u2726 Fund & Unlock', url: 'https://iqoption.com/pwa/payments/deposit' }]]), image_file: 'n-giveaway-open.jpg' },
    O: { copy: '✦ Sequence done\n\nLosses don\u2019t end the story.\n\nNew setup loading — the engine already recalibrated.\n\nNext \u2500', buttons: T([TRADE]), image_file: 'o-new-setup-loading.jpg' },
    Q1: { copy: '✦ One step away\n\nYour IQ Option account just needs linking — the door is already open.\n\nFinish it \u2500', buttons: T([[{ text: '\u27e1 Connect Account', callback: 'ui:connect' }]]), image_file: 'q1-one-step.jpg' },
    Q2: { copy: '✦ Your access is waiting\n\nYou started the setup but never finished. Connect and it\u2019s yours.\n\nTake it \u2500', buttons: T([[{ text: '\u27e1 Connect Account', callback: 'ui:connect' }]]), image_file: 'q2-waiting.jpg' },
    Q3: { copy: '✦ 2 minutes\n\nThat\u2019s all that sits between you and the engine.\n\nLink your account now \u2500', buttons: T([[{ text: '\u27e1 Connect Account', callback: 'ui:connect' }]]), image_file: 'q3-two-minutes.jpg' },
    R: { copy: '✦ Almost there\n\nYour account is linked — your access is being finalized.\n\nTap below and admin will fast-track you \u2500', buttons: T([[{ text: '\u27e1 Notify Admin', url: 'https://t.me/shiloh_is_10xing' }]]), image_file: 'q2-waiting.jpg' },
    P: { copy: '✦ LIMITED-TIME WINDOW\n\nPrivate Trader usually unlocks at $50 funded.\n\nRight now: {spot} gets you in.\n\nFund & lock it in \u2500', buttons: T([[{ text: '\u2726 Fund & Unlock', url: 'https://iqoption.com/pwa/payments/deposit' }]]), image_file: 'n-giveaway-open.jpg' },
};

const upsert = db.prepare(`INSERT INTO bot_a_templates (key, copy, buttons, image_file) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET copy=excluded.copy, buttons=excluded.buttons, image_file=excluded.image_file`);
for (const [k, v] of Object.entries(templates)) {
    upsert.run(k, v.copy, v.buttons, v.image_file);
}

const pools = {
    names: ['Chen W.', 'Kemi B.', 'Tunde A.', 'Amara O.', 'David K.', 'Chinedu E.', 'Fatima S.', 'Samuel O.', 'Grace A.', 'Yusuf M.'],
    amounts: ['+$540', '+$410', '+$318', '+$1,240', '+$762', '+$215', '+$980', '+$1,520', '+$480', '+$655'],
    spots: ['$10', '$15', '$20', '$25', '$30'],
    autospots: ['$50', '$75', '$100', '$125', '$150'],
};
const poolUpsert = db.prepare(`INSERT INTO bot_a_pools (key, items) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET items=excluded.items`);
for (const [k, items] of Object.entries(pools)) poolUpsert.run(k, JSON.stringify(items));

console.log(`seeded ${Object.keys(templates).length} templates + ${Object.keys(pools).length} pools`);
db.close();
