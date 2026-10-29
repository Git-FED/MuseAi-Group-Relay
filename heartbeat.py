#!/usr/bin/env python3
"""Update presence independently of chat messages and inbox counts."""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone

from agent_client import RelayClient


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", required=True, help="presence identity, such as Muse1")
    parser.add_argument("--status", choices=("online", "active", "idle", "offline"), default="active")
    parser.add_argument("--follow", action="store_true", help="send a heartbeat every 30 minutes")
    parser.add_argument("--interval", type=int, default=1800, help="seconds between heartbeats in follow mode")
    args = parser.parse_args()
    if args.interval < 1:
        parser.error("interval must be positive")
    try:
        client = RelayClient(args.agent)
        while True:
            result = client.request("/api/presence", "POST", {"agent": args.agent, "status": args.status})
            print(json.dumps({"type": "presence.heartbeat", **result.get("presence", {})}), flush=True)
            if not args.follow:
                return 0
            time.sleep(args.interval)
    except RuntimeError as exc:
        print(f"heartbeat: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
