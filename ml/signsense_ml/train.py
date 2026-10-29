"""Train a sign classifier (+ "unknown" class), calibrate it, choose its decision policy, evaluate, export.

Usage (from ml/):
  .venv/Scripts/python -m signsense_ml.train --model cnn                      # official INCLUDE split
  .venv/Scripts/python -m signsense_ml.train --model cnn --protocol session   # whole sessions held out

Writes ml/runs/<timestamp>-<model>[-tag]/: model.pt, model.onnx, config.json (incl. decision policy),
labels.json, report.json, confusion_test.png. Logs to MLflow (ml/mlflow.db) when installed.

Data: INCLUDE clips of the vocabulary signs; out-of-vocabulary INCLUDE signs (include_download.py
--oov-per-word) as one "unknown" class, split by word so test-time unknown words are never seen in
training; our own recordings, if any, as an unseen-signer test set. Invalid clips (audit.check_samples)
are excluded. The best epoch is chosen on validation macro-F1 with early stopping.
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from torch import nn

from . import data
from .audit import check_samples
from .augment import augment
from .evaluate import evaluate_model
from .features import (
    FEATURE_DIM,
    FEATURE_GROUPS,
    FEATURE_VERSION,
    SAMPLE_FPS,
    WINDOW,
    fit_window,
    frame_features,
    resample_indices,
    sequence_features,
    window_variants,
)
from .model import MODELS
from .policy import fit_temperature, select_policy
from .report import evaluate, save_confusion

RUNS = data.ML_DIR / "runs"


def random_window(seq, rng: np.random.Generator) -> np.ndarray:
    idx = resample_indices(seq.t)
    start = int(rng.integers(0, abs(len(idx) - WINDOW) + 1))
    return frame_features(seq, fit_window(idx, start=start))


def stack(samples, classes) -> tuple[np.ndarray, np.ndarray]:
    if not samples:
        return np.zeros((0, WINDOW, FEATURE_DIM), np.float32), np.zeros(0, np.int64)
    x = np.stack([sequence_features(s.seq) for s in samples])
    y = np.array([classes.index(s.label) for s in samples])
    return x, y


def macro_f1(pred: np.ndarray, y: np.ndarray) -> float:
    from sklearn.metrics import f1_score

    return float(f1_score(y, pred, average="macro", zero_division=0)) if len(y) else 0.0


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", choices=sorted(MODELS), default="cnn")
    p.add_argument("--protocol", choices=("official", "session"), default="official")
    p.add_argument("--unknown", choices=("auto", "off"), default="auto", help="train an 'unknown' class from OOV clips when available")
    p.add_argument("--epochs", type=int, default=120)
    p.add_argument("--patience", type=int, default=40, help="stop when val macro-F1 hasn't improved for this many epochs")
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--hidden", type=int, default=192)
    p.add_argument("--dropout", type=float, default=0.3)
    p.add_argument("--no-augment", action="store_true")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--max-far", type=float, default=0.02, help="max share of unknown val clips the policy may auto-send")
    p.add_argument("--drop", default="", help=f"comma-separated feature groups to zero out: {sorted(FEATURE_GROUPS)}")
    p.add_argument("--tag", default="", help="suffix for the run directory name")
    p.add_argument("--exclude-oov", default="", help="comma-separated OOV words (folder names, e.g. oov-hom-gift) left out of training")
    args = p.parse_args()
    dropped = [g for g in args.drop.split(",") if g]
    bad_groups = set(dropped) - set(FEATURE_GROUPS)
    if bad_groups:
        p.error(f"unknown feature groups: {sorted(bad_groups)}")
    drop_cols = np.array(sorted({c for g in dropped for c in FEATURE_GROUPS[g]}), dtype=np.int64)

    def mask(x: np.ndarray) -> np.ndarray:
        if len(drop_cols):
            x = x.copy()
            x[..., drop_cols] = 0.0
        return x

    rng = np.random.default_rng(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    # ---- data -----------------------------------------------------------------------------------
    vocab_ids = [s["id"] for s in data.load_vocabulary()]
    known = data.load_include(set(vocab_ids))
    if args.protocol == "session":
        split = data.session_split(known)
        for s in known:
            s.split = split[s.key]
    oov = data.load_oov() if args.unknown == "auto" else []
    excluded_oov = {w for w in args.exclude_oov.split(",") if w}
    oov = [s for s in oov if not (s.split == "train" and s.group in excluded_oov)]  # eval sets stay unchanged
    own = data.load_own(set(vocab_ids))
    samples = known + oov + own
    invalid = check_samples(samples)
    samples = [s for s in samples if s.key not in invalid]
    present = {s.label for s in samples if s.split == "train" and s.label != data.UNKNOWN}
    classes = [c for c in vocab_ids if c in present]
    use_unknown = any(s.label == data.UNKNOWN and s.split == "train" for s in samples)
    if use_unknown:
        classes.append(data.UNKNOWN)
    samples = [s for s in samples if s.label in classes]
    by_split = {k: [s for s in samples if s.split == k] for k in ("train", "val", "test", "own")}
    counts = Counter(s.label for s in by_split["train"])
    print({k: len(v) for k, v in by_split.items()}, f"{len(classes)} classes (unknown={'yes' if use_unknown else 'no'}), "
          f"protocol={args.protocol}, excluded invalid={len(invalid)}, device={device}")

    xv, yv = stack(by_split["val"], classes)
    xv = mask(xv)

    # ---- model ----------------------------------------------------------------------------------
    model = MODELS[args.model](FEATURE_DIM, len(classes), hidden=args.hidden, dropout=args.dropout).to(device)
    params = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    steps_per_epoch = max(1, -(-len(by_split["train"]) // args.batch))
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.epochs * steps_per_epoch)
    # Class weights (inverse square-root frequency) so the large "unknown" class and the few 8-clip signs
    # don't dominate or vanish.
    freq = np.array([counts[c] for c in classes], dtype=np.float64)
    weights = np.sqrt(freq.sum() / (len(classes) * np.maximum(freq, 1)))
    loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32, device=device), label_smoothing=0.1)

    def logits_of(x: np.ndarray) -> np.ndarray:
        model.eval()
        with torch.no_grad():
            return model(torch.from_numpy(x).to(device)).cpu().numpy()

    best_score, best_state, best_epoch = -1.0, None, 0
    train = by_split["train"]
    t0 = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = rng.permutation(len(train))
        total = 0.0
        for b in range(0, len(order), args.batch):
            batch = [train[i] for i in order[b : b + args.batch]]
            x = mask(np.stack([random_window(s.seq if args.no_augment else augment(s.seq, rng), rng) for s in batch]))
            y = torch.tensor([classes.index(s.label) for s in batch], device=device)
            loss = loss_fn(model(torch.from_numpy(x).to(device)), y)
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            total += loss.item() * len(batch)
        val_pred = logits_of(xv).argmax(1) if len(yv) else np.zeros(0)
        score = macro_f1(val_pred, yv)
        if score >= best_score:
            best_score, best_epoch = score, epoch
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        if epoch % 10 == 0 or epoch == 1:
            acc = float((val_pred == yv).mean()) if len(yv) else 0.0
            print(f"epoch {epoch:3d}  loss {total / len(train):.3f}  val acc {acc:.3f}  val macro-F1 {score:.3f}  ({time.time() - t0:.0f}s)", flush=True)
        if epoch - best_epoch >= args.patience and epoch >= args.epochs // 2:
            print(f"early stop at epoch {epoch} (best {best_epoch})")
            break
    model.load_state_dict(best_state)

    # ---- calibration + decision policy (validation data only) ------------------------------------
    val_variants = np.stack([mask(window_variants(s.seq)) for s in by_split["val"]]) if by_split["val"] else None
    unknown_label = data.UNKNOWN if use_unknown else None
    if val_variants is not None:
        n, v = val_variants.shape[:2]
        vlog = logits_of(val_variants.reshape(n * v, WINDOW, FEATURE_DIM).astype(np.float32)).reshape(n, v, -1)
        temperature = fit_temperature(vlog[:, 1], yv)
        is_unknown_val = np.array([s.label == data.UNKNOWN for s in by_split["val"]])
        policy, val_outcomes = select_policy(list(vlog), yv, is_unknown_val, classes, temperature, unknown_label, max_far=args.max_far)
    else:
        from .policy import Policy

        policy, val_outcomes = Policy(unknown_label=unknown_label), None
    print(f"policy: T={policy.temperature:.2f} accept>={policy.accept} margin>={policy.margin} suggest>={policy.suggest}")

    # ---- save + export ---------------------------------------------------------------------------
    run_dir = RUNS / f"{time.strftime('%Y%m%d-%H%M%S')}-{args.model}{'-' + args.tag if args.tag else ''}"
    run_dir.mkdir(parents=True)
    config = {
        "featureVersion": FEATURE_VERSION,
        "droppedFeatures": dropped,
        "extractorVersion": data.EXTRACTOR_VERSION,
        "featureDim": FEATURE_DIM,
        "window": WINDOW,
        "sampleFps": SAMPLE_FPS,
        "classes": classes,
        "protocol": args.protocol,
        "policy": policy.to_json(),
        "args": vars(args),
    }
    torch.save(model.state_dict(), run_dir / "model.pt")
    (run_dir / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    (run_dir / "labels.json").write_text(json.dumps(classes), encoding="utf-8")

    from .export import export_onnx

    sample = xv[:16] if len(xv) else np.zeros((1, WINDOW, FEATURE_DIM), np.float32)
    parity = export_onnx(model.cpu().eval(), run_dir / "model.onnx", sample)

    if len(drop_cols):  # ablation runs: the exported model expects masked features, so evaluate in-process
        xt, yt = stack([s for s in by_split["test"] if s.label != data.UNKNOWN], classes)
        known_cols = [i for i, c in enumerate(classes) if c != data.UNKNOWN]
        model.to(device)
        test_known = evaluate(logits_of(mask(xt))[:, known_cols], np.array([known_cols.index(i) for i in yt]), [classes[i] for i in known_cols])
        full = None
    else:
        full = evaluate_model(run_dir, args.protocol)
        test_known = full["known_classification"]
        xt, yt = stack([s for s in by_split["test"] if s.label != data.UNKNOWN], classes)
        model.to(device)
        known_cols = [i for i, c in enumerate(classes) if c != data.UNKNOWN]
        save_confusion(logits_of(xt)[:, known_cols], np.array([known_cols.index(i) for i in yt]), [classes[i] for i in known_cols],
                       run_dir / "confusion_test.png", f"INCLUDE test ({args.protocol} split), known signs")

    xo, yo = stack(by_split["own"], classes)
    report = {
        "model": args.model,
        "protocol": args.protocol,
        "params": params,
        "best_epoch": best_epoch,
        "val_macro_f1": best_score,
        "splits": {k: len(v) for k, v in by_split.items()},
        "train_per_class": dict(counts),
        "excluded_invalid": invalid,
        "policy": policy.to_json(),
        "val_policy_outcomes": val_outcomes,
        "test": test_known,
        "test_policy": full and {k: full[k] for k in ("n_known_test", "n_unknown_test", "n_unknown_test_words", "policy_outcomes", "latency_ms_per_decision_cpu1", "model_size_mb")},
        "own": evaluate(logits_of(xo), yo, classes) if len(yo) else None,
        "onnx_max_abs_diff": parity,
    }
    (run_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    _log_mlflow(args, report, run_dir)
    rates = full["policy_outcomes"]["rates"] if full else {}
    print(f"\nbest val macro-F1 {best_score:.3f} @ epoch {best_epoch}; {params:,} params")
    print("summary:", json.dumps({
        "test": test_known and {m: test_known[m] for m in ("accuracy", "top3_accuracy", "macro_f1")},
        "auto_sent_correct": rates.get("known_auto_sent_correct"),
        "auto_sent_wrong": rates.get("known_auto_sent_wrong"),
        "unknown_false_acceptance": rates.get("unknown_false_acceptance"),
    }))
    print("run dir:", run_dir)


def _log_mlflow(args, report: dict, run_dir: Path) -> None:
    try:
        import mlflow
    except ImportError:
        return
    try:
        _mlflow_run(mlflow, args, report, run_dir)
    except Exception as exc:  # tracking is a convenience; never lose a finished run over it
        print(f"MLflow logging skipped: {exc}")


def _mlflow_run(mlflow, args, report: dict, run_dir: Path) -> None:
    # View with: .venv/Scripts/mlflow ui --backend-store-uri sqlite:///mlflow.db
    mlflow.set_tracking_uri(f"sqlite:///{(data.ML_DIR / 'mlflow.db').as_posix()}")
    name = "signsense-isolated-signs"
    if mlflow.get_experiment_by_name(name) is None:
        mlflow.create_experiment(name, artifact_location=(data.ML_DIR / "mlruns").as_uri())
    mlflow.set_experiment(name)
    with mlflow.start_run(run_name=run_dir.name):
        mlflow.log_params({**vars(args), "feature_version": FEATURE_VERSION, "params": report["params"]})
        mlflow.log_metric("val_macro_f1", report["val_macro_f1"])
        if report["test"]:
            for m in ("accuracy", "top3_accuracy", "macro_f1"):
                mlflow.log_metric(f"test_{m}", report["test"][m])
        if report.get("test_policy"):
            for k, v in report["test_policy"]["policy_outcomes"]["rates"].items():
                if v is not None:
                    mlflow.log_metric(f"policy_{k}", v)
        mlflow.log_artifacts(str(run_dir))


if __name__ == "__main__":
    main()
