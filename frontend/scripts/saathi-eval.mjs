// Offline check: can the sign model read Saathi? Deterministic and faster than real time (no camera).
// For each dictionary sign, in the dev page /dev/saathi-render:
//   saathi: draw every frame of the motion at the source video's framing -> the app's MediaPipe extractor ->
//           features -> the published model and decision policy (whole motion = one sign, as in training);
//   source: the source clip's stored landmarks (same extractor, same segment) -> the same model.
// Also reports how often MediaPipe finds Saathi's hands, and how far from the true wrist.
// The source clips are mostly training clips, so "source" is an upper bound, not a test score.
// --frames3d DIR: score rendered frames instead of the 2D drawing (DIR/<id>/f0000.png ..., e.g. the 3D Saathi rendered
//   by ml/blender/saathi3d.py --mode camera).
// --rig: score the rigged live 3D Saathi (sign-library/saathi-rig/saathi.glb), rendered with three.js.
// Needs the frontend dev server. Usage: node scripts/saathi-eval.mjs [--only id,id] [--frames3d DIR | --rig] [--json out.json]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const ML = path.join(here, "../../ml");
const BASE = process.env.BASE ?? "http://localhost:3000";
const args = process.argv.slice(2);
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
const only = opt("only") ? new Set(opt("only").split(",")) : null;

const library = JSON.parse(readFileSync(path.join(here, "../public/sign-library/library.json"), "utf8"));
const signs = library.signs.filter((s) => !only || only.has(s.id));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const rows = [];
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 420 } });
  await page.goto(`${BASE}/dev/saathi-render`);
  await page.waitForFunction(() => typeof window.__saathiEval === "function");
  if (opt("hand-style")) await page.evaluate((hs) => (window.__saathiHandStyle = hs), JSON.parse(opt("hand-style")));
  for (const sign of signs) {
    const anim = JSON.parse(readFileSync(path.join(here, "../public/sign-library", sign.anim), "utf8"));
    const rec = JSON.parse(readFileSync(path.join(ML, "data/include/landmarks", sign.id, `${path.basename(anim.source.file).replace(/\.[^.]+$/, "")}.json`), "utf8"));
    const [first, last] = anim.source.frames;
    const cam = anim.camera;
    const source = await page.evaluate(([f, a]) => window.__landmarksEval(f, a), [rec.frames.slice(first, last + 1), cam.w / cam.h]);
    let saathi;
    if (args.includes("--rig")) {
      saathi = await page.evaluate((id) => window.__rigEval(id), sign.id);
    } else if (opt("frames3d")) {
      const dir = path.join(opt("frames3d"), sign.id);
      if (!existsSync(dir)) continue;
      const urls = readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).sort()
        .map((f) => `data:image/png;base64,${readFileSync(path.join(dir, f)).toString("base64")}`);
      saathi = await page.evaluate(([id, u]) => window.__imagesEval(id, u), [sign.id, urls]);
    } else {
      saathi = await page.evaluate((id) => window.__saathiEval(id), sign.id);
    }
    rows.push({ id: sign.id, saathi, source });
    const fmt = (r) => `${r.decision.padEnd(7)} ${r.top === sign.id ? "right" : "OTHER"} ${r.top}:${r.prob.toFixed(2)}`;
    console.log(`${sign.id.padEnd(13)} saathi ${fmt(saathi).padEnd(36)} hands ${saathi.handsFound}/${saathi.handFrames} err ${saathi.wristError}   source ${fmt(source)}`);
  }
} finally {
  await browser.close();
}

function summary(key) {
  const rs = rows.map((r) => ({ id: r.id, ...r[key] }));
  return {
    n: rs.length,
    acceptedRight: rs.filter((r) => r.decision === "accept" && r.top === r.id).length,
    suggestedRightFirst: rs.filter((r) => r.decision === "suggest" && r.top === r.id).length,
    wrongAccepted: rs.filter((r) => r.decision === "accept" && r.top !== r.id).length,
    rejected: rs.filter((r) => r.decision === "reject").length,
    top1: rs.filter((r) => r.top === r.id).length,
  };
}
const hands = rows.reduce((a, r) => [a[0] + r.saathi.handsFound, a[1] + r.saathi.handFrames], [0, 0]);
const report = { saathi: summary("saathi"), source: summary("source"), saathiHandsFound: `${hands[0]}/${hands[1]}`, rows };
console.log("\nSAATHI:", JSON.stringify(report.saathi), "hands found", report.saathiHandsFound);
console.log("SOURCE:", JSON.stringify(report.source));
if (opt("json")) writeFileSync(opt("json"), JSON.stringify(report, null, 2) + "\n");
