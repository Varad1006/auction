// End-to-end test of the registration form against a running app + local
// Supabase (same setup as smoke.mjs). Screenshots go to $SHOTS.
import { createServerClient } from "@supabase/ssr";
import { mkdirSync, writeFileSync } from "node:fs";
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
const act = async (action, body) => {
  const res = await fetch(`${APP}/api/actions/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP, cookie: cookieHeader(admin) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const settings = (is_open) =>
  act("registration.settings", {
    is_open,
    title: "Society Premier League 2025 – Registration",
    intro: "Matches on weekend mornings in November, 7:30 am – 1:00 pm at the society ground.",
    payment_instructions: "Pay ₹500 to UPI: spl@upi and upload the screenshot.",
    receipt_required: true,
    availability_question: "Availability (Nov 2025) – 7:30 am till 1:00 pm",
    availability_options: ["Sat 8 Nov", "Sun 9 Nov", "Sat 15 Nov", "Sun 16 Nov"],
    declaration_text: "I confirm the details are correct and I will follow the rules.",
  });

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
  availability: "Sat 8 Nov", declaration: "yes",
};
const files = { photo: [photo, "image/jpeg", "p.jpg"], receipt: [Buffer.from("%PDF-1.4\n"), "application/pdf", "r.pdf"] };

console.log("Access and validation");
check((await settings(false)).status === 200, "admin can save form settings");
check((await post(fields, files)).status === 403, "closed form rejects submissions");
await settings(true);
const fake = await post(fields, { ...files, photo: [Buffer.from("not an image"), "image/jpeg", "x.jpg"] });
check(fake.status === 415, `a non-image renamed .jpg is rejected (${fake.body?.message})`);
const bad = await post({ ...fields, availability: "Every day" }, files);
check(bad.status === 400, "availability must be one of the configured options");
const noDecl = await post({ ...fields, declaration: "" }, files);
check(noDecl.status === 400, "declaration is required");
const owner = await sessionCookies("owner1@test.local");
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
await page.goto(`${APP}/register`);
await page.getByRole("heading", { name: /Registration/ }).waitFor();
await page.getByRole("button", { name: "Submit registration" }).click();
check((await page.getByText("Enter your full name").count()) === 1, "empty submit shows inline errors");
await page.getByLabel("Full name").fill("Rohan Patil");
await page.getByLabel("Email").fill(email);
await page.getByLabel("Contact number").fill("98765 43210");
await page.getByLabel("Flat number").fill("B-1203");
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
await page.getByLabel("I agree").check();
await page.screenshot({ path: `${SHOTS}/r-01-form.png`, fullPage: true });
await page.getByRole("button", { name: "Submit registration" }).click();
await page.getByText("You're registered!").waitFor({ timeout: 15000 });
check(true, "form submits and shows the confirmation");
await page.screenshot({ path: `${SHOTS}/r-02-done.png` });

const dup = await post({ ...fields, email }, files);
check(dup.status === 409, "the same email cannot register twice");

console.log("Admin review");
const list = await (await fetch(`${APP}/api/admin/registrations`, { headers: { cookie: cookieHeader(admin) } })).json();
const reg = list.registrations.find((r) => r.email === email);
check(reg?.status === "pending" && reg.phone === "98765 43210" && reg.availability === "Sat 8 Nov, Sun 9 Nov", "registration stored as pending with all answers");
check(Boolean(reg?.photo_url && reg?.receipt_url), "admin gets signed links to the photo and receipt");
const ok = await act("registration.approve", { id: reg.id, grade: "B" });
check(ok.status === 200, `approve creates the player (${ok.body?.message ?? "ok"})`);
const again = await act("registration.approve", { id: reg.id, grade: "B" });
check(again.status === 409, "a registration can't be approved twice");
const players = await (await fetch(`${SB_URL}/rest/v1/players?select=*&name=eq.Rohan%20Patil`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } })).json();
const p = players.at(-1);
check(p?.grade === "B" && p?.role === "All-rounder" && p?.pool === "men" && p?.base_price === 30, "player has the chosen grade, role, pool and grade base price");
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

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
