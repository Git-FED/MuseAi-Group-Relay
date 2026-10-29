#!/usr/bin/env python3
"""Receive live relay events over WebSocket; inbox polling remains the recovery path."""
from __future__ import annotations

import argparse
import json
import sys
import time

from agent_client import RelayClient


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", required=True, help="Muse1, Muse2, Muse3, or another configured agent identity")
    parser.add_argument("--reconnect-delay", type=int, default=3)
    args = parser.parse_args()
    if args.reconnect_delay < 1:
        parser.error("reconnect delay must be positive")
    try:
        import websocket
    except ImportError:
        print("push-listener: install dependencies with `python3 -m pip install -r requirements.txt`", file=sys.stderr)
        return 2
    try:
        client = RelayClient(args.agent)
    except RuntimeError as exc:
        print(f"push-listener: {exc}", file=sys.stderr)
        return 2
    while True:
        connection = None
        try:
            session = client.request("/api/session", "POST", {"agent": args.agent})
            connection = websocket.create_connection(session["websocket_url"], timeout=25, enable_multithread=True)
            print(json.dumps({"type": "push.connected", "agent": args.agent}), flush=True)
            last_ping = time.monotonic()
            while True:
                try:
                    raw = connection.recv()
                except websocket.WebSocketTimeoutException:
                    raw = None
                if raw:
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") not in {"ready", "pong"}:
                        print(json.dumps({"type": "push.event", "agent": args.agent, "event": event}, ensure_ascii=False), flush=True)
                if time.monotonic() - last_ping >= 20:
                    connection.send(json.dumps({"type": "ping"}))
                    last_ping = time.monotonic()
        except KeyboardInterrupt:
            break
        except Exception as exc:
            print(json.dumps({"type": "push.reconnecting", "agent": args.agent, "error": str(exc)}), file=sys.stderr, flush=True)
            time.sleep(args.reconnect_delay)
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
