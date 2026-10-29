// First-time-user journeys through the real app (headless Chrome, real backend and database):
// landing navigation + smooth scrolling + reduced motion, mobile menu, sign-up validation, onboarding,
// dashboard, starting a meeting, settings, account deletion, login errors, the dictionary, and a
// dead-link check. The test account it creates (e2e-<time>@example.test) deletes itself at the end.
// Needs the dev servers. Usage: node scripts/journeys.mjs
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const results = [];
let failed = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name} — ${String(err?.message ?? err).split("\n")[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
// example.com: reserved for examples, accepted by the backend's email validator (".test" is refused).
const email = `e2e-${Date.now()}@example.com`;
const password = "journey-password-1";

try {
  await check("landing: nav, smooth anchor scroll, reveal", async () => {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === "smooth"), "smooth scrolling not enabled");
    assert(await page.evaluate(() => document.documentElement.classList.contains("reveal-ready")), "reveal not armed");
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "How it works" }).click();
    await page.waitForFunction(() => location.hash === "#how" && Math.abs(document.getElementById("how").getBoundingClientRect().top) < 140, null, { timeout: 5000 });
    // Scrolling through reveals everything (and nothing is left hidden).
    for (let y = 0; y < 9000; y += 600) {
      await page.evaluate((yy) => scrollTo(0, yy), y);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(900);
    const hidden = await page.evaluate(() => [...document.querySelectorAll("[data-reveal]")].filter((e) => getComputedStyle(e).opacity !== "1").length);
    assert(hidden === 0, `${hidden} sections still hidden after scrolling`);
    await page.getByRole("link", { name: /Start a free call/ }).first().click();
    await page.waitForURL("**/signup");
    return "anchor scrolled under the sticky header; all sections revealed; CTA -> /signup";
  });

  await check("reduced motion: content visible without animation", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    const armed = await page.evaluate(() => document.documentElement.classList.contains("reveal-ready"));
    const invisible = await page.evaluate(() => [...document.querySelectorAll("[data-reveal]")].filter((e) => getComputedStyle(e).opacity !== "1").length);
    const smooth = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
    assert(!armed && invisible === 0, `reveal armed=${armed}, ${invisible} hidden`);
    assert(smooth !== "smooth", "smooth scrolling still on");
    await ctx.close();
    return "no reveal hiding, no smooth scroll";
  });

  await check("mobile menu: open, Escape, focus return, navigate", async () => {
    const page = await (await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true })).newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    const btn = page.getByRole("button", { name: "Open menu" });
    await btn.click();
    assert((await page.getByRole("button", { name: "Close menu" }).getAttribute("aria-expanded")) === "true", "not expanded");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    assert(await page.evaluate(() => document.activeElement?.getAttribute("aria-controls") === "mobile-nav"), "focus did not return to the menu button");
    assert(await page.evaluate(() => document.getElementById("mobile-nav").inert), "closed menu is still focusable");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.locator("#mobile-nav").getByRole("link", { name: "Sign dictionary" }).click();
    await page.waitForURL("**/signs");
    await page.waitForTimeout(400);
    assert(await page.evaluate(() => document.getElementById("mobile-nav").inert), "menu stayed open after navigating");
    return "Escape closes and refocuses the button; tapping a link navigates and closes";
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();

  await check("sign-up: validation messages, then account created", async () => {
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Create account" }).click();
    const alerts = await page.locator("[aria-invalid=true]").count();
    assert(alerts === 3, `expected 3 invalid fields, got ${alerts}`);
    assert(await page.evaluate(() => document.activeElement?.id === "name"), "focus did not move to the first invalid field");
    await page.getByLabel("Your name").fill("Journey Tester");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText(/doesn't look like an email/).waitFor();
    await page.getByText("Use at least 8 characters.").waitFor();
    await page.getByRole("button", { name: "Show password" }).click();
    assert((await page.getByLabel("Password", { exact: true }).getAttribute("type")) === "text", "password not revealed");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/onboarding", { timeout: 20000 });
    return "3 field errors + focus on first; email/length messages; show-password works; -> /onboarding";
  });

  await check("onboarding -> dashboard getting-started", async () => {
    await page.getByRole("radio", { name: /I use sign language/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(BASE + "/");
    await page.getByRole("heading", { name: "Getting started" }).waitFor();
    const done = await page.getByText("Done", { exact: true }).count();
    assert(done === 1, `expected 1 done step (preferences), got ${done}`);
    return "guide shows preferences done, first call not done";
  });

  await check("dashboard: new meeting opens the pre-join screen", async () => {
    await page.getByRole("button", { name: /New meeting/ }).click();
    await page.waitForURL(/\/m\/SS-/, { timeout: 20000 });
    await page.getByRole("heading", { name: "Ready to join?" }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: /Copy invite link/ }).waitFor();
    return page.url().split("/m/")[1];
  });

  await check("settings: rename with confirmation toast", async () => {
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await page.getByLabel("Name shown in calls").fill("Journey Renamed");
    await page.getByRole("button", { name: "Save name" }).click();
    await page.getByText("Name saved").waitFor();
    return "toast shown";
  });

  await check("delete account: wrong password refused, right one deletes", async () => {
    await page.getByRole("button", { name: /Delete my account/ }).click();
    await page.getByLabel("Type your password to confirm").fill("wrong-password");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByText("That password is not correct").waitFor();
    await page.getByLabel("Type your password to confirm").fill(password);
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.waitForURL(BASE + "/", { timeout: 15000 });
    await page.getByText("Your account was deleted").waitFor();
    return "test account removed";
  });

  await check("login: wrong password shows a recoverable error", async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Wrong email or password").waitFor();
    assert((await page.getByLabel("Email").inputValue()) === email, "email was cleared after the error");
    return "message shown, input kept (the deleted account can no longer sign in)";
  });

  await check("dictionary: deep link filter, playback, missing words", async () => {
    await page.goto(`${BASE}/signs?q=Hello`, { waitUntil: "networkidle" });
    await page.getByText(/1 of \d+ signs/).waitFor();
    await page.getByLabel("Search signs").fill("");
    await page.locator("#sentence").fill("hello doctor zebra");
    await page.getByRole("button", { name: "Show signs" }).click();
    await page.getByText("No sign yet for:").waitFor();
    // Saathi plays the sign (3D video by default, 2D drawing otherwise): it must actually be moving.
    const saathi = page.locator('[data-saathi][aria-label^="Saathi signing"]').first();
    await saathi.waitFor();
    const kind = await saathi.getAttribute("data-saathi");
    const at = () => (kind === "3d" ? saathi.evaluate((v) => v.currentTime) : saathi.getAttribute("data-saathi-frame"));
    const f1 = await at();
    await page.waitForTimeout(500);
    const f2 = await at();
    assert(f1 !== f2, `Saathi (${kind}) is not playing (${f1} -> ${f2})`);
    const videos = await page.$$eval("video", (vs) => vs.map((v) => v.currentSrc || v.src));
    assert(videos.every((src) => src.includes("/sign-library/saathi3d/")), `unexpected video on the page: ${videos.join(", ")}`);
    return `filtered to 1, Saathi (${kind}) signs it, 'zebra' reported missing`;
  });

  await check("Saathi: 3D/2D choice carries across pages; practice page shows a word to watch", async () => {
    await page.goto(`${BASE}/signs`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Show Saathi in 2D" }).first().click();
    await page.goto(`${BASE}/try`, { waitUntil: "networkidle" });
    const picker = page.getByRole("region", { name: /Watch Saathi first/ });
    await picker.getByRole("button", { name: "Thank you" }).click();
    const tile = picker.locator("[data-saathi]").first();
    assert((await tile.getAttribute("data-saathi")) === "2d", "the 2D choice was not used on /try");
    const f1 = await tile.getAttribute("data-saathi-frame");
    await page.waitForTimeout(500);
    assert(f1 !== (await tile.getAttribute("data-saathi-frame")), "Saathi is not playing the chosen word");
    await page.evaluate(() => localStorage.removeItem("saathi-style"));
    return "2D chosen on /signs is used on /try; the picked word plays";
  });

  await check("no real signers' videos or photos on the website", async () => {
    const media = [];
    const onRequest = (r) => /sign-library\/(videos|posters)\//.test(r.url()) && media.push(r.url());
    page.on("request", onRequest);
    for (const path of ["/", "/signs", "/about"]) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(500);
    }
    page.off("request", onRequest);
    assert(!media.length, `real-person media requested: ${media.slice(0, 3).join(", ")}`);
    const direct = await page.request.get(`${BASE}/sign-library/videos/hello.mp4`);
    assert(direct.status() === 404, `dictionary video still served (HTTP ${direct.status()})`);
    return "no dictionary video/poster requested on /, /signs, /about; old video URL returns 404";
  });

  await check("no dead internal links", async () => {
    const hrefs = new Set();
    for (const path of ["/", "/about", "/signs", "/login", "/signup", "/try"]) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      for (const h of await page.$$eval("a[href^='/']", (as) => as.map((a) => a.getAttribute("href")))) hrefs.add(h);
    }
    const bad = [];
    for (const h of hrefs) {
      const [pathOnly, hash] = h.split("#");
      const res = await page.request.get(BASE + (pathOnly || "/"));
      if (!res.ok()) bad.push(`${h} -> ${res.status()}`);
      else if (hash) {
        await page.goto(BASE + (pathOnly || "/"), { waitUntil: "networkidle" });
        if (!(await page.locator(`[id="${hash}"]`).count())) bad.push(`${h} -> no #${hash}`);
      }
    }
    assert(!bad.length, bad.join(", "));
    return `${hrefs.size} links checked`;
  });
} finally {
  await browser.close();
  console.log(`\n${results.length}/${results.length + failed} journeys passed`);
  process.exitCode = failed ? 1 : 0;
}
