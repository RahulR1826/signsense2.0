"""Evaluation metrics and confusion-matrix plots."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support


def evaluate(probs: np.ndarray, y: np.ndarray, classes: list[str]) -> dict:
    pred = probs.argmax(1)
    top3 = np.argsort(-probs, axis=1)[:, :3]
    labels = list(range(len(classes)))
    p, r, f, support = precision_recall_fscore_support(y, pred, labels=labels, zero_division=0)
    return {
        "n": int(len(y)),
        "accuracy": float(accuracy_score(y, pred)),
        "top3_accuracy": float(np.mean([y[i] in top3[i] for i in range(len(y))])),
        "macro_f1": float(f1_score(y, pred, labels=sorted(set(y)), average="macro", zero_division=0)),
        "mean_confidence_correct": float(probs.max(1)[pred == y].mean()) if (pred == y).any() else None,
        "mean_confidence_wrong": float(probs.max(1)[pred != y].mean()) if (pred != y).any() else None,
        "per_class": {
            c: {"precision": float(p[i]), "recall": float(r[i]), "f1": float(f[i]), "support": int(support[i])}
            for i, c in enumerate(classes)
            if support[i]
        },
    }


def save_confusion(probs: np.ndarray, y: np.ndarray, classes: list[str], path: Path, title: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    cm = confusion_matrix(y, probs.argmax(1), labels=list(range(len(classes))))
    norm = cm / np.maximum(cm.sum(1, keepdims=True), 1)
    fig, ax = plt.subplots(figsize=(12, 10))
    im = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(classes)), classes, rotation=90, fontsize=7)
    ax.set_yticks(range(len(classes)), classes, fontsize=7)
    ax.set_xlabel("predicted")
    ax.set_ylabel("true")
    ax.set_title(f"{title} — accuracy {np.trace(cm) / max(cm.sum(), 1):.1%} (n={cm.sum()})")
    fig.colorbar(im, ax=ax, fraction=0.03)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
