// Copies the browser ML runtimes into public/ and downloads the MediaPipe landmark models:
//   public/mediapipe/wasm, public/mediapipe/models  - landmark extraction
//   public/ort                                      - ONNX Runtime Web (sign classifier), WASM build
//   public/sign-library                             - Saathi motion files + 3D videos for text -> sign (from ../sign-library)
// Served locally so the app works offline and every recording uses the exact same models.
// Run: npm run setup:runtime
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDst = path.join(root, "public/mediapipe/wasm");
const modelDir = path.join(root, "public/mediapipe/models");

// Pinned model versions: changing any of these changes the landmarks, so it requires re-recording data.
const MODELS = {
  "hand_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  "pose_landmarker_lite.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  "face_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
};

async function exists(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

await mkdir(modelDir, { recursive: true });
await cp(wasmSrc, wasmDst, { recursive: true });
console.log("copied wasm runtime ->", path.relative(root, wasmDst));

const ortSrc = path.join(root, "node_modules/onnxruntime-web/dist");
const ortDst = path.join(root, "public/ort");
await mkdir(ortDst, { recursive: true });
for (const file of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  await cp(path.join(ortSrc, file), path.join(ortDst, file));
}
console.log("copied onnxruntime-web ->", path.relative(root, ortDst));

const libSrc = path.join(root, "../sign-library");
const libDst = path.join(root, "public/sign-library");
// Only Saathi's motion files are served. The INCLUDE videos and posters show real people, who did not consent
// to appearing on this website, so they stay out of public/ (and stale copies are removed).
await rm(path.join(libDst, "videos"), { recursive: true, force: true });
await rm(path.join(libDst, "posters"), { recursive: true, force: true });
await cp(path.join(libSrc, "anim"), path.join(libDst, "anim"), { recursive: true });
if (existsSync(path.join(libSrc, "saathi3d"))) await cp(path.join(libSrc, "saathi3d"), path.join(libDst, "saathi3d"), { recursive: true });
// The rigged 3D Saathi (ml/blender/saathi_rig.py): one GLB with an animation clip per sign, rendered live.
if (existsSync(path.join(libSrc, "saathi-rig"))) await cp(path.join(libSrc, "saathi-rig"), path.join(libDst, "saathi-rig"), { recursive: true });
const library = JSON.parse(await readFile(path.join(libSrc, "library.json"), "utf8"));
library.signs = library.signs.filter((s) => s.anim).map(({ video, poster, ...s }) => s); // eslint-disable-line @typescript-eslint/no-unused-vars
await writeFile(path.join(libDst, "library.json"), JSON.stringify(library, null, 2) + "\n");
console.log("copied sign library (Saathi motion only) ->", path.relative(root, libDst));

for (const [name, url] of Object.entries(MODELS)) {
  const dst = path.join(modelDir, name);
  if (await exists(dst)) {
    console.log("have", name);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await writeFile(dst, Buffer.from(await res.arrayBuffer()));
  console.log("downloaded", name);
}
