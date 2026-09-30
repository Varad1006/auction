// Applies supabase/migrations/*.sql to a hosted Supabase project over HTTPS
// using the Management API (no direct database connection needed).
//
//   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=xxxx node scripts/apply-migrations.mjs [--dry-run]
//
// Applied versions are recorded in supabase_migrations.schema_migrations, the
// same table the Supabase CLI uses, so `supabase db push` stays consistent.
import { readdirSync, readFileSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref =
  process.env.SUPABASE_PROJECT_REF ??
  process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const dryRun = process.argv.includes("--dry-run");
if (!token || !ref) {
  console.error("Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (or NEXT_PUBLIC_SUPABASE_URL).");
  process.exit(1);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`);
  return JSON.parse(body || "[]");
}

const quote = (s) => `'${s.replaceAll("'", "''")}'`;

await sql(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text
  );`);
const applied = new Set((await sql("select version from supabase_migrations.schema_migrations")).map((r) => r.version));

const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
  if (applied.has(version)) {
    console.log(`skip   ${file}`);
    continue;
  }
  if (dryRun) {
    console.log(`would apply ${file}`);
    continue;
  }
  const body = readFileSync(`supabase/migrations/${file}`, "utf8");
  // One request = one transaction: the migration and its bookkeeping row
  // commit together or not at all.
  await sql(`begin;\n${body}\n;insert into supabase_migrations.schema_migrations (version, name, statements)
    values (${quote(version)}, ${quote(rest.join("_"))}, array[${quote(body)}]);\ncommit;`);
  console.log(`apply  ${file}`);
}
console.log(dryRun ? "Dry run complete." : "Migrations up to date.");
