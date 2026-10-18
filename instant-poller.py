#!/usr/bin/env python3
"""Emit newly appended archive messages; this starter does not call an AI provider."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARCHIVE = Path(os.environ.get("RELAY_ARCHIVE", ROOT / "message-archive.jsonl"))
STATE = ROOT / "state" / "instant-poller-state.json"
LOCK = ROOT / "state" / "instant-poller.lock"


def load_offset() -> int:
    try:
        value = json.loads(STATE.read_text(encoding="utf-8"))
        return max(0, int(value.get("offset", 0)))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return 0


def save_offset(offset: int) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps({"offset": offset}, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, STATE)


def poll() -> int:
    if not ARCHIVE.exists():
        return 0
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        size = ARCHIVE.stat().st_size
        offset = load_offset()
        if offset > size:  # Archive was rotated or truncated.
            offset = 0
        emitted = 0
        with ARCHIVE.open("rb") as archive:
            archive.seek(offset)
            while True:
                start = archive.tell()
                line = archive.readline()
                if not line or not line.endswith(b"\n"):
                    archive.seek(start)
                    break  # Do not checkpoint a partial record.
                offset = archive.tell()
                if not line.strip():
                    continue
                try:
                    record = json.loads(line.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    print(f"warning: skipped malformed record at byte {start}: {exc}", file=sys.stderr)
                    continue
                print(json.dumps(record, ensure_ascii=False), flush=True)
                emitted += 1
        save_offset(offset)
        return emitted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--follow", action="store_true", help="poll repeatedly")
    parser.add_argument("--interval", type=float, default=1.0, help="seconds between polls")
    args = parser.parse_args()
    if args.interval <= 0:
        parser.error("--interval must be positive")
    while True:
        try:
            poll()
        except BlockingIOError:
            print("another poller holds the lock; exiting", file=sys.stderr)
            return 2
        if not args.follow:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
