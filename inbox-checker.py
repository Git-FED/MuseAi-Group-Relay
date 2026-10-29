#!/usr/bin/env python3
"""Check one agent's approved-message inbox; follow mode checks every five minutes."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse

from agent_client import RelayClient


def check(client: RelayClient, limit: int, threshold: int) -> int:
    query = urllib.parse.urlencode({"agent": client.agent, "limit": limit})
    data = client.request(f"/api/inbox?{query}")
    unread = int(data.get("unread_count", 0))
    messages = data.get("messages", [])
    if unread >= threshold:
        print(json.dumps({"type": "unread.alert", "agent": client.agent, "unread_count": unread,
                          "threshold": threshold, "message": "Unread relay messages are above the alert threshold."}), file=sys.stderr, flush=True)
    for message in messages:
        print(json.dumps({"type": "inbox.message", "agent": client.agent, "message": message}, ensure_ascii=False), flush=True)
    if messages:
        last = messages[-1]
        client.request("/api/read", "POST", {"agent": client.agent, "timestamp": last["timestamp"], "id": last["id"]})
    return max(0, unread - len(messages))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", required=True, help="Muse1, Muse2, Muse3, or another configured agent identity")
    parser.add_argument("--follow", action="store_true", help="check continuously (defaults to every 300 seconds)")
    parser.add_argument("--interval", type=int, default=300, help="seconds between checks in follow mode")
    parser.add_argument("--limit", type=int, default=100, help="messages to emit per request, 1–500")
    parser.add_argument("--threshold", type=int, default=int(os.environ.get("RELAY_UNREAD_ALERT_THRESHOLD", "10")))
    args = parser.parse_args()
    if args.interval < 1 or not 1 <= args.limit <= 500 or args.threshold < 1:
        parser.error("interval, threshold, and limit must be positive; limit is at most 500")
    try:
        client = RelayClient(args.agent)
        while True:
            remaining = check(client, args.limit, args.threshold)
            if not args.follow:
                return 0
            # Drain a backlog over additional immediate pages before sleeping.
            if remaining:
                continue
            time.sleep(args.interval)
    except (RuntimeError, KeyError, ValueError) as exc:
        print(f"inbox-checker: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
