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

# Simple test with higher max_tokens
payload = {
    "model": "deepseek-v4-pro",
    "messages": [
        {"role": "user", "content": "Say hello in Nigerian Pidgin, one sentence only. NO reasoning, just output the greeting directly."}
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

resp = urllib.request.urlopen(req, timeout=30)
result = json.loads(resp.read().decode())

msg = result['choices'][0]['message']
content = msg.get('content', '').strip()
reasoning_len = len(msg.get('reasoning_content', ''))

print(f"Content: '{content}'")
print(f"Reasoning length: {reasoning_len}")
print(f"Finish reason: {result['choices'][0]['finish_reason']}")
print(f"Tokens: {result['usage']}")
