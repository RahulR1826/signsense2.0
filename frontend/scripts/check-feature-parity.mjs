// Checks lib/signs/features.ts against feature outputs produced by the Python training code.
// Generate fixtures first: (from ml/) .venv/Scripts/python tools/make_feature_fixtures.py
// Run: npm run check:features   (Node strips the TypeScript types itself; no bundler needed)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { sequenceFeatures, windowVariants, FEATURE_DIM, FEATURE_VERSION, WINDOW } = await import("../lib/signs/features.ts");
const fixtures = JSON.parse(readFileSync(path.join(here, "../../ml/data/fixtures/feature_parity.json"), "utf8"));

if (fixtures.featureVersion !== FEATURE_VERSION || fixtures.featureDim !== FEATURE_DIM || fixtures.window !== WINDOW) {
  console.error("Feature config differs between Python and TypeScript", fixtures.featureVersion, FEATURE_VERSION);
  process.exit(1);
}

const TOL = 1e-4;
let failed = 0;
for (const c of fixtures.cases) {
  const maxDiff = (got, want) => {
    let w = 0;
    let i = -1;
    for (let k = 0; k < want.length; k++) {
      const d = Math.abs(got[k] - want[k]);
      if (d > w) [w, i] = [d, k];
    }
    return [got.length === want.length ? w : Infinity, i];
  };
  const [worstCentred, at] = maxDiff(sequenceFeatures(c.frames, c.aspect), c.expected);
  const [worstVariants] = c.expectedVariants ? maxDiff(windowVariants(c.frames, c.aspect), c.expectedVariants) : [0];
  const worst = Math.max(worstCentred, worstVariants);
  const ok = worst <= TOL;
  if (!ok) failed++;
  const where = at >= 0 ? ` (frame ${Math.floor(at / FEATURE_DIM)}, feature ${at % FEATURE_DIM})` : "";
  console.log(`${ok ? "ok  " : "FAIL"} ${c.name}: max diff ${worst.toExponential(2)}${ok ? "" : where}`);
}
console.log(failed ? `${failed} case(s) differ` : `all ${fixtures.cases.length} cases match`);
process.exit(failed ? 1 : 0);
