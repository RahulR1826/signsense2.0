// Practice page (/try) start-up and responsiveness, with a recorded INCLUDE clip as the camera
// (Chrome's fake capture device). SIMULATED camera — not a person at a webcam.
// Reports: time until a first recognition result, main-thread long tasks (start-up and steady state),
// and whether the page reacts to input during start-up (a click handler's delay).
// Usage: node scripts/try-perf.mjs [--think-ms N] [--json out.json]
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://localhost:3000";
const clip = path.join(here, "../../ml/data/cache/fakecam/Greetings__Hello__MVI_9956.y4m");
if (!existsSync(clip)) throw new Error("fake camera clip missing: run node scripts/live-call-e2e.mjs --make-clips");
const out = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${clip}`],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }))).observe({ type: "longtask", buffered: true });
    // Input responsiveness probe: every 250 ms, measure how late a 0 ms timer fires (main-thread blocking).
    window.__lag = [];
    const probe = () => {
      const t = performance.now();
      setTimeout(() => {
        window.__lag.push({ at: Math.round(t), ms: Math.round(performance.now() - t) });
        setTimeout(probe, 250);
      }, 0);
    };
    probe();
  });
  const page = await ctx.newPage();
  // Experiment flag: hide the on-page preview to see what drawing it costs.
  if (process.argv.includes("--hide-preview")) await ctx.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "main video{visibility:hidden}"; document.head.append(s); }));
  const t0 = Date.now();
  await page.goto(`${BASE}/try`);
  // Newer /try waits for the user to turn the camera on; older versions started it immediately.
  const start = page.getByRole("button", { name: "Turn on camera" });
  // --think-ms N: wait like a person reading the page before turning the camera on (the page warms the models
  // in the background meanwhile). Default 0 = click as soon as the button shows.
  const think = process.argv.includes("--think-ms") ? Number(process.argv[process.argv.indexOf("--think-ms") + 1]) : 0;
  let clickedAt = Date.now();
  if (await start.isVisible({ timeout: 15000 }).catch(() => false)) {
    if (think) await page.waitForTimeout(think);
    clickedAt = Date.now();
    await start.click();
  }
  // The page is "usable" for recognition when it shows its first result card/outcome.
  // (Waits for the result card itself: page text such as "Not sure what to sign?" must not count as a result.)
  await page.waitForFunction(() => !!document.querySelector("[data-result-id]"), null, { timeout: 180000, polling: 250 });
  const firstResultS = (Date.now() - t0) / 1000;
  const fromCameraOnS = (Date.now() - clickedAt) / 1000;
  const startup = await page.evaluate(() => ({ tasks: window.__longTasks, lag: window.__lag }));
  const from = await page.evaluate(() => performance.now());
  await page.waitForTimeout(10000);
  const steady = await page.evaluate((f) => ({ tasks: window.__longTasks.filter((t) => t.at >= f), lag: window.__lag.filter((l) => l.at >= f) }), from);
  const summary = {
    firstResultS,
    thinkMs: think,
    fromCameraOnS,
    startupLongTasks: startup.tasks.length,
    startupTasks: startup.tasks,
    startupLongestMs: Math.max(0, ...startup.tasks.map((t) => t.ms)),
    startupWorstTimerLagMs: Math.max(0, ...startup.lag.map((l) => l.ms)),
    steadyLongTasks: steady.tasks.length,
    steadyLongestMs: Math.max(0, ...steady.tasks.map((t) => t.ms)),
    steadyWorstTimerLagMs: Math.max(0, ...steady.lag.map((l) => l.ms)),
    stats: await page.evaluate(() => (window.__signRecognition ? { ...window.__signRecognition } : null)),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
