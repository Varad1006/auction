// End-to-end test of the price guide and AI notes: stats and price-list
// uploads, generation and who sees it. The AI is replaced by a fake server on
// FAKE_AI_PORT (default 4545) that answers like Groq and like Anthropic.
// Start the app in one of three ways; the test reads which from the app:
//   Groq:   GROQ_API_KEY=test-groq-key GROQ_BASE_URL=http://127.0.0.1:4545/openai/v1
//   Claude: ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:4545
//   No AI:  neither key (prices only)
// plus AI_TIMEOUT_MS=5000 (so the "slow AI" check doesn't take a minute).
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
const PORT = Number(process.env.FAKE_AI_PORT ?? 4545);
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
const generate = (cookies, body) => call(cookies, "/api/admin/insights/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let made = 0;
const unique = (prefix) => `${prefix} ${(Date.now() * 10 + made++).toString(26).replace(/\d/g, (d) => "abcdefghij"[d])}`;

const status = (await call(admin, "/api/insights")).body?.admin;
if (!status) throw new Error("Couldn't read the AI status: run migration 0017 and sign in as admin");
const AI = status.provider ?? "none";
console.log(`AI: ${AI}${status.model ? ` (${status.model})` : ""}`);

// --- Fake Groq and Anthropic APIs ------------------------------------------
const requests = [];
let mode = "ok";
/** The user message of a request, whichever API it was sent to. */
const userText = (r) => (r.url.includes("/chat/completions") ? r.body.messages?.[1]?.content : r.body.messages?.[0]?.content) ?? "";
const refsOf = (text) => [...text.matchAll(/^\[(P\d+)\]/gm)].map((m) => m[1]);
/** The guide's fair price for each player in the brief. */
function guideFairs(text) {
  const out = new Map();
  let ref = null;
  for (const line of text.split("\n")) {
    const r = /^\[(P\d+)\]/.exec(line);
    if (r) ref = r[1];
    const f = /price guide: floor [\d,]+, fair ([\d,]+)/.exec(line);
    if (f && ref) out.set(ref, Number(f[1].replace(/,/g, "")));
  }
  return out;
}
const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const groq = req.url.startsWith("/openai/");
    const reply = (code, json, headers = {}) => {
      if (!res.destroyed) res.writeHead(code, { "content-type": "application/json", ...headers }).end(JSON.stringify(json));
    };
    if (groq && req.method === "GET" && req.url.endsWith("/models")) {
      return reply(200, { object: "list", data: [{ id: "llama-3.3-70b-versatile" }, { id: "qwen/qwen3-235b-a22b" }, { id: "qwen/qwen3-32b" }] });
    }
    const r = { url: req.url, headers: req.headers, body };
    requests.push(r);
    const error = (code, type, message, headers) =>
      reply(code, groq ? { error: { message, type: "invalid_request_error", code: type } } : { type: "error", error: { type, message } }, headers);
    if (mode === "auth") return error(401, groq ? "invalid_api_key" : "authentication_error", "Invalid API Key");
    if (mode === "ratelimit-once" || mode === "ratelimit-long") {
      const long = mode === "ratelimit-long";
      if (!long) mode = "ok";
      // Groq says how long in the message; Anthropic in the header.
      return error(429, groq ? "rate_limit_exceeded" : "rate_limit_error", `Rate limit reached. Please try again in ${long ? "9m59.5s" : "1.5s"}.`, groq && long ? {} : { "retry-after": long ? "600" : "2" });
    }
    if (mode === "nomodel-once" && groq) {
      mode = "ok";
      return error(404, "model_not_found", `The model \`${body.model}\` does not exist or you do not have access to it.`);
    }
    const text = userText(r);
    const fairs = guideFairs(text);
    const players = refsOf(text).map((ref, i) => ({
      ref,
      summary: `Fake note for ${ref}: strike rate and wickets look useful.`,
      strengths: ["Hits sixes", "Tidy overs"],
      concerns: i % 2 ? ["Small sample"] : [],
      role_fit: "Middle-order hitter",
      // Far above the guide and off the price step: the app must hold it to +20% and round it.
      price_fair: Math.round((fairs.get(ref) ?? 100) * 1.5) + 3,
    }));
    const json = JSON.stringify({ players });
    const answer = () =>
      groq
        ? reply(200, {
            id: `chatcmpl-fake-${requests.length}`,
            object: "chat.completion",
            model: body.model,
            choices: [{ index: 0, message: { role: "assistant", content: mode === "refusal" ? "I can't help with that." : `<think>\n</think>\n${json}` }, finish_reason: "stop" }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          })
        : reply(200, {
            id: `msg_fake_${requests.length}`,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [
              { type: "thinking", thinking: "", signature: "fake" },
              { type: "text", text: json },
            ],
            stop_reason: mode === "refusal" ? "refusal" : "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          });
    // "slow": more than two players takes longer than the app waits.
    if (mode === "slow" && refsOf(text).length > 2) setTimeout(answer, 12000);
    else answer();
  });
});
await new Promise((r) => fake.listen(PORT, "127.0.0.1", r));

// --- Test players, their stats and previous prices -------------------------
// Players left behind by an earlier run that stopped partway.
const listPlayers = async (filter) =>
  (await fetch(`${SB_URL}/rest/v1/players?select=id,name,pool,status&${filter}`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } })).json();
for (const p of await listPlayers("name=like.Scout*")) if (/^Scout [a-z]+$/.test(p.name)) await act("player.delete", { id: p.id });
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

// Last season's tracker, as Google Sheets downloads it: every other men's
// player sold for 5,000-17,000, the first scout for 30,000 and the second for
// 3,000; the third is new. The contact columns must be ignored.
const others = (await listPlayers("pool=eq.men&status=eq.pool")).filter((p) => !names.includes(p.name));
const tracker = [
  ...others.map((p, i) => [p.name, "Male", `9${String(i).padStart(9, "0")}`, `p${i}@example.com`, "P2 Indians", String(5000 + (i % 7) * 2000)]),
  [names[0], "Male", "9000000001", "a@example.com", "P2 Royals", "30000"],
  [names[1], "M", "9000000002", "b@example.com", "P2 Royals", "3,000"],
  ["Gone Player", "Male", "9000000003", "c@example.com", "Unsold", ""],
];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const col = (i) => String.fromCharCode(65 + i);
const sheetXml = [["Players tracker"], [], ["Full Name", "Gender", "Phone", "Email", "Team", "Sold For"], ...tracker]
  .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join("")}</row>`)
  .join("");
const xlsx = zipSync({
  "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Players list" sheetId="2" r:id="rId2"/></sheets></workbook>`),
  "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`),
  "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Totals</t></is></c></row></sheetData></worksheet>`),
  "xl/worksheets/sheet2.xml": strToU8(`<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`),
});
// The season before, as a CSV (no gender column: the price column says which pool).
const csv = `Name,Team,Male Sold For\n${[[names[0], "P2 Kings", "20000"], ...Array.from({ length: 5 }, (_, i) => [`Csv Filler ${i}`, "P2 Kings", "10000"])].map((r) => r.join(",")).join("\n")}\n`;

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const adm = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await adm.context().addCookies(admin.map((c) => ({ ...c, url: APP })));
adm.on("dialog", (d) => void d.accept());

console.log("Upload stats");
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

console.log("Upload previous prices");
const priceForm = (season, name, data) => {
  const f = new FormData();
  f.append("season", String(season));
  f.append("file", new Blob([data]), name);
  return f;
};
check((await call(owner, "/api/admin/insights/prices", { method: "POST", body: priceForm(2, "t.xlsx", xlsx) })).status === 403, "owners can't upload prices");
const notSheet = await call(admin, "/api/admin/insights/prices", { method: "POST", body: priceForm(2, "notes.txt", "hello") });
check(notSheet.status === 400 && notSheet.body?.code === "bad_file", `other files are refused ("${notSheet.body?.message}")`);
const brokenXlsx = await call(admin, "/api/admin/insights/prices", { method: "POST", body: priceForm(2, "broken.xlsx", "not a zip") });
check(brokenXlsx.status === 400 && brokenXlsx.body?.code === "bad_file", "a broken Excel file is refused");
await adm.getByLabel("Season of the price list").selectOption("2");
await adm.getByLabel("Price list file").setInputFiles({ name: "PPL 2 tracker.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(xlsx) });
const priceReport = adm.getByRole("status").filter({ hasText: "players read" });
await priceReport.waitFor({ timeout: 20000 });
const priceText = await priceReport.innerText();
check(
  priceText.includes(`PPL 2: ${tracker.length} players read from "Players list", ${tracker.length - 1} sold`),
  `the players tab is read (${priceText.split("\n")[0]})`,
);
const found = /Found (\d+) of this year's (\d+) auction players/.exec(priceText);
check(found && Number(found[1]) === others.length + 2, `this year's players are found in it (${found?.[0]})`);
const csvUpload = await call(admin, "/api/admin/insights/prices", { method: "POST", body: priceForm(1, "ppl1.csv", csv) });
check(csvUpload.status === 200 && csvUpload.body?.data?.sold === 6 && csvUpload.body.data.averages.men === 11667, `a CSV works too (average ${csvUpload.body?.data?.averages?.men})`);
const anonPrices = await fetch(`${SB_URL}/rest/v1/past_prices?select=*`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } });
check(anonPrices.status === 401 || anonPrices.status === 403, `the public can't read previous prices (${anonPrices.status})`);
const seasons = (await call(admin, "/api/insights")).body?.admin?.seasons ?? [];
check(
  seasons.length === 2 && seasons[0].season === 1 && seasons[1].sold === tracker.length - 1 && !JSON.stringify(seasons).includes("example.com"),
  "the admin sees each uploaded season (and no contact details)",
);

console.log(AI === "none" ? "Calculate prices" : "Generate");
const menCard = adm.locator("div", { has: adm.getByText("Men", { exact: true }) }).filter({ has: adm.getByRole("button", { name: /Generate|All done|Calculate prices|Recalculate prices/ }) }).last();
await adm.reload();
await menCard.getByText(/· ([2-9]|\d\d+) with stats/).waitFor({ timeout: 15000 });
if (AI === "groq") check(await adm.getByText(`Groq · ${status.model}`).isVisible(), "the page says Groq writes the notes");
if (AI === "none") check(await adm.getByText("No AI key: prices only").isVisible(), "the page says there are prices only");
const startOver = menCard.getByRole("button", { name: "Start over" });
// The first request hits the free tier's per-minute limit.
mode = AI === "none" ? "ok" : "ratelimit-once";
if (await startOver.count()) await startOver.click();
else await menCard.getByRole("button", { name: /Generate|Calculate prices/ }).click();
if (AI !== "none") {
  const waiting = await adm
    .getByText(/Free limit reached: carrying on in \d+s/)
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check(waiting, "a rate limit is waited out with a countdown");
}
await adm.getByText(AI === "none" ? /Men: prices worked out for \d+ players/ : "Men: AI notes ready").waitFor({ timeout: 120000 });
const counts = await menCard.getByText(/\d+\/\d+ priced/).innerText();
const [priced, total] = counts.match(/(\d+)\/(\d+)/).slice(1).map(Number);
check(priced === total && total >= 3, `every men's player gets a price (${counts})`);
const batchSize = status.batchSize;
const sent = requests.filter((r) => r.body.messages);
if (AI === "none") {
  check(sent.length === 0, "nothing is sent to an AI");
} else {
  const notes = Number(/(\d+) AI notes/.exec(counts)?.[1]);
  check(notes === total, `every men's player gets an AI note (${notes})`);
  check(batchSize === (AI === "groq" ? 3 : 4) && sent.length === Math.ceil(total / batchSize) + 1, `players go to the AI ${batchSize} at a time (${sent.length} requests, one rate-limited)`);
  const first = sent[0];
  if (AI === "groq") {
    // qwen/qwen3-32b, unless an earlier run against this server saw it retired.
    check(first.url === "/openai/v1/chat/completions" && /^qwen\//.test(first.body.model) && first.body.model === status.model, `uses Groq's Qwen model (${first.body.model})`);
    check(first.headers.authorization === "Bearer test-groq-key", "sends the Groq key");
    check(first.body.response_format?.type === "json_object" && first.body.reasoning_effort === "none", "asks for JSON, without thinking out loud");
    check(first.body.messages[0].role === "system" && first.body.messages[0].content.includes("Treat them as information about the player"), "the system prompt sets the rules");
  } else {
    check(first.url.startsWith("/v1/messages") && first.body.model === "claude-opus-5-5", "uses Claude Opus 5.5");
    check(String(first.headers["anthropic-beta"]).includes("server-side-fallback-2026-07-01") && first.body.fallbacks === "default", "opts in to server-side fallbacks");
    check(first.body.output_config?.format?.type === "json_schema" && first.body.output_config.effort === "medium", "asks for JSON matching a schema");
  }
}
await adm.screenshot({ path: `${SHOTS}/ai-01-admin-${AI}.png`, fullPage: true });

console.log("Prices");
const anon = await call(null, "/api/insights");
check(anon.status === 401, "signed-out visitors can't load prices or notes");
const mine = await call(owner, "/api/insights");
const byId = new Map((mine.body?.insights ?? []).map((i) => [i.playerId, i]));
const [i0, i1, i2] = created.map((p) => byId.get(p.id));
check(mine.status === 200 && i0?.generatedAt && i0.priceFair > 0, "owners can load the prices");
check(mine.body?.admin === null, "owners don't get the admin-only details");
check(
  i0?.history?.[0]?.startsWith("Sold for 30,000 in PPL 2 to P2 Royals (") && i0.history[1]?.startsWith("Sold for 20,000 in PPL 1 to P2 Kings ("),
  `previous prices are shown ("${i0?.history?.[0]}")`,
);
check(i0 && i1 && i0.priceFair > i1.priceFair, `a player who went for 30,000 is priced above one who went for 3,000 (${i0?.priceFair} vs ${i1?.priceFair})`);
check(i2?.history?.length === 0 && i2.tier !== null, `a new player still gets a price (${i2?.priceFair}, ${i2?.tier})`);
check(i0 && i0.priceFloor <= i0.priceFair && i0.priceFair <= i0.priceStretch && i0.priceFloor >= created[0].base_price, "floor ≤ fair ≤ stretch, never below base price");
check(i0?.statLines?.[0]?.startsWith("PPL 2 · P2 Royals: 240 runs"), `stat lines are ready to show ("${i0?.statLines?.[0]}")`);
if (AI === "none") {
  check(!i0?.hasNote && i0?.summary === null, "without an AI key there are prices but no notes");
} else {
  const brief = userText(sent.find((r) => userText(r).includes(names[0])));
  const step = 5; // The local test purse (under 2,000) rounds to 5.
  const guide = guideFairs(brief).get(new RegExp(`^\\[(P\\d+)\\] ${names[0]}:`, "m").exec(brief)?.[1]);
  check(brief.includes(`] ${names[0]}: All-rounder; base ${created[0].base_price}`) && brief.includes("PPL2 (P2 ROYALS): bat 8inns 240r") && brief.includes("MVP 23.1 pts"), "the brief carries the player's PPL stats");
  check(brief.includes("auction: Sold for 30,000 in PPL 2 to P2 Royals"), "the brief carries the player's previous prices");
  const third = userText(sent.find((r) => userText(r).includes(names[2])));
  check(third.split(`] ${names[2]}`)[1].split("\n").slice(1, 3).join("\n").includes("no recorded stats"), "players without stats are marked as such");
  check(/points left in total for \d+ more squad places/.test(brief), "the brief carries the purse maths");
  const expected = Math.round((guide * 1.2) / step) * step;
  check(
    i0?.hasNote && (i0.priceFair === expected || (i0.priceFair === i0.priceStretch && i0.priceFair < expected)),
    `the AI may move the guide's price by 20% at most (guide ${guide}, AI asked ${Math.round(guide * 1.5) + 3}, saved ${i0?.priceFair})`,
  );
}

console.log("Who sees it");
const region = AI === "none" ? "Price guide" : "AI scout";
const chip = AI === "none" ? /📊/ : /✨/;
const ownerPage = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await ownerPage.context().addCookies(owner.map((c) => ({ ...c, url: APP })));
await ownerPage.goto(`${APP}/players?pool=men`);
await ownerPage.getByPlaceholder("Search players…").fill(names[0]);
const card = ownerPage.getByRole("listitem").filter({ hasText: names[0] }).getByRole("button").first();
await card.waitFor({ timeout: 15000 });
await card.getByText(chip).waitFor({ timeout: 10000 }).catch(() => {});
check((await card.getByText(chip).count()) === 1, "owners see the suggested price on the player card");
await card.click();
const scout = ownerPage.getByRole("region", { name: region });
await scout.waitFor({ timeout: 10000 });
const scoutText = await scout.innerText();
check(
  scoutText.includes("Fair price") && scoutText.includes("Sold for 30,000 in PPL 2") && scoutText.includes("PPL 2 · P2 Royals") && (AI === "none" || scoutText.includes("Fake note for")),
  `owners see the ${region.toLowerCase()} card with previous prices${AI === "none" ? "" : ", the note"} and stats`,
);
await scout.screenshot({ path: `${SHOTS}/ai-02-owner-card-${AI}.png` });

// The wishlist offers the suggested prices as "my max".
const ownerAct = (action, body) => call(owner, `/api/actions/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
await ownerAct("wishlist.add", { playerId: created[0].id });
await ownerPage.goto(`${APP}/wishlist`);
const row = ownerPage.getByRole("listitem").filter({ hasText: names[0] }).first();
await row.waitFor({ timeout: 15000 });
await row.getByText(chip).waitFor({ timeout: 10000 });
await row.getByRole("button").first().click();
await row.getByRole("region", { name: region }).waitFor({ timeout: 10000 });
await row.getByRole("button", { name: /^fair / }).click();
await ownerPage.waitForTimeout(1000);
const wl = await call(owner, "/api/wishlist");
const saved = wl.body?.entries?.find((e) => e.player_id === created[0].id);
check(saved?.max_price === i0.priceFair, `one tap sets "my max" to the fair price (${saved?.max_price})`);
await row.screenshot({ path: `${SHOTS}/ai-03-wishlist-${AI}.png` });
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
check(
  (await viewer.getByRole("region", { name: /AI scout|Price guide/ }).count()) === 0 && (await viewer.getByText(/✨|📊/).count()) === 0,
  "the public doesn't see prices or notes",
);
await viewer.context().close();

if (AI !== "none") {
  console.log("When the AI is slow");
  mode = "slow";
  requests.length = 0;
  await adm.goto(`${APP}/admin/insights`);
  await menCard.getByText(new RegExp(`${total} AI notes`)).waitFor({ timeout: 15000 });
  await menCard.getByRole("button", { name: "Start over" }).click();
  await adm.getByText("Men: AI notes ready").waitFor({ timeout: 120000 });
  const sizes = requests.map((r) => refsOf(userText(r)).length);
  check(sizes[0] === batchSize && sizes.slice(1).every((n) => n <= 2), `after a request runs out of time the page asks for fewer players (${sizes.slice(0, 4).join(", ")}, …)`);
  check((await menCard.getByText(/\d+ AI notes/).innerText()).includes(`${total} AI notes`), "…and still finishes every player");
  mode = "ok";

  console.log("When the AI fails");
  mode = "auth";
  const nothing = await generate(admin, { pool: "men" });
  check(nothing.status === 200 && nothing.body?.data?.remaining === 0, "nothing is sent once every player has a note");
  const rejected = await generate(admin, { pool: "men", restart: true });
  check(rejected.status === 502 && rejected.body?.code === "ai_key_rejected", `a bad API key gets a clear message ("${rejected.body?.message}")`);
  mode = "refusal";
  const refused = await generate(admin, { pool: "men" });
  check(refused.status === 502 && refused.body?.code === (AI === "groq" ? "ai_unreadable" : "ai_refused"), `an answer without notes is reported, not saved (${refused.body?.code})`);
  mode = "ratelimit-long";
  const limited = await generate(admin, { pool: "men" });
  check(limited.status === 429 && limited.body?.code === "ai_rate_limited" && limited.body.retryAfter === 600, `a long rate limit says how long to wait (${limited.body?.retryAfter}s)`);
  const guideOnly = (await call(owner, "/api/insights")).body?.insights?.find((i) => i.playerId === created[0].id);
  check(guideOnly?.priceFair > 0 && !guideOnly.hasNote, "players keep their price guide while the AI is unavailable");
  if (AI === "groq") {
    mode = "nomodel-once";
    requests.length = 0;
    const picked = await generate(admin, { pool: "men", size: 1 });
    check(picked.status === 200 && requests.at(-1)?.body?.model === "qwen/qwen3-235b-a22b", `when the Qwen model is retired, the largest one Groq lists is used (${requests.at(-1)?.body?.model})`);
  }
  mode = "ok";
}
check((await generate(owner, { pool: "men" })).status === 403, "owners can't run the price guide or the AI");

await browser.close();
fake.close();
for (const p of created) await act("player.delete", { id: p.id });

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
