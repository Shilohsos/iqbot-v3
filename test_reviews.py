import json, urllib.request

def get_api_key():
    with open('/root/iqbot-v3/.env') as f:
        for line in f:
            line = line.strip()
            if '=' in line:
                k, v = line.split('=', 1)
                if k == 'DEEPSEEK_API_KEY':
                    return v
    raise Exception('Key not found')

api_key = get_api_key()

with open('/root/iqbot-v3/review-generation-prompt.md') as f:
    prompt = f.read()

system_prompt = prompt[:prompt.index('### Example 20')]

scenarios = [
    ("Street Hustler", "15k Naira to 89k Naira", "2 days", "OTC Blitz"),
    ("Grateful Believer", "$25 to $210", "first week", "AI auto-trading"),
    ("Shocked Newbie", "5k Naira to 42k Naira", "first 3 trades", "signals"),
    ("Quiet Killer", "$100 to $1,850", "10 days", "auto-trading"),
    ("Lifestyle Upgrader", "$50 to $850", "2 weeks", "AI trading, withdrew 450k"),
]

for i, (voice, amount, tf, trades) in enumerate(scenarios, 1):
    user_prompt = f"Generate ONE Nigerian trader review:\nVoice: {voice}\nAmount: {amount}\nTimeframe: {tf}\nTrades: {trades}\n\nOutput ONLY the raw DM text."

    payload = {
        "model": "deepseek-v4-pro",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.9,
        "max_tokens": 500,
        "stream": False
    }
    
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    )
    
    try:
        resp = urllib.request.urlopen(req, timeout=45)
        result = json.loads(resp.read())
        review = result['choices'][0]['message']['content'].strip()
        tokens = result['usage']['completion_tokens']
        print(f"=== TEST {i}: {voice} ({tokens}t) ===")
        print(review)
        print()
    except Exception as e:
        print(f"=== TEST {i}: {voice} === ERROR: {e}")
        print()
