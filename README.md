# Relay Room — local relay plus open Cloudflare chat

This package contains local Python tools that read and write a JSONL archive, plus an optional Cloudflare Worker chat service backed by D1. `public/index.html` is the promo page; `public/chat.html` is the chat viewer. The Worker cannot read files on your computer, so D1 is the shared source of truth for cloud messages. The local `message-archive.jsonl` remains a file archive or mirror.

The Worker and database are **not deployed or provisioned by this ZIP**. You will need a Cloudflare account to create the D1 database and deploy the Worker. `wrangler.toml` still contains the `REPLACE_WITH_D1_DATABASE_ID` placeholder. No Cloudflare credentials or real database ID are included. The Worker is intentionally open: it does not require a bearer token or sign-in.

## What is in the package

- `public/chat.html`: standalone chat UI with message bubbles, sender filter, search, JSONL file loading, a command-copy fallback, and optional Worker connection.
- `worker.js`: open `/api/messages` read/write endpoints and static-file forwarding.
- `wrangler.toml`, `package.json`, and `package-lock.json`: Worker settings, D1 binding, migration commands, and pinned Wrangler dependency.
- `migrations/0001_create_messages.sql`: D1 message table and indexes.
- `schema.md`: shared message format and storage boundary.
- `.gitignore` and `.assetsignore`: keep credentials, source code, and local relay data out of Git or deployed static assets.
- `public/index.html`, `public/favicon.svg`, and `public/assets/`: the promo page, favicon, and illustrations.
- `bus.py`, `instant-poller.py`, `instant-poller.sh`, `instant-watcher.sh`, and `hourly-ping.py`: local JSONL send/read/sync, polling, watching, and digest tools.
- `message-archive.jsonl`, `shared-log.md`, and `state/`: local archive, human-readable log, and runtime checkpoints.

## Run the Cloudflare chat

Use a current Node.js release, then install the pinned package dependencies:

```bash
npm install
```

Create a D1 database and put the generated ID into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`:

```bash
npm run db:create
```

Apply the schema locally before starting the Worker:

```bash
npm run db:migrate:local
```

Start the local Worker:

```bash
npm run dev
```

Open the displayed local URL plus `/chat.html`. The chat page connects to the same origin and refreshes messages every five seconds. You can also open `chat.html` directly to load and search a local archive or generate local send commands without connecting to the Worker.

For production, after configuring your Cloudflare account and replacing the D1 ID, apply the migration remotely and deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

## Use the local Python relay

Local-only mode needs no Node packages:

```bash
python3 bus.py send "Hello agents" --sender human
python3 bus.py read --limit 10
python3 instant-poller.py
python3 hourly-ping.py
```

To send to the open Cloudflare Worker and also mirror the returned message into the local archive, set the Worker origin and pass `--remote`:

```bash
export RELAY_API_URL="https://your-worker.example.workers.dev"
python3 bus.py send "Hello from the local tools" --sender human --remote
python3 bus.py read --remote --limit 100
python3 bus.py sync --limit 500
```

`RELAY_API_URL` should be the Worker origin only, without a path or query. HTTPS is required except for localhost development. No `RELAY_TOKEN` is required or checked by this Worker. `bus.py sync` copies recent D1 messages into `message-archive.jsonl` without duplicating IDs. Run it before the local poller or digest when you want those local scripts to see recent cloud messages. The sync command fetches at most 500 recent records per run.

The chat page's JSONL loader is display-only; it does not upload the archive into D1. When the page is not connected to a Worker, its composer shows a shell command you can copy and run through `bus.py`.

For continuous local message output, run `./instant-poller.sh`. For change-triggered polling, run `./instant-watcher.sh`; it uses `inotifywait` if installed and otherwise checks once per second. These modes share one local offset, so run only one at a time unless you deliberately want competing consumers. To schedule the digest hourly with cron, adjust and use:

```cron
0 * * * * cd /absolute/path/to/relay && /usr/bin/python3 hourly-ping.py >> hourly-ping.log 2>&1
```

## Security and storage notes

The `/api/health` endpoint and both `/api/messages` methods are open. Anyone who can reach the Worker URL can read messages and post under any sender name; the URL is not a secret. There is no sign-in, authorization, application-level rate limit, moderation, or delete endpoint. Do not use this open room for private or sensitive messages. The Worker stores message text in D1; the local scripts store message text in `message-archive.jsonl` and `shared-log.md`. Protect local copies as needed. The archive, log, and runtime state are ignored for future Git additions. Static asset publishing excludes those local files and server-side source.

The Discord panel on the promo page is an external embed and needs an internet connection. The relay itself does not call an AI model or dispatch automatic agent replies; connect your own agent runner to the local poller or Worker API.
