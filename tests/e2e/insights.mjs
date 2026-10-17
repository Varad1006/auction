// End-to-end test of AI insights: stats upload, generation and who sees it.
// The model is replaced by a fake Anthropic API on FAKE_ANTHROPIC_PORT
// (default 4545), so start the app with
//   ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:4545
//   AI_TIMEOUT_MS=5000 (so the "slow AI" check doesn't take a minute)
// Same setup as smoke.mjs otherwise. Screenshots go to $SHOTS.
import { createServerClient } from "@supabase/ssr";
import { strToU8, zipSync } from "fflate";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { chromium, devices } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SHOTS = process.env.SHOTS ?? "tests/e2e/shots";
const PORT = Number(process.env.FAKE_ANTHROPIC_PORT ?? 4545);
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
const call = async (cookies, path, init = {}) => {
  const res = await fetch(`${APP}${path}`, { ...init, headers: { origin: APP, cookie: cookies ? cookieHeader(cookies) : "", ...(init.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const act = (action, body) => call(admin, `/api/actions/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let made = 0;
const unique = (prefix) => `${prefix} ${(Date.now() * 10 + made++).toString(26).replace(/\d/g, (d) => "abcdefghij"[d])}`;

// --- Fake Anthropic Messages API -------------------------------------------
const requests = [];
let mode = "ok";
const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    requests.push({ url: req.url, headers: req.headers, body });
    const reply = (status, json) => {
      if (!res.destroyed) res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
    };
    if (mode === "auth") return reply(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    const last = body.messages?.at(-1)?.content?.at(-1)?.text ?? "";
    const largest = Number((/Largest purse left: ([\d,]+)/.exec(body.messages?.[0]?.content?.[0]?.text ?? "")?.[1] ?? "0").replace(/,/g, ""));
    const refs = (/"ref": ([P0-9, ]+)\./.exec(last)?.[1] ?? "").split(",").map((r) => r.trim()).filter(Boolean);
    const players = refs.map((ref, i) => ({
      ref,
      summary: `Fake note for ${ref}: strike rate and wickets look useful.`,
      strengths: ["Hits sixes", "Tidy overs"],
      concerns: i % 2 ? ["Small sample"] : [],
      role_fit: "Middle-order hitter",
      tier: i === 0 ? "premium" : "solid",
      price_floor: 1, // below base: the app must lift it
      price_fair: Math.round(largest * 0.3) + 3 + i, // off the price step: the app must round it
      price_stretch: largest * 2, // above every purse: the app must cap it
      confidence: "medium",
    }));
    const answer = () => reply(200, {
      id: `msg_fake_${requests.length}`,
      type: "message",
      role: "assistant",
      model: body.model,
      content: [
        { type: "thinking", thinking: "", signature: "fake" },
        { type: "text", text: JSON.stringify({ players }) },
      ],
      stop_reason: mode === "refusal" ? "refusal" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    // "slow": more than two players takes longer than the app waits.
    if (mode === "slow" && refs.length > 2) setTimeout(answer, 12000);
    else answer();
  });
});
await new Promise((r) => fake.listen(PORT, "127.0.0.1", r));

// --- Test players and their stats export -----------------------------------
// Players left behind by an earlier run that stopped partway.
const old = await (await fetch(`${SB_URL}/rest/v1/players?select=id,name&name=like.Scout*`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } })).json();
for (const p of old) if (/^Scout [a-z]+$/.test(p.name)) await act("player.delete", { id: p.id });
const created = [];
const names = [unique("Scout"), unique("Scout"), unique("Scout")];
for (const name of names) {
  const r = await act("player.create", { name, pool: "men", role: "All-rounder" });
  if (r.status !== 200) throw new Error(`create failed: ${r.body?.message}`);
  created.push(r.body.data);
}
const chIds = ["7000001", "7000002", "7000003"];
const record = (p, i) => ({
  auction_row: { id: p.id, name: p.name, pool: "men", cricheroes_url: `https://cricheroes.com/player-profile/${chIds[i]}/x/stats` },
  stats_url: `https://cricheroes.com/player-profile/${chIds[i]}/x/stats`,
  header_text: "Live scores",
  tabs: {
    Batting: { tables: [{ section: "TENNIS BALL", rows: [["", "Mat", "Inns", "NO", "Runs", "HS", "Avg", "SR", "30s", "50s", "100s", "4s", "6s", "Ducks"], ["Total", "30", "28", "4", String(500 + i * 100), "77*", "25.00", "170.00", "5", "2", "-", "20", "40", "2"]] }] },
    Bowling: { tables: [] },
    Fielding: { tables: [] },
    Captain: { tables: [] },
  },
  api_responses: [],
});
const zip = zipSync({
  "ppl data/all_players.json": strToU8(JSON.stringify([...created.slice(0, 2).map(record), { auction_row: { id: null, name: "Not In Auction Zz", pool: "men" }, tabs: {} }])),
  "ppl data/ppl2_batting_leaderboard.csv": strToU8(
    "player_id,name,team_id,team_name,total_match,innings,total_runs,highest_run,average,not_out,strike_rate,ball_faced,batting_hand,4s,6s,50s,100s\n" +
      `${chIds[0]},Scout A,1,P2 ROYALS,8,8,240,80,40.00,2,200.00,120,RHB,6,20,2,0\n`,
  ),
  "ppl data/ppl2_mvp_leaderboard.csv": strToU8("Player Name,Team Name,Player Role,Bowling Style,Batting Hand,Matches,Batting,Bowling,Fielding,Total\nScout  A,P2 ROYALS,None,,RHB,8,20.1,2.0,1.0,23.100\n"),
  "__MACOSX/ppl data/._all_players.json": strToU8("junk"),
});

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const adm = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await adm.context().addCookies(admin.map((c) => ({ ...c, url: APP })));

console.log("Upload");
const ownerUpload = new FormData();
ownerUpload.append("files", new Blob([zip]), "ppl_data.zip");
check((await call(owner, "/api/admin/insights/import", { method: "POST", body: ownerUpload })).status === 403, "owners can't upload stats");
await adm.goto(`${APP}/admin/insights`);
await adm.getByLabel("Stats files").setInputFiles({ name: "ppl_data.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
const report = adm.getByRole("status").filter({ hasText: "players matched" });
await report.waitFor({ timeout: 20000 });
const reportText = await report.innerText();
check(/2 players matched · seasons PPL 2/.test(reportText), `the zip is read and matched (${reportText.split("\n")[0]})`);
check(reportText.includes("Not In Auction Zz"), "names that aren't in the auction are listed");
check(reportText.includes(names[2]), "auction players without stats are listed");

console.log("Generate");
const startOver = adm.getByRole("button", { name: "Start over" }).first();
adm.on("dialog", (d) => void d.accept());
const menCard = adm.locator("div", { has: adm.getByText("Men", { exact: true }) }).filter({ has: adm.getByRole("button", { name: /Generate|All done/ }) }).last();
// Wait until the page shows the counts with the stats just uploaded.
await menCard.getByText(/· ([2-9]|\d\d+) with stats/).waitFor({ timeout: 15000 });
if (await startOver.count()) await startOver.click();
else await menCard.getByRole("button", { name: /Generate/ }).click();
await adm.getByText("Men: AI notes ready").waitFor({ timeout: 90000 });
const done = await menCard.getByText(/\d+\/\d+ done/).innerText();
const [got, total] = done.match(/(\d+)\/(\d+)/).slice(1).map(Number);
check(got === total && total >= 3, `every men's player gets a note (${done})`);
const batchSize = (await call(admin, "/api/insights")).body?.admin?.batchSize;
check(batchSize === 4 && requests.length === Math.ceil(total / batchSize), `players go to the AI ${batchSize} at a time (${requests.length} requests)`);
const first = requests[0];
check(first.url.startsWith("/v1/messages") && first.body.model === "claude-opus-5-5", "uses Claude Opus 5.5");
check(String(first.headers["anthropic-beta"]).includes("server-side-fallback-2026-07-01") && first.body.fallbacks === "default", "opts in to server-side fallbacks");
check(first.body.output_config?.format?.type === "json_schema" && first.body.output_config.effort === "medium", "asks for JSON matching a schema");
const prefixes = new Set(requests.map((r) => r.body.messages[0].content[0].text));
check(prefixes.size === 1 && first.body.messages[0].content[0].cache_control?.type === "ephemeral", "every batch shares one cached brief");
const brief = first.body.messages[0].content[0].text;
check(brief.includes(`${names[0]} — All-rounder`) && brief.includes("PPL2 (P2 ROYALS): bat 8m 8inns 240r") && brief.includes("MVP 23.1 pts"), "the brief carries the player's PPL stats");
check(brief.includes(`${names[2]} — All-rounder; grade C`) && brief.split(names[2])[1].split("\n")[1].includes("no recorded stats"), "players without stats are marked unknown");
check(/points left in total to fill \d+ more squad places/.test(brief), "the brief carries the purse maths");
check(requests.at(-1).body.messages[0].content[1].text.includes("Fair prices you already gave"), "later batches see earlier prices to stay consistent");
await adm.screenshot({ path: `${SHOTS}/ai-01-admin.png`, fullPage: true });

console.log("Who sees it");
const anon = await call(null, "/api/insights");
check(anon.status === 401, "signed-out visitors can't load AI notes");
const mine = await call(owner, "/api/insights");
const byId = new Map((mine.body?.insights ?? []).map((i) => [i.playerId, i]));
const i0 = byId.get(created[0].id);
check(mine.status === 200 && i0?.generatedAt, "owners can load AI notes");
const largest = Number(/Largest purse left: ([\d,]+)/.exec(brief)[1].replace(/,/g, ""));
const step = Number(/Round every price to the nearest ([\d,]+)/.exec(brief)[1].replace(/,/g, ""));
check(
  i0 && i0.priceFloor === created[0].base_price && i0.priceFair > i0.priceFloor && i0.priceFair % step === 0 && i0.priceStretch === largest,
  `prices are tidied: floor lifted to base, fair on the ${step} step, stretch capped at the largest purse (${i0?.priceFloor} / ${i0?.priceFair} / ${i0?.priceStretch})`,
);
check(i0?.statLines?.[0]?.startsWith("PPL 2 · P2 Royals: 240 runs"), `stat lines are ready to show ("${i0?.statLines?.[0]}")`);
check(mine.body?.admin === null, "owners don't get the admin-only details");

const ownerPage = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await ownerPage.context().addCookies(owner.map((c) => ({ ...c, url: APP })));
await ownerPage.goto(`${APP}/players?pool=men`);
await ownerPage.getByPlaceholder("Search players…").fill(names[0]);
const card = ownerPage.getByRole("listitem").filter({ hasText: names[0] }).getByRole("button").first();
await card.waitFor({ timeout: 15000 });
await card.getByText(/✨/).waitFor({ timeout: 10000 }).catch(() => {});
check((await card.getByText(/✨/).count()) === 1, "owners see the AI price on the player card");
await card.click();
const scout = ownerPage.getByRole("region", { name: "AI scout" });
await scout.waitFor({ timeout: 10000 });
const scoutText = await scout.innerText();
check(scoutText.includes("Fair price") && scoutText.includes("Fake note for") && scoutText.includes("PPL 2 · P2 Royals"), "owners see the AI scout card with the note and stats");
await scout.screenshot({ path: `${SHOTS}/ai-02-owner-card.png` });

// The wishlist offers the AI's prices as "my max".
const ownerAct = (action, body) => call(owner, `/api/actions/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
await ownerAct("wishlist.add", { playerId: created[0].id });
await ownerPage.goto(`${APP}/wishlist`);
const row = ownerPage.getByRole("listitem").filter({ hasText: names[0] }).first();
await row.waitFor({ timeout: 15000 });
await row.getByText(/✨/).waitFor({ timeout: 10000 });
await row.getByRole("button").first().click();
await row.getByRole("region", { name: "AI scout" }).waitFor({ timeout: 10000 });
await row.getByRole("button", { name: /^fair / }).click();
await ownerPage.waitForTimeout(1000);
const wl = await call(owner, "/api/wishlist");
const saved = wl.body?.entries?.find((e) => e.player_id === created[0].id);
check(saved?.max_price === i0.priceFair, `one tap sets "my max" to the AI's fair price (${saved?.max_price})`);
await row.screenshot({ path: `${SHOTS}/ai-03-wishlist.png` });
await ownerAct("wishlist.remove", { playerId: created[0].id });
await ownerPage.context().close();

const viewer = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await viewer.goto(`${APP}/players?pool=men`);
await viewer.getByPlaceholder("Search players…").fill(names[0]);
const publicCard = viewer.getByRole("listitem").filter({ hasText: names[0] }).getByRole("button").first();
await publicCard.waitFor({ timeout: 15000 });
await publicCard.click();
await viewer.getByText("Tap the card to flip it.").waitFor();
await viewer.waitForTimeout(1500);
check((await viewer.getByRole("region", { name: "AI scout" }).count()) === 0 && (await viewer.getByText(/✨/).count()) === 0, "the public doesn't see AI notes");
await viewer.context().close();

console.log("When the AI is slow");
mode = "slow";
requests.length = 0;
await adm.goto(`${APP}/admin/insights`);
await menCard.getByText(new RegExp(`${total}/${total} done`)).waitFor({ timeout: 15000 });
await adm.getByRole("button", { name: "Start over" }).first().click();
await adm.getByText("Men: AI notes ready").waitFor({ timeout: 120000 });
const sizes = requests.map((r) => (/"ref": ([P0-9, ]+)\./.exec(r.body.messages.at(-1).content.at(-1).text)?.[1] ?? "").split(",").length);
check(sizes[0] === 4 && sizes.slice(1).every((n) => n <= 2), `after a request runs out of time the page asks for fewer players (${sizes.slice(0, 4).join(", ")}, …)`);
check((await menCard.getByText(/\d+\/\d+ done/).innerText()).startsWith(`${total}/${total}`), "…and still finishes every player");
mode = "ok";

console.log("When the AI fails");
mode = "auth";
const rejected = await call(admin, "/api/admin/insights/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pool: "men" }) });
// Nothing is pending, so nothing is sent: start over to force a request.
const rejected2 = await call(admin, "/api/admin/insights/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pool: "men", restart: true }) });
check(rejected.status === 200 && rejected.body?.data?.remaining === 0, "nothing to do once every player has a note");
check(rejected2.status === 502 && rejected2.body?.code === "ai_key_rejected", `a bad API key gets a clear message ("${rejected2.body?.message}")`);
mode = "refusal";
const refused = await call(admin, "/api/admin/insights/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pool: "men" }) });
check(refused.status === 502 && refused.body?.code === "ai_refused", "a refusal is reported, not saved");
check(
  (await call(owner, "/api/admin/insights/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pool: "men" }) })).status === 403,
  "owners can't run the AI",
);

await browser.close();
fake.close();
for (const p of created) await act("player.delete", { id: p.id });

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
