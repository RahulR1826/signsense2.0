// Live sign recognition in a real call, end to end, without a person signing.
//
// SIMULATED CAMERA: Chrome's fake capture device plays a recorded INCLUDE test clip
// (--use-file-for-fake-video-capture), so the app's real getUserMedia path, MediaPipe, segmenter, ONNX
// model, decision policy, data channel and the receiver's UI all run for real. It is still a recording
// of an INCLUDE signer, NOT a person at a physical webcam; passing this does not validate real-world use.
//
// Needs: dev servers (frontend :3000, backend :8000 with ENABLE_DEV_TOOLS not required) and the
// fake-camera clips: (from ml/) see docs/DEVELOPMENT_LOG.md "fake camera clips", or run
//   node scripts/live-call-e2e.mjs --make-clips
// Usage: node scripts/live-call-e2e.mjs [--only name,name] [--json out.json]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const ML = path.join(here, "../../ml");
const CLIPS_DIR = path.join(ML, "data/cache/fakecam");
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
const args = process.argv.slice(2);
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

// INCLUDE *test-split* clips (never trained on). "alive" and "curved" are words outside the vocabulary.
const CLIPS = {
  hello: "hello/Greetings__Hello__MVI_9956",
  alive: "oov-adj-alive/Adjectives__alive__MVI_9827",
  curved: "oov-adj-curved/Adjectives__curved__MVI_9633",
};
// Saathi signing "Hello" (rendered by scripts/saathi-check.mjs; the 3D one when present): used where the screen is
// saved for the docs, so no real signer appears in screenshots. Recognition checks keep using the INCLUDE test clips.
const SAATHI_HELLO = ["hello.saathi3d.y4m", "hello.saathi.y4m"].map((f) => path.join(ML, "data/cache/saathi", f)).find((f) => existsSync(f)) ?? "";
const clipFile = (name) => (name === "saathi-hello" ? SAATHI_HELLO : path.join(CLIPS_DIR, `${path.basename(CLIPS[name])}.y4m`));

function makeClips() {
  const ffmpeg = execFileSync(path.join(ML, ".venv/Scripts/python"), ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();
  mkdirSync(CLIPS_DIR, { recursive: true });
  for (const name of Object.keys(CLIPS)) {
    const src = path.join(ML, "data/include/videos", `${CLIPS[name]}.MOV`);
    execFileSync(ffmpeg, ["-loglevel", "error", "-y", "-i", src, "-vf", "scale=640:360,fps=15", "-pix_fmt", "yuv420p", clipFile(name)]);
  }
}
if (args.includes("--make-clips") || Object.keys(CLIPS).some((n) => !existsSync(clipFile(n)))) makeClips();

const user = JSON.parse(readFileSync(path.join(here, "../../backend/seed/dev_users.json"), "utf8")).users[0];
const results = [];
const perf = {};
let failed = 0;

async function check(name, fn) {
  if (only && !only.has(name)) return;
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, s: Math.round((Date.now() - t0) / 1000) });
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failed++;
    results.push({ name, ok: false, detail: String(err?.message ?? err).split("\n")[0], s: Math.round((Date.now() - t0) / 1000) });
    console.log(`FAIL ${name} — ${String(err?.message ?? err).split("\n")[0]}`);
  }
}

const GPU_ARGS = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required"];
const camBrowser = (clip) =>
  chromium.launch({
    channel: "chrome",
    headless: true,
    args: [...GPU_ARGS, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(clip ? [`--use-file-for-fake-video-capture=${clipFile(clip)}`] : [])],
  });

// Recorded in every signer page: camera tracks handed out, every recognition card shown, long tasks.
const INSTRUMENT = () => {
  window.__gumTracks = [];
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    const s = await gum(c);
    window.__gumTracks.push(...s.getTracks());
    return s;
  };
  window.__wsOpened = 0;
  const NativeWS = window.WebSocket;
  window.WebSocket = class extends NativeWS {
    constructor(...a) {
      super(...a);
      if (String(a[0]).includes("/ws/meetings/")) window.__wsOpened++;
    }
  };
  window.__cards = [];
  const seen = new WeakSet();
  setInterval(() => {
    const el = document.querySelector('[role="dialog"][aria-label="Recognised sign"]');
    if (el && !seen.has(el)) {
      seen.add(el);
      window.__cards.push({ decision: el.dataset.decision, text: el.innerText.replace(/\s+/g, " ").trim(), at: Date.now() });
    }
  }, 100);
  window.__phases = new Set();
  setInterval(() => {
    const bar = document.querySelector("[data-recognition]");
    if (bar) window.__phases.add(`${bar.dataset.recognition}${bar.dataset.phase ? ":" + bar.dataset.phase : ""}`);
  }, 100);
  window.__longTasks = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }))).observe({ type: "longtask", buffered: true });
  } catch {}
};

// Log in once and reuse the session cookie (the backend rate-limits logins: 10 per 5 min).
let sessionCookies = null;
async function newMeeting(ctx) {
  if (sessionCookies) {
    await ctx.addCookies(sessionCookies);
  } else {
    const login = await apiLogin(ctx, user.email, user.password);
    if (!login.ok()) throw new Error(`login failed (${login.status()})`);
    sessionCookies = await ctx.cookies();
  }
  return (await (await ctx.request.post(`${API}/api/meetings`)).json()).code;
}

/** Signer (host, recorded clip as camera) + listener (guest, test pattern) in one meeting. */
async function startCall(clip, { viewport = { width: 1280, height: 800 }, signerRoutes } = {}) {
  const sb = await camBrowser(clip);
  const lb = await camBrowser(null);
  const sctx = await sb.newContext({ viewport });
  await sctx.addInitScript(INSTRUMENT);
  if (signerRoutes) await signerRoutes(sctx);
  const code = await newMeeting(sctx);
  const sp = await sctx.newPage();
  await sp.goto(`${BASE}/m/${code}`);
  await sp.getByRole("radio", { name: "Sign" }).click();
  await sp.getByRole("button", { name: "Join call" }).click({ timeout: 60000 });

  const lctx = await lb.newContext({ viewport: { width: 1280, height: 800 } });
  // Experiment switch: BLOCK_SAATHI_RIG=1 makes the listener fall back from the live 3D Saathi (performance A/B).
  if (process.env.BLOCK_SAATHI_RIG) await lctx.route("**/saathi-rig/**", (r) => r.abort());
  // BLOCK_SIGN_LIBRARY=1: the listener shows no Saathi at all (as before the live 3D Saathi existed).
  if (process.env.BLOCK_SIGN_LIBRARY) await lctx.route("**/sign-library/**", (r) => r.abort());
  const lp = await lctx.newPage();
  await lp.goto(`${BASE}/m/${code}?fake=1`);
  await lp.getByLabel("Your name").fill("Listener");
  await lp.getByRole("radio", { name: "Speak / type" }).click();
  await lp.getByRole("button", { name: "Join call" }).click();
  await sp.getByText("Listener").first().waitFor({ timeout: 30000 });
  const close = async () => {
    await sctx.request.post(`${API}/api/meetings/${code}/end`).catch(() => {});
    await sb.close();
    await lb.close();
  };
  return { sp, lp, sctx, code, close };
}

const recStats = (page) => page.evaluate(() => ({ ...window.__signRecognition }));
const signEntries = (page, from) =>
  page.evaluate((f) => [...document.querySelectorAll(`li[data-entry-kind="sign"][data-entry-from="${f}"]`)].map((li) => ({ id: li.dataset.entryId, via: li.dataset.entryVia, text: li.innerText })), from);

async function waitFor(page, fn, arg, timeout = 90000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 200 });
}

try {
  // 1. Camera initialisation through the real getUserMedia path, and permission errors.
  await check("camera-init-and-errors", async () => {
    const b = await camBrowser("hello");
    try {
      const ctx = await b.newContext();
      await ctx.addInitScript(INSTRUMENT);
      const code = await newMeeting(ctx);
      const p = await ctx.newPage();
      await p.goto(`${BASE}/m/${code}`);
      await waitFor(p, () => window.__gumTracks?.some((t) => t.kind === "video" && t.readyState === "live"), null, 30000);
      await p.getByRole("button", { name: "Join call" }).waitFor({ timeout: 30000 });
      const denied = await b.newContext();
      await denied.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
      });
      const dp = await denied.newPage();
      await dp.goto(`${BASE}/m/${code}`);
      await dp.getByText(/Camera and microphone are blocked/i).first().waitFor({ timeout: 30000 });
      await dp.getByText(/join without camera/i).first().waitFor();
      const missing = await b.newContext();
      await missing.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("none", "NotFoundError"));
      });
      const mp = await missing.newPage();
      await mp.goto(`${BASE}/m/${code}`);
      await mp.getByText(/No camera or microphone found/i).first().waitFor({ timeout: 30000 });
      await ctx.request.post(`${API}/api/meetings/${code}/end`);
      return "live camera track from the fake device; denied + missing camera show their messages and still allow joining";
    } finally {
      await b.close();
    }
  });

  // 2-3, 7-9. Known sign -> landmarks -> buffering -> model -> accept -> delivered exactly once.
  await check("known-sign-delivered-once", async () => {
    const call = await startCall("hello");
    try {
      const { sp, lp } = call;
      await waitFor(sp, () => window.__signRecognition?.loopsRunning === 1);
      // Let the looping clip produce at least two automatic sends.
      await waitFor(sp, () => document.querySelectorAll('li[data-entry-kind="sign"][data-entry-from="me"]').length >= 2, null, 120000);
      await lp.waitForTimeout(1500);
      const sent = await signEntries(sp, "me");
      const got = await signEntries(lp, "them");
      const phases = await sp.evaluate(() => window.__signRecognition.phasesSeen);
      const cards = await sp.evaluate(() => window.__cards);
      const s = await recStats(sp);
      Object.assign(perf, {
        known: s,
        longTasks: await sp.evaluate(() => window.__longTasks),
        steady: await sp.evaluate(async () => {
          // Steady state: 10 s of normal recognition, well after start-up.
          const from = performance.now();
          const heap0 = performance.memory?.usedJSHeapSize;
          const f0 = window.__signRecognition.framesProcessed;
          await new Promise((r) => setTimeout(r, 10000));
          const tasks = window.__longTasks.filter((t) => t.at >= from);
          return {
            fps: (window.__signRecognition.framesProcessed - f0) / 10,
            longTasks: tasks.length,
            longTaskMax: tasks.length ? Math.max(...tasks.map((t) => t.ms)) : 0,
            heapMB0: heap0 ? Math.round(heap0 / 1e6) : null,
            heapMB1: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
          };
        }),
      });
      if (!phases.includes("signing")) throw new Error(`never saw a sign being collected: ${phases}`);
      if (!phases.some((p) => p === "hands-down" || p === "no-hands" || p === "no-person")) throw new Error(`never saw a not-signing state: ${phases}`);
      if (got.length !== sent.length) throw new Error(`sent ${sent.length} signs but the listener has ${got.length}`);
      if (new Set(got.map((g) => g.id)).size !== got.length) throw new Error("duplicate message ids on the listener side");
      if (!got.every((g) => /Hello/.test(g.text))) throw new Error(`listener got ${got.map((g) => g.text)}`);
      if (s.loopsRunning !== 1) throw new Error(`${s.loopsRunning} recognition loops running`);
      const accepts = cards.filter((c) => c.decision === "accept").length;
      return `${sent.length} sent = ${got.length} received (unique ids); cards: ${cards.map((c) => c.decision).join(",")} (${accepts} accept); phases: ${phases.join(",")}`;
    } finally {
      await call.close();
    }
  });

  // 4-5. Out-of-vocabulary clips: nothing may reach the listener unless the model accepts or the signer picks.
  for (const clip of ["alive", "curved"]) {
    await check(`unknown-sign-${clip}`, async () => {
      const call = await startCall(clip);
      try {
        const { sp, lp } = call;
        await waitFor(sp, () => window.__cards?.length >= 3, null, 120000);
        // Leave suggestion cards alone (no one taps them) and let the countdown run on any accept.
        await sp.waitForTimeout(3000);
        const cards = await sp.evaluate(() => window.__cards);
        const got = await signEntries(lp, "them");
        const accepts = cards.filter((c) => c.decision === "accept").length;
        if (got.length > accepts) throw new Error(`${got.length} signs reached the listener but only ${accepts} were auto-accepted`);
        if (got.some((g) => g.via === "chosen")) throw new Error("a 'chosen' sign was sent without a tap");
        return `cards: ${cards.map((c) => c.decision).join(",")}; delivered to listener: ${got.length} (${accepts} model false accepts)`;
      } finally {
        await call.close();
      }
    });
  }

  // 4b. An unsure result is only sent when the signer picks it, and is labelled as chosen.
  await check("uncertain-needs-confirmation", async () => {
    const call = await startCall("curved");
    try {
      const { sp, lp } = call;
      const card = sp.locator('[role="dialog"][data-decision="suggest"]');
      await card.waitFor({ timeout: 120000 });
      const before = (await signEntries(lp, "them")).length;
      await sp.waitForTimeout(2500); // longer than the auto-send countdown: still nothing sent
      if ((await signEntries(lp, "them")).length !== before) throw new Error("an unsure result was sent without a tap");
      const choice = card.locator("button").nth(1); // first choice (button 0 is dismiss)
      const word = (await choice.innerText()).trim();
      await choice.click();
      await waitFor(lp, (w) => [...document.querySelectorAll('li[data-entry-kind="sign"][data-entry-from="them"]')].some((li) => li.dataset.entryVia === "chosen" && li.innerText.includes(w)), word, 15000);
      return `not sent for 2.5 s without a tap; after choosing “${word}” the listener sees it marked as chosen`;
    } finally {
      await call.close();
    }
  });

  // 6. Turning recognition off stops the loop; on again starts exactly one new loop.
  await check("enable-disable", async () => {
    const call = await startCall("hello");
    try {
      const { sp } = call;
      await waitFor(sp, () => window.__signRecognition?.loopsRunning === 1);
      const signs = sp.getByRole("button", { name: "Signs" });
      await signs.click();
      await sp.waitForTimeout(800);
      const off = await recStats(sp);
      await sp.waitForTimeout(1500);
      const offLater = await recStats(sp);
      if (off.loopsRunning !== 0) throw new Error(`loop still running after Signs off (${off.loopsRunning})`);
      if (offLater.framesProcessed !== off.framesProcessed) throw new Error("frames still processed while off");
      if (await sp.locator("[data-recognition]").count()) throw new Error("recognition bar still shown while off");
      await signs.click();
      await waitFor(sp, () => window.__signRecognition.loopsRunning === 1, null, 60000);
      const on = await recStats(sp);
      await sp.waitForTimeout(1500);
      const onLater = await recStats(sp);
      if (onLater.framesProcessed <= on.framesProcessed) throw new Error("not processing frames after turning back on");
      return `off: 0 loops, frames frozen; on: 1 loop, ${((onLater.framesProcessed - on.framesProcessed) / 1.5).toFixed(1)} frames/s; loops started in total ${onLater.loopsStarted}`;
    } finally {
      await call.close();
    }
  });

  // 10. Model fails to load: the call keeps working, the signer is told, Retry recovers.
  await check("model-load-failure", async () => {
    let block = true;
    const call = await startCall("hello", {
      signerRoutes: (ctx) => ctx.route("**/models/signs/model.onnx", (r) => (block ? r.fulfill({ status: 404, body: "" }) : r.continue())),
    });
    try {
      const { sp, lp } = call;
      await waitFor(sp, () => document.querySelector("[data-recognition]")?.dataset.recognition === "error", null, 60000);
      // The call itself is unaffected: chat still goes through.
      await lp.getByPlaceholder(/Message/).fill("still connected");
      await lp.getByRole("button", { name: "Send message" }).click();
      await sp.getByText("still connected").first().waitFor({ timeout: 10000 });
      block = false;
      await sp.getByRole("button", { name: "Retry" }).click();
      await waitFor(sp, () => document.querySelector("[data-recognition]")?.dataset.recognition === "ready", null, 60000);
      return "error shown, call and chat kept working, Retry loaded the model";
    } finally {
      await call.close();
    }
  });

  // 10b. A corrupt model file fails cleanly too (inference session cannot be created).
  await check("corrupt-model", async () => {
    const call = await startCall("hello", {
      signerRoutes: (ctx) => ctx.route("**/models/signs/model.onnx", (r) => r.fulfill({ status: 200, body: Buffer.from("not an onnx model") })),
    });
    try {
      await waitFor(call.sp, () => document.querySelector("[data-recognition]")?.dataset.recognition === "error", null, 60000);
      const msg = await call.sp.locator("[data-recognition]").innerText();
      return `error state: “${msg.replace(/\s+/g, " ").slice(0, 80)}”`;
    } finally {
      await call.close();
    }
  });

  // 11. Leaving stops the camera tracks and the recognition loop.
  await check("cleanup-on-leave", async () => {
    const call = await startCall("hello");
    try {
      const { sp } = call;
      await waitFor(sp, () => window.__signRecognition?.loopsRunning === 1);
      await sp.getByRole("button", { name: "Leave call" }).click();
      await sp.getByText("You left the call").waitFor({ timeout: 15000 });
      await sp.waitForTimeout(500);
      const r = await sp.evaluate(() => ({ tracks: window.__gumTracks.map((t) => t.readyState), loops: window.__signRecognition.loopsRunning, frames: window.__signRecognition.framesProcessed }));
      await sp.waitForTimeout(1500);
      const frames2 = await sp.evaluate(() => window.__signRecognition.framesProcessed);
      if (r.tracks.some((s) => s !== "ended")) throw new Error(`camera/mic tracks not stopped: ${r.tracks}`);
      if (r.loops !== 0 || frames2 !== r.frames) throw new Error("recognition still running after leaving");
      return `${r.tracks.length} tracks ended, 0 loops, no frames processed after leaving`;
    } finally {
      await call.close();
    }
  });

  // 12. Temporary connection loss: recognition pauses (nothing recognised that can't be delivered), then resumes.
  await check("connection-interruption", async () => {
    const call = await startCall("hello");
    try {
      const { sp, lp } = call;
      await waitFor(sp, () => window.__signRecognition?.loopsRunning === 1);
      const before = await recStats(sp);
      const startedBefore = before.loopsStarted;
      const sentBefore = (await signEntries(sp, "me")).length;
      const t = new Date();
      utimesSync(path.join(here, "../../backend/app/main.py"), t, t); // uvicorn --reload restarts the backend
      // (a) Signaling outage: the page must open a new signaling socket by itself.
      await waitFor(sp, () => window.__wsOpened >= 2, null, 60000);
      await waitFor(sp, (n) => document.querySelectorAll('li[data-entry-kind="sign"][data-entry-from="me"]').length > n, sentBefore, 120000);
      await lp.waitForTimeout(1500);
      const s = await recStats(sp);
      const sent = (await signEntries(sp, "me")).length;
      const got = (await signEntries(lp, "them")).length;
      if (s.loopsStarted !== startedBefore) throw new Error(`models were reloaded on reconnect (${startedBefore} -> ${s.loopsStarted} loops)`);
      if (got !== sent) throw new Error(`after reconnect: sent ${sent}, listener has ${got}`);
      const paused = s.pauses - before.pauses;

      // (b) Data-channel outage: the listener drops out (page reload) and rejoins.
      await lp.reload();
      await waitFor(sp, (n) => window.__signRecognition.pauses > n, s.pauses, 30000);
      await lp.getByRole("button", { name: "Join call" }).click({ timeout: 60000 });
      const sentAtRejoin = (await signEntries(sp, "me")).length;
      await waitFor(sp, (n) => document.querySelectorAll('li[data-entry-kind="sign"][data-entry-from="me"]').length > n, sentAtRejoin, 120000);
      await lp.waitForTimeout(1500);
      const s2 = await recStats(sp);
      const sent2 = (await signEntries(sp, "me")).length - sentAtRejoin;
      const got2 = (await signEntries(lp, "them")).length;
      if (s2.loopsStarted !== startedBefore) throw new Error("models were reloaded when the other person rejoined");
      if (got2 !== sent2) throw new Error(`after the rejoin: sent ${sent2}, listener has ${got2}`);
      return `signaling restart: new socket, data channel ${paused ? "dropped (paused)" : "stayed up"}, ${sent} sent = ${got} received; listener drop-out: recognition paused, resumed on rejoin without reloading models, ${sent2} sent = ${got2} received`;
    } finally {
      await call.close();
    }
  });

  // 13. Layout: the recognition card never covers either video, at phone and desktop sizes.
  for (const [label, viewport] of [["mobile", { width: 375, height: 812 }], ["desktop", { width: 1440, height: 900 }]]) {
    await check(`layout-${label}`, async () => {
      const call = await startCall(SAATHI_HELLO ? "saathi-hello" : "hello", { viewport });
      try {
        const { sp } = call;
        await sp.locator('[role="dialog"][aria-label="Recognised sign"]').waitFor({ timeout: 120000 });
        const r = await sp.evaluate(() => {
          const box = (el) => el.getBoundingClientRect();
          const card = box(document.querySelector('[role="dialog"][aria-label="Recognised sign"]'));
          const stage = box(document.querySelector('section[aria-label="Video"]'));
          const footer = box(document.querySelector('footer[aria-label="Call controls"]'));
          return { card, stage, footer, overflow: document.documentElement.scrollWidth - innerWidth, vh: innerHeight };
        });
        await sp.screenshot({ path: path.join(here, `../../docs/screenshots/live-recognition-${label}.png`) });
        if (r.overflow > 1) throw new Error(`${r.overflow}px horizontal overflow`);
        if (r.card.top < r.stage.bottom - 1) throw new Error(`card (top ${r.card.top}) overlaps the video (bottom ${r.stage.bottom})`);
        if (r.card.bottom > r.footer.top + 1) throw new Error("card overlaps the controls");
        if (r.footer.bottom > r.vh + 1) throw new Error("controls pushed off screen");
        if (r.stage.height < 200) throw new Error(`video squeezed to ${r.stage.height}px`);
        return `card below video, video ${Math.round(r.stage.height)}px tall, controls visible`;
      } finally {
        await call.close();
      }
    });
  }
} finally {
  console.log("\nPerformance (simulated camera, headless Chrome on this machine):");
  if (perf.known) {
    const k = perf.known;
    const lt = perf.longTasks ?? [];
    const st = perf.steady ?? {};
    console.log(`  model load ${k.modelLoadMs} ms · MediaPipe ready ${k.extractorInitMs} ms after start (${k.delegate}; of which first-frame GPU warm-up ${k.warmupMs} ms, in the worker) · frames skipped ${k.framesSkipped} · decision ${k.decideMs} ms · segments ${k.segments} · frame errors ${k.frameErrors}`);
    console.log(`  MediaPipe ${k.detectMs} ms/frame (pose ${k.detectSplitMs?.pose}, hands ${k.detectSplitMs?.hand}, face ${k.detectSplitMs?.face}) · ${st.fps} frames/s processed`);
    console.log(`  long tasks (>50 ms), whole page incl. start-up: ${lt.length}${lt.length ? `, max ${Math.max(...lt.map((t) => t.ms))} ms` : ""}`);
    console.log(`  steady state (10 s): ${st.longTasks} long tasks, max ${st.longTaskMax} ms · JS heap ${st.heapMB0} -> ${st.heapMB1} MB`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ results, perf }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
