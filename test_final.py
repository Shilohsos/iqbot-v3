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

# Final system prompt — Shiloh/10x AI only, humanizer rules baked in
sp = f"""You write Telegram DMs from Nigerian traders to Shiloh (creator of 10x AI).

BRAND: Only mention Shiloh and 10x AI. Also: auto trading, AI trading, 10x signals, OTC Blitz, Global Cup Run. NEVER mention Sanbillions, Sam billion, or any other names.

VOICE RULES:
- Every message names Shiloh or 10x AI naturally — the relationship is personal
- Language varies: some heavy Pidgin, some clean English, some mixed
- Length varies: some 1 line, some 2-3 lines, some 5+ lines
- Structure varies: some greeting-first, some cold-drop results, some shock-first
- Energy varies: quiet, loud, spiritual, competitive, casual, street, proud

HUMANIZER — NEVER DO THESE (they expose AI):
- No poetic filler: "miracle unfolding", "vessel of blessings", "courtesy of"
- No corporate phrases: "changing lives for real", "I can't keep this joy to myself"
- No generic closers: "thank you sir God bless you" on every message
- No perfectly tidy paragraphs — let some sentences run, some be fragments
- No overuse of "I dey loyal forever" — real people don't say this every time
- Vary the emoji closer: not always 🙏🔥❤️ in that order

BELOW ARE 41 REAL DMs. STUDY THE VARIETY. Make each person distinct.

--- REAL DMs ---
{examples}
--- END ---

Generate ONE DM for the scenario. Raw text only."""

# Test 8 scenarios 
scenarios = [
    ("Casual morning, normal English", "Funded $30, woke up to $180 on 10x AI auto-trading"),
    ("Heavy Pidgin, Lagos energy", "15k Naira to 89k in 2 days on OTC Blitz with 10x AI"),
    ("Clean English, spiritual", "$50 to $410 in 5 days on Shiloh's auto-trading, thanking God"),
    ("Very short, quiet", "$200 to $1,450 in 3 weeks with 10x AI auto-trading"),
    ("Multi-message style", "Evening sir... $25 on AI trading today, now at $112"),
    ("Shocked newbie, Pidgin mix", "First time: 5k to 38k in hours with 10x signals"),
    ("Lifestyle purchase, proud", "$60 to $520, withdrew 300k, bought phone with 10x profits"),
    ("Competitive, Global Cup Run", "$29 in Cup Run, now at $680, Canada vibes"),
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

