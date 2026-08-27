#!/usr/bin/env python3
"""Check whether the 10x bot can see/post to a chat via Bot API getChat."""
import json, urllib.request, os, re

env = {}
with open('/root/iqbot-v3/.env') as f:
    for line in f:
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m:
            env[m.group(1)] = m.group(2)

token = env.get('BOT_TOKEN', '').strip()
chat_id = '-1003666360325'

req = urllib.request.Request(
    f'https://api.telegram.org/bot{token}/getChat?chat_id={chat_id}',
    method='GET',
)
with urllib.request.urlopen(req, timeout=15) as r:
    d = json.loads(r.read().decode())

res = d.get('result')
if res:
    print('OK chat:', res.get('id'), '|', res.get('title'), '| type:', res.get('type'))
    print('username:', res.get('username'))
    print('permissions fields present:', [k for k in res.keys() if 'perm' in k.lower() or 'can_' in k.lower()])
else:
    print('ERROR:', json.dumps(d)[:500])
