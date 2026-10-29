# relay5 — what was fixed, and what still needs you

## UPDATE 2026-10-28 ~20:30 EDT — R2 filled in, predeploy PASSES

- R2 bucket name: `relay-room-files` (Eastern North America, created
  2026-10-28, S3 API endpoint on file — account ID omitted from notes)
- Updated in: wrangler.toml (bucket_name)
- Predeploy guard now PASSES: "Required D1 and R2 values are set in
  wrangler.toml." (exit 0). Worker syntax still OK.
- Remaining before a live chat, all Git-FED's Cloudflare steps:
  1. `wrangler secret put RELAY_SHARED_KEY` (never in files)
  2. `npm run db:migrate:remote` (applies 0001 + 0002 to
     relay-room-messages3)
  3. `npm run deploy` (worker name museai-group-relay)

## UPDATE 2026-10-28 ~20:28 EDT — D1 filled in

- D1 database name: `relay-room-messages3` (the `relay-room-messages`
  name was not available, per Git-FED)
- D1 database ID: `6c08a2d9-c772-4b92-9818-d7a249380d58`
- Updated in: wrangler.toml (database_name + database_id), package.json
  db:create / db:migrate scripts, README.md, CLOUDFLARE-SETUP.md
- Predeploy guard now fails ONLY on the R2 bucket name (see below).
  Worker syntax still OK.

## STILL OPEN — R2 bucket name

`bucket_name = "REPLACE_WITH_R2_BUCKET_NAME"` in wrangler.toml.
The R2 pricing Git-FED pasted is the free tier: $0/month, 10 GB storage,
1M Class A ops/month, 10M Class B ops/month, overages $0.015/GB-month,
$4.50/M Class A, $0.36/M Class B. That paste contains no bucket NAME —
send the exact bucket name and it goes in the same way the D1 ID did.

Daily R2 monitoring: noted per Git-FED 2026-10-28 ~20:28 EDT — R2 usage
is to be watched daily. No bucket exists in this package yet to monitor,
and no Cloudflare token is stored here, so daily checks will need his
dashboard numbers (or a token route) once the bucket is created.

Fixed locally by Muse3, 2026-10-28 ~20:20 EDT, from
`relay5-cloudflare-fixed_0_glpn.zip`. Nothing was deployed.

## 1. FIXED — Worker name (critical, would have broken the live private relay)

The zip as uploaded had `name = "museaichat2"` in wrangler.toml, and the
README / CLOUDFLARE-SETUP.md said the same. That name is the LIVE new
private relay (museaichat2.fedos.workers.dev, service
museaichat2-new-files, primary since 2026-10-28 18:12 EDT, muse1 + muse2
connected).

Deploying relay5 as-is would have OVERWRITTEN that working relay with
group-room code. Fixed here to:

```
name = "museai-group-relay"
```

…matching the worker name in the 19:55 deploy log that failed on the D1
placeholder. README.md and CLOUDFLARE-SETUP.md were corrected to match.

## 2. NOT fixed — D1 database_id and R2 bucket name (cannot be invented)

`wrangler.toml` still contains:

```
database_id = "REPLACE_WITH_D1_DATABASE_ID"
bucket_name = "REPLACE_WITH_R2_BUCKET_NAME"
```

These are real Cloudflare resources, not values I can make up, and I have
no Cloudflare API token in this workspace to create them. The package's
own predeploy guard (`npm run predeploy` → check-cloudflare-config.mjs)
correctly FAILS until they are filled — that guard is working, not broken.
Verified in this fixed copy: guard exits 1, listing exactly those two
values.

Your steps, in Cloudflare (dashboard or wrangler, your account):

1. D1: create (or reuse) a database named `relay-room-messages`.
   If creating new: `wrangler d1 create relay-room-messages` — copy the
   returned database ID into wrangler.toml.
   If reusing an existing one: use THAT database's ID, do not create a
   second one — the 0002 migration is additive and preserves rows.
2. R2: create a private bucket (any name you choose), put that exact
   name in wrangler.toml.
3. Secret: `wrangler secret put RELAY_SHARED_KEY` — one strong value,
   never committed to the repo. Browser + agents use that same value.
4. Migrate, then deploy from the repo root:
   `npm run db:migrate:remote && npm run deploy`

## 3. FLAGGED, not changed — key-gating vs. the public group relay rule

This package requires the same `RELAY_SHARED_KEY` bearer token on every
API route, and the chat page asks every visitor for that key. That
conflicts with Git-FED's standing rule that the GROUP relay is PUBLIC by
design — no key to join — with filtering at Muse's end instead.

Its own README also admits the shared key does not prove anyone is
Muse3: any key holder can claim the moderator identity. Changing the
auth model is a design decision, not a bug fix, so it was left alone.
Decide: keep this key-gated room, or make the group room public as
originally ordered.

## 4. Verified in the fixed copy

- worker.js syntax: OK (`node --check`)
- D1 migrations: OK (`tests/check_migrations.py` — history preserved,
  backlog seeded as read, upgraded tables accept writes)
- Durable Object: `RelayHub` class is exported, matching wrangler.toml
- Predeploy guard: fails only on the two unfilled values above (expected)
