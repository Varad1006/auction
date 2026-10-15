// End-to-end test of owners and star players: assigned from Admin → Players,
// paid from the purse, kept out of the squad count, Top buys and results.
// Same setup as smoke.mjs (running app + local Supabase). Screenshots go to $SHOTS.
import { createServerClient } from "@supabase/ssr";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SHOTS = process.env.SHOTS ?? "tests/e2e/shots";
mkdirSync(SHOTS, { recursive: true });

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
const cookieHeader = (c) => c.map((x) => `${x.name}=${x.value}`).join("; ");
const admin = await sessionCookies("admin@test.local");
const owner = await sessionCookies("owner1@test.local");
const actAs = async (cookies, action, body) => {
  const res = await fetch(`${APP}/api/actions/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP, cookie: cookieHeader(cookies) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const act = (action, body) => actAs(admin, action, body);
const read = async (query) => (await fetch(`${SB_URL}/rest/v1/${query}`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } })).json();
const unique = (prefix) => `${prefix} ${Date.now().toString(26).replace(/\d/g, (d) => "abcdefghij"[d])}`;
const money = (n) => `${n.toLocaleString("en-IN")} pts`;

const teams = await read("teams?select=id,name&order=sort_order");
const team = teams[0];
const created = [];
async function addPlayer(name) {
  const r = await act("player.create", { name, pool: "men", role: "All-rounder" });
  if (r.status !== 200) throw new Error(`create failed: ${r.body?.message}`);
  created.push(r.body.data.id);
  return r.body.data.id;
}
// Squad and purse for the test team, as the database works them out.
const purseLeft = async () => {
  const [cfg] = await read("pool_config?select=purse&pool=eq.men");
  const [lim] = await read(`team_pool_limits?select=purse&team_id=eq.${team.id}&pool=eq.men`);
  const sold = await read(`players?select=sold_price&status=eq.sold&pool=eq.men&sold_team_id=eq.${team.id}`);
  return (lim?.purse ?? cfg.purse) - sold.reduce((s, p) => s + p.sold_price, 0);
};

// Clear players left behind by an earlier run that stopped partway.
for (const p of await read("players?select=id,name&name=like.*%20*")) {
  if (/^(Owner|Star|Hand|Tenstar) [a-z]+$/.test(p.name)) {
    await act("player.release", { playerId: p.id });
    await act("player.delete", { id: p.id });
  }
}

const ownerName = unique("Owner");
const starName = unique("Star");
const handName = unique("Hand");
const ownerId = await addPlayer(ownerName);
const starId = await addPlayer(starName);
const handId = await addPlayer(handName);
// Clear any star a previous run left on this team.
for (const p of await read(`players?select=id&signing=eq.star&sold_team_id=eq.${team.id}`)) await act("player.release", { playerId: p.id });

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const adm = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await adm.context().addCookies(admin.map((c) => ({ ...c, url: APP })));

console.log("Admin assigns an owner");
const before = await purseLeft();
await adm.goto(`${APP}/admin/players`);
await adm.getByPlaceholder("Search name…").fill(ownerName);
const ownerRow = adm.getByRole("listitem").filter({ hasText: ownerName });
await ownerRow.getByRole("button", { name: "Assign" }).click();
const dialog = adm.getByRole("dialog");
await dialog.getByRole("radio", { name: /Team owner/ }).check();
await dialog.locator("select").selectOption(team.id);
await dialog.getByLabel(/Price/).fill("0");
await dialog.getByRole("button", { name: "Assign" }).click();
await adm.getByText(`${ownerName} is ${team.name}'s owner`).waitFor({ timeout: 10000 });
let row = (await read(`players?select=status,signing,sold_team_id,sold_price&id=eq.${ownerId}`))[0];
check(row?.status === "sold" && row.signing === "owner" && row.sold_team_id === team.id && row.sold_price === 0, "owner assigned to the team with price 0");

console.log("…and sets the price later");
await dialog.waitFor({ state: "hidden" });
const summary = adm.getByRole("region", { name: "Owners & star players" });
await summary.getByRole("button", { name: new RegExp(ownerName) }).click();
await dialog.getByLabel(/Price/).fill("300");
await dialog.getByRole("button", { name: "Save" }).click();
await adm.getByText(`${ownerName} is ${team.name}'s owner (${money(300)})`).waitFor({ timeout: 10000 });
row = (await read(`players?select=sold_price&id=eq.${ownerId}`))[0];
check(row?.sold_price === 300, "the owner's price is changed to 300");
check((await purseLeft()) === before - 300, "the price comes out of the team's purse");

console.log("Star player and limits");
const star = await act("player.sign", { playerId: starId, teamId: team.id, signing: "star", price: 200 });
check(star.status === 200 && star.body?.data?.signing === "star", "the admin makes a player the team's star");
const second = await act("player.sign", { playerId: handId, teamId: team.id, signing: "star", price: 0 });
check(second.status === 409 && second.body?.code === "star_taken", `a team can't have two stars (${second.body?.message})`);
const tooMuch = await act("player.sign", { playerId: starId, teamId: team.id, signing: "star", price: 10_000_000 });
check(tooMuch.status === 409 && tooMuch.body?.code === "insufficient_purse", "a price above the purse is refused");
check((await actAs(owner, "player.sign", { playerId: handId, teamId: team.id, signing: "owner", price: 0 })).status === 403, "owners can't assign owners or stars");

console.log("A hand-assigned player becomes an owner");
check((await act("auction.assign", { playerId: handId, teamId: team.id, price: 50 })).status === 200, "player assigned by hand first (like the real owners were)");
const results1 = await read(`results?select=id&player_id=eq.${handId}&undone_at=is.null`);
check(results1.length === 1, "…which made a result");
await adm.goto(`${APP}/admin/players`);
await adm.getByPlaceholder("Search name…").fill(handName);
await adm.getByRole("listitem").filter({ hasText: handName }).getByRole("button", { name: "Owner / star" }).click();
check(!(await dialog.getByRole("radio", { name: /Assigned pick/ }).count()), "the form only offers owner or star for them");
await dialog.getByRole("button", { name: "Save" }).click();
await adm.getByText(`${handName} is ${team.name}'s owner (${money(50)})`).waitFor({ timeout: 10000 });
check((await read(`results?select=id&player_id=eq.${handId}`)).length === 0, "their result is removed, so it can't be undone or listed");
await adm.getByPlaceholder("Search name…").fill("");
await adm.screenshot({ path: `${SHOTS}/s-01-admin.png`, fullPage: false });

console.log("What everyone sees");
const viewer = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await viewer.goto(`${APP}/`);
await viewer.getByRole("heading", { name: "Top buys" }).waitFor({ timeout: 15000 });
await viewer.waitForTimeout(500);
for (const name of [ownerName, starName, handName]) {
  check((await viewer.getByText(name).count()) === 0, `${name.split(" ")[0]} isn't in Top buys or Recent results`);
}
await viewer.goto(`${APP}/teams/${team.id}`);
const men = viewer.locator("section").filter({ has: viewer.getByRole("heading", { name: "Men" }) });
await men.getByText(ownerName).waitFor({ timeout: 15000 });
const ownerLine = men.getByRole("listitem").filter({ hasText: ownerName });
check((await ownerLine.getByText("Owner", { exact: true }).count()) === 1, "the team page tags the owner");
check((await men.getByRole("listitem").filter({ hasText: starName }).getByText("★ Star", { exact: true }).count()) === 1, "…and the star player");
const teamLine = await men.getByText(/^Team of \d+:/).innerText();
check(/\+ 1 star · 2 owners/.test(teamLine), `team size counts them separately ("${teamLine}")`);
await viewer.screenshot({ path: `${SHOTS}/s-02-team.png`, fullPage: true });
await viewer.context().close();

console.log("A team whose owners don't play buys 10");
const other = teams[1];
const extraStarName = unique("Tenstar");
const extraStar = await addPlayer(extraStarName);
for (const p of await read(`players?select=id&signing=eq.star&sold_team_id=eq.${other.id}`)) await act("player.release", { playerId: p.id });
check((await act("team.limits", { teamId: other.id, pool: "men", purse: null, min_squad: 10, max_squad: 10 })).status === 200, `${other.name} set to buy 10 men in the auction`);
await act("player.sign", { playerId: extraStar, teamId: other.id, signing: "star", price: 0 });
await adm.goto(`${APP}/admin/players`);
const otherRow = adm.getByRole("region", { name: "Owners & star players" }).getByRole("listitem").filter({ hasText: other.name });
await otherRow.getByText(extraStarName).waitFor({ timeout: 10000 });
const otherText = await otherRow.innerText();
check(/Buys\s*10/.test(otherText) && /No playing owner/.test(otherText), `the summary shows "Buys 10" and no playing owner (${otherText.replace(/\s+/g, " ")})`);
const firstText = await adm.getByRole("region", { name: "Owners & star players" }).getByRole("listitem").filter({ hasText: team.name }).innerText();
check(!/Buys\s*10/.test(firstText), "other teams keep the pool's number");
const page = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await page.goto(`${APP}/teams/${other.id}`);
const otherMen = page.locator("section").filter({ has: page.getByRole("heading", { name: "Men" }) });
await otherMen.getByText(extraStarName).waitFor({ timeout: 15000 });
check((await otherMen.getByText(/more from the auction to reach 10\./).count()) === 1, "their team page counts towards 10 from the auction");
await page.context().close();
await act("team.limits", { teamId: other.id, pool: "men", purse: null, min_squad: null, max_squad: null });

console.log("Owners who don't play");
await adm.goto(`${APP}/admin/settings`);
const teamForm = adm.locator("form", { has: adm.locator(`input[value="${other.name}"]`) });
await teamForm.getByLabel("Owners who don't play").fill("Nonplay Alpha,  Nonplay Beta (co-owner) ,");
await teamForm.getByRole("button", { name: "Save" }).click();
await adm.getByText("Team saved").waitFor({ timeout: 10000 });
const [saved] = await read(`teams?select=owner_names&id=eq.${other.id}`);
check(JSON.stringify(saved?.owner_names) === JSON.stringify(["Nonplay Alpha", "Nonplay Beta (co-owner)"]), `Settings saves the names tidied (${JSON.stringify(saved?.owner_names)})`);
await act("team.update", { id: team.id, owner_names: ["Nonplay Gamma (co-owner)"] });
const fan = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await fan.goto(`${APP}/teams/${other.id}`);
await fan.getByText("Nonplay Alpha · Nonplay Beta (co-owner)").waitFor({ timeout: 15000 });
check((await fan.getByText("Owners:").count()) === 1, "the team page shows the owners who don't play");
await fan.goto(`${APP}/teams/${team.id}`);
const ownersLine = fan.getByText(/^Owners:/);
await ownersLine.waitFor({ timeout: 15000 });
const ownersText = (await ownersLine.locator("..").innerText()).replace(/\s+/g, " ");
check(ownersText.includes(ownerName) && ownersText.includes(handName) && ownersText.endsWith("Nonplay Gamma (co-owner)"), `playing owners come first, then the others ("${ownersText}")`);
await fan.goto(`${APP}/teams`);
await fan.getByText("Nonplay Alpha · Nonplay Beta (co-owner)").waitFor({ timeout: 15000 });
check(true, "…and so does the Teams list");
await fan.screenshot({ path: `${SHOTS}/s-03-teams.png`, fullPage: false });
await fan.context().close();
check((await actAs(owner, "team.update", { id: team.id, owner_names: ["Hacker"] })).status === 403, "owners can't change team owner names");
for (const t of [team, other]) await act("team.update", { id: t.id, owner_names: [] });

console.log("Removing");
const rel = await act("player.release", { playerId: starId });
check(rel.status === 200 && rel.body?.data?.status === "pool", "the admin takes the star off the team (back to the pool)");
check((await purseLeft()) === before - 300 - 50, "…and the price goes back to the purse");

await browser.close();
for (const id of created) {
  await act("player.release", { playerId: id });
  await act("player.delete", { id });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
