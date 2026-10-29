import type * as Ort from "onnxruntime-web/wasm";

import { EXTRACTOR_VERSION } from "../landmarks/schema";
import { LEGACY_POLICY, combine, decide, rankKnown, softmax, type Decision, type DecisionPolicy } from "./decision";
import { meanEmbedding } from "./embedding";
import { FEATURE_DIM, FEATURE_VERSION, WINDOW } from "./features";

/** ONNX Runtime is browser-only (it breaks server rendering), so it's imported on first use. */
async function loadOrt(): Promise<typeof Ort> {
  const ort = await import("onnxruntime-web/wasm");
  // Served from public/ort (npm run setup:runtime) so nothing loads from a CDN.
  ort.env.wasm.wasmPaths = "/ort/";
  // Multi-threading needs cross-origin isolation; the model is tiny, one thread is plenty.
  ort.env.wasm.numThreads = 1;
  return ort;
}

const MODEL_BASE = "/models/signs";

export interface SignModelConfig {
  featureVersion: string;
  extractorVersion: string;
  featureDim: number;
  window: number;
  classes: string[];
  /** Display label per class id (from ml/vocabulary.json at publish time). */
  labels?: Record<string, string>;
  /** Calibration + thresholds chosen on validation data (absent for older models -> LEGACY_POLICY). */
  policy?: DecisionPolicy;
  /** Size of the `embedding` output (pooled representation), when the model has one ("My signs"). */
  embeddingDim?: number;
  /** Cosine-similarity threshold for matching personal signs, chosen in ml/tools/personal_study.py. */
  personal?: { method: string; threshold: number; evidence?: string };
  runId?: string;
}

export interface Prediction {
  label: string;
  prob: number;
}

/** The trained sign model (ml/runs/... published to public/models/signs). */
export class SignClassifier {
  private constructor(
    private ort: typeof Ort,
    private session: Ort.InferenceSession,
    readonly config: SignModelConfig,
  ) {}

  static async load(): Promise<SignClassifier> {
    const res = await fetch(`${MODEL_BASE}/config.json`, { cache: "no-store" });
    if (!res.ok) throw new Error("No sign model found. Publish one with ml/tools/publish_model.py.");
    const config = (await res.json()) as SignModelConfig;
    // A model trained on different features or landmarks would silently give wrong answers.
    if (config.featureVersion !== FEATURE_VERSION || config.featureDim !== FEATURE_DIM || config.window !== WINDOW) {
      throw new Error(`Model expects features ${config.featureVersion}, app computes ${FEATURE_VERSION}.`);
    }
    if (config.extractorVersion !== EXTRACTOR_VERSION) {
      throw new Error("Model was trained on landmarks from a different extractor version.");
    }
    const ort = await loadOrt();
    const session = await ort.InferenceSession.create(`${MODEL_BASE}/model.onnx`, {
      executionProviders: ["wasm"],
    });
    return new SignClassifier(ort, session, config);
  }

  labelFor(id: string): string {
    return this.config.labels?.[id] ?? id;
  }

  get policy(): DecisionPolicy {
    return this.config.policy ?? LEGACY_POLICY;
  }

  /** Classify one WINDOW x FEATURE_DIM feature matrix; predictions sorted by probability (uncalibrated). */
  async classify(features: Float32Array): Promise<Prediction[]> {
    const input = new this.ort.Tensor("float32", features, [1, WINDOW, FEATURE_DIM]);
    const out = await this.session.run({ features: input });
    const probs = softmax(out.logits.data as Float32Array);
    return probs.map((prob, i) => ({ label: this.config.classes[i], prob })).sort((a, b) => b.prob - a.prob);
  }

  /**
   * Decide what to do with one sign segment: features of the 3 window placements (windowVariants)
   * -> calibrated, averaged probabilities -> accept / suggest / reject under the model's policy.
   */
  async decide(variants: Float32Array): Promise<SignDecision> {
    if (variants.length !== 3 * WINDOW * FEATURE_DIM) throw new Error(`expected 3x${WINDOW}x${FEATURE_DIM} features`);
    const input = new this.ort.Tensor("float32", variants, [3, WINDOW, FEATURE_DIM]);
    const out = await this.session.run({ features: input });
    const n = this.config.classes.length;
    const flat = out.logits.data as Float32Array;
    if (flat.length !== 3 * n) throw new Error(`model returned ${flat.length} values, expected ${3 * n}`);
    const logits = [0, 1, 2].map((v) => Array.from(flat.subarray(v * n, (v + 1) * n)));
    const { probs, stable } = combine(logits, this.policy);
    return {
      decision: decide(probs, stable, this.config.classes, this.policy),
      stable,
      ranked: rankKnown(probs, this.config.classes, this.policy).map((r) => ({ ...r, text: this.labelFor(r.label) })),
      embedding: out.embedding ? meanEmbedding(out.embedding.data as Float32Array, 3) : undefined,
    };
  }
}

export interface SignDecision {
  decision: Decision;
  stable: boolean;
  /** Supported signs, best first (never includes "unknown"). Calibrated probabilities. */
  ranked: (Prediction & { text: string })[];
  /** L2-normalised pooled representation averaged over the 3 window placements (models with an embedding output). */
  embedding?: Float32Array;
}
