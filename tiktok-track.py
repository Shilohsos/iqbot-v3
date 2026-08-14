#!/usr/bin/env python3
"""
TikTok Events API tracker — receives events from funnel pages, forwards to TikTok.
Runs alongside meta-track.py via Caddy reverse proxy.

Pixel ID: D9F5S3RC77U8SCOM3G70
Access Token: fcaa927f3a80fd87e722cddc20b9ffd9c207cff2
Endpoint: POST https://business-api.tiktok.com/open_api/v1.3/event/track/
"""

import json
import time
import logging
import urllib.request
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8767  # separate port from meta-track.py (8766)

TOKEN = "fcaa927f3a80fd87e722cddc20b9ffd9c207cff2"
PIXEL_ID = "D9F5S3RC77U8SCOM3G70"
API_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/"
TEST_EVENT_CODE = None  # PRODUCTION — no test code

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(message)s', datefmt='%Y-%m-%dT%H:%M:%SZ')


def send_to_tiktok(event_data):
    """Send event to TikTok Events API. Returns (success: bool, response_text: str)."""
    payload = {
        "event_source": "web",
        "event_source_id": PIXEL_ID,
        "data": [event_data],
    }
    if TEST_EVENT_CODE:
        payload["test_event_code"] = TEST_EVENT_CODE

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(API_URL, data=data, headers={
        "Content-Type": "application/json",
        "Access-Token": TOKEN,
    })

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            ok = result.get("code") == 0
            return ok, json.dumps(result)
    except Exception as e:
        return False, str(e)


class TikTokHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            self._reply(400, {"error": "Invalid JSON"})
            return

        event_name = body.get("event", "ViewContent")
        event_time = int(time.time())
        user_data = body.get("user", {})
        page_data = body.get("page", {"url": "https://10xpremium.online/"})
        properties = body.get("properties", {})

        # Map custom parameters
        if body.get("email"):
            user_data.setdefault("email", body["email"])

        event = {
            "event": event_name,
            "event_time": event_time,
            "event_id": body.get("event_id", ""),
        }

        # Add user data
        if user_data:
            event["user"] = {}
            for field in ["email", "phone", "external_id", "ip", "user_agent", "ttclid", "ttp"]:
                if user_data.get(field):
                    event["user"][field] = user_data[field]
            # Forward client IP if not provided
            if "ip" not in event["user"]:
                event["user"]["ip"] = self.headers.get("X-Forwarded-For", self.client_address[0])

        # Add page data
        if page_data:
            event["page"] = page_data

        # Add properties
        if properties:
            event["properties"] = properties

        ok, resp = send_to_tiktok(event)
        log_msg = f"[tiktok] {event_name} → {'OK' if ok else 'FAIL'}: {resp[:200]}"
        if ok:
            logging.info(log_msg)
        else:
            logging.warning(log_msg)

        self._reply(200 if ok else 502, {"status": "sent" if ok else "failed", "tiktok": resp})

    def do_GET(self):
        if self.path == "/health":
            self._reply(200, {"status": "ok", "pixel": PIXEL_ID, "test_mode": TEST_EVENT_CODE is not None})
        else:
            self._reply(200, {"status": "ok"})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _reply(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))


def main():
    server = HTTPServer(("127.0.0.1", PORT), TikTokHandler)
    logging.info(f"[tiktok-tracker] listening on :{PORT} — pixel={PIXEL_ID}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
