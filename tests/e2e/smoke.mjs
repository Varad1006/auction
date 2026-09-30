// End-to-end smoke test against a running app + local Supabase.
//
//   supabase start && npm run build && npm start   (with .env.local pointing at local Supabase)
//   node tests/e2e/smoke.mjs
//
// Needs test users (see scripts/e2e-users.sh). Drives an admin (desktop), two
// owners (phones) and an anonymous viewer (phone) at the same time and checks
// that authorization is enforced server-side and that every screen stays in
// sync in real time. Screenshots go to $SHOTS (default tests/e2e/shots).
import { createServerClient } from "@supabase/ssr";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "test-password-1";
const SHOTS = process.env.SHOTS ?? "tests/e2e/shots";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${msg}`);
  if (!cond) failures++;
}

/** Signs in with a password and returns the @supabase/ssr auth cookies. */
async function sessionCookies(email) {
  const jar = new Map();
  const sb = createServerClient(SB_URL, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return [...jar].map(([name, value]) => ({ name, value }));
}

const cookieHeader = (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join("; ");

async function act(cookies, action, body, origin = APP) {
  const res = await fetch(`${APP}/api/actions/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookies ? { cookie: cookieHeader(cookies) } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function rest(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json", ...init.headers },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const admin = await sessionCookies("admin@test.local");
const owner1 = await sessionCookies("owner1@test.local");
const owner2 = await sessionCookies("owner2@test.local");
const stranger = await sessionCookies("stranger@test.local");

// ---------------------------------------------------------------------------
console.log("Server-side authorization");
const reset = await act(admin, "auction.reset", { confirm: "RESET" });
check(reset.status === 200, `admin can reset the auction (${reset.body?.message ?? reset.status})`);

const me = async (c) => (await fetch(`${APP}/api/me`, { headers: { cookie: cookieHeader(c) } })).json();
check((await me(admin)).role === "admin", "admin email resolves to admin");
const o1 = await me(owner1);
check(o1.role === "owner" && o1.teamId, "owner email resolves to owner with a team");
check((await me(stranger)).role === "viewer", "unmapped email resolves to viewer");

for (const [action, body] of [
  ["auction.spin", {}],
  ["auction.sell", { playerId: "00000000-0000-4000-8000-000000000000" }],
  ["auction.undoResult", {}],
  ["bid.undo", {}],
  ["player.update", { id: "00000000-0000-4000-8000-000000000000", name: "Hacked" }],
  ["pool.update", { pool: "men" }],
  ["owner.upsert", { email: "me@x.com", teamId: o1.teamId }],
  ["auction.reset", { confirm: "RESET" }],
]) {
  const r = await act(owner1, action, body);
  check(r.status === 403, `owner calling ${action} is rejected (${r.status})`);
}
check((await act(stranger, "bid.place", { playerId: o1.teamId, amount: 5 })).status === 403, "signed-in viewer cannot bid");
check((await act(null, "bid.place", { playerId: o1.teamId, amount: 5 })).status === 401, "anonymous cannot bid");
check((await act(admin, "auction.spin", {}, "https://evil.example")).status === 403, "cross-origin admin request is rejected");

const somePlayer = (await rest("players?select=id&limit=1")).body[0].id;
const direct = await rest(`players?id=eq.${somePlayer}`, {
  method: "PATCH",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({ name: "Hacked" }),
});
check(direct.status === 401 || direct.status === 403, `direct REST update with the public key is rejected (${direct.status} ${direct.body?.message ?? ""})`);
const insert = await rest("bids", { method: "POST", body: JSON.stringify({ player_id: somePlayer, pool: "men", round: 1, team_id: o1.teamId, amount: 1, placed_by_role: "admin" }) });
check(insert.status === 401 || insert.status === 403, `direct REST insert of a bid is rejected (${insert.status})`);
const rpc = await rest("rpc/auction_reset", { method: "POST", body: JSON.stringify({ p_actor: "x" }) });
check(rpc.status >= 400, `direct RPC to auction functions with the public key is rejected (${rpc.status})`);
const owners = await rest("owners?select=email");
check(owners.status >= 400 || (Array.isArray(owners.body) && owners.body.length === 0), "owner emails are not publicly readable");
const players = await rest("players?select=id,name");
check(players.status === 200 && players.body.length > 0, "players are publicly readable");

// ---------------------------------------------------------------------------
console.log("Live sync across devices");
// PLAYWRIGHT_CHROMIUM lets you point at a pre-installed browser.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
async function open(cookies, device, path = "/") {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport: { width: 1366, height: 900 } });
  if (cookies) await ctx.addCookies(cookies.map((c) => ({ ...c, url: APP })));
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => {
    console.log(`  page error: ${e.message}`);
    failures++;
  });
  await page.goto(`${APP}${path}`);
  return page;
}

const adminPage = await open(admin, null, "/admin");
const ownerPage = await open(owner1, "iPhone 13", "/live");
const owner2Page = await open(owner2, "Pixel 7", "/live");
const viewerPage = await open(null, "iPhone 13", "/live");
const all = [adminPage, ownerPage, owner2Page, viewerPage];
await Promise.all(all.map((p) => p.getByText("Waiting for the next spin").waitFor({ timeout: 15000 })));
await viewerPage.screenshot({ path: `${SHOTS}/01-viewer-idle.png`, fullPage: true });
check((await viewerPage.getByRole("button", { name: /^(Bid|Jump|Bidding)/ }).count()) === 0, "viewer page renders no bid controls");
check((await viewerPage.getByRole("link", { name: "Admin" }).count()) === 0, "viewer page has no admin link");

await adminPage.getByRole("button", { name: /Spin the wheel/ }).click();
await Promise.all(all.map((p) => p.getByText(/Spinning · \d+ players/).waitFor({ timeout: 5000 })));
check(true, "wheel appears on every device after the admin spins");
await viewerPage.waitForTimeout(2500);
await viewerPage.screenshot({ path: `${SHOTS}/02-viewer-spinning.png` });

await adminPage.getByRole("button", { name: /Open bidding for/ }).waitFor({ timeout: 15000 });
const openLabel = await adminPage.getByRole("button", { name: /Open bidding for/ }).textContent();
const playerName = openLabel.replace("Open bidding for ", "").trim();
await Promise.all(all.map((p) => p.getByRole("heading", { name: playerName }).waitFor({ timeout: 15000 })));
check(true, `every device reveals the same player (${playerName})`);

await adminPage.getByRole("button", { name: /Open bidding for/ }).click();
const bidButton = ownerPage.getByRole("button", { name: /^Bid/ });
await bidButton.waitFor({ timeout: 5000 });
await ownerPage.screenshot({ path: `${SHOTS}/03-owner-bidding.png` });
await bidButton.click();
await viewerPage.getByText("Leading", { exact: true }).first().waitFor({ timeout: 5000 });
check(true, "owner bid shows on the viewer's phone");
await ownerPage.getByText(/You're leading at/).waitFor({ timeout: 5000 });
check(true, "owner sees they are leading, bid buttons hidden");

// Both owners tap at the same moment; exactly one bid of that amount wins.
const before = await rest(`auction_state?select=bid_count`);
const o2Bid = owner2Page.getByRole("button", { name: /^Bid/ });
await o2Bid.waitFor({ timeout: 5000 });
await owner2Page.screenshot({ path: `${SHOTS}/04-owner2-bidding.png` });
const r1 = await act(owner2, "bid.place", { playerId: (await rest("auction_state?select=current_player_id")).body[0].current_player_id, amount: 1000000 });
check(r1.status === 409, `bid over the purse is rejected by the server (${r1.body?.code})`);
const state = (await rest("auction_state?select=current_player_id,current_bid")).body[0];
const team3 = (await rest("teams?select=id&order=sort_order&offset=2&limit=1")).body[0].id;
const race = await Promise.all([
  act(owner2, "bid.place", { playerId: state.current_player_id, amount: state.current_bid + 5 }),
  act(admin, "bid.place", { playerId: state.current_player_id, teamId: team3, amount: state.current_bid + 5 }),
]);
const wins = race.filter((r) => r.status === 200).length;
check(wins === 1, `simultaneous equal bids: exactly one accepted (${race.map((r) => r.body?.code ?? "ok").join(", ")})`);
const after = await rest(`auction_state?select=bid_count,current_bid`);
check(after.body[0].bid_count === before.body[0].bid_count + 1, "bid count increased by exactly one");

// Owner 1 cannot bid for another team even if the request says so.
const cur = (await rest("auction_state?select=current_player_id,current_bid,leading_team_id")).body[0];
const forged = await act(owner1, "bid.place", { playerId: cur.current_player_id, amount: cur.current_bid + 5, teamId: cur.leading_team_id });
const leader = (await rest("auction_state?select=leading_team_id")).body[0].leading_team_id;
check(forged.status === 200 && leader === o1.teamId, "owner's forged teamId is ignored: bid goes to their own team");

await viewerPage.screenshot({ path: `${SHOTS}/05-viewer-bidding.png`, fullPage: true });
await adminPage.screenshot({ path: `${SHOTS}/06-admin-bidding.png`, fullPage: true });

await adminPage.getByRole("button", { name: /^SOLD to/ }).click();
await Promise.all([viewerPage, ownerPage].map((p) => p.getByText("Sold", { exact: true }).first().waitFor({ timeout: 5000 })));
check(true, "SOLD stamp appears on viewer and owner phones");
await viewerPage.screenshot({ path: `${SHOTS}/07-viewer-sold.png`, fullPage: true });
const sold = (await rest(`players?select=status,sold_team_id,sold_price&name=eq.${encodeURIComponent(playerName)}`)).body[0];
check(sold.status === "sold" && sold.sold_team_id === o1.teamId, "player recorded as sold to owner 1's team");

await adminPage.getByRole("button", { name: /Undo last result/ }).click();
await ownerPage.getByText(/You're leading at/).waitFor({ timeout: 5000 });
check(true, "undo result puts the player back on the block with owner 1 leading");
await adminPage.getByRole("button", { name: /^SOLD to/ }).click();
await viewerPage.getByText("Sold", { exact: true }).first().waitFor({ timeout: 5000 });

// A fresh visit after a sale shows the wheel for the next player, while
// screens that watched the sale keep the SOLD card.
check((await viewerPage.getByRole("heading", { name: playerName }).count()) > 0, "viewer who watched still sees the sold player");
await ownerPage.reload();
await ownerPage.getByText("Waiting for the next spin").waitFor({ timeout: 10000 });
check((await ownerPage.getByRole("img", { name: "Player wheel" }).count()) === 1, "a fresh visit after a sale shows the wheel, not the last sold player");
await ownerPage.screenshot({ path: `${SHOTS}/08-owner-after-sale.png`, fullPage: true });

for (const [path, marker] of [
  ["/admin/players", /Players \(\d+\)/],
  ["/admin/settings", "Men pool"],
  ["/admin/owners", "owner1@test.local"],
  ["/admin/results", /Results log/],
]) {
  await adminPage.goto(`${APP}${path}`);
  await adminPage.getByText(marker).first().waitFor({ timeout: 10000 });
  await adminPage.waitForTimeout(500);
  check(true, `admin page ${path} renders`);
  await adminPage.screenshot({ path: `${SHOTS}/09-admin${path.replaceAll("/", "-")}.png`, fullPage: true });
}
const ownerAdmin = await ownerPage.goto(`${APP}/admin`);
check((await ownerPage.getByText("Admins only").count()) === 1 && ownerAdmin.status() === 200, "owner visiting /admin sees 'Admins only'");

const csv = await fetch(`${APP}/api/admin/export?kind=players`, { headers: { cookie: cookieHeader(admin) } });
check(csv.status === 200 && (await csv.text()).includes(playerName), "admin CSV export includes the sold player");
const csvOwner = await fetch(`${APP}/api/admin/export?kind=players`, { headers: { cookie: cookieHeader(owner1) } });
check(csvOwner.status === 403, "owner cannot export CSV");

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
