#!/usr/bin/env python3
"""
Scan an affiliate tracking Telegram channel for a given IQ Option User ID.

Usage:
    python3 check_affiliate.py <iq_user_id> [--limit 1000]

Output (stdout, JSON):
    {"found": true,  "data": {"message": "...", "date": "..."}}
    {"found": false, "data": null}
    {"error": "..."}                  # on failure, exit code 1

Required env vars (loaded from .env automatically):
    TELETHON_SESSION      — Telethon StringSession string
    TELEGRAM_API_ID       — from https://my.telegram.org
    TELEGRAM_API_HASH     — from https://my.telegram.org
    AFFILIATE_CHANNEL_ID  — numeric channel ID (e.g. -1001234567890)

Optional:
    AFFILIATE_SCAN_LIMIT  — max messages to scan (default 1000)
"""

import sys
import json
import os
import asyncio
import argparse

# Load .env relative to repo root (two levels up from scripts/)
_REPO_ROOT = os.path.join(os.path.dirname(__file__), '..')
_ENV_FILE = os.path.join(_REPO_ROOT, '.env')

try:
    from dotenv import load_dotenv
    load_dotenv(_ENV_FILE)
except ImportError:
    pass  # python-dotenv not installed; rely on env being pre-set


def _require_env(name: str) -> str:
    val = os.environ.get(name, '').strip()
    if not val:
        print(json.dumps({"error": f"{name} is not set in environment"}), flush=True)
        sys.exit(1)
    return val


async def _scan(user_id: str, limit: int) -> dict:
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    session = _require_env('TELETHON_SESSION')
    api_id = int(_require_env('TELEGRAM_API_ID'))
    api_hash = _require_env('TELEGRAM_API_HASH')
    channel_id = int(_require_env('AFFILIATE_CHANNEL_ID'))

    client = TelegramClient(StringSession(session), api_id, api_hash)
    await client.connect()

    try:
        channel = await client.get_entity(channel_id)
        async for msg in client.iter_messages(channel, limit=limit):
            if msg.text and user_id in msg.text:
                return {
                    "found": True,
                    "data": {
                        "message": msg.text,
                        "date": str(msg.date),
                    },
                }
        return {"found": False, "data": None}
    finally:
        await client.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser(description="Check affiliate channel for IQ Option User ID")
    parser.add_argument('user_id', help='IQ Option User ID (numeric)')
    parser.add_argument('--limit', type=int,
                        default=int(os.environ.get('AFFILIATE_SCAN_LIMIT', '1000')))
    args = parser.parse_args()

    user_id = args.user_id.strip()
    if not user_id.isdigit():
        print(json.dumps({"error": "user_id must be numeric"}), flush=True)
        sys.exit(1)

    try:
        result = asyncio.run(_scan(user_id, args.limit))
        print(json.dumps(result), flush=True)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
