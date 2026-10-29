// Headless landmark extraction for INCLUDE videos — the same browser extractor the webcam uses, with no
// manual clicking. Drives the /import page in the locally installed Chrome (playwright-core, no browser
// download). Resumable: the backend only lists videos without landmarks for the current extractor version.
//
// Prerequisites: frontend dev server (:3000) and backend (:8000) running, with ENABLE_DEV_TOOLS=true.
// Usage: node scripts/extract-landmarks.mjs [--base http://localhost:3000] [--api http://localhost:8000]
//                                           [--limit N] [--headed]
import { chromium } from "playwright-core";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3000");
const API = arg("api", "http://127.0.0.1:8000"); // Node resolves localhost to ::1; uvicorn listens on 127.0.0.1
const LIMIT = Number(arg("limit", "0")) || Infinity;
const HEADED = process.argv.includes("--headed");

async function preflight() {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error(`Frontend not reachable at ${BASE}. Start it with: npm run dev`);
  }
  const res = await fetch(`${API}/api/dataset/include/pending?extractor_version=x`).catch(() => null);
  if (!res) throw new Error(`Backend not reachable at ${API}.`);
  if (res.status === 404) throw new Error("Backend dev tools are off. Set ENABLE_DEV_TOOLS=true in backend/.env and restart it.");
}

async function main() {
  await preflight();
  const browser = await chromium.launch({
    channel: "chrome",
    headless: !HEADED,
    // Let MediaPipe use the GPU when possible (it falls back to CPU by itself otherwise).
    args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}/import`, { waitUntil: "domcontentloaded" });

  const button = page.getByRole("button", { name: /^Import \d+ videos$|^All videos imported$/ });
  await button.waitFor({ timeout: 120_000 });
  const label = (await button.textContent()) ?? "";
  if (label.startsWith("All")) {
    console.log("Nothing to extract: every video already has landmarks for the current extractor version.");
    await browser.close();
    return;
  }
  const total = Number(label.match(/\d+/)[0]);
  console.log(`extracting ${Math.min(total, LIMIT)} of ${total} pending videos (${HEADED ? "headed" : "headless"} Chrome)`);
  await button.click();

  const started = Date.now();
  let lastLog = 0;
  let processedAtStart = null;
  for (;;) {
    await page.waitForTimeout(2000);
    const text = await page.locator("main").innerText();
    const progress = text.match(/Progress\s+(\d+)\s*\/\s*(\d+)/);
    const done = progress ? Number(progress[1]) : 0;
    processedAtStart ??= done;
    const processed = done - processedAtStart;
    const failed = Number(text.match(/(\d+) failed/)?.[1] ?? 0);
    const running = await page.getByRole("button", { name: "Stop" }).isVisible();
    if (Date.now() - lastLog > 30_000 || !running) {
      const rate = processed / ((Date.now() - started) / 60000);
      console.log(`  ${processed} done, ${failed} failed, ${rate.toFixed(1)} videos/min`);
      lastLog = Date.now();
    }
    if (processed >= LIMIT && running) {
      await page.getByRole("button", { name: "Stop" }).click();
      await page.waitForTimeout(3000);
      console.log(`stopped after --limit ${LIMIT}`);
      break;
    }
    if (!running) break;
  }
  const failures = await page.locator("ul.text-red-700 li").allInnerTexts();
  if (failures.length) console.log("failures (rerun to retry):\n  " + failures.join("\n  "));
  await browser.close();
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 2;
});
