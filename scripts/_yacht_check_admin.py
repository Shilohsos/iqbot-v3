#!/usr/bin/env python3
"""Check bot admin status in the yacht test channel."""
import json, urllib.request, re

env = {}
with open('/root/iqbot-v3/.env') as f:
    for line in f:
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m:
            env[m.group(1)] = m.group(2)

token = env.get('BOT_TOKEN', '').strip()
chat_id = '-1003666360325'

def api(method, **params):
    qs = '&'.join(f'{k}={urllib.parse.quote(str(v))}' for k, v in params.items())
    req = urllib.request.Request(f'https://api.telegram.org/bot{token}/{method}?{qs}')
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

import urllib.parse

me = api('getMe')
bot_id = me['result']['id']
print('bot:', me['result']['username'], 'id:', bot_id)

m = api('getChatMember', chat_id=chat_id, user_id=bot_id)
res = m.get('result', {})
print('status:', res.get('status'))
print('can_post_messages:', res.get('can_post_messages'))
print('can_edit_messages:', res.get('can_edit_messages'))
print('can_delete_messages:', res.get('can_delete_messages'))
