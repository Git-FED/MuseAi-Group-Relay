#!/usr/bin/env python3
"""Shared authenticated HTTP helpers for the agent-side Relay Room tools."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request


class RelayClient:
    def __init__(self, agent: str):
        self.agent = agent
        self.base = os.environ.get("RELAY_API_URL", "").strip().rstrip("/")
        self.key = os.environ.get("RELAY_SHARED_KEY", "")
        if not self.base:
            raise RuntimeError("Set RELAY_API_URL to the deployed Worker origin.")
        parsed = urllib.parse.urlparse(self.base)
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
        if parsed.scheme != "https" and not local_http:
            raise RuntimeError("RELAY_API_URL must use HTTPS (HTTP is allowed only for localhost).")
        if not parsed.hostname or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise RuntimeError("RELAY_API_URL must be the Worker origin only, without a path or query.")
        if not self.key:
            raise RuntimeError("Set RELAY_SHARED_KEY to the same shared key configured on the Worker.")

    def request(self, path: str, method: str = "GET", payload: dict | None = None) -> dict:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.key}",
            "X-Relay-Agent": self.agent,
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                value = json.loads(response.read().decode("utf-8"))
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
        if not isinstance(value, dict):
            raise RuntimeError("Worker API returned an unexpected response.")
        return value
