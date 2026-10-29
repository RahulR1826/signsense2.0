"""Before training on more "other word" (OOV) clips: are any of them really one of our supported signs?

An OOV word signed (almost) like a supported sign would teach the "unknown" class to swallow that sign. Two checks:
  1. names: OOV words whose name matches a supported sign or one of its gloss synonyms;
  2. model: OOV training clips that the published model already auto-accepts as a supported sign (calibrated
     probability >= its accept threshold on all window variants). Words where most clips do so are flagged.
Also: nearest-neighbour cosine between OOV training clips and known-sign / OOV eval clips on pooled embeddings
(near-duplicates across splits).

Writes reports/oov_overlap.json. Usage (from ml/): .venv/Scripts/python tools/oov_overlap_check.py
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from signsense_ml import data  # noqa: E402
from signsense_ml.features import window_variants  # noqa: E402
from signsense_ml.policy import Policy, combine  # noqa: E402

MODEL = ML_DIR.parent / "frontend" / "public" / "models" / "signs"
NEAR_DUP = 0.995  # embedding cosine treated as a near-duplicate clip


def main() -> None:
    import onnxruntime as ort

    cfg = json.loads((MODEL / "config.json").read_text(encoding="utf-8"))
    classes = cfg["classes"]
    policy = Policy.from_json(cfg["policy"])
    vocab = data.load_vocabulary()
    names = {}
    for s in vocab:
        for n in [s["id"], s["label"], *s.get("synonyms", [])]:
            names[n.lower().replace("_", " ").strip()] = s["id"]

    oov = data.load_oov()
    known = data.load_include({c for c in classes if c != data.UNKNOWN})
    sess = ort.InferenceSession(str(MODEL / "model.onnx"), providers=["CPUExecutionProvider"])

    def run(samples):
        x = np.stack([window_variants(s.seq) for s in samples])
        n, v = x.shape[:2]
        logits, emb = sess.run(["logits", "embedding"], {"features": x.reshape(n * v, *x.shape[2:]).astype(np.float32)})
        e = emb.reshape(n, v, -1).mean(1)
        return logits.reshape(n, v, -1), e / np.linalg.norm(e, axis=1, keepdims=True)

    oov_logits, oov_emb = run(oov)
    known_logits, known_emb = run(known)

    # 1. Name matches.
    by_word = defaultdict(list)
    for i, s in enumerate(oov):
        by_word[s.group].append(i)
    name_hits = {}
    for word in by_word:
        plain = word.split("-", 2)[-1].replace("-", " ").replace("_", " ").lower()
        if plain in names:
            name_hits[word] = names[plain]

    # 2. Auto-accepted as a supported sign by the published model.
    model_hits = {}
    for word, idx in by_word.items():
        accepted = defaultdict(int)
        for i in idx:
            probs, stable = combine(oov_logits[i], policy)
            top = int(np.argmax(probs))
            if classes[top] != data.UNKNOWN and probs[top] >= policy.accept and stable:
                accepted[classes[top]] += 1
        if accepted:
            sign, k = max(accepted.items(), key=lambda kv: kv[1])
            model_hits[word] = {"split": oov[idx[0]].split, "clips": len(idx), "acceptedAs": sign, "acceptedClips": k}

    # 3. Near-duplicates across splits (OOV train vs known clips, and vs OOV val/test).
    train = [i for i, s in enumerate(oov) if s.split == "train"]
    held = [i for i, s in enumerate(oov) if s.split != "train"]
    sims_known = oov_emb[train] @ known_emb.T
    sims_held = oov_emb[train] @ oov_emb[held].T if held else np.zeros((len(train), 0))
    dup_known = [(oov[train[a]].key, known[b].key, float(sims_known[a, b])) for a, b in zip(*np.where(sims_known >= NEAR_DUP))]
    dup_held = [(oov[train[a]].key, oov[held[b]].key, float(sims_held[a, b])) for a, b in zip(*np.where(sims_held >= NEAR_DUP))]

    flagged = sorted(set(name_hits) | {w for w, h in model_hits.items() if h["acceptedClips"] / h["clips"] >= 0.5})
    report = {
        "oovClips": len(oov),
        "oovWords": len(by_word),
        "nameMatches": name_hits,
        "autoAcceptedByPublishedModel": model_hits,
        "flaggedWords": flagged,
        "nearDuplicateThreshold": NEAR_DUP,
        "nearDuplicatesTrainVsKnown": dup_known[:50],
        "nearDuplicatesTrainVsHeldOutOov": dup_held[:50],
        "maxCosTrainVsKnown": float(sims_known.max()) if sims_known.size else None,
        "maxCosTrainVsHeldOutOov": float(sims_held.max()) if sims_held.size else None,
    }
    (ML_DIR / "reports" / "oov_overlap.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"OOV {len(oov)} clips / {len(by_word)} words; name matches {name_hits}")
    print("auto-accepted by published model:", {w: (h["split"], f"{h['acceptedClips']}/{h['clips']}", h["acceptedAs"]) for w, h in model_hits.items()})
    print("flagged words (exclude from training):", flagged)
    print(f"near-duplicates (cos >= {NEAR_DUP}): train-vs-known {len(dup_known)}, train-vs-heldout-OOV {len(dup_held)}; "
          f"max cos {report['maxCosTrainVsKnown']:.4f} / {report['maxCosTrainVsHeldOutOov']:.4f}")


if __name__ == "__main__":
    main()
