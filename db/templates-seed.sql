-- Templates Schema + Seed Data for IQ Bot V3 LLM Brain
-- Claude: Include this in db.ts as a bootstrap function (seedTemplates())
-- That runs: CREATE TABLE IF NOT EXISTS... then INSERT OR IGNORE...

CREATE TABLE IF NOT EXISTS templates (
    key         TEXT PRIMARY KEY,
    category    TEXT NOT NULL,
    state       TEXT,
    message     TEXT NOT NULL,
    media_file_id TEXT,
    button_text TEXT,
    button_url  TEXT,
    auto_delete INTEGER NOT NULL DEFAULT 1,
    delay_sec   INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Onboarding entry templates (state-specific)
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('entry_welcome_1', 'onboarding_entry', 'entry', '@username You just secured your access to the hottest trading bot in the industry right now!\n\nNo jokes! On your command this bot can print you more money than you can imagine.\n\nThe bot is called THE 10x SPECIAL BOT.', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('entry_welcome_2', 'onboarding_entry', 'entry', 'What can 10x bot do? 👾\n\nThe 10x bot is the smartest trading bot right now for trading IQ options OTC assets.\n\n🟣Scans the market in real time\n🟣Detects winning setups\n🟣Executes smart trades automatically\n\nYou relax while 10x AI does the work. 🤖\n\nDEMO — Practice risk-free\nPro — Best for $10+ accounts\nMaster — $50+ capital • Multiple trades • Advanced AI Analysis\n\n✅Smart Recovery System\n✅OTC Pairs Supported\n✅Direct Withdrawals', 0, 5);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('entry_branch_question', 'onboarding_entry', 'entry_branch_sent', 'Before we proceed any further! Are you new to trading or this is your first time hearing about trading?', 1, 5);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('new_trader_video', 'onboarding_entry', 'new_trader_video_sent', 'Alright @username, since you''re new... strap in. 🚀\n\nBefore anything else, I need you to watch this short video.\n\nIt''ll show you:\n🎬 What IQ Option is\n💳 How to create and fund your account\n🤖 How to access the 10x Special Bot\n\n5 minutes. That''s all it takes to understand everything you need.\n\n👇 Watch the video below:\n[video link placeholder]', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('experienced_branch', 'onboarding_entry', 'experienced_branch_sent', 'You''ve traded before? Say less. 💜\n\nWe''re skipping the basics.\n\n👇 Do you have an IQ Option account or not?', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('experienced_have_one', 'onboarding_entry', 'experienced_have_one_sent', 'Bet. Let''s link it up.\n\nDrop your IQ Option User ID 👇', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('experienced_need_new', 'onboarding_entry', 'new_account_created', 'No problem @username. 💜\n\nTap the button below to create your free IQ Option account. I''ll wait right here 👇', '🆕 Create Account', 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('after_video_account', 'onboarding_entry', 'after_video_account_sent', 'Let''s get this money @username. 💜\n\nFirst thing — you need an IQ Option account to use the bot.\n\n👇 Sign up here (2 minutes):\nhttps://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue\n\nOnce you''re done, drop your User ID below so I can verify you.', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('verify_success', 'onboarding_entry', 'awaiting_email', '✅ Account verified! You''re good to go.\n\n📧 Now enter your IQ Option email:', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('awaiting_password', 'onboarding_entry', 'awaiting_password', '🔑 Now enter your password:', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('connected_success', 'onboarding_entry', 'connected', '✅ Connected @username! 💜\n\n💰 Practice: $10,000.00\n\nYou''re now locked in. The 10x Special Bot is live and ready.\n\n👇 Tap below to take your first trade.', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('verify_fail_1', 'onboarding_entry', 'awaiting_user_id', '❌ We couldn''t verify that User ID @username.\n\nDouble-check and send it again 👇', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('verify_fail_2', 'onboarding_entry', 'awaiting_user_id', 'Still not matching @username. Did you create your account through the link we provided?\n\n1️⃣ Tap the Create Account button below\n2️⃣ Use the same email you signed up with\n3️⃣ Send your new User ID here 👇', '🆕 Create Account', 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue', 0, 0);

-- Re-engagement followups (state-specific)
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reengage_entry_stuck', 'reengage', 'entry_branch_sent', '@username people are literally printing money with 10x right now.\n\nCheck this out 👆\n\nWhile you''re sitting here deciding, someone just cashed out.\n\n👇 You new or you''ve traded before?', 1, 21600);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reengage_video_stuck', 'reengage', 'new_trader_video_sent', '@username still haven''t watched the video?\n\nReal 10x users don''t wait. They stack.\n\n👇 5 minutes and you''ll understand everything:\n[video link]\n\nExternal proof:\n📱 TikTok: [link]\n📸 Instagram: [link]', 1, 21600);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reengage_userid_stuck', 'reengage', 'awaiting_user_id', '@username while you''re holding your User ID...\n\nSomeone else just hit +$2,400 today using 10x.\n\nYour account is 2 minutes away from being in that same leaderboard.\n\nDrop your User ID 👇', 1, 21600);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reengage_email_stuck', 'reengage', 'awaiting_email', '@username your account is verified. Door is open.\n\nJust need your email and you''re in.\n\nCheck what other 10x users are pulling daily 📸👇\n📱 TikTok: [link]\n📸 Instagram: [link]\n\nDrop that email.', 1, 21600);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reengage_password_stuck', 'reengage', 'awaiting_password', '@username one password away from being locked in.\n\nThe bot is live. Signals are hot.\n\nDon''t sit this one out. 🔑', 1, 21600);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reengage_never_traded', 'reengage', 'connected', '@username you''re connected but you haven''t taken a single trade yet.\n\nWhile you wait, 10x users are stacking daily.\n\n📱 See what they''re saying: [link]\n📸 Real results: [link]\n\n👇 Tap below. First trade is on the house.', 1, 21600);

-- Funding sequence (category = funding)
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_win_screenshot', 'funding', 'funding_active', '@username this is what a funded account looks like.\n\nReal money. Real withdrawal. Real life.\n\nUse promo code 10xfirst for a 100% bonus when you fund 👇', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_lifestyle_video', 'funding', 'funding_active', '@username demo money disappears.\n\nReal money buys real things.\n\nBig difference.\n\nUse code 10xsecond — 150% bonus on your first deposit.', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_testimonial', 'funding', 'funding_active', '@username this could be your caption next week.\n\nSame bot. Same strategy. Real results.\n\nPromo: 10xfirst gives you 100% extra.', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_payout_proof', 'funding', 'funding_active', '@username imagine waking up to this.\n\nEvery. Single. Week.\n\nThat''s what funded 10x users do.\n\nGet 150% more with code 10xsecond 👇', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_lifestyle_photo', 'funding', 'funding_active', '@username the goal isn''t more demo wins.\n\nThe goal is this. Right here.\n\nOne fund away. Use 10xfirst for 100% bonus.', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_user_result', 'funding', 'funding_active', '@username real person. Real 10x user. Real money.\n\nYour turn.\n\nDon''t forget: code 10xsecond doubles your deposit + 50%.', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);

-- SSID/Reconnect templates
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reconnect_session_expired', 'ssid', 'brain', '🔐 Session Expired\n\nYour IQ Option session has expired.\n\nTap below to reconnect and continue trading.', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reconnect_followup', 'ssid', 'brain', '⚠️ Still disconnected\n\nYour account is paused until you reconnect.\n\nNo trades, no signals until your session is restored.', 1, 21600);

-- LLM Brain templates (25 categories, 6 variants each) are loaded via seed_templates_brain()
-- See db.ts for the full brain template seed function

PRAGMA user_version = 1;
