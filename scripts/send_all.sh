#!/bin/bash
cd /root/iqbot-v3
source .env
SHARA=6622587977
API="https://api.telegram.org/bot$BOT_TOKEN"
count=0

sqlite3 iqbot-v3.db "
SELECT 'KEY:' || key || '|CAT:' || category || '|MSG:' || message || '|BTN:' || COALESCE(button_text,'') || '|URL:' || COALESCE(button_url,'')
FROM templates ORDER BY category, key;" | while IFS='|' read -r line; do
    key=$(echo "$line" | sed 's/^KEY://')
    cat=$(echo "$line" | sed 's/.*CAT://;s/|MSG:.*//')
    rest=$(echo "$line" | sed 's/.*MSG://')
    msg=$(echo "$rest" | sed 's/|BTN:.*//')
    btn=$(echo "$rest" | sed 's/.*|BTN://;s/|URL:.*//')
    url=$(echo "$rest" | sed 's/.*|URL://')

    text="[$cat] $key%0A%0A$msg"
    
    if [ -n "$btn" ] && [ -n "$url" ]; then
        kb="{\"inline_keyboard\":[[{\"text\":\"$btn\",\"url\":\"$url\"}]]}"
        resp=$(curl -s -X POST "$API/sendMessage" \
            -H "Content-Type: application/json" \
            -d "{\"chat_id\":$SHARA,\"text\":\"[$cat] $key\n\n$msg\",\"parse_mode\":\"Markdown\",\"reply_markup\":$kb}" 2>/dev/null)
    else
        resp=$(curl -s -X POST "$API/sendMessage" \
            -H "Content-Type: application/json" \
            -d "{\"chat_id\":$SHARA,\"text\":\"[$cat] $key\n\n$msg\",\"parse_mode\":\"Markdown\"}" 2>/dev/null)
    fi
    
    ok=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null)
    
    if [ "$ok" != "True" ]; then
        # Retry without markdown
        desc=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('description','unknown'))" 2>/dev/null)
        if [ -n "$btn" ] && [ -n "$url" ]; then
            resp2=$(curl -s -X POST "$API/sendMessage" \
                -H "Content-Type: application/json" \
                -d "{\"chat_id\":$SHARA,\"text\":\"[$cat] $key\n\n$msg\",\"reply_markup\":$kb}" 2>/dev/null)
        else
            resp2=$(curl -s -X POST "$API/sendMessage" \
                -H "Content-Type: application/json" \
                -d "{\"chat_id\":$SHARA,\"text\":\"[$cat] $key\n\n$msg\"}" 2>/dev/null)
        fi
        ok2=$(echo "$resp2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null)
        if [ "$ok2" = "True" ]; then
            echo "OK(plain): $key"
        else
            desc2=$(echo "$resp2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('description','unknown'))" 2>/dev/null)
            echo "FAIL: $key - $desc2"
        fi
    else
        echo "OK: $key"
    fi
    
    count=$((count + 1))
    sleep 0.3
done

echo "Done: $count sent"
