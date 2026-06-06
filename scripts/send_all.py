import json, sqlite3, time, urllib.request, os

with open('/tmp/bot_token.txt') as f:
    token = f.read().strip()

API = f'https://api.telegram.org/bot{token}'
SHARA = 6622587977

db = sqlite3.connect('/root/iqbot-v3/iqbot-v3.db')
rows = db.execute("SELECT key, category, message, button_text, button_url FROM templates ORDER BY category, key").fetchall()

def send_msg(chat_id, text, kb=None):
    body = {'chat_id': chat_id, 'text': text, 'parse_mode': 'Markdown'}
    if kb:
        body['reply_markup'] = kb
    try:
        req = urllib.request.Request(
            f'{API}/sendMessage',
            data=json.dumps(body).encode(),
            headers={'Content-Type': 'application/json'},
        )
        resp = json.loads(urllib.request.urlopen(req, timeout=15).read())
        if resp.get('ok'):
            return True, None
        body.pop('parse_mode', None)
        req2 = urllib.request.Request(
            f'{API}/sendMessage',
            data=json.dumps(body).encode(),
            headers={'Content-Type': 'application/json'},
        )
        resp2 = json.loads(urllib.request.urlopen(req2, timeout=15).read())
        return resp2.get('ok'), resp2.get('description', '')
    except Exception as e:
        return False, str(e)

total = len(rows)
sent = 0
failed = 0
print(f'Sending {total} templates to Shara...')
print('=' * 40)

for key, cat, msg, btn_text, btn_url in rows:
    text = f'[{cat}] {key}\n\n{msg}'
    kb = None
    if btn_text and btn_url:
        kb = {'inline_keyboard': [[{'text': btn_text, 'url': btn_url}]]}
    ok, desc = send_msg(SHARA, text, kb)
    if ok:
        sent += 1
        sys.stdout.write('.')
        sys.stdout.flush()
    else:
        print(f'\nFAIL: {key} — {desc[:80]}')
        failed += 1
    time.sleep(0.25)

print(f'\n{"=" * 40}')
print(f'Done: {sent} sent, {failed} failed')
db.close()
os.remove('/tmp/bot_token.txt')
