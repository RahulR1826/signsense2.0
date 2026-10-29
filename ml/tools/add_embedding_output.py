"""Re-export a trained run's ONNX with a second output, `embedding` (the pooled representation used by
'My signs'), WITHOUT retraining. Verifies the logits are unchanged against the run's existing model.onnx.

Usage (from ml/): .venv/Scripts/python tools/add_embedding_output.py runs/<run> [--publish]
--publish also copies it to frontend/public/models/signs and records embeddingDim + the personal-sign
threshold from ml/reports/personal_study.json in config.json.
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))
from signsense_ml import data  # noqa: E402
from signsense_ml.export import export_onnx  # noqa: E402
from signsense_ml.features import FEATURE_DIM, window_variants  # noqa: E402
from signsense_ml.model import MODELS  # noqa: E402

run = Path(sys.argv[1]).resolve()
cfg = json.loads((run / "config.json").read_text(encoding="utf-8"))
kind = "cnn" if "cnn" in run.name else "gru"
model = MODELS[kind](FEATURE_DIM, len(cfg["classes"]))
model.load_state_dict(torch.load(run / "model.pt", map_location="cpu"))
model.eval()

# Real test clips as the check input (3 window placements each).
known = [s for s in data.load_include({c for c in cfg["classes"] if c != data.UNKNOWN}) if s.split == "test"][:20]
x = np.concatenate([window_variants(s.seq) for s in known]).astype(np.float32)
new = run / "model_embed.onnx"
torch_diff = export_onnx(model, new, x)
old_logits = ort.InferenceSession(str(run / "model.onnx"), providers=["CPUExecutionProvider"]).run(["logits"], {"features": x})[0]
sess = ort.InferenceSession(str(new), providers=["CPUExecutionProvider"])
new_logits, emb = sess.run(["logits", "embedding"], {"features": x})
diff = float(np.abs(new_logits - old_logits).max())
print(f"logits: max |new - old onnx| = {diff:.2e}, |onnx - torch| = {torch_diff:.2e}; embedding shape {emb.shape}")
assert diff < 1e-4, "logits changed - not publishing"

if "--publish" in sys.argv:
    dest = ML.parent / "frontend" / "public" / "models" / "signs"
    pub = json.loads((dest / "config.json").read_text(encoding="utf-8"))
    assert pub.get("runId") == run.name, f"published model is {pub.get('runId')}, not {run.name}"
    study = json.loads((ML / "reports" / "personal_study.json").read_text(encoding="utf-8"))
    point = next(p for p in study["embed"]["operating_points"] if p["target_false_match_val"] == 0.05)
    pub["embeddingDim"] = int(emb.shape[1])
    pub["personal"] = {
        "method": "embedding-cosine",
        "threshold": point["threshold"],
        "evidence": "ml/reports/personal_study.json (val-chosen; test: "
        f"{point['test_new_sign_matched_correctly']:.0%} matched, {point['test_false_match_rate']:.1%} false matches, cross-signer)",
    }
    shutil.copy2(new, dest / "model.onnx")
    (dest / "config.json").write_text(json.dumps(pub, indent=2), encoding="utf-8")
    print("published model.onnx with embedding output ->", dest)
