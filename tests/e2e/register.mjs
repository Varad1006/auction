// End-to-end test of the registration form against a running app + local
// Supabase (same setup as smoke.mjs). Screenshots go to $SHOTS.
import { createServerClient } from "@supabase/ssr";
import ece from "http_ece";
import { createECDH, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import jsQR from "jsqr";
import { chromium, devices } from "playwright";
import sharp from "sharp";

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
const actAs = async (cookies, action, body) => {
  const res = await fetch(`${APP}/api/actions/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP, cookie: cookieHeader(cookies) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const act = (action, body) => actAs(admin, action, body);

// A fake push service on localhost (the app runs with PUSH_ALLOW_LOCALHOST=1).
const pushes = [];
const pushServer = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    pushes.push({ path: req.url, body: Buffer.concat(chunks) });
    res.writeHead(201).end();
  });
});
await new Promise((r) => pushServer.listen(0, "127.0.0.1", r));
function device(name) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16).toString("base64url");
  const sub = { endpoint: `http://127.0.0.1:${pushServer.address().port}/push/${name}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth } };
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
const settings = (is_open, capacity = {}) =>
  act("registration.settings", {
    is_open,
    capacity_men: capacity.men ?? null,
    capacity_women: capacity.women ?? null,
    title: "Society Premier League 2025 – Registration",
    intro: "Matches on weekend mornings in November, 7:30 am – 1:00 pm at the society ground.",
    payment_instructions: "Pay ₹500 to UPI: spl@upi and upload the screenshot.",
    receipt_required: true,
    availability_question: "Availability (Nov 2025) – 7:30 am till 1:00 pm",
    availability_options: ["Sat 8 Nov", "Sun 9 Nov", "Sat 15 Nov", "Sun 16 Nov"],
    declaration_text: "I confirm and undertake the following:\n\n1. I will follow the rules.\n2. I am fit to play.",
    final_declaration_text: "10. I agree to follow the Rule Book and keep discipline.",
    rulebook_url: "https://example.com/rulebook",
    rulebook_message: "Please go through the Rule Book before registering.",
  });
const UPI = "upi://pay?pa=test.payee@okaxis&pn=Test%20Payee&aid=abc";

// Files
const photo = await sharp({ create: { width: 600, height: 750, channels: 3, background: "#1e40af" } })
  .composite([{ input: Buffer.from('<svg width="600" height="750"><text x="300" y="400" font-size="160" text-anchor="middle" fill="#fbbf24" font-family="Arial" font-weight="bold">RP</text></svg>') }])
  .jpeg()
  .toBuffer();
writeFileSync(`${SHOTS}/photo.jpg`, photo);
writeFileSync(`${SHOTS}/receipt.pdf`, "%PDF-1.4\n% test receipt\n");
writeFileSync(`${SHOTS}/fake.jpg`, "this is not an image");

const email = `rohan.${Date.now()}@example.com`;
const post = async (fields, files) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const [k, [buf, type, name]] of Object.entries(files)) form.set(k, new Blob([buf], { type }), name);
  const res = await fetch(`${APP}/api/register`, { method: "POST", body: form, headers: { origin: APP } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const fields = {
  full_name: "Rohan Patil", email: `other.${Date.now()}@example.com`, phone: "9876543210", flat_number: "B-1203", age: "29",
  gender: "men", role: "All-rounder", batting_style: "Right-hand bat", bowling_style: "Right-arm medium", tshirt_size: "L",
  availability: "Sat 8 Nov", declaration: "yes", final_declaration: "yes",
};
const files = { photo: [photo, "image/jpeg", "p.jpg"], receipt: [Buffer.from("%PDF-1.4\n"), "application/pdf", "r.pdf"] };

console.log("Access and validation");
check((await settings(false)).status === 200, "admin can save form settings");
check((await act("registration.payments", { items: [{ label: "", payload: "https://evil.example/qr" }] })).status === 400, "only UPI payment links are accepted as QR codes");
check((await act("registration.payments", { items: [{ label: "Fees", payload: UPI, phone: "call me" }] })).status === 400, "payee phone must be a phone number");
check((await act("registration.payments", { items: [{ label: "Fees", payload: UPI, phone: "98765 01234" }] })).status === 200, "admin saves a payment QR code with a phone number");
check((await post(fields, files)).status === 403, "closed form rejects submissions");
await settings(true);
const fake = await post(fields, { ...files, photo: [Buffer.from("not an image"), "image/jpeg", "x.jpg"] });
check(fake.status === 415, `a non-image renamed .jpg is rejected (${fake.body?.message})`);
const bad = await post({ ...fields, availability: "Every day" }, files);
check(bad.status === 400, "availability must be one of the configured options");
const noDecl = await post({ ...fields, declaration: "" }, files);
check(noDecl.status === 400, "declaration is required");
const noFinal = await post({ ...fields, final_declaration: "" }, files);
check(noFinal.status === 400 && noFinal.body?.message === "Please agree to the rules and conduct", `the final agreement is required too (${noFinal.body?.message})`);
const shortPhone = await post({ ...fields, phone: "98765 4321" }, files);
check(shortPhone.status === 400 && shortPhone.body?.message === "Mobile number must be exactly 10 digits", `mobile numbers must be 10 digits (${shortPhone.body?.message})`);
const conEmail = await post({ ...fields, email: "rohan@gmail.con" }, files);
check(conEmail.status === 400 && conEmail.body?.message === "Check your email: did you mean rohan@gmail.com?", `impossible email endings are rejected (${conEmail.body?.message})`);
const young = await post({ ...fields, age: "17" }, files);
check(young.status === 400 && young.body?.message === "Age must be between 18 and 60", `under-18s are rejected (${young.body?.message})`);
const old = await post({ ...fields, age: "61" }, files);
check(old.status === 400, "over-60s are rejected");
const plainFlat = await post({ ...fields, flat_number: "1203" }, files);
check(plainFlat.status === 400 && plainFlat.body?.message === "Use building number - flat number, e.g. B-1203", `flat must be building-flat (${plainFlat.body?.message})`);
const digitName = await post({ ...fields, full_name: "R0han" }, files);
check(digitName.status === 400, "names can't contain digits");
const owner = await sessionCookies("owner1@test.local");

console.log("Admin alerts");
const adminPhone = device("admin");
const ownerPhone = device("owner");
check((await act("push.subscribe", adminPhone.sub)).status === 200, "admin turns on new-registration alerts");
check((await actAs(owner, "push.subscribe", ownerPhone.sub)).status === 200, "an owner has wishlist alerts on");
check((await actAs(await sessionCookies("stranger@test.local"), "push.subscribe", device("x").sub)).status === 403, "signed-in viewers can't subscribe");
check((await act("push.test", {})).status === 200, "admin can send a test alert");
const adminTest = await nextPush("/push/admin");
check(adminTest && /registration form/.test(adminPhone.read(adminTest).body), "the admin test alert talks about registrations");
const ownerList = await fetch(`${APP}/api/admin/registrations`, { headers: { cookie: cookieHeader(owner) } });
check(ownerList.status === 403, "owners cannot list registrations");
const rest = await fetch(`${SB_URL}/rest/v1/registrations?select=email`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } });
check(rest.status >= 400, `registrations are not readable with the public key (${rest.status})`);
const store = await fetch(`${SB_URL}/storage/v1/object/list/registrations`, {
  method: "POST",
  headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json" },
  body: JSON.stringify({ prefix: "" }),
});
const listed = await store.json().catch(() => null);
check(!Array.isArray(listed) || listed.length === 0, "private registration files are not listable publicly");

console.log("Filling the form on a phone");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log(`  page error: ${e.message}`);
  failures++;
});
const sockets = [];
page.on("websocket", (ws) => sockets.push(ws.url()));
await page.goto(`${APP}/register`);
await page.getByRole("heading", { name: /Registration/ }).waitFor();
await page.waitForTimeout(1500);
check(
  (await page.getByRole("link", { name: /^(Overview|Live|Players|Teams|Results)$/ }).count()) === 0 &&
    (await page.getByRole("button", { name: /Sign in/ }).count()) === 0,
  "the form stands alone: no app tabs or sign-in",
);
check(sockets.length === 0, `the form opens no live connection (${sockets.length})`);
check((await page.getByRole("link", { name: /Rule Book before registering/ }).getAttribute("href")) === "https://example.com/rulebook", "rulebook link and message are shown");
check((await page.getByRole("img", { name: "UPI QR code for Test Payee" }).count()) === 1, "payment QR code is drawn on the form");
check(
  (await page.getByText("98765 01234").count()) === 1 && (await page.getByText("test.payee@okaxis").count()) === 0,
  "the payee's phone number is shown instead of the UPI ID",
);
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
await page.getByRole("button", { name: "Copy phone number 98765 01234" }).click();
const copiedText = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
check(copiedText === null || copiedText === "9876501234", `Copy puts the 10-digit number on the clipboard (${copiedText})`);
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "⬇ Download QR" }).click()]);
const qrFile = `${SHOTS}/${download.suggestedFilename()}`;
await download.saveAs(qrFile);
const qrMeta = await sharp(qrFile).metadata();
check(download.suggestedFilename() === "payment-qr-Test-Payee.png" && qrMeta.format === "png" && qrMeta.width >= 700, `Download QR saves a PNG (${download.suggestedFilename()}, ${qrMeta.width}x${qrMeta.height})`);
const qrPixels = await sharp(qrFile).resize({ width: 400 }).removeAlpha().ensureAlpha(1).raw().toBuffer({ resolveWithObject: true });
const scanned = jsQR(new Uint8ClampedArray(qrPixels.data), qrPixels.info.width, qrPixels.info.height)?.data;
check(scanned === UPI, "the downloaded image scans as the same UPI payment link");
const submitButton = page.getByRole("button", { name: "Submit registration" });
check(await submitButton.isDisabled(), "submit is disabled until the declaration is accepted");
const sections = await page.getByRole("heading", { level: 2 }).allTextContents();
check(
  sections[0] === "Undertaking and Declaration" && sections.at(-1) === "Rules and Conduct",
  `the declaration comes first and the rules agreement last (${sections.join(" > ")})`,
);
await page.getByLabel("I have read and agree to the Undertaking and Declaration").check();
check(await submitButton.isDisabled(), "one agreement isn't enough to submit");
await page.getByLabel("I agree to follow the rules and conduct above").check();
check(await submitButton.isEnabled(), "accepting both agreements enables submit");
await submitButton.click();
check((await page.getByText("Enter your full name").count()) === 1, "empty submit shows inline errors");
await page.getByLabel("Full name").fill("Rohan Patil");
await page.getByLabel("Email").fill("rohan@gmial.com");
await page.getByLabel("Mobile number").focus();
await page.getByText("Did you mean").waitFor({ timeout: 3000 });
check((await page.getByText("rohan@gmail.com").count()) === 1, "an email typo gets a suggestion");
await page.getByRole("button", { name: "Yes, use this" }).click();
check((await page.getByLabel("Email").inputValue()) === "rohan@gmail.com", "one tap fixes the email");
await page.getByLabel("Email").fill(email);
await page.getByLabel("Mobile number").fill("+91 98765-43210");
check((await page.getByLabel("Mobile number").inputValue()) === "9876543210", "the mobile field keeps just the 10 digits");
await page.getByLabel("Flat number").fill("b 1203");
check((await page.getByLabel("Flat number").inputValue()) === "B-1203", "flat number is typed as building-flat (b 1203 -> B-1203)");
check((await page.getByText("18 to 60 years").count()) === 1, "the age limits are shown under the age box");
await page.getByLabel("Age").fill("29");
await page.getByRole("radio", { name: "Male", exact: true }).click();
await page.getByLabel("Playing role").selectOption("All-rounder");
await page.getByLabel("Batting style").selectOption("Right-hand bat");
await page.getByLabel("Bowling style").selectOption("Right-arm medium");
await page.getByLabel("T-shirt size").selectOption("L");
await page.getByLabel("Sat 8 Nov").check();
await page.getByLabel("Sun 9 Nov").check();
await page.getByLabel(/Additional information/).fill("Opened for the Titans last season. 212 runs.");
await page.locator('input[type=file][accept="image/*"]').setInputFiles(`${SHOTS}/photo.jpg`);
await page.getByAltText("Your photo").waitFor();
await page.locator('input[type=file][accept="image/*,application/pdf"]').setInputFiles(`${SHOTS}/receipt.pdf`);
await page.getByText("Receipt attached").waitFor();
await page.screenshot({ path: `${SHOTS}/r-01-form.png`, fullPage: true });
await page.getByRole("button", { name: "Submit registration" }).click();
await page.getByText("You're registered!").waitFor({ timeout: 15000 });
check(true, "form submits and shows the confirmation");
const regPush = await nextPush("/push/admin");
const regMsg = regPush && adminPhone.read(regPush);
check(
  regMsg?.title === "📝 New registration: Rohan Patil" && /Men · All-rounder · 29 yrs — \d+ waiting for your approval/.test(regMsg.body) && regMsg.url === "/admin/registrations",
  `the admin's phone is told about the new registration (${regMsg?.title} | ${regMsg?.body})`,
);
check(pushes.filter((p) => p.path === "/push/owner").length === 0, "owners don't get registration alerts");
await page.screenshot({ path: `${SHOTS}/r-02-done.png` });

const dup = await post({ ...fields, email }, files);
check(dup.status === 409, "the same email cannot register twice");
const samePerson = await post({ ...fields, email: `again.${Date.now()}@example.com`, phone: "+91 98765 43210" }, files);
check(samePerson.status === 409, `the same name and mobile can't register twice under another email (${samePerson.body?.message})`);

console.log("Admin review");
const list = await (await fetch(`${APP}/api/admin/registrations`, { headers: { cookie: cookieHeader(admin) } })).json();
const reg = list.registrations.find((r) => r.email === email);
check(reg?.status === "pending" && reg.phone === "9876543210" && reg.flat_number === "B-1203" && reg.availability === "Sat 8 Nov, Sun 9 Nov", "registration stored as pending with tidy answers");
check(Boolean(reg?.photo_url && reg?.receipt_url), "admin gets signed links to the photo and receipt");
const ok = await act("registration.approve", { id: reg.id });
check(ok.status === 200, `approve creates the player (${ok.body?.message ?? "ok"})`);
const again = await act("registration.approve", { id: reg.id });
check(again.status === 409, "a registration can't be approved twice");
const players = await (await fetch(`${SB_URL}/rest/v1/players?select=*&id=eq.${ok.body?.data}`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } })).json();
const p = players.at(-1);
const menBase = (await (await fetch(`${SB_URL}/rest/v1/pool_config?select=base_price_c&pool=eq.men`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } })).json())[0].base_price_c;
check(p?.role === "All-rounder" && p?.pool === "men" && p?.base_price === menBase, "player has the chosen role, pool and the pool base price");
check(p?.photo_url?.includes("/player-photos/"), "photo copied to the public player-photos bucket");
check(JSON.stringify(p?.details) === JSON.stringify([{ label: "Availability", value: "Sat 8 Nov, Sun 9 Nov" }, { label: "Age", value: "29" }]), "availability and age become card details");
check(!JSON.stringify(p).match(/9876543210|B-1203|example\.com/), "no phone, flat or email on the public player");

await page.goto(`${APP}/players?pool=men`);
await page.getByPlaceholder("Search players…").fill("Rohan Patil");
await page.getByRole("button", { name: /Rohan Patil/ }).last().click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/r-03-card.png` });

const admPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await admPage.context().addCookies(admin.map((c) => ({ ...c, url: APP })));
await admPage.goto(`${APP}/admin/registrations`);
await admPage.getByText("Share this link").waitFor();
await admPage.getByRole("button", { name: /^approved/ }).click();
await admPage.waitForTimeout(500);
await admPage.screenshot({ path: `${SHOTS}/r-04-admin.png`, fullPage: true });

console.log("Waitlist");
// Every men's spot is taken once the limit equals the men already registered.
const before = await (await fetch(`${APP}/api/admin/registrations`, { headers: { cookie: cookieHeader(admin) } })).json();
const menTaken = before.spots.men.taken;
check((await settings(true, { men: menTaken })).status === 200, `admin sets ${menTaken} men's spots`);
const formPage = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await formPage.goto(`${APP}/register`);
check((await formPage.getByText("Men: full — new registrations join the waitlist").count()) === 1, "the form says the men's spots are full");
await formPage.context().close();
// A name unique to this run (letters only, as the form requires).
const lateName = `Late ${Date.now().toString(26).replace(/\d/g, (d) => "abcdefghij"[d])}`;
const late = await post({ ...fields, full_name: lateName, email: `late.${Date.now()}@example.com`, phone: "9123456780" }, files);
check(late.status === 200 && late.body?.waitlist === 1, `a registration after the limit is waitlisted (#${late.body?.waitlist})`);
const waitPush = await nextPush("/push/admin");
check(waitPush && adminPhone.read(waitPush).title === `⏳ Waitlist #1: ${lateName}`, "the admin is told it's a waitlist registration");
const after1 = await (await fetch(`${APP}/api/admin/registrations`, { headers: { cookie: cookieHeader(admin) } })).json();
const lateReg = after1.registrations.find((r) => r.full_name === lateName);
check(lateReg?.waitlist_position === 1, "the admin list shows the waitlist position");
const publicRead = async (query) => (await fetch(`${SB_URL}/rest/v1/${query}`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } })).json();
const approved = await act("registration.approve", { id: lateReg.id });
const lateId = approved.body?.data;
check(approved.status === 200, "approving a waitlisted registration works");
const lateRow = (await publicRead(`players?select=status,waitlisted_at&id=eq.${lateId}`))[0];
check(lateRow?.status === "waitlist" && lateRow.waitlisted_at, "…and puts them on the public waitlist, not in the auction");
const after2 = await (await fetch(`${APP}/api/admin/registrations`, { headers: { cookie: cookieHeader(admin) } })).json();
check(after2.registrations.find((r) => r.id === lateReg.id)?.waitlisted === true, "the admin list marks them approved onto the waitlist");

console.log("Public waitlist");
const manualName = `Walk ${Date.now().toString(26).replace(/\d/g, (d) => "abcdefghij"[d])}`;
const manual = await act("player.create", { name: manualName, pool: "men", role: "Bowler", waitlist: true });
check(manual.status === 200 && manual.body?.data?.status === "waitlist", "the admin adds a player straight to the waitlist");
const manualId = manual.body?.data?.id;
check((await actAs(owner, "player.setWaitlist", { id: manualId, waitlisted: false })).status === 403, "owners can't move players off the waitlist");
const star = await actAs(owner, "wishlist.add", { playerId: manualId });
check(star.status === 409 && star.body?.code === "waitlisted", "owners can't wishlist a waitlisted player");

const viewer = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await viewer.goto(`${APP}/waitlist`);
const wl = viewer.getByRole("list", { name: "Men waitlist" });
await wl.getByText(manualName).waitFor({ timeout: 15000 });
const order = await wl.locator("li").allInnerTexts();
const lateAt = order.findIndex((t) => t.includes(lateName));
const manualAt = order.findIndex((t) => t.includes(manualName));
check(lateAt !== -1 && manualAt > lateAt, `anyone can see the waitlist, in order (#${lateAt + 1} ${lateName}, #${manualAt + 1} ${manualName})`);
check((await viewer.getByRole("button", { name: "Move to players" }).count()) === 0, "visitors don't get the move button");
await viewer.screenshot({ path: `${SHOTS}/r-05-waitlist.png`, fullPage: true });
await viewer.goto(`${APP}/players?pool=men`);
await viewer.getByRole("button", { name: /^All/ }).click();
await viewer.getByText("Loading players…").waitFor({ state: "detached" });
check((await viewer.getByText(manualName).count()) === 0 && (await viewer.getByText(lateName).count()) === 0, "waitlisted players aren't in the players list");
await act("auction.setPool", { pool: "men" });
const spin = await act("auction.spin", {});
check(spin.status === 200 && ![lateId, manualId].some((id) => spin.body?.data?.spin_candidates?.includes(id)), "…or on the wheel");
await act("auction.returnToPool", {});

// The admin moves a player off the waitlist from the public page.
await admPage.goto(`${APP}/waitlist`);
const adminRow = admPage.getByRole("listitem").filter({ hasText: manualName });
await adminRow.getByRole("button", { name: "Move to players" }).click();
await admPage.getByText(`${manualName} moved to players`).waitFor({ timeout: 10000 });
check((await publicRead(`players?select=status&id=eq.${manualId}`))[0]?.status === "pool", "the admin moves a player from the waitlist to the players list");
await viewer.goto(`${APP}/players?pool=men`);
await viewer.getByText(manualName).waitFor({ timeout: 10000 });
check(true, "…and they show up in the players list");
check((await act("player.setWaitlist", { id: manualId, waitlisted: true })).status === 200, "and can be put back on the waitlist");

// Admin → Players: add someone to the waitlist with the form.
const formName = `Form ${Date.now().toString(26).replace(/\d/g, (d) => "abcdefghij"[d])}`;
await admPage.goto(`${APP}/admin/players`);
await admPage.getByRole("button", { name: "+ Add to waitlist" }).click();
const dialog = admPage.getByRole("dialog");
await dialog.getByLabel("Name").fill(formName);
check(await dialog.getByRole("checkbox", { name: /Add to the waitlist/ }).isChecked(), "the waitlist form starts with 'Add to the waitlist' ticked");
await dialog.getByRole("button", { name: "Add to waitlist" }).click();
await admPage.getByText("Added to the waitlist").waitFor({ timeout: 10000 });
await admPage.keyboard.press("Escape");
await admPage.getByLabel("Status").selectOption("waitlist");
const formRow = admPage.getByRole("listitem").filter({ hasText: formName });
await formRow.waitFor({ timeout: 10000 });
check((await formRow.getByText(/Waitlist #\d+/).count()) === 1, "Admin → Players lists them under the Waitlist filter with their place");
const formId = (await publicRead(`players?select=id,status&name=eq.${encodeURIComponent(formName)}`))[0];
check(formId?.status === "waitlist", "the form adds them with waitlist status");
await admPage.screenshot({ path: `${SHOTS}/r-06-admin-waitlist.png`, fullPage: true });
if (formId) await act("player.delete", { id: formId.id });
await viewer.context().close();
await settings(true);
await browser.close();

console.log("Start fresh");
const ownerCleanup = await fetch(`${APP}/api/actions/admin.cleanup`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: APP, cookie: cookieHeader(owner) },
  body: JSON.stringify({ players: false, registrations: true, confirm: "DELETE" }),
});
check(ownerCleanup.status === 403, "owners can't clean up the database");
check((await act("admin.cleanup", { players: false, registrations: true, confirm: "yes" })).status === 400, "clean-up needs DELETE typed to confirm");
const cleaned = await act("admin.cleanup", { players: false, registrations: true, confirm: "DELETE" });
const after = await (await fetch(`${APP}/api/admin/registrations`, { headers: { cookie: cookieHeader(admin) } })).json();
check(cleaned.status === 200 && after.registrations.length === 0, `admin deletes all registrations (${cleaned.body?.data?.registrations ?? cleaned.body?.message})`);
check((await (await fetch(`${SB_URL}/rest/v1/players?select=id&limit=1`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } })).json()).length === 1, "players are kept when only registrations are cleared");
await act("registration.payments", { items: [] });
// Remove the players this run created, so reruns start clean.
for (const id of [ok.body?.data, lateId, manualId]) if (id) await act("player.delete", { id });
await act("push.unsubscribe", { endpoint: adminPhone.sub.endpoint });
await actAs(owner, "push.unsubscribe", { endpoint: ownerPhone.sub.endpoint });
pushServer.close();

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
