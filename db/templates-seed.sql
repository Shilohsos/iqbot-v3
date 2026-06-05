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

-- Onboarding verification templates
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('verify_success', 'onboarding_entry', 'awaiting_email', '✅ Account verified! You''re good to go.

📧 Now enter your IQ Option email:', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('awaiting_password', 'onboarding_entry', 'awaiting_password', '🔑 Now enter your password:', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('connected_success', 'onboarding_entry', 'connected', '✅ Connected @username! 💜

💰 Practice: $10,000.00

You''re now locked in. The 10x Special Bot is live and ready.

👇 Tap below to take your first trade.', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('verify_fail_1', 'onboarding_entry', 'awaiting_user_id', '❌ We couldn''t verify that User ID @username.

Double-check and send it again 👇', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('verify_fail_2', 'onboarding_entry', 'awaiting_user_id', 'Still not matching @username. Did you create your account through the link we provided?

1️⃣ Tap the Create Account button below
2️⃣ Use the same email you signed up with
3️⃣ Send your new User ID here 👇', '🆕 Create Account', 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('experienced_need_new', 'onboarding_entry', 'new_account_created', 'No problem @username. 💜

Tap the button below to create your free IQ Option account. I''ll wait right here 👇', '🆕 Create Account', 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue', 0, 0);

-- Funding sequence (category = funding)
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_win_screenshot', 'funding', 'funding_active', '@username this is what a funded account looks like.

Real money. Real withdrawal. Real life.

Use promo code 10xfirst for a 100% bonus when you fund 👇', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_lifestyle_video', 'funding', 'funding_active', '@username demo money disappears.

Real money buys real things.

Big difference.

Use code 10xsecond — 150% bonus on your first deposit.', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_testimonial', 'funding', 'funding_active', '@username this could be your caption next week.

Same bot. Same strategy. Real results.

Promo: 10xfirst gives you 100% extra.', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_payout_proof', 'funding', 'funding_active', '@username imagine waking up to this.

Every. Single. Week.

That''s what funded 10x users do.

Get 150% more with code 10xsecond 👇', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_lifestyle_photo', 'funding', 'funding_active', '@username the goal isn''t more demo wins.

The goal is this. Right here.

One fund away. Use 10xfirst for 100% bonus.', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_user_result', 'funding', 'funding_active', '@username real person. Real 10x user. Real money.

Your turn.

Don''t forget: code 10xsecond doubles your deposit + 50%.', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);
INSERT OR IGNORE INTO templates (key, category, state, message, button_text, button_url, auto_delete, delay_sec) VALUES ('funding_user_result_video', 'funding', 'funding_active', '@username watch this.

This is what happens when you stop playing demo and go live.

Use code 10xfirst — 100% bonus on your first fund 👇', '💎 Fund now', 'https://iqoption.com/pwa/payments/deposit', 1, NULL);

-- SSID/Reconnect templates
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reconnect_session_expired', 'ssid', 'brain', '🔐 Session Expired

Your IQ Option session has expired.

Tap below to reconnect and continue trading.', 0, 0);
INSERT OR IGNORE INTO templates (key, category, state, message, auto_delete, delay_sec) VALUES ('reconnect_followup', 'ssid', 'brain', '⚠️ Still disconnected

Your account is paused until you reconnect.

No trades, no signals until your session is restored.', 1, 21600);

-- LLM Brain templates (25 categories, 6 variants each) are loaded via seed_templates_brain()
-- See db.ts for the full brain template seed function

PRAGMA user_version = 1;
