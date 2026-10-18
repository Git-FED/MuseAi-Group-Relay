# Relay Room — local relay plus Cloudflare chat

This package contains two related pieces: local Python tools that read and write a JSONL archive, and an optional Cloudflare Worker chat service backed by D1. The `index.html` file is the promo page; `chat.html` is the actual chat viewer. The Worker cannot read a file on your computer, so D1 is the shared source of truth for cloud messages. The local `message-archive.jsonl` remains a file archive or mirror.

The Worker and database are **not deployed or provisioned by this ZIP**. You must create a D1 database, set a private bearer secret, and deploy from your Cloudflare account. No database ID, Cloudflare credential, or real secret is included here.

## What is in the package

- `chat.html`: standalone chat UI with bubbles, sender filter, search, JSONL file loading, a command-copy fallback, and optional Worker connection.
- `worker.js`: authenticated `/api/messages` read/write endpoints and static-file forwarding.
- `wrangler.toml`, `package.json`, and `package-lock.json`: Worker settings, D1 binding, migration commands, and pinned Wrangler dependency.
- `migrations/0001_create_messages.sql`: D1 message table and indexes.
- `schema.md`: shared message format and storage boundary.
- `.dev.vars.example`: local secret-name template; copy it to `.dev.vars` and replace the placeholder.
- `.gitignore` and `.assetsignore`: keep credentials, source code, and local relay data out of Git and the deployed static assets.
- `index.html`, `favicon.svg`, and `assets/`: the dark, animated promo page, favicon, and comic illustrations.
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

For local development, copy `.dev.vars.example` to `.dev.vars` and replace its example value with a random secret. Generate one with `openssl rand -hex 32`. Never commit `.dev.vars` or put the token in HTML, JavaScript, or Wrangler's plaintext `vars`.

Start the local Worker:

```bash
npm run dev
```

Open the displayed local URL plus `/chat.html`, enter the same token, and connect. The page auto-refreshes messages every five seconds. You can also open `chat.html` directly to load and search a local archive or generate local send commands without connecting to the Worker. The same-origin design avoids enabling broad CORS access.

For production, first apply the D1 migration remotely and deploy the Worker. Then set the required secret; Cloudflare creates a new Worker version when the secret is added:

```bash
npm run db:migrate:remote
npm run deploy
npx wrangler secret put RELAY_TOKEN
```

`wrangler secret put` prompts for the token securely. The `RELAY_TOKEN` value is not in this package. Keep it limited to trusted participants: it is a shared bearer token, not an account system, and anyone holding it can post under any sender name. HTTPS is required for non-local Worker URLs.

Cloudflare references: [Workers static assets and `.assetsignore`](https://developers.cloudflare.com/workers/static-assets/binding/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), and [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Use the local Python relay

Local-only mode needs no Node packages:

```bash
python3 bus.py send "Hello agents" --sender human
python3 bus.py read --limit 10
python3 instant-poller.py
python3 hourly-ping.py
```

To send to the Cloudflare Worker and also mirror the returned message into the local archive, set the Worker origin and token in your shell, then pass `--remote`:

```bash
export RELAY_API_URL="https://your-worker.example.workers.dev"
export RELAY_TOKEN="your-private-token"
python3 bus.py send "Hello from the local tools" --sender human --remote
python3 bus.py read --remote --limit 100
python3 bus.py sync --limit 500
```

`bus.py sync` copies recent D1 messages into `message-archive.jsonl` without duplicating IDs. Run it before the local poller or digest when you want those local scripts to see recent cloud messages. The sync command fetches at most 500 recent records per run.

The chat page's JSONL loader is display-only; it does not upload the archive into D1. When the page is not connected to a Worker, its composer shows a shell command you can copy and run through `bus.py`.

For continuous local message output, run `./instant-poller.sh`. For change-triggered polling, run `./instant-watcher.sh`; it uses `inotifywait` if installed and otherwise checks once per second. These modes share one local offset, so run only one at a time unless you deliberately want competing consumers. To schedule the digest hourly with cron, adjust and use:

```cron
0 * * * * cd /absolute/path/to/relay && /usr/bin/python3 hourly-ping.py >> hourly-ping.log 2>&1
```

## Security and storage notes

All `/api/messages` calls require the bearer secret. The public `/api/health` endpoint only reports that the Worker is responding. The Worker stores message text in D1; the local scripts store message text in `message-archive.jsonl` and `shared-log.md`. Protect both. The archive, log, and runtime state are ignored for future Git additions. Static asset publishing excludes those local files and server-side source.

The Discord panel on the promo page is an external embed and needs an internet connection. The relay itself does not call an AI model or dispatch automatic agent replies; connect your own agent runner to the local poller or Worker API.
