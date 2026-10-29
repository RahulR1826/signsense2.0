// Screenshots of every main page at phone, tablet and desktop sizes (headless system Chrome).
// Needs the dev servers running (frontend :3000, backend :8000) and the dev seed users
// (backend/seed/dev_users.json). Also asserts there is no horizontal overflow on any page.
// Usage: node scripts/ui-screenshots.mjs [outDir]
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "../../docs/screenshots"));
const BASE = process.env.BASE ?? "http://localhost:3000";
const API = process.env.API ?? "http://127.0.0.1:8000";

/** Node resolves "localhost" to ::1 but uvicorn listens on 127.0.0.1, so API calls from Node use the IPv4
 *  address; the session cookie is then copied to "localhost", where the pages (and their API calls) run. */
async function apiLogin(ctx, email, password) {
  const res = await ctx.request.post(`${API}/api/auth/login`, { data: { email, password } });
  if (res.ok()) {
    const cookies = await ctx.cookies(API);
    await ctx.addCookies(cookies.map(({ name, value, path, httpOnly, secure, sameSite, expires }) => ({ name, value, path, httpOnly, secure, sameSite, expires, domain: "localhost" })));
  }
  return res;
}
const SIZES = { narrow: [320, 640], mobile: [375, 812], tablet: [768, 1024], desktop: [1440, 900] };

const users = JSON.parse(readFileSync(path.join(here, "../../backend/seed/dev_users.json"), "utf8")).users;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const problems = [];

async function shoot(page, name, size) {
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`${name}@${size}: ${overflow}px horizontal overflow`);
  // Content cut off by a clipping parent does not show up as page overflow: check visible text and controls too
  // (anything inside a deliberately scrollable row is fine).
  const clipped = await page.evaluate(() => {
    const scrolls = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
      return false;
    };
    return [...document.querySelectorAll("main h1, main h2, main p, main a, main button, main label")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && (r.right > innerWidth + 1 || r.left < -1) && !scrolls(el);
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}"`);
  });
  if (clipped.length) problems.push(`${name}@${size}: cut off at the screen edge: ${clipped.join(", ")}`);
  await page.screenshot({ path: path.join(out, `${name}-${size}.png`) });
}

async function signedInContext(user, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ["camera", "microphone"] });
  const res = await apiLogin(ctx, user.email, user.password);
  if (!res.ok()) throw new Error(`login failed (${res.status()}) — is the backend running and the seed applied?`);
  return ctx;
}

try {
  for (const [size, [w, h]] of Object.entries(SIZES)) {
    const anon = await browser.newContext({ viewport: { width: w, height: h } });
    const p = await anon.newPage();
    for (const [name, url] of [["landing", "/"], ["login", "/login"], ["signup", "/signup"], ["signs", "/signs"], ["about", "/about"], ["try", "/try"]]) {
      await p.goto(BASE + url, { waitUntil: "networkidle" });
      await shoot(p, name, size);
    }
    await anon.close();

    const host = await signedInContext(users[0], w, h);
    const hp = await host.newPage();
    for (const [name, url] of [["dashboard", "/"], ["settings", "/settings"], ["onboarding", "/onboarding"], ["my-signs", "/my-signs"]]) {
      await hp.goto(BASE + url, { waitUntil: "networkidle" });
      await shoot(hp, name, size);
    }
    const meeting = await (await host.request.post(`${API}/api/meetings`)).json();
    await hp.goto(`${BASE}/m/${meeting.code}?fake=1`, { waitUntil: "networkidle" });
    await shoot(hp, "prejoin", size);
    await hp.getByRole("button", { name: "Join call" }).click();
    await shoot(hp, "call-waiting", size);

    // Second person joins as a guest so the call connects.
    const guest = await browser.newContext({ viewport: { width: w, height: h } });
    const gp = await guest.newPage();
    await gp.goto(`${BASE}/m/${meeting.code}?fake=1`, { waitUntil: "networkidle" });
    await gp.getByLabel("Your name").fill("Guest Tester");
    await gp.getByRole("radio", { name: "Speak / type" }).click();
    await gp.getByRole("button", { name: "Join call" }).click();
    await hp.getByText("Guest Tester").first().waitFor({ timeout: 20000 });
    await shoot(hp, "call-connected", size);

    await hp.getByRole("button", { name: /^Chat/ }).click();
    if (!(await hp.getByRole("tab", { name: "Chat" }).isVisible())) await hp.getByRole("button", { name: /^Chat/ }).click();
    await gp.getByRole("button", { name: /^Chat/ }).click();
    if (!(await gp.getByRole("tab", { name: "Chat" }).isVisible())) await gp.getByRole("button", { name: /^Chat/ }).click();
    await gp.getByPlaceholder(/Message/).fill("Hello, how are you?");
    await gp.getByRole("button", { name: "Send message" }).click();
    await hp.getByText("Hello, how are you?").first().waitFor({ timeout: 10000 });
    await shoot(hp, "call-chat", size);

    await hp.getByRole("tab", { name: "Pictures" }).click();
    await shoot(hp, "call-pictures", size);

    await guest.close();
    await host.request.post(`${API}/api/meetings/${meeting.code}/end`);
    await host.close();
    console.log(`${size}: ok`);
  }
} finally {
  await browser.close();
}

if (problems.length) {
  console.error("Layout problems:\n" + problems.join("\n"));
  process.exit(1);
}
console.log(`screenshots in ${out}`);
