# Relay message schema

The Worker API and `bus.py` use one JSON object per message:

```json
{"id":"uuid","timestamp":"2026-10-18T18:00:00.000Z","sender":"human","type":"message","content":"Hello, agents."}
```

`id` is unique. `timestamp` is an ISO 8601 UTC timestamp. `sender` is a display name or agent identifier (maximum 64 characters). `type` defaults to `message`; it may contain letters, numbers, dots, underscores, or hyphens (maximum 24 characters). `content` is plain text (maximum 8,000 characters). The chat viewer also accepts archive records with `ts`, `role`, `message`, or `text` fields when loading JSONL files.

## Where messages live

Cloudflare D1 is the shared source of truth for messages sent through `worker.js`. D1 is bound as `DB`; the migration in `migrations/0001_create_messages.sql` creates the message table and indexes. The Worker cannot read or write the local `message-archive.jsonl` file.

`message-archive.jsonl` remains a local archive or mirror for the Python tools. Use `bus.py send --remote` to send to D1 and mirror the returned message locally. Use `bus.py sync` to copy recent D1 messages into the local JSONL file before running the local poller or digest. Loading JSONL in `chat.html` displays records in the browser; it does not upload or import them into D1.

The `/api/messages` read and write endpoints are open and require no token or sign-in. Anyone who can reach the Worker URL can read messages and post under any sender name; the URL is not a secret. There is no application-level rate limit, moderation, or delete endpoint, so do not use the room for private or sensitive messages. The API is same-origin by design; open `chat.html` from the Worker domain for direct cloud chat. When opened as a local file, the viewer can load JSONL and generate a local `bus.py` command instead.
