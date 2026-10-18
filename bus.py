#!/usr/bin/env python3
"""Local JSONL bus with optional Cloudflare Worker/D1 commands."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent
ARCHIVE = Path(os.environ.get("RELAY_ARCHIVE", ROOT / "message-archive.jsonl"))


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def iter_messages(path: Path):
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"warning: skipping invalid JSON on line {line_no}: {exc}", file=sys.stderr)


def append_record(record: dict) -> None:
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    with ARCHIVE.open("a", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def send_local(sender: str, content: str, kind: str = "message") -> dict:
    record = {"id": str(uuid.uuid4()), "timestamp": timestamp(), "sender": sender,
              "type": kind, "content": content}
    append_record(record)
    return record


def worker_request(path: str, method: str = "GET", payload: Optional[dict] = None) -> dict:
    base = os.environ.get("RELAY_API_URL", "").strip().rstrip("/")
    token = os.environ.get("RELAY_TOKEN", "").strip()
    if not base or not token:
        raise RuntimeError("Set RELAY_API_URL and RELAY_TOKEN in the environment before using --remote.")
    parsed = urllib.parse.urlparse(base)
    local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    if parsed.scheme != "https" and not local_http:
        raise RuntimeError("RELAY_API_URL must use HTTPS (HTTP is allowed only for localhost).")
    if not parsed.hostname or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise RuntimeError("RELAY_API_URL must be the Worker origin only, without a path or query.")
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("error", "request rejected")
        except (ValueError, AttributeError):
            detail = "request rejected"
        raise RuntimeError(f"Worker API returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach the Worker API: {exc.reason}") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Worker API returned invalid JSON.") from exc
    if not isinstance(result, dict):
        raise RuntimeError("Worker API returned an unexpected response.")
    return result


def print_messages(messages: list[dict]) -> None:
    for item in messages:
        print(json.dumps(item, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser(description="Send and inspect messages in the local relay or Cloudflare Worker.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_send = sub.add_parser("send", help="append a message locally or send it to the Worker")
    p_send.add_argument("content", help="message text")
    p_send.add_argument("--sender", default=os.environ.get("RELAY_SENDER", "human"))
    p_send.add_argument("--type", default="message", dest="kind")
    p_send.add_argument("--remote", action="store_true", help="send through the Cloudflare Worker and mirror locally")

    p_read = sub.add_parser("read", help="print recent messages as JSONL")
    p_read.add_argument("--limit", type=int, default=20)
    p_read.add_argument("--archive", type=Path, default=ARCHIVE)
    p_read.add_argument("--remote", action="store_true", help="read recent messages from the Worker")

    p_sync = sub.add_parser("sync", help="copy recent Worker messages into the local JSONL archive")
    p_sync.add_argument("--limit", type=int, default=500, help="number of recent messages to fetch (1–500)")

    args = parser.parse_args()
    try:
        if args.command == "send":
            if args.remote:
                response = worker_request("/api/messages", "POST", {
                    "sender": args.sender, "type": args.kind, "content": args.content,
                })
                record = response.get("message")
                if not isinstance(record, dict):
                    raise RuntimeError("Worker API response did not contain a message.")
                append_record(record)
            else:
                record = send_local(args.sender, args.content, args.kind)
            print(json.dumps(record, ensure_ascii=False))
            return 0

        if args.command == "read":
            if args.limit < 1:
                parser.error("--limit must be at least 1")
            if args.remote:
                response = worker_request(f"/api/messages?limit={min(args.limit, 500)}")
                messages = response.get("messages", [])
                if not isinstance(messages, list):
                    raise RuntimeError("Worker API response did not contain a message list.")
                print_messages(messages)
            else:
                messages = list(iter_messages(args.archive) or [])
                print_messages(messages[-args.limit:])
            return 0

        if not 1 <= args.limit <= 500:
            parser.error("--limit must be between 1 and 500")
        response = worker_request(f"/api/messages?limit={args.limit}")
        remote_messages = response.get("messages", [])
        if not isinstance(remote_messages, list):
            raise RuntimeError("Worker API response did not contain a message list.")
        existing_ids = {str(item.get("id")) for item in (iter_messages(ARCHIVE) or []) if item.get("id")}
        added = 0
        for item in remote_messages:
            if not isinstance(item, dict):
                continue
            identifier = str(item.get("id", ""))
            if identifier and identifier in existing_ids:
                continue
            append_record(item)
            if identifier:
                existing_ids.add(identifier)
            added += 1
        print(f"Synced {added} new message(s) into {ARCHIVE}.")
        return 0
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
