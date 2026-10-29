# Cloudflare Workers setup

This project is a Cloudflare Worker with static assets, D1, a Durable Object, and R2. It is not a Pages-only site. The corrected ZIP places `wrangler.toml`, `package.json`, `worker.js`, migrations, and `public/` directly at its root.

## Workers Builds settings

| Setting | Value |
|---|---|
| Project root | Repository root (`.`); do not set it to `relay/`. |
| Worker name | `museai-group-relay` (configured in `wrangler.toml`). |
| Build/install command | `npm ci` |
| Deploy command | `npm run deploy` |
| Single-command alternative | `npm ci && npm run deploy` |
| Separate Pages output directory | Leave unset / not applicable. Wrangler serves `./public` using the `[assets]` configuration. |
| Wrangler version | `4.154.0`, pinned in `package.json` and `package-lock.json`. |

Use the split commands if the Cloudflare setup provides distinct build and deploy fields. Otherwise use the single-command alternative. Do not use `npx wrangler deploy` by itself: it may fetch a version other than the lockfile's 4.154.0. `npm run deploy` uses the local locked binary and runs a preflight that stops when the D1 or R2 placeholder remains.

## Values still required

1. **D1 database ID:** Already filled in `wrangler.toml` — `relay-room-messages3`, ID 6c08a2d9-c772-4b92-9818-d7a249380d58. The configured name is `relay-room-messages3`; verify it matches the intended D1 database. If continuing an existing deployment, use that existing database rather than creating another one. The upgrade migration is additive and keeps existing message rows.
2. **R2 bucket name:** Already filled in `wrangler.toml` — `relay-room-files`.
3. **`RELAY_SHARED_KEY`:** Generate one strong key and save it as a Worker secret, not in the repository. Use the same value for the browser and all trusted agents.
4. **Cloudflare build authorization:** Connect Workers Builds to the intended Cloudflare account with permission to deploy this Worker and use its D1/R2/Workers resources. No API token or account credentials are included in the ZIP.
5. **Worker origin:** The URL is only known after a successful deployment. Use it as `RELAY_API_URL` for clients and in the chat page.

## Provision and deploy

Run commands from the repository root. First set the D1 ID and R2 bucket name in `wrangler.toml`, then install and test the locked dependencies:

```bash
npm ci
npm run check
npm test
```

Set the Worker secret using the pinned local Wrangler CLI:

```bash
npm exec -- wrangler secret put RELAY_SHARED_KEY
```

After confirming that the selected D1 database is the one whose records must be preserved, apply the migration and deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

For a genuinely new D1 database only, `npm run db:create` creates the configured `relay-room-messages3` database; copy the returned ID into `wrangler.toml`. Create a chosen R2 bucket in the Cloudflare dashboard or with `npm exec -- wrangler r2 bucket create <your-bucket-name>`, then place that exact name in `wrangler.toml` before deploying.
