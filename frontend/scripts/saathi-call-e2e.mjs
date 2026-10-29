// Live 3D Saathi in real two-person calls (headless Chrome, recorded INCLUDE test clip as the signer's camera):
//   - a received sign is performed by the 3D Saathi on the other side, which does NOT run recognition;
//   - typed text is played sign by sign; a word without a sign stays text; replay and 0.5x speed work;
//   - each message is performed once (no duplicates);
//   - WebGL unavailable / model missing -> fallback player, the call and messages keep working;
//   - leaving the call releases the 3D renderer;
//   - layout: Saathi has its own space on phone and desktop and never covers the controls.
// These check the integration. They do NOT show that a clip is a correct ISL sign (see saathi-eval.mjs --rig).
// Needs the dev servers. Usage: node scripts/saathi-call-e2e.mjs [--only name,name]
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://localhost:3000";
const API = process.env.API ?? "http://127.0.0.1:8000";
const CLIP = path.join(here, "../../ml/data/cache/fakecam/Greetings__Hello__MVI_9956.y4m"); // INCLUDE test split
const user = JSON.parse(readFileSync(path.join(here, "../../backend/seed/dev_users.json"), "utf8")).users[0];
const only = process.argv.includes("--only") ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(",")) : null;
const GPU = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

let failed = 0;
async function check(name, fn) {
  if (only && !only.has(name)) return;
  try {
    console.log(`PASS ${name} — ${await fn()}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name} — ${String(err?.message ?? err).split("\n")[0]}`);
  }
}
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

let cookies = null;
async function meeting(ctx) {
  if (!cookies) {
    const res = await ctx.request.post(`${API}/api/auth/login`, { data: { email: user.email, password: user.password } });
    assert(res.ok(), `login failed (${res.status()})`);
    // The session cookie for both hosts: 127.0.0.1 (API calls from Node) and localhost (the pages).
    const raw = await ctx.cookies(API);
    cookies = [...raw, ...raw.map(({ name, value, path: p, httpOnly, secure, sameSite, expires }) => ({ name, value, path: p, httpOnly, secure, sameSite, expires, domain: "localhost" }))];
  }
  await ctx.addCookies(cookies);
  return (await (await ctx.request.post(`${API}/api/meetings`)).json()).code;
}

/** Signer (recorded clip as camera, "Sign") + listener ("Speak / type"). Options per side. */
async function startCall({ listenerArgs = [], listenerViewport = { width: 1280, height: 800 }, listenerRoutes, signerViewport = { width: 1280, height: 800 } } = {}) {
  const sb = await chromium.launch({ channel: "chrome", headless: true, args: [...GPU, `--use-file-for-fake-video-capture=${CLIP}`] });
  const lb = await chromium.launch({ channel: "chrome", headless: true, args: [...GPU, ...listenerArgs] });
  const sctx = await sb.newContext({ viewport: signerViewport });
  const code = await meeting(sctx);
  const sp = await sctx.newPage();
  const lctx = await lb.newContext({ viewport: listenerViewport });
  if (listenerRoutes) await listenerRoutes(lctx);
  const lp = await lctx.newPage();
  try {
    await sp.goto(`${BASE}/m/${code}`);
    await sp.getByRole("radio", { name: "Sign" }).click();
    await sp.getByRole("button", { name: "Join call" }).click({ timeout: 60000 });
    await lp.goto(`${BASE}/m/${code}?fake=1`);
    await lp.getByLabel("Your name").fill("Listener");
    await lp.getByRole("radio", { name: "Speak / type" }).click();
    await lp.getByRole("button", { name: "Join call" }).click();
    await sp.getByText("Listener").first().waitFor({ timeout: 30000 });
  } catch (err) {
    if (process.env.DEBUG_SHOTS) {
      await sp.screenshot({ path: "debug-signer.png" }).catch(() => {});
      await lp.screenshot({ path: "debug-listener.png" }).catch(() => {});
    }
    await sb.close();
    await lb.close();
    throw new Error(`call set-up failed (meeting ${code}): ${String(err.message).split(String.fromCharCode(10))[0]}`);
  }
  const close = async () => {
    await sctx.request.post(`${API}/api/meetings/${code}/end`).catch(() => {});
    await sb.close();
    await lb.close();
  };
  return { sp, lp, close };
}

const stage = (page) => page.locator("[data-saathi-stage]").first();
const live = (page) => page.evaluate(() => (window.__saathiLive ? { ...window.__saathiLive } : null));
const waitStage = (page, states, timeout = 150000) =>
  page.waitForFunction((s) => s.includes(document.querySelector("[data-saathi-stage]")?.dataset.saathiStage), states, { timeout, polling: 200 });

async function typeChat(page, text) {
  const box = page.getByPlaceholder(/^Message /); // reads "Waiting for the other person…" until the channel opens
  if (!(await page.getByRole("tab", { name: "Chat" }).isVisible().catch(() => false))) await page.getByRole("button", { name: /^Chat/ }).click();
  await box.waitFor({ timeout: 60000 });
  await box.fill(text);
  await box.press("Enter");
}

try {
  await check("sign-received-performed-by-3d-saathi", async () => {
    const call = await startCall();
    try {
      const { lp } = call;
      await waitStage(lp, ["playing", "done"]);
      await lp.waitForFunction(() => window.__saathiLive?.clipsStarted.includes("hello"), null, { timeout: 30000 });
      const signs = await lp.locator('li[data-entry-kind="sign"][data-entry-from="them"]').count();
      const st = await live(lp);
      const rec = await lp.evaluate(() => window.__signRecognition?.loopsStarted ?? 0);
      assert(rec === 0, `the listener ran recognition (${rec} loops)`);
      const starts = st.clipsStarted.filter((c) => c === "hello").length;
      assert(starts <= signs, `Saathi performed ${starts} times for ${signs} received signs (duplicates)`);
      const heading = await stage(lp).locator("p").first().innerText();
      return `listener received ${signs} sign(s); live 3D clip "hello" started ${starts}x; no recognition on the listener; heading "${heading.replace(/\s+/g, " ")}"`;
    } finally {
      await call.close();
    }
  });

  await check("typed-text-sequence-replay-speed", async () => {
    const call = await startCall();
    try {
      const { sp, lp } = call;
      await typeChat(lp, "thank you doctor zebra");
      await sp.waitForFunction(() => window.__saathiLive?.clipsStarted.includes("doctor"), null, { timeout: 60000 });
      const chips = await stage(sp).locator('ol[aria-label="Words"] li').allInnerTexts();
      assert(JSON.stringify(chips) === JSON.stringify(["Thank you", "Doctor", "zebra"]), `word chips ${JSON.stringify(chips)}`);
      const struck = await stage(sp).locator('ol[aria-label="Words"] li').nth(2).evaluate((el) => getComputedStyle(el).textDecorationLine);
      assert(struck.includes("line-through"), "the unsupported word is not marked");
      await sp.getByText("No sign in the dictionary yet").waitFor({ timeout: 20000 });
      await waitStage(sp, ["done"]);
      const order = (await live(sp)).clipsStarted.filter((c) => c === "thank_you" || c === "doctor");
      assert(order.join(",").startsWith("thank_you,doctor"), `clip order ${order}`);
      const timeRun = async () => {
        const t0 = Date.now();
        await stage(sp).getByRole("button", { name: "Replay" }).first().click();
        await waitStage(sp, ["playing"], 5000);
        await waitStage(sp, ["done"], 60000);
        return (Date.now() - t0) / 1000;
      };
      const normal = await timeRun();
      await stage(sp).getByRole("button", { name: "0.5×" }).click();
      assert((await stage(sp).getAttribute("data-saathi-speed")) === "0.5", "speed not applied");
      const slow = await timeRun();
      // Ideal ratio 2; wall-clock timing in headless Chrome under load has some slack (frames, polling).
      assert(slow > normal * 1.3, `0.5× took ${slow.toFixed(1)} s vs ${normal.toFixed(1)} s at 1×`);
      return `chips Thank you / Doctor / zebra (struck, "No sign" card); clips in order; replay ${normal.toFixed(1)} s at 1×, ${slow.toFixed(1)} s at 0.5×`;
    } finally {
      await call.close();
    }
  });

  await check("webgl-unavailable-fallback", async () => {
    const call = await startCall({ listenerArgs: ["--disable-webgl", "--disable-3d-apis"] });
    try {
      const { sp, lp } = call;
      await lp.waitForFunction(() => document.querySelector("[data-saathi-stage]")?.dataset.saathiReason === "webgl", null, { timeout: 150000 });
      const fallbackPlayer = await stage(lp).locator("[data-saathi]").count();
      assert(fallbackPlayer > 0, "no fallback Saathi player");
      await typeChat(sp, "still here");
      await lp.getByText("still here").first().waitFor({ timeout: 15000 });
      return "stage fell back to the recorded Saathi (reason webgl); chat still delivered";
    } finally {
      await call.close();
    }
  });

  await check("model-missing-fallback", async () => {
    const call = await startCall({ listenerRoutes: (ctx) => ctx.route("**/saathi-rig/saathi.glb", (r) => r.fulfill({ status: 404, body: "" })) });
    try {
      const { sp, lp } = call;
      await lp.waitForFunction(() => document.querySelector("[data-saathi-stage]")?.dataset.saathiReason === "load", null, { timeout: 150000 });
      await typeChat(sp, "still connected");
      await lp.getByText("still connected").first().waitFor({ timeout: 15000 });
      const err = (await live(lp))?.loadErrors ?? 0;
      return `model 404 -> fallback (reason load, ${err} load error counted); call and chat continue`;
    } finally {
      await call.close();
    }
  });

  await check("cleanup-on-leave", async () => {
    const call = await startCall();
    try {
      const { lp } = call;
      await lp.waitForFunction(() => (window.__saathiLive?.canvases ?? 0) > 0, null, { timeout: 150000 });
      await lp.getByRole("button", { name: "Leave" }).click();
      await lp.waitForFunction(() => window.__saathiLive.disposed >= window.__saathiLive.canvases, null, { timeout: 15000 });
      const st = await live(lp);
      return `${st.canvases} 3D canvas created, ${st.disposed} disposed after leaving`;
    } finally {
      await call.close();
    }
  });

  for (const [label, viewport] of [["mobile", { width: 375, height: 812 }], ["desktop", { width: 1440, height: 900 }]]) {
    await check(`layout-${label}`, async () => {
      const call = await startCall({ listenerViewport: viewport });
      try {
        const { lp } = call;
        await waitStage(lp, ["playing", "done"]);
        await lp.waitForTimeout(500);
        const r = await lp.evaluate(() => {
          const box = (el) => el?.getBoundingClientRect();
          return {
            stage: box(document.querySelector("[data-saathi-stage]")),
            video: box(document.querySelector('section[aria-label="Video"]')),
            footer: box(document.querySelector('footer[aria-label="Call controls"]')),
            vh: innerHeight,
            overflow: document.documentElement.scrollWidth - innerWidth,
          };
        });
        // The signer's camera here is a real INCLUDE recording: keep these out of the docs (temporary folder only).
        await lp.screenshot({ path: path.join(os.tmpdir(), `saathi-call-${label}.png`) });
        assert(r.overflow <= 1, `${r.overflow}px horizontal overflow`);
        assert(r.stage.height >= 240, `Saathi only ${Math.round(r.stage.height)}px tall`);
        assert(r.stage.bottom <= r.footer.top + 1, "Saathi overlaps the call controls");
        assert(r.footer.bottom <= r.vh + 1, "controls pushed off screen");
        const overlapsVideo = r.stage.left < r.video.right - 1 && r.stage.top < r.video.bottom - 1 && r.stage.right > r.video.left + 1 && r.stage.bottom > r.video.top + 1;
        assert(!overlapsVideo, "Saathi covers the video");
        assert(r.video.height >= 160, `video squeezed to ${Math.round(r.video.height)}px`);
        return `Saathi ${Math.round(r.stage.width)}×${Math.round(r.stage.height)} px, video ${Math.round(r.video.height)} px tall, controls visible, no overlap`;
      } finally {
        await call.close();
      }
    });
  }
} finally {
  console.log(failed ? `\n${failed} check(s) failed` : "\nall Saathi call checks passed");
  process.exitCode = failed ? 1 : 0;
}
