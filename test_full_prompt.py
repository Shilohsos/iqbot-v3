import json, urllib.request

with open('/root/iqbot-v3/.env') as f:
    for line in f:
        line = line.strip()
        if '=' in line:
            k, v = line.split('=', 1)
            if k == 'DEEPSEEK_API_KEY':
                api_key = v
                break

with open('/root/iqbot-v3/review-examples-block.txt') as f:
    examples = f.read()

sp = f"""You generate Telegram DMs sent to Shiloh by his Nigerian traders who use 10x AI (also called Sanbillions AI).

CRITICAL: Every message must feel CENTERED on Shiloh and 10x AI. These people are messaging SHILOH — not leaving a generic review. They're thanking HIM. They're crediting HIS AI. The relationship is personal. Name-drop Shiloh, 10x AI, or Sanbillions naturally in every message.

BELOW ARE 41 REAL DMs. STUDY THE VARIETY:
- Language: heavy Pidgin, clean English, Nigerian-flavored English, mixed
- Length: 1 line to 5+ lines, some multi-message flows
- Structure: some open with greeting, some cold-drop results, some lead with shock, some with gratitude
- Energy: quiet, loud, spiritual, competitive, casual, street, proud
- Each feels like a DISTINCT person — different personality, different typing style

--- 41 REAL DMs ---
{examples}
--- END ---

Generate ONE DM. Raw text only. Make this person distinct."""

scenarios = [
    ("Casual morning, normal English with Nigerian flavor", "$30 funded → woke up to $180 on 10x AI auto-trading"),
    ("Heavy Pidgin, loud Lagos energy, praising Shiloh directly", "15k Naira blew up to 89k in 2 days on OTC Blitz thanks to 10x AI"),
    ("Clean English, spiritual, God + Shiloh gratitude", "$50 turned into $410 in 5 days on Shiloh's AI auto-trading"),
    ("Very short, quiet, confident, minimal", "$200 to $1,450 in 3 weeks with 10x AI auto-trading"),
    ("Multi-message flow — greeting then result", "Good evening sir... then shows what Shiloh's AI did today: $25 → $112"),
    ("Pidgin mix, shocked newbie, first time using Shiloh's signals", "5k Naira to 38k in a few hours, can't believe 10x AI is real"),
    ("Proud, lifestyle purchase thanks to Shiloh's AI", "$60 → $520, withdrew 300k to buy new phone, crediting 10x AI"),
    ("Competitive, Global Cup Run with Sanbillions", "$29 funded in Global Cup Run, now at $680 thanks to Shiloh, Canada-bound"),
    ("Casual grateful, short, mixed language", "$15 → $95 in 3 days with Shiloh's signals, just saying thanks"),
    ("Streetwise, confident, big numbers, crediting 10x", "100k to 600k in 2 weeks on auto-trading, Shiloh made it possible"),
]

for i, (voice, desc) in enumerate(scenarios, 1):
    up = f"Personality: {voice}. Scenario: {desc}. Write the DM."
    
    payload = {
        'model': 'deepseek-v4-pro',
        'messages': [
            {'role': 'system', 'content': sp},
            {'role': 'user', 'content': up}
        ],
        'temperature': 1.15,
        'max_tokens': 10000,
        'stream': False
    }
    
    req = urllib.request.Request(
        'https://api.deepseek.com/v1/chat/completions',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'}
    )
    
    resp = urllib.request.urlopen(req, timeout=90)
    result = json.loads(resp.read())
    msg = result['choices'][0]['message']
    content = msg.get('content', '').strip()
    ct = result['usage']['completion_tokens']
    print(f'{i}. [{ct}t]')
    print(content)
    print('---')

