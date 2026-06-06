import json, urllib.request

with open('/tmp/bot_token.txt') as f:
    token = f.read().strip()

url1 = f'https://api.telegram.org/bot{token}/sendMessage'
body = json.dumps({'chat_id':6622587977,'text':'Test from 10x Bot'}).encode()
req = urllib.request.Request(url1, data=body, headers={'Content-Type':'application/json'})
resp = urllib.request.urlopen(req, timeout=15)
print(json.loads(resp.read()))
