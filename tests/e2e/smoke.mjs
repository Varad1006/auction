// End-to-end smoke test against a running app + local Supabase.
//
//   supabase start && npm run build && npm start   (with .env.local pointing at local Supabase)
//   node tests/e2e/smoke.mjs
//
// Needs test users (see scripts/e2e-users.sh) and the app started with
// PUSH_ALLOW_LOCALHOST=1 (so it can deliver to the fake push service below).
// Drives an admin (desktop), two owners (phones) and an anonymous viewer
// (phone) at the same time and checks that authorization is enforced
// server-side, that every screen stays in sync in real time, and that owner
// wishlists stay private and trigger push notifications. Screenshots go to
// $SHOTS (default tests/e2e/shots).
import { createServerClient } from "@supabase/ssr";
import ece from "http_ece";
import { createECDH, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
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

// Wishlists survive a reset; start from empty ones.
for (const owner of [owner1, owner2]) {
  const list = await (await fetch(`${APP}/api/wishlist`, { headers: { cookie: cookieHeader(owner) } })).json();
  for (const e of list.entries ?? []) await act(owner, "wishlist.remove", { playerId: e.player_id });
}

const me = async (c) => (await fetch(`${APP}/api/me`, { headers: { cookie: cookieHeader(c) } })).json();
check((await me(admin)).role === "admin", "admin email resolves to admin");
const o1 = await me(owner1);
check(o1.role === "owner" && o1.teamId, "owner email resolves to owner with a team");
check((await me(stranger)).role === "viewer", "unmapped email resolves to viewer");

for (const [action, body] of [
  ["bid.place", { playerId: "00000000-0000-4000-8000-000000000000", amount: 50, teamId: o1.teamId }],
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

const teams = (await rest("teams?select=id,name&order=sort_order,name")).body;
const [team1, team2, team3] = teams;
const teamButton = (t) => adminPage.getByRole("button", { name: new RegExp(`^${t.name}\\b`) });

await adminPage.getByRole("button", { name: /Open bidding for/ }).click();
await teamButton(team1).waitFor({ timeout: 5000 });
check((await ownerPage.getByRole("button", { name: /^(Bid|Jump)/ }).count()) === 0, "owners get no bid buttons");
await adminPage.screenshot({ path: `${SHOTS}/03-admin-bidding.png`, fullPage: true });
await teamButton(team1).click();
await viewerPage.getByText("Leading", { exact: true }).first().waitFor({ timeout: 5000 });
check(true, "the auctioneer's bid for a team shows on the viewer's phone");
await ownerPage.getByText(/Your team leads at/).waitFor({ timeout: 5000 });
check(true, "owner sees their team is leading");
await ownerPage.screenshot({ path: `${SHOTS}/04-owner-leading.png` });

// Two bids of the same amount at the same moment; exactly one wins.
const before = await rest(`auction_state?select=bid_count`);
const state = (await rest("auction_state?select=current_player_id,current_bid")).body[0];
const r1 = await act(admin, "bid.place", { playerId: state.current_player_id, teamId: team2.id, amount: 1000000 });
check(r1.status === 409, `bid over the purse is rejected by the server (${r1.body?.code})`);
const race = await Promise.all([
  act(admin, "bid.place", { playerId: state.current_player_id, teamId: team2.id, amount: state.current_bid + 5 }),
  act(admin, "bid.place", { playerId: state.current_player_id, teamId: team3.id, amount: state.current_bid + 5 }),
]);
const wins = race.filter((r) => r.status === 200).length;
check(wins === 1, `simultaneous equal bids: exactly one accepted (${race.map((r) => r.body?.code ?? "ok").join(", ")})`);
await ownerPage.getByText(/Outbid!/).waitFor({ timeout: 5000 });
check(true, "owner 1 gets an outbid alert when another team takes the lead");
const after = await rest(`auction_state?select=bid_count,current_bid`);
check(after.body[0].bid_count === before.body[0].bid_count + 1, "bid count increased by exactly one");

await teamButton(team1).click();
await ownerPage.getByText(/Your team leads at/).waitFor({ timeout: 5000 });
await viewerPage.screenshot({ path: `${SHOTS}/05-viewer-bidding.png`, fullPage: true });

await adminPage.getByRole("button", { name: /^SOLD to/ }).click();
await Promise.all([viewerPage, ownerPage].map((p) => p.getByText("Sold", { exact: true }).first().waitFor({ timeout: 5000 })));
check(true, "SOLD stamp appears on viewer and owner phones");
await ownerPage.getByText(/You signed .* for/).waitFor({ timeout: 5000 });
check(true, "owner 1 is told they signed the player");
await viewerPage.screenshot({ path: `${SHOTS}/07-viewer-sold.png`, fullPage: true });
const sold = (await rest(`players?select=id,status,sold_team_id,sold_price&name=eq.${encodeURIComponent(playerName)}`)).body[0];
check(sold.status === "sold" && sold.sold_team_id === o1.teamId, "player recorded as sold to owner 1's team");

await adminPage.getByRole("button", { name: /Undo last result/ }).click();
await ownerPage.getByText(/Your team leads at/).waitFor({ timeout: 5000 });
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

// ---------------------------------------------------------------------------
console.log("Wishlists");
const menPool = (await rest("players?select=id,name,base_price&pool=eq.men&status=eq.pool&order=name")).body;
const [w1, w2] = menPool;
check((await act(owner1, "wishlist.add", { playerId: w1.id, priority: 1 })).status === 200, "owner adds a player to the team wishlist");
check((await act(owner1, "wishlist.add", { playerId: sold.id })).status === 409, "a sold player can't be wishlisted");
check((await act(admin, "wishlist.add", { playerId: w1.id })).status === 403, "admins have no wishlist");
check((await act(stranger, "wishlist.add", { playerId: w1.id })).status === 403, "signed-in viewers can't wishlist");
check((await act(owner2, "wishlist.update", { playerId: w1.id, maxPrice: 1 })).status === 404, "an owner can't edit another team's wishlist");
const wishlistOf = async (c) => fetch(`${APP}/api/wishlist`, { headers: c ? { cookie: cookieHeader(c) } : {} });
check((await (await wishlistOf(owner2)).json()).entries.length === 0, "another team's owner can't see the wishlist");
check((await wishlistOf(null)).status === 401 && (await wishlistOf(stranger)).status === 403, "the wishlist API needs an owner sign-in");
for (const table of ["wishlist", "push_subscriptions", "app_secrets"]) {
  const r = await rest(`${table}?select=*`);
  check(r.status >= 400 || r.body.length === 0, `${table} is not readable with the public key (${r.status})`);
}

await ownerPage.goto(`${APP}/players?pool=men`);
await ownerPage.getByRole("button", { name: `Add ${w2.name} to wishlist` }).click();
await ownerPage.getByRole("button", { name: `Remove ${w2.name} from wishlist` }).waitFor({ timeout: 5000 });
check(true, "owner stars a player on the Players page");
await ownerPage.getByRole("link", { name: "★ Wishlist", exact: true }).click();
await ownerPage.getByRole("heading", { name: "Your wishlist" }).waitFor({ timeout: 10000 });
await ownerPage.getByRole("tablist", { name: "Pool" }).getByRole("tab", { name: /^Men/ }).click();
await ownerPage.getByRole("button", { name: new RegExp(w1.name) }).first().click();
const maxPrice = w1.base_price + 20;
await ownerPage.getByLabel("My max price").fill(String(maxPrice));
await ownerPage.getByLabel("My max price").press("Enter");
await ownerPage.waitForTimeout(800);
const mine = (await (await wishlistOf(owner1)).json()).entries;
check(
  mine.length === 2 && mine.find((e) => e.player_id === w1.id)?.max_price === maxPrice && mine.find((e) => e.player_id === w2.id),
  "starred player and max price are saved to the team wishlist",
);
await ownerPage.screenshot({ path: `${SHOTS}/10-owner-wishlist.png`, fullPage: true });

// Push: a fake push service on localhost receives the encrypted messages.
const pushes = [];
const pushServer = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    pushes.push({ path: req.url, at: Date.now(), headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(201).end();
  });
});
await new Promise((r) => pushServer.listen(0, "127.0.0.1", r));
function device(name) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16).toString("base64url");
  const sub = {
    endpoint: `http://127.0.0.1:${pushServer.address().port}/push/${name}`,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth },
  };
  const read = (p) => JSON.parse(ece.decrypt(p.body, { version: "aes128gcm", privateKey: ecdh, authSecret: auth }).toString());
  return { sub, read };
}
async function nextPush(path, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const i = pushes.findIndex((p) => p.path === path);
    if (i !== -1) return pushes.splice(i, 1)[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
const phone1 = device("owner1");
check((await act(owner1, "push.subscribe", phone1.sub)).status === 200, "owner registers a phone for notifications");
const evil = await act(owner1, "push.subscribe", { ...phone1.sub, endpoint: "https://evil.example/collect" });
check(evil.status === 400, "only browser push services are accepted as endpoints");
check((await act(owner1, "push.test", {})).status === 200, "owner can send a test notification");
const test = await nextPush("/push/owner1");
check(test && phone1.read(test).title.includes("Notifications are on"), "test notification arrives and decrypts");

const selected = await act(admin, "auction.select", { playerId: w1.id });
check(selected.status === 200, "admin puts the wishlisted player on the block");
await ownerPage.getByText(new RegExp(`${w1.name} is up`)).first().waitFor({ timeout: 5000 });
check(true, "owner gets an in-app wishlist alert");
await ownerPage.getByText("On the block now").waitFor({ timeout: 5000 });
const push = await nextPush("/push/owner1");
const msg = push && phone1.read(push);
check(msg?.title === `⭐ ${w1.name} is up now` && msg.body.includes("Must-have") && msg.body.includes("your max"), `push notification sent and decrypts (${msg?.title})`);
check(push?.headers.ttl === "300" && push.headers.urgency === "high" && /^vapid t=/.test(push.headers.authorization ?? ""), "push uses VAPID, a short TTL and high urgency");
await ownerPage.screenshot({ path: `${SHOTS}/11-owner-wishlist-up.png`, fullPage: true });

await act(admin, "auction.openBidding", {});
check((await act(admin, "bid.place", { playerId: w1.id, teamId: team2.id, amount: maxPrice + 10 })).status === 200, "rival bids past the owner's max");
await ownerPage.getByText(/Bidding passed your max/).waitFor({ timeout: 5000 });
await ownerPage.getByText(/Over your max/).first().waitFor({ timeout: 5000 });
check(true, "owner is warned that bidding passed their max");
await ownerPage.screenshot({ path: `${SHOTS}/12-owner-over-max.png` });
await act(admin, "auction.sell", { playerId: w1.id });
await ownerPage.getByText(/removed from your wishlist/).waitFor({ timeout: 5000 });
await ownerPage.getByText(/Went to other teams · 1/).waitFor({ timeout: 5000 });
check(true, "a wishlisted player sold elsewhere drops off the list");

// Spin path: owner 2 wishlists every woman, so the spun player is always
// theirs; the push is held back until the wheel stops.
check((await act(admin, "auction.setPool", { pool: "women" })).status === 200, "admin switches to the women's pool");
const women = (await rest("players?select=id,name&pool=eq.women&status=eq.pool")).body;
for (const w of women) await act(owner2, "wishlist.add", { playerId: w.id });
const phone2 = device("owner2");
await act(owner2, "push.subscribe", phone2.sub);
const spun = await act(admin, "auction.spin", { durationMs: 3000 });
const spunAt = Date.now();
const spinPush = await nextPush("/push/owner2");
const spunName = women.find((w) => w.id === spun.body?.data?.current_player_id)?.name;
check(spinPush && phone2.read(spinPush).title === `⭐ ${spunName} is up now`, `spin notifies the owner who wishlisted the player (${spunName})`);
check(spinPush && spinPush.at - spunAt >= 1500, `spin notification waits for the wheel (${spinPush ? spinPush.at - spunAt : "–"} ms)`);
check(pushes.filter((p) => p.path === "/push/owner1").length === 0, "owners who didn't wishlist the player get nothing");
await act(admin, "auction.returnToPool", {});
pushServer.close();

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
