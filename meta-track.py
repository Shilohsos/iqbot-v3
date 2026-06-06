"""Meta Conversions API proxy — receives events from funnel page, forwards to Meta."""
import os
import json
import time
import hashlib
import logging
from pathlib import Path
from flask import Flask, request, jsonify

# Load .env from project root
env_path = Path(__file__).resolve().parent / ".env"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())

logging.basicConfig(level=logging.INFO, format="[meta-track] %(message)s")
logger = logging.getLogger("meta-track")

app = Flask(__name__)

PIXEL_ID = "2115121012365333"
TOKEN = os.getenv("META_ACCESS_TOKEN", "")
API_URL = f"https://graph.facebook.com/v22.0/{PIXEL_ID}/events?access_token={TOKEN}"

@app.route("/track", methods=["POST"])
@app.route("/", methods=["POST"])
def track():
    data = request.get_json(silent=True) or {}
    event_name = data.get("event_name", "ViewContent")
    event_source_url = data.get("event_source_url", request.headers.get("Referer", ""))
    # CF-Connecting-IP carries the real visitor IP when behind Cloudflare
    client_ip = (request.headers.get("CF-Connecting-IP") or
                 request.headers.get("X-Forwarded-For", request.remote_addr) or "")
    client_ua = request.headers.get("User-Agent", "")

    # IP geolocation via ip-api.com — free, no key, 3s timeout, non-blocking
    geo: dict = {}
    try:
        import urllib.request as ureq
        geo_resp = ureq.urlopen(
            f"http://ip-api.com/json/{client_ip}?fields=city,regionName,countryCode",
            timeout=3
        )
        geo = json.loads(geo_resp.read().decode())
    except Exception:
        pass

    # Build user_data — omit keys with empty values so Meta ignores missing params
    # rather than counting them as mismatches
    user_data: dict = {
        "client_ip_address": client_ip,
        "client_user_agent": client_ua,
    }
    for field in ("fbc", "fbp", "em", "ph"):
        val = data.get(field, "")
        if val:
            user_data[field] = val

    # Meta requires PII fields (country, st, ct) to be SHA-256 hashed.
    # Exceptions: client_ip_address, client_user_agent, fbc, fbp — sent raw.
    if geo.get("countryCode"):
        user_data["country"] = hashlib.sha256(geo["countryCode"].encode()).hexdigest()
    if geo.get("regionName"):
        user_data["st"] = hashlib.sha256(geo["regionName"].encode()).hexdigest()
    if geo.get("city"):
        user_data["ct"] = hashlib.sha256(geo["city"].encode()).hexdigest()

    # Build CAPI payload. event_id enables Meta-side deduplication between
    # browser pixel and server events; client may supply it, otherwise we
    # derive a stable id from event_name + fbp/fbc + minute bucket so rapid
    # duplicates within the same minute are collapsed.
    event_id = data.get("event_id")
    if not event_id:
        bucket = int(time.time()) // 60
        seed = f"{event_name}|{data.get('fbp','')}|{data.get('fbc','')}|{client_ip}|{bucket}"
        event_id = hashlib.sha256(seed.encode()).hexdigest()[:32]

    payload = {
        "data": [{
            "event_name": event_name,
            "event_id": event_id,
            "event_time": int(time.time()),
            "action_source": "website",
            "event_source_url": event_source_url,
            "user_data": user_data,
            "custom_data": data.get("custom_data", {}),
        }]
    }

    try:
        import urllib.request
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = resp.read().decode()
            logger.info(f"meta: {event_name} → {resp.status}")
            return jsonify({"status": "ok", "meta_response": json.loads(result)})
    except Exception as e:
        logger.error(f"meta fail: {event_name} → {e}")
        return jsonify({"status": "error", "detail": str(e)}), 502

@app.route("/api/log_visit", methods=["POST"])
def log_visit():
    """Log a landing page visit to the bot's funnel_events table."""
    data = request.get_json(silent=True) or {}
    source = str(data.get("source", "direct"))[:64]
    db_path = os.path.join(os.path.dirname(__file__), "iqbot-v3.db")
    try:
        import sqlite3
        con = sqlite3.connect(db_path, timeout=5)
        con.execute(
            "INSERT INTO funnel_events (event_type, source) VALUES (?, ?)",
            ("page_visit", source),
        )
        con.commit()
        con.close()
        return jsonify({"ok": True})
    except Exception as e:
        logger.error(f"log_visit error: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/health")
def health():
    return jsonify({"status": "ok", "pixel": PIXEL_ID})

if __name__ == "__main__":
    port = int(os.getenv("META_TRACK_PORT", "8766"))
    logger.info(f"meta tracking proxy on :{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
