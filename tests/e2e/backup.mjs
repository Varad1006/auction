// End-to-end test of the admin backup: every table as JSON and every stored
// photo/receipt as a zip, admin only. Same setup as smoke.mjs.
import { createServerClient } from "@supabase/ssr";
import { unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${msg}`);
  if (!cond) failures++;
};

async function sessionCookies(email) {
  const jar = new Map();
  const sb = createServerClient(SB_URL, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: "test-password-1" });
  if (error) throw new Error(error.message);
  return [...jar].map(([name, value]) => ({ name, value }));
}
const admin = await sessionCookies("admin@test.local");
const owner = await sessionCookies("owner1@test.local");
const cookie = (c) => c.map((x) => `${x.name}=${x.value}`).join("; ");
const get = (c, path) => fetch(`${APP}${path}`, { headers: { cookie: c ? cookie(c) : "", origin: APP } });

console.log("Who can download");
check((await get(null, "/api/admin/backup?part=data")).status === 401, "signed-out visitors can't");
check((await get(owner, "/api/admin/backup?part=data")).status === 403, "owners can't");
check((await get(owner, "/api/admin/backup?part=files")).status === 403, "…not even the file list");

// A photo, so there's at least one stored file to back up.
const players = await (await fetch(`${SB_URL}/rest/v1/players?select=id,name&order=name&limit=1`, { headers: { apikey: ANON } })).json();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const up = new FormData();
up.append("playerId", players[0].id);
up.append("file", new Blob([png], { type: "image/png" }), "p.png");
const upload = await fetch(`${APP}/api/admin/photo`, { method: "POST", body: up, headers: { cookie: cookie(admin), origin: APP } });
check(upload.ok, "a test photo is uploaded");

console.log("Downloads");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await browser.newContext({ acceptDownloads: true });
await ctx.addCookies(admin.map((c) => ({ ...c, url: APP })));
const page = await ctx.newPage();
await page.goto(`${APP}/admin/settings`);
const [dataFile] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Download data (.json)" }).click()]);
const backup = JSON.parse(readFileSync(await dataFile.path(), "utf8"));
const count = async (table) => Number((await fetch(`${SB_URL}/rest/v1/${table}?select=id`, { headers: { apikey: ANON, Prefer: "count=exact", Range: "0-0" } })).headers.get("content-range")?.split("/")[1]);
check(dataFile.suggestedFilename().startsWith("auction-backup-") && dataFile.suggestedFilename().endsWith(".json"), `the data file is named ${dataFile.suggestedFilename()}`);
check(Object.keys(backup.tables).length === 18 && Object.keys(backup.errors).length === 0, `all 18 tables are saved (errors: ${JSON.stringify(backup.errors)})`);
check(backup.tables.players.length === (await count("players")) && backup.tables.teams.length === (await count("teams")), `every player and team is in it (${backup.tables.players.length} players)`);
check(backup.tables.owners.some((o) => o.email === "owner1@test.local") && backup.tables.registrations !== undefined, "private tables (owners, registrations) are in it too");

const [zipFile] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /Download photos & receipts/ }).click()]);
const files = unzipSync(new Uint8Array(readFileSync(await zipFile.path())));
const names = Object.keys(files);
check(names.some((n) => n.startsWith(`player-photos/${players[0].id}/`) && files[n].length === png.length), `the zip holds the stored photos (${names.length} files)`);
await browser.close();

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
