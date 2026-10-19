// Mobile layout check: every page at phone width (360 px, the narrowest
// common Android screen) must fit the screen with no sideways scrolling.
// Visits each page as a visitor, an owner and the admin, and reports the
// elements that stick out. Same setup as smoke.mjs. Screenshots go to $SHOTS.
import { createServerClient } from "@supabase/ssr";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

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
  return [...jar].map(([name, value]) => ({ name, value, url: APP }));
}

const PAGES = {
  visitor: ["/", "/live", "/players", "/waitlist", "/teams", "/bids", "/register"],
  owner: ["/", "/live", "/players", "/wishlist", "/ai", "/teams"],
  admin: ["/admin", "/admin/players", "/admin/registrations", "/admin/settings", "/admin/owners", "/admin/results", "/admin/insights"],
};

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
for (const [who, paths] of Object.entries(PAGES)) {
  console.log(who);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (who !== "visitor") await ctx.addCookies(await sessionCookies(who === "admin" ? "admin@test.local" : "owner1@test.local"));
  const page = await ctx.newPage();
  for (const path of paths) {
    await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" });
    // Data arrives over realtime, so the page never goes idle: give it a moment.
    await page.waitForTimeout(2500);
    const wide = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 1) continue;
        // Inside a sideways-scrolling strip (tabs, tables) is fine.
        let p = el.parentElement;
        let scrolls = false;
        while (p && p !== document.body) {
          const s = getComputedStyle(p);
          if (/(auto|scroll|hidden)/.test(s.overflowX) && p.getBoundingClientRect().right <= vw + 1) scrolls = true;
          p = p.parentElement;
        }
        if (scrolls || getComputedStyle(el).position === "fixed") continue;
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
      }
      return { scroll: document.documentElement.scrollWidth, vw, out: out.slice(0, 6) };
    });
    check(wide.scroll <= wide.vw + 1, `${path} fits ${wide.vw}px${wide.scroll > wide.vw + 1 ? ` (page is ${wide.scroll}px: ${wide.out.join(" | ")})` : ""}`);
    await page.screenshot({ path: `${SHOTS}/mobile-${who}${path.replace(/\//g, "-") || "-home"}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
