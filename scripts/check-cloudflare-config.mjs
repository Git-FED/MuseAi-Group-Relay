import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const required = [
  {
    label: "D1 database_id",
    pattern: /^\s*database_id\s*=\s*"([^"]*)"/m,
    placeholder: "REPLACE_WITH_D1_DATABASE_ID",
  },
  {
    label: "R2 bucket_name",
    pattern: /^\s*bucket_name\s*=\s*"([^"]*)"/m,
    placeholder: "REPLACE_WITH_R2_BUCKET_NAME",
  },
];

const missing = [];
for (const item of required) {
  const match = config.match(item.pattern);
  if (!match || !match[1] || match[1] === item.placeholder) missing.push(item.label);
}

if (missing.length) {
  console.error("Cloudflare configuration is incomplete. Set these values in wrangler.toml:");
  for (const item of missing) console.error(`- ${item}`);
  process.exitCode = 1;
} else {
  console.log("Required D1 and R2 values are set in wrangler.toml.");
}
