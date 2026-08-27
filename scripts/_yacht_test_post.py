#!/usr/bin/env python3
"""Send one test message to the yacht test channel as the 10x bot."""
import json, urllib.request, urllib.parse, re

env = {}
with open('/root/iqbot-v3/.env') as f:
    for line in f:
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m:
            env[m.group(1)] = m.group(2)

token = env.get('BOT_TOKEN', '').strip()
chat_id = '-1003666360325'
text = '◆ Yacht engine test — posting path OK (10x bot).'

data = urllib.parse.urlencode({'chat_id': chat_id, 'text': text}).encode()
req = urllib.request.Request(f'https://api.telegram.org/bot{token}/sendMessage', data=data)
with urllib.request.urlopen(req, timeout=15) as r:
    d = json.loads(r.read().decode())

if d.get('ok'):
    print('SENT message_id:', d['result']['message_id'], 'chat:', d['result']['chat']['title'])
else:
    print('ERROR:', json.dumps(d)[:500])
