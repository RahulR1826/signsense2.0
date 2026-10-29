// Can the real recogniser read Saathi? For each dictionary sign:
//   1. draw every frame of Saathi's motion (dev page /dev/saathi-render) at the framing of the source video;
//   2. encode it like the other fake-camera clips (640x360, 15 fps, with a short rest before and after);
//   3. play it as the camera of the Practice page (/try) and record what the recogniser decides;
//   4. do the same with the source INCLUDE clip's segment (--baseline), to separate "the drawing loses
//      information" from "this recording is hard for the model".
// SIMULATED camera, and the source clips are mostly training clips (the dictionary never shows test clips), so
// the baseline is optimistic. The question measured is how much is lost by drawing the motion as Saathi.
// --frames3d DIR: use rendered frames (DIR/<id>/f0000.png ..., e.g. the 3D Saathi from ml/blender/saathi3d.py --mode
//   camera) instead of drawing the 2D Saathi.
// Needs the dev servers. Usage: node scripts/saathi-check.mjs [--only id,id] [--baseline] [--frames3d DIR] [--json out.json]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const ML = path.join(here, "../../ml");
const OUT_DIR = path.join(ML, "data/cache/saathi");
const BASE = process.env.BASE ?? "http://localhost:3000";
const args = process.argv.slice(2);
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
const only = opt("only") ? new Set(opt("only").split(",")) : null;
const baseline = args.includes("--baseline");
const jsonOut = opt("json");
const REST_S = 0.8; // still frames before and after, so the segmenter sees hands down
const RESULTS_WANTED = 2; // the fake camera loops; record the first passes
const TIMEOUT_MS = 60000;

const library = JSON.parse(readFileSync(path.join(here, "../public/sign-library/library.json"), "utf8"));
const signs = library.signs.filter((s) => !only || only.has(s.id));
const ffmpeg = execFileSync(path.join(ML, ".venv/Scripts/python"), ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();
mkdirSync(OUT_DIR, { recursive: true });

async function renderSaathi(browser, sign) {
  const anim = JSON.parse(readFileSync(path.join(here, "../public", "sign-library", sign.anim), "utf8"));
  if (opt("frames3d")) {
    // Pre-rendered frames: hold the first and last frame for the rest padding, as below.
    const src = path.join(opt("frames3d"), sign.id);
    const out = path.join(OUT_DIR, `${sign.id}.saathi3d.y4m`);
    execFileSync(ffmpeg, ["-loglevel", "error", "-y", "-framerate", String(anim.fps), "-i", path.join(src, "f%04d.png"),
      "-vf", `tpad=start_mode=clone:start_duration=${REST_S}:stop_mode=clone:stop_duration=${REST_S},scale=640:360,fps=15`, "-pix_fmt", "yuv420p", out]);
    return { file: out, anim };
  }
  const dir = path.join(OUT_DIR, `${sign.id}-frames`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  const page = await browser.newPage({ viewport: { width: 700, height: 420 } });
  await page.goto(`${BASE}/dev/saathi-render`);
  await page.waitForFunction(() => typeof window.__saathiShow === "function");
  const pad = Math.round(REST_S * anim.fps);
  const order = [...Array(pad).fill(0), ...anim.frames.map((_, i) => i), ...Array(pad).fill(anim.frames.length - 1)];
  for (let k = 0; k < order.length; k++) {
    await page.evaluate(([id, i]) => window.__saathiShow(id, i), [sign.id, order[k]]);
    await page.locator("#stage").screenshot({ path: path.join(dir, `f${String(k).padStart(4, "0")}.png`) });
  }
  await page.close();
  const out = path.join(OUT_DIR, `${sign.id}.saathi.y4m`);
  execFileSync(ffmpeg, ["-loglevel", "error", "-y", "-framerate", String(anim.fps), "-i", path.join(dir, "f%04d.png"), "-vf", "scale=640:360,fps=15", "-pix_fmt", "yuv420p", out]);
  rmSync(dir, { recursive: true, force: true });
  return { file: out, anim };
}

function sourceClip(sign, anim) {
  // The same INCLUDE segment Saathi's motion came from, with the same rest padding.
  const out = path.join(OUT_DIR, `${sign.id}.source.y4m`);
  const [first, last] = anim.source.frames;
  const video = path.join(ML, "data/include/videos", sign.id, path.basename(anim.source.file));
  const start = first / anim.fps;
  const dur = (last - first + 1) / anim.fps;
  const pad = REST_S;
  execFileSync(ffmpeg, ["-loglevel", "error", "-y", "-ss", String(start), "-t", String(dur), "-i", video,
    "-vf", `scale=640:360,fps=15,tpad=start_mode=clone:start_duration=${pad}:stop_mode=clone:stop_duration=${pad}`, "-pix_fmt", "yuv420p", out]);
  return out;
}

async function recognise(clip) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${clip}`],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${BASE}/try`);
    await page.getByRole("button", { name: "Turn on camera" }).click({ timeout: 30000 });
    const seen = [];
    const t0 = Date.now();
    while (seen.length < RESULTS_WANTED && Date.now() - t0 < TIMEOUT_MS) {
      const r = await page.evaluate(() => {
        const el = document.querySelector("[data-result-id]");
        return el ? { id: el.dataset.resultId, decision: el.dataset.resultDecision, top: el.dataset.resultTop, prob: Number(el.dataset.resultProb) } : null;
      });
      if (r && !seen.some((s) => s.id === r.id)) seen.push(r);
      await page.waitForTimeout(250);
    }
    const st = await page.evaluate(() => window.__signRecognition);
    return { results: seen.map(({ id, ...r }) => r), segments: st?.segments ?? 0, phases: st?.phasesSeen ?? [] }; // eslint-disable-line @typescript-eslint/no-unused-vars
  } finally {
    await browser.close();
  }
}

const outcome = (sign, r) => (!r ? "no result" : r.decision === "accept" ? (r.top === sign.id ? "correct" : "WRONG") : r.decision === "suggest" ? (r.top === sign.id ? "suggested (right first)" : "suggested (other first)") : "rejected");

const renderer = await chromium.launch({ channel: "chrome", headless: true });
const rows = [];
try {
  for (const sign of signs) {
    const { file, anim } = await renderSaathi(renderer, sign);
    const s = await recognise(file);
    const row = { id: sign.id, saathi: s.results, saathiSegments: s.segments, saathiPhases: s.phases };
    if (baseline) row.source = (await recognise(sourceClip(sign, anim))).results;
    rows.push(row);
    const fmt = (rs) => (rs.length ? rs.map((r) => `${outcome(sign, r)} [${r.top} ${r.prob}]`).join(", ") : "no result");
    if (!s.results.length) console.log(`  (saathi: ${s.segments} segments, phases ${s.phases.join(">")})`);
    console.log(`${sign.id.padEnd(14)} saathi: ${fmt(row.saathi)}${baseline ? `\n${"".padEnd(14)} source: ${fmt(row.source)}` : ""}`);
  }
} finally {
  await renderer.close();
}

// Pass 1 can overlap start-up (models loading, first frames); pass 2 is the steady state, as in a real call.
function summary(key, pass) {
  const first = rows.map((r) => ({ sign: { id: r.id }, r: r[key]?.[pass] }));
  const count = (name) => first.filter(({ sign, r }) => outcome(sign, r) === name).length;
  return {
    n: first.length,
    correct: count("correct"),
    suggestedRightFirst: count("suggested (right first)"),
    suggestedOtherFirst: count("suggested (other first)"),
    rejected: count("rejected"),
    wrong: count("WRONG"),
    noResult: count("no result"),
    top1: first.filter(({ sign, r }) => r && r.decision !== "reject" && r.top === sign.id).length,
  };
}
const both = (key) => ({ pass1: summary(key, 0), pass2: summary(key, 1) });
const report = { note: "simulated camera (fake capture device); see header", saathi: both("saathi"), ...(baseline ? { source: both("source") } : {}), rows };
console.log("\nSAATHI pass 1:", JSON.stringify(report.saathi.pass1), "\nSAATHI pass 2:", JSON.stringify(report.saathi.pass2));
if (baseline) console.log("SOURCE pass 1:", JSON.stringify(report.source.pass1), "\nSOURCE pass 2:", JSON.stringify(report.source.pass2));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n");
