// "My signs" end to end, with a recorded clip as the camera (Chrome's fake capture device):
//   1. sign in, open /my-signs, name a sign, record takes from the camera, save it;
//   2. join a call with the same clip as the signer's camera: the main model rejects the word (it is not in
//      the vocabulary), the personal matcher offers "Is this your sign?", the signer taps it, and the
//      listener receives it marked "chosen by the signer";
//   3. delete the test sign.
// PLUMBING TEST: takes and call use the same recording, so it shows the pipeline works, not how well a real
// person's sign is matched (that is measured by ml/tools/personal_study.py).
// Needs the dev servers and the fake-camera clips (node scripts/live-call-e2e.mjs --make-clips).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://localhost:3000";
const API = process.env.API ?? "http://127.0.0.1:8000";
const clip = path.join(here, "../../ml/data/cache/fakecam/Adjectives__alive__MVI_9827.y4m");
if (!existsSync(clip)) throw new Error("fake camera clip missing: run node scripts/live-call-e2e.mjs --make-clips");
const user = JSON.parse(readFileSync(path.join(here, "../../backend/seed/dev_users.json"), "utf8")).users[0];
const LABEL = `Alive test ${Date.now() % 100000}`;

const GPU = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
const signerBrowser = await chromium.launch({ channel: "chrome", headless: true, args: [...GPU, `--use-file-for-fake-video-capture=${clip}`] });
const listenerBrowser = await chromium.launch({ channel: "chrome", headless: true, args: GPU });
let failed = false;
const step = (s) => console.log(`- ${s}`);

async function login(ctx) {
  const res = await ctx.request.post(`${API}/api/auth/login`, { data: { email: user.email, password: user.password } });
  if (!res.ok()) throw new Error(`login failed (${res.status()})`);
  const cookies = await ctx.cookies(API);
  await ctx.addCookies(cookies.map(({ name, value, path: p, httpOnly, secure, sameSite, expires }) => ({ name, value, path: p, httpOnly, secure, sameSite, expires, domain: "localhost" })));
}

let signId = null;
const sctx = await signerBrowser.newContext({ viewport: { width: 1280, height: 860 } });
try {
  await login(sctx);
  const page = await sctx.newPage();

  // 1. Record and save.
  await page.goto(`${BASE}/my-signs`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Add a sign" }).click();
  await page.getByLabel("What does your sign mean?").fill(LABEL);
  await page.getByRole("button", { name: "🌱" }).count(); // (no-op; emoji list is fixed)
  await page.getByRole("button", { name: "❤️" }).click();
  await page.getByRole("button", { name: /Next: record it/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Take "][aria-label$=" recorded"]').length >= 3, null, { timeout: 180000, polling: 500 });
  step("3 takes recorded from the camera");
  const status = await page.getByRole("status").filter({ hasText: /consistent|different|built-in|close to/ }).first().innerText().catch(() => "(no check shown)");
  step(`enrolment check: ${status.replace(/\s+/g, " ").trim()}`);
  const saveResponse = page.waitForResponse((r) => r.url().endsWith("/api/personal-signs") && r.request().method() === "POST", { timeout: 30000 });
  await page.getByRole("button", { name: /^Save/ }).click();
  const res = await saveResponse;
  if (!res.ok()) throw new Error(`save failed: HTTP ${res.status()} ${(await res.text()).slice(0, 300)}`);
  await page.getByText(`“${LABEL}” saved`).waitFor({ timeout: 20000 });
  const list = await (await sctx.request.get(`${API}/api/personal-signs`)).json();
  const saved = list.find((s) => s.label === LABEL);
  if (!saved || saved.samples.length < 3) throw new Error("sign not stored with its takes");
  signId = saved.id;
  step(`saved via the API: ${saved.samples.length} takes, ${saved.samples[0].frames.length} frames in take 1, no video`);

  // 2. Call: personal suggestion -> tap -> delivered as "chosen".
  const { code } = await (await sctx.request.post(`${API}/api/meetings`)).json();
  const sp = await sctx.newPage();
  await sp.goto(`${BASE}/m/${code}`);
  await sp.getByRole("radio", { name: "Sign" }).click();
  await sp.getByRole("button", { name: "Join call" }).click({ timeout: 60000 });
  const lctx = await listenerBrowser.newContext({ viewport: { width: 1280, height: 800 } });
  const lp = await lctx.newPage();
  await lp.goto(`${BASE}/m/${code}?fake=1`);
  await lp.getByLabel("Your name").fill("Listener");
  await lp.getByRole("radio", { name: "Speak / type" }).click();
  await lp.getByRole("button", { name: "Join call" }).click();
  await sp.getByText("Listener").first().waitFor({ timeout: 30000 });
  step("call connected");
  const card = sp.locator('[role="dialog"][aria-label="Recognised sign"]').filter({ hasText: "Is this your sign?" });
  await card.waitFor({ timeout: 180000 });
  step(`personal suggestion shown: "${(await card.innerText()).replace(/\s+/g, " ").slice(0, 80)}"`);
  await sp.waitForTimeout(2500);
  const early = await lp.locator('li[data-entry-kind="sign"][data-entry-from="them"]').count();
  if (early) throw new Error("a personal sign reached the listener without a tap");
  await card.getByRole("button", { name: new RegExp(LABEL) }).click();
  await lp.locator('li[data-entry-kind="sign"][data-entry-from="them"][data-entry-via="chosen"]').filter({ hasText: LABEL }).first().waitFor({ timeout: 15000 });
  step("listener received it, marked as chosen by the signer (nothing sent before the tap)");
  await sctx.request.post(`${API}/api/meetings/${code}/end`);
  console.log("\nMY SIGNS E2E: PASS");
} catch (err) {
  failed = true;
  console.log(`\nMY SIGNS E2E: FAIL — ${String(err?.message ?? err).split("\n")[0]}`);
} finally {
  if (signId) await sctx.request.delete(`${API}/api/personal-signs/${signId}`).catch(() => {});
  await signerBrowser.close();
  await listenerBrowser.close();
  process.exitCode = failed ? 1 : 0;
}
