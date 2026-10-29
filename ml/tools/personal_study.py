"""How well can a brand-new sign be recognised from 2 recordings? (design study for the 'My signs' feature)

Simulation with real INCLUDE clips of words the model never saw (word-disjoint OOV val/test words, 3 clips each):
  - pick K words as a user's 'personal signs' and enrol 2 clips of each,
  - query with the held-out 3rd clip of each enrolled word  -> should match that word,
  - query with clips of other unseen words and with the 121 known-sign test clips -> must NOT match.
Two matchers:
  embed : cosine similarity of the published model's pooled 192-d representation (mean over 3 window placements)
  dtw   : dynamic time warping over body-normalised hand/pose/handshape features (model-independent)
Thresholds are chosen on VALIDATION words (false-match rate <= target), then scored once on TEST words.
Note: enrol and query clips are usually different INCLUDE signers; a real user enrols with their own signing,
so these numbers are a pessimistic estimate of the same-person case.

Usage (from ml/): .venv/Scripts/python tools/personal_study.py  -> ml/reports/personal_study.json
"""

import json
import sys
from pathlib import Path

import numpy as np
import torch

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from signsense_ml import data  # noqa: E402
from signsense_ml.features import FEATURE_DIM, frame_features, resample_indices, window_variants  # noqa: E402
from signsense_ml.model import SignCNN  # noqa: E402

RUN = ML / "runs" / "20261021-001816-cnn-candidate"
K_WORDS, ENROL, DRAWS = 5, 2, 300
TARGETS = (0.01, 0.02, 0.05)
DTW_DIMS = np.r_[0:186, 330:333]  # pose + hands (body frame) + handshape + presence; no face


def load_model():
    cfg = json.loads((RUN / "config.json").read_text(encoding="utf-8"))
    m = SignCNN(FEATURE_DIM, len(cfg["classes"]))
    m.load_state_dict(torch.load(RUN / "model.pt", map_location="cpu"))
    m.eval()
    return m


@torch.no_grad()
def embed(model, seqs):
    """Pooled representation (input to the final classifier), averaged over the 3 window placements, L2-normalised."""
    out = []
    for s in seqs:
        x = torch.from_numpy(window_variants(s)).float()  # [3, 48, 333]
        from signsense_ml.model import with_motion

        h = model.proj(with_motion(x))
        h = model.conv(h.transpose(1, 2)).transpose(1, 2) + h
        e = model.pool(h).mean(0)
        out.append((e / e.norm()).numpy())
    return np.stack(out)


def dtw_seq(s):
    f = frame_features(s, resample_indices(s.t))[:, DTW_DIMS]
    return f.astype(np.float32)


def dtw(a, b, band=0.3):
    n, m = len(a), len(b)
    w = max(int(band * max(n, m)), abs(n - m) + 1)
    cost = np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).sum(-1))
    D = np.full((n + 1, m + 1), np.inf)
    D[0, 0] = 0
    for i in range(1, n + 1):
        lo, hi = max(1, i - w), min(m, i + w)
        for j in range(lo, hi + 1):
            D[i, j] = cost[i - 1, j - 1] + min(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1])
    return D[n, m] / (n + m)


def simulate(words, word_clips, negatives, score, rng):
    """Returns (positive_scores, positive_correct_word, negative_scores) over DRAWS random enrolments.
    score(query_id, enrolled_ids) -> similarity (higher = more alike)."""
    pos, pos_ok, neg = [], [], []
    for _ in range(DRAWS):
        chosen = rng.choice(len(words), K_WORDS, replace=False)
        enrolled, held = {}, {}
        for wi in chosen:
            clips = list(word_clips[words[wi]])
            rng.shuffle(clips)
            enrolled[wi], held[wi] = clips[:ENROL], clips[ENROL:]
        others = [c for wj, w in enumerate(words) if wj not in enrolled for c in word_clips[w]]
        for wi in chosen:
            for qc in held[wi]:
                s = {wj: score(qc, enrolled[wj]) for wj in chosen}
                best = max(s, key=s.get)
                pos.append(s[best])
                pos_ok.append(best == wi)
        for qc in list(rng.choice(others, min(30, len(others)), replace=False)) + list(rng.choice(negatives, 30, replace=False)):
            neg.append(max(score(qc, enrolled[wj]) for wj in chosen))
    return np.array(pos), np.array(pos_ok), np.array(neg)


def main():
    rng = np.random.default_rng(0)
    model = load_model()
    oov = data.load_oov()
    classes = json.loads((RUN / "config.json").read_text(encoding="utf-8"))["classes"]
    known = [s for s in data.load_include({c for c in classes if c != data.UNKNOWN}) if s.split == "test"]

    seqs = {}
    clip_word = {}
    for s in oov + known:
        seqs[s.key] = s.seq
    E = dict(zip(seqs, embed(model, list(seqs.values()))))
    print("embeddings done", len(E))
    F = {k: dtw_seq(v) for k, v in seqs.items()}
    dcache = {}

    def emb_score(q, enrolled):
        return max(float(E[q] @ E[e]) for e in enrolled)

    def dtw_score(q, enrolled):
        out = []
        for e in enrolled:
            key = (q, e) if q < e else (e, q)
            if key not in dcache:
                dcache[key] = dtw(F[q], F[e])
            out.append(-dcache[key])
        return max(out)

    known_keys = [s.key for s in known]
    report = {"setup": {"personal_words_per_user": K_WORDS, "enrolment_clips": ENROL, "draws": DRAWS,
                        "note": "enrol and query clips are mostly different INCLUDE signers (pessimistic vs a real user)"}}
    for name, fn in (("embed", emb_score), ("dtw", dtw_score)):
        res = {}
        for split in ("val", "test"):
            words = sorted({s.group for s in oov if s.split == split})
            word_clips = {w: [s.key for s in oov if s.split == split and s.group == w] for w in words}
            res[split] = simulate(words, word_clips, known_keys, fn, np.random.default_rng(1 if split == "val" else 2))
        vpos, vok, vneg = res["val"]
        tpos, tok, tneg = res["test"]
        rows = []
        for target in TARGETS:
            thr = float(np.quantile(vneg, 1 - target))  # chosen on validation
            match = tpos >= thr
            rows.append({
                "target_false_match_val": target,
                "threshold": round(thr, 4),
                "test_false_match_rate": round(float((tneg >= thr).mean()), 4),
                "test_new_sign_matched_correctly": round(float((match & tok).mean()), 4),
                "test_new_sign_matched_wrong_word": round(float((match & ~tok).mean()), 4),
                "test_new_sign_not_matched": round(float((~match).mean()), 4),
            })
        report[name] = {"test_top1_word_if_forced": round(float(tok.mean()), 4), "operating_points": rows,
                        "n_test_positive_queries": int(len(tpos)), "n_test_negative_queries": int(len(tneg))}
        print(name, json.dumps(report[name], indent=1))
    out = ML / "reports" / "personal_study.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("wrote", out)


if __name__ == "__main__":
    main()
