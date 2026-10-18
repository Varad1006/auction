// End-to-end test of the price guide, the automatic AI notes and the owners'
// AI suggestions panel. The AI is replaced by a fake server on FAKE_AI_PORT
// (default 4545) that answers like Groq and like Anthropic. Start the app in
// one of three ways; the test reads which from the app:
//   Groq:   GROQ_API_KEY=test-groq-key GROQ_BASE_URL=http://127.0.0.1:4545/openai/v1
//   Claude: ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:4545
//   No AI:  neither key (prices only)
// plus AI_TIMEOUT_MS=5000 (so the "slow AI" check doesn't take a minute) and
// AI_BACKGROUND_GAP_S=1 (so background notes don't wait 30 s between requests).
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const owner2 = await sessionCookies("owner2@test.local");
const call = async (cookies, path, init = {}) => {
  const res = await fetch(`${APP}${path}`, { ...init, headers: { origin: APP, cookie: cookies ? cookieHeader(cookies) : "", ...(init.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const postJson = (cookies, path, body) => call(cookies, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const act = (action, body) => postJson(admin, `/api/actions/${action}`, body);
const ownerAct = (action, body) => postJson(owner, `/api/actions/${action}`, body);
const insightsFor = async (cookies = owner) => new Map(((await call(cookies, "/api/insights")).body?.insights ?? []).map((i) => [i.playerId, i]));
let made = 0;
const unique = (prefix) => `${prefix} ${(Date.now() * 10 + made++).toString(26).replace(/\d/g, (d) => "abcdefghij"[d])}`;

const status = (await call(admin, "/api/insights")).body?.admin;
if (!status) throw new Error("Couldn't read the AI status: run migrations 0017 and 0018 and sign in as admin");
const AI = status.provider ?? "none";
console.log(`AI: ${AI}${status.model ? ` (${status.model})` : ""}`);
// An earlier run may have left the AI paused: the admin's "write now" lifts it (women have no data, so nothing is written).
const unpause = () => postJson(admin, "/api/admin/insights/generate", { pool: "women", size: 1 });
if (status.pausedFor) await unpause();

// --- Fake Groq and Anthropic APIs ------------------------------------------
const requests = [];
let mode = "ok";
/** The user message of a request, whichever API it was sent to. */
const userText = (r) => (r.url.includes("/chat/completions") ? r.body.messages?.[1]?.content : r.body.messages?.[0]?.content) ?? "";
const refsOf = (text) => [...text.matchAll(/^\[(P\d+)\]/gm)].map((m) => m[1]);
const namesIn = (r) => [...userText(r).matchAll(/^\[P\d+\] ([^:]+):/gm)].map((m) => m[1]);
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
    const r = { url: req.url, headers: req.headers, body, at: Date.now() };
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
const sent = () => requests.filter((r) => r.body.messages);

// --- Test players, their stats and previous prices -------------------------
// Players left behind by an earlier run that stopped partway, and any player left on the block.
const listPlayers = async (filter) =>
  (await fetch(`${SB_URL}/rest/v1/players?select=id,name,pool,status,base_price&${filter}`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } })).json();
await act("auction.returnToPool", {});
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
const form = (fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, ...(Array.isArray(v) ? v : [v]));
  return f;
};

console.log("Loading the data");
const statsForm = () => form({ files: [new Blob([zip]), "ppl_data.zip"] });
const priceForm = (season, name, data) => form({ season: String(season), file: [new Blob([data]), name] });
check((await call(owner, "/api/admin/insights/import", { method: "POST", body: statsForm() })).status === 403, "owners can't upload stats");
check((await call(owner, "/api/admin/insights/prices", { method: "POST", body: priceForm(2, "t.xlsx", xlsx) })).status === 403, "owners can't upload prices");
const stats = await call(admin, "/api/admin/insights/import", { method: "POST", body: statsForm() });
check(stats.body?.data?.matched === 2 && stats.body.data.unmatched.includes("Not In Auction Zz"), "the stats zip is read and matched");
const notSheet = await call(admin, "/api/admin/insights/prices", { method: "POST", body: priceForm(2, "notes.txt", "hello") });
check(notSheet.status === 400 && notSheet.body?.code === "bad_file", `other files are refused ("${notSheet.body?.message}")`);
const brokenXlsx = await call(admin, "/api/admin/insights/prices", { method: "POST", body: priceForm(2, "broken.xlsx", "not a zip") });
check(brokenXlsx.status === 400 && brokenXlsx.body?.code === "bad_file", "a broken Excel file is refused");
const xl = await call(admin, "/api/admin/insights/prices", { method: "POST", body: priceForm(2, "PPL 2 tracker.xlsx", xlsx) });
check(
  xl.body?.data?.sheet === "Players list" && xl.body.data.players === tracker.length && xl.body.data.sold === tracker.length - 1 && xl.body.data.matched === others.length + 2,
  `the tracker's players tab is read (${xl.body?.data?.players} players, ${xl.body?.data?.matched} found this year)`,
);
const csvUpload = await call(admin, "/api/admin/insights/prices", { method: "POST", body: priceForm(1, "ppl1.csv", csv) });
check(csvUpload.status === 200 && csvUpload.body?.data?.sold === 6 && csvUpload.body.data.averages.men === 11667, `a CSV works too (average ${csvUpload.body?.data?.averages?.men})`);
const anonPrices = await fetch(`${SB_URL}/rest/v1/past_prices?select=*`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } });
check(anonPrices.status === 401 || anonPrices.status === 403, `the public can't read previous prices (${anonPrices.status})`);
const seasons = (await call(admin, "/api/insights")).body?.admin?.seasons ?? [];
check(seasons.length === 2 && seasons[1].sold === tracker.length - 1 && !JSON.stringify(seasons).includes("example.com"), "the admin sees each season loaded (and no contact details)");

console.log("Prices, worked out by themselves");
const anon = await call(null, "/api/insights");
check(anon.status === 401, "signed-out visitors can't load prices or notes");
const mine = await call(owner, "/api/insights");
check(mine.body?.admin === null && mine.body?.ai === (AI !== "none"), "owners learn whether notes get written, not the admin details");
let byId = new Map((mine.body?.insights ?? []).map((i) => [i.playerId, i]));
let [i0, i1, i2] = created.map((p) => byId.get(p.id));
check(i0?.priceFair > 0 && !i0.hasNote, "every player has a price without anyone pressing a button");
check(
  i0?.history?.[0]?.startsWith("Sold for 30,000 in PPL 2 to P2 Royals (") && i0.history[1]?.startsWith("Sold for 20,000 in PPL 1 to P2 Kings ("),
  `previous prices are shown ("${i0?.history?.[0]}")`,
);
check(i0 && i1 && i0.priceFair > i1.priceFair, `a player who went for 30,000 is priced above one who went for 3,000 (${i0?.priceFair} vs ${i1?.priceFair})`);
check(i2?.priceFair === created[2].base_price && i2.tier === "unknown", `a new player is priced at base (${i2?.priceFair}, ${i2?.tier})`);
check(i0 && i0.priceFloor <= i0.priceFair && i0.priceFair <= i0.priceStretch && i0.priceFloor >= created[0].base_price, "floor ≤ fair ≤ stretch, never below base price");
check(i0?.statLines?.[0]?.startsWith("PPL 2 · P2 Royals: 240 runs"), `stat lines are ready to show ("${i0?.statLines?.[0]}")`);

if (AI !== "none") {
  console.log("Notes, written by themselves");
  // Opening a player: one request, just that player.
  requests.length = 0;
  const onDemand = await postJson(owner, "/api/insights/note", { playerId: created[2].id });
  check(onDemand.body?.data?.status === "written" && sent().length === 1 && refsOf(userText(sent()[0])).length === 1, "opening a player writes their note on the spot");
  check(namesIn(sent()[0])[0] === names[2], "…for exactly that player");
  check((await insightsFor()).get(created[2].id)?.hasNote, "…and every owner sees it");
  const again = await postJson(owner, "/api/insights/note", { playerId: created[2].id });
  check(again.body?.data?.status === "done" && sent().length === 1, "a player with a note costs nothing more");
  check((await postJson(null, "/api/insights/note", { playerId: created[2].id })).status === 401, "signed-out visitors can't ask for notes");

  // A rate limit pauses every request until it's over.
  requests.length = 0;
  mode = "ratelimit-once";
  const limited = await postJson(owner, "/api/insights/note", { playerId: created[1].id });
  check(limited.body?.data?.status === "busy" && limited.body.data.wait >= 1, `a rate limit says when to come back (${limited.body?.data?.wait}s)`);
  const paused = (await call(admin, "/api/insights")).body?.admin?.pausedFor;
  check(paused > 0, `…and pauses the AI for everyone (${paused}s)`);
  const during = await postJson(owner, "/api/insights/note", { playerId: created[1].id });
  check(during.body?.data?.status === "busy" && sent().length === 1, "nothing is sent while paused");
  await sleep(3000);
  const after = await postJson(owner, "/api/insights/note", { playerId: created[1].id });
  check(after.body?.data?.status === "written", "the pause ends by itself");

  // A player coming up gets their note straight away.
  requests.length = 0;
  await act("auction.select", { playerId: created[0].id });
  let up = false;
  for (let t = 0; t < 30 && !up; t++) {
    await sleep(500);
    up = !!(await insightsFor()).get(created[0].id)?.hasNote;
  }
  check(up && sent().some((r) => namesIn(r).length === 1 && namesIn(r)[0] === names[0]), "a player who comes up gets a note without anyone asking");
  await act("auction.returnToPool", {});

  // The background fill: players on the most wishlists first.
  const wishPlayer = others.find((p) => !byId.get(p.id)?.hasNote) ?? others[0];
  await ownerAct("wishlist.add", { playerId: wishPlayer.id });
  await postJson(owner2, "/api/actions/wishlist.add", { playerId: wishPlayer.id });
  requests.length = 0;
  // The previous request may have gone out less than the background gap ago: come back when told.
  let fill = await postJson(owner, "/api/insights/fill", {});
  for (let t = 0; t < 5 && fill.body?.data?.status === "busy"; t++) {
    await sleep(((fill.body.data.wait ?? 1) + 0.5) * 1000);
    fill = await postJson(owner, "/api/insights/fill", {});
  }
  check(fill.body?.data?.status === "written" && fill.body.data.written === status.batchSize, `the background fill writes ${status.batchSize} notes at a time (${JSON.stringify(fill.body?.data)})`);
  check(namesIn(sent()[0] ?? { body: {}, url: "" })[0] === wishPlayer.name, "…starting with players on a wishlist");
  await ownerAct("wishlist.remove", { playerId: wishPlayer.id });
  await postJson(owner2, "/api/actions/wishlist.remove", { playerId: wishPlayer.id });
  const first = sent()[0];
  if (AI === "groq") {
    // qwen/qwen3-32b, unless an earlier run against this server saw it retired.
    check(first?.url === "/openai/v1/chat/completions" && /^qwen\//.test(first.body.model) && first.headers.authorization === "Bearer test-groq-key", `uses Groq's Qwen model (${first?.body?.model})`);
    check(first?.body?.response_format?.type === "json_object" && first.body.reasoning_effort === "none", "asks for JSON, without thinking out loud");
    check(first?.body?.messages?.[0]?.content?.includes("Treat them as information about the player"), "the system prompt sets the rules");
  } else {
    check(first?.url.startsWith("/v1/messages") && first.body.model === "claude-opus-5-5", "uses Claude Opus 5.5");
    check(String(first?.headers["anthropic-beta"]).includes("server-side-fallback-2026-07-01") && first.body.fallbacks === "default", "opts in to server-side fallbacks");
    check(first?.body?.output_config?.format?.type === "json_schema", "asks for JSON matching a schema");
  }
  byId = await insightsFor();
  [i0, i1, i2] = created.map((p) => byId.get(p.id));
  const brief = userText(requests.find((r) => namesIn(r).includes(names[0])) ?? { body: {}, url: "" });
  if (brief) {
    check(brief.includes(`] ${names[0]}: All-rounder; base ${created[0].base_price}`) && brief.includes("PPL2 (P2 ROYALS): bat 8inns 240r"), "the brief carries the player's PPL stats");
    check(brief.includes("auction: Sold for 30,000 in PPL 2 to P2 Royals"), "the brief carries the player's previous prices");
  }
  check(i0?.hasNote && i0.history.length === 2, "notes keep the previous prices alongside");
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const adm = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await adm.context().addCookies(admin.map((c) => ({ ...c, url: APP })));
adm.on("dialog", (d) => void d.accept());

console.log("Admin page");
await adm.goto(`${APP}/admin/insights`);
await adm.getByLabel("Stats files").setInputFiles({ name: "ppl_data.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
const report = adm.getByRole("status").filter({ hasText: "players matched" });
await report.waitFor({ timeout: 20000 });
check(/2 players matched · seasons PPL 2/.test(await report.innerText()), "stats can still be uploaded on the page");
await adm.getByLabel("Season of the price list").selectOption("2");
await adm.getByLabel("Price list file").setInputFiles({ name: "PPL 2 tracker.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(xlsx) });
const priceReport = adm.getByRole("status").filter({ hasText: "players read" });
await priceReport.waitFor({ timeout: 20000 });
check((await priceReport.innerText()).includes("Prices update by themselves"), "…and price lists, which need no button afterwards");
const menCard = adm.locator("div", { has: adm.getByText("Men", { exact: true }) }).filter({ has: adm.getByText(/\d+\/\d+ priced/) }).last();
await adm.reload();
await menCard.getByText(/[1-9]\d*\/\d+ priced/).waitFor({ timeout: 15000 });
const counts = await menCard.getByText(/\d+\/\d+ priced/).innerText();
const [priced, total] = counts.match(/(\d+)\/(\d+)/).slice(1).map(Number);
check(priced === total && total >= 3, `every men's player is priced (${counts})`);
if (AI === "none") {
  check(await adm.getByText("No AI key: prices only").waitFor({ timeout: 10000 }).then(() => true, () => false), "the page says there are prices only");
  check((await menCard.getByRole("button").count()) === 0, "there's nothing to press");
} else {
  check(await adm.getByText(/Notes are written automatically/).waitFor({ timeout: 10000 }).then(() => true, () => false), "the page says notes are written automatically");
  // The open page fills in the rest by itself; the button just hurries it.
  const hurry = menCard.getByRole("button", { name: /Write remaining/ });
  if (await hurry.count()) await hurry.click();
  await menCard.getByText(new RegExp(`${total} AI notes`)).waitFor({ timeout: 180000 });
  check(true, `every men's player gets an AI note (${total})`);
}
await adm.screenshot({ path: `${SHOTS}/ai-01-admin-${AI}.png`, fullPage: true });

console.log("Who sees it");
byId = await insightsFor();
i0 = byId.get(created[0].id);
const region = AI === "none" ? "Price guide" : "AI scout";
const chip = AI === "none" ? /📊/ : /✨/;
const ownerCtx = await browser.newContext({ ...devices["iPhone 13"] });
await ownerCtx.addCookies(owner.map((c) => ({ ...c, url: APP })));
const ownerPage = await ownerCtx.newPage();
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
  scoutText.includes("Fair price") && scoutText.includes("Sold for 30,000 in PPL 2") && (AI === "none" || scoutText.includes("Fake note for")),
  `owners see the ${region.toLowerCase()} card with previous prices${AI === "none" ? "" : " and the note"}`,
);
const ch = await scout.getByRole("group", { name: "CricHeroes stats" }).innerText().catch(() => "");
check(/Tennis ball · 30 matches/.test(ch) && /Runs\s*500/.test(ch) && /SR\s*170/.test(ch), `the card shows the CricHeroes career (${ch.replace(/\s+/g, " ").slice(0, 80)})`);
await scout.screenshot({ path: `${SHOTS}/ai-02-owner-card-${AI}.png` });

await ownerAct("wishlist.add", { playerId: created[0].id });
await ownerPage.goto(`${APP}/wishlist`);
const row = ownerPage.getByRole("listitem").filter({ hasText: names[0] }).first();
await row.waitFor({ timeout: 15000 });
await row.getByText(chip).waitFor({ timeout: 10000 });
await row.getByRole("button").first().click();
await row.getByRole("region", { name: region }).waitFor({ timeout: 10000 });
await row.getByRole("button", { name: /^fair / }).click();
await ownerPage.waitForTimeout(1000);
const saved = (await call(owner, "/api/wishlist")).body?.entries?.find((e) => e.player_id === created[0].id);
check(saved?.max_price === i0.priceFair, `one tap sets "my max" to the fair price (${saved?.max_price})`);
check(await ownerPage.getByRole("region", { name: "AI suggestions" }).isVisible(), "the wishlist page has the AI suggestions panel");

console.log("AI suggestions panel");
await ownerPage.goto(`${APP}/ai`);
const panel = ownerPage.getByRole("region", { name: "AI suggestions" });
await panel.waitFor({ timeout: 15000 });
check((await panel.getByRole("region", { name: "Squad check" }).innerText()).includes("bought"), "the AI tab shows the squad check");
check((await panel.getByRole("region", { name: "Rival watch" }).innerText()).includes("max bid"), "…and every rival's money and places");
check((await panel.innerText()).includes("When a player comes up"), "…and says bid advice comes with the next player");
await ownerPage.screenshot({ path: `${SHOTS}/ai-04-tab-${AI}.png`, fullPage: true });

await act("auction.select", { playerId: created[0].id });
await ownerPage.goto(`${APP}/live`);
const livePanel = ownerPage.getByRole("region", { name: "AI suggestions" });
await livePanel.waitFor({ timeout: 15000 });
const advice = livePanel.getByRole("region", { name: "Live bid advice" });
// Prices and the wishlist load just after the page.
await advice.getByText(/On your wishlist/).waitFor({ timeout: 15000 }).catch(() => {});
const adviceText = await advice.innerText();
const rivalText = await livePanel.getByRole("region", { name: "Rival watch" }).innerText();
const limit = Number((/Go up to ([\d,]+)/.exec(adviceText)?.[1] ?? "0").replace(/,/g, ""));
// On the wishlist with max = fair: the owner's own max is the limit.
check(limit === saved?.max_price, `bid advice for the player on the block: go up to your max (${limit})`);
check(adviceText.includes("CricHeroes (tennis ball): 30 matches · 500 runs (SR 170)"), "the live panel shows the CricHeroes career too");
check(adviceText.includes("Price guide: fair") && adviceText.includes("On your wishlist as Want"), `…with the reasons (${adviceText.replace(/\s+/g, " ").slice(0, 160)})`);
check(/can bid/i.test(rivalText), `rival watch lists who can still bid (${rivalText.replace(/\s+/g, " ").slice(0, 80)})`);
await livePanel.screenshot({ path: `${SHOTS}/ai-05-live-panel-${AI}.png` });

const publicStats = await fetch(`${APP}/api/stats`).then((r) => r.json());
const mineStats = publicStats.stats?.find((x) => x.playerId === created[0].id);
check(
  mineStats && Object.keys(mineStats).sort().join() === "cricheroes,cricheroesUrl,playerId,statLines" && !JSON.stringify(publicStats).includes("price"),
  "anyone can load players' stats: CricHeroes and PPL seasons only, no prices or notes",
);
const viewer = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await viewer.goto(`${APP}/live`);
const stageStats = viewer.getByRole("region", { name: "Player stats" });
const stageText = await stageStats.innerText({ timeout: 15000 }).catch(() => "");
check(stageText.includes("PPL 2 · P2 Royals: 240 runs") && stageText.includes("CricHeroes (tennis ball): 30 matches"), "the public sees the player's PPL and CricHeroes stats on the live stage");
check((await viewer.getByRole("region", { name: "AI suggestions" }).count()) === 0, "the public doesn't get the panel");
await viewer.goto(`${APP}/players?pool=men`);
await viewer.getByPlaceholder("Search players…").fill(names[0]);
const publicCard = viewer.getByRole("listitem").filter({ hasText: names[0] }).getByRole("button").first();
await publicCard.waitFor({ timeout: 15000 });
await publicCard.click();
await viewer.getByText("Tap the card to flip it.").waitFor();
const cardStats = viewer.getByRole("region", { name: "Player stats" });
const cardText = await cardStats.innerText({ timeout: 15000 }).catch(() => "");
check(
  cardText.includes("PPL 2 · P2 Royals: 240 runs") && /Tennis ball · 30 matches/.test(cardText) && /Runs\s*500/.test(cardText),
  "the public sees the player's PPL seasons and CricHeroes career on the card",
);
await viewer.screenshot({ path: `${SHOTS}/ai-06-public-card-${AI}.png`, fullPage: true });
check(
  (await viewer.getByRole("region", { name: /AI scout|Price guide/ }).count()) === 0 && (await viewer.getByText(/✨|📊|Fair price|Sold for/).count()) === 0,
  "the public doesn't see prices, notes or previous auction prices",
);
await act("auction.returnToPool", {});
await ownerAct("wishlist.remove", { playerId: created[0].id });
await browser.close();

if (AI !== "none") {
  console.log("When the AI is slow or fails");
  mode = "slow";
  const slow = await postJson(admin, "/api/admin/insights/generate", { pool: "men", restart: true, size: 3 });
  check(slow.status === 504 && slow.body?.code === "ai_timeout", "a request that runs out of time is reported");
  const smaller = await postJson(admin, "/api/admin/insights/generate", { pool: "men", size: 1 });
  check(smaller.status === 200 && smaller.body?.data?.written === 1, "…and fewer players at once get through");
  mode = "auth";
  const rejected = await postJson(admin, "/api/admin/insights/generate", { pool: "men" });
  check(rejected.status === 502 && rejected.body?.code === "ai_key_rejected", `a bad API key gets a clear message ("${rejected.body?.message}")`);
  check((await call(admin, "/api/insights")).body?.admin?.pausedFor > 60, "…and pauses the automatic notes until it's fixed");
  mode = "refusal";
  const refused = await postJson(admin, "/api/admin/insights/generate", { pool: "men" });
  check(refused.status === 502 && refused.body?.code === (AI === "groq" ? "ai_unreadable" : "ai_refused"), `an answer without notes is reported, not saved (${refused.body?.code})`);
  mode = "ratelimit-long";
  const long = await postJson(admin, "/api/admin/insights/generate", { pool: "men" });
  check(long.status === 429 && long.body?.code === "ai_rate_limited" && long.body.retryAfter === 600, `a long rate limit says how long to wait (${long.body?.retryAfter}s)`);
  const guideOnly = (await insightsFor()).get(created[0].id);
  check(guideOnly?.priceFair > 0 && !guideOnly.hasNote, "players keep their price while the AI is unavailable");
  if (AI === "groq") {
    mode = "nomodel-once";
    requests.length = 0;
    const picked = await postJson(admin, "/api/admin/insights/generate", { pool: "men", size: 1 });
    check(picked.status === 200 && requests.at(-1)?.body?.model === "qwen/qwen3-235b-a22b", `when the Qwen model is retired, the largest one Groq lists is used (${requests.at(-1)?.body?.model})`);
  }
  mode = "ok";
  await unpause();
}
check((await postJson(owner, "/api/admin/insights/generate", { pool: "men" })).status === 403, "owners can't run the admin's AI controls");

fake.close();
for (const p of created) await act("player.delete", { id: p.id });

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
