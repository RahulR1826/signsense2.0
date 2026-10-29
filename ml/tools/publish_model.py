"""Copy a trained run's model into the frontend so the browser uses it.

Usage (from ml/): .venv/Scripts/python tools/publish_model.py [run_dir]   (default: newest run)
Writes frontend/public/models/signs/{model.onnx, config.json}.
"""

import json
import shutil
import sys
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
DEST = ML_DIR.parent / "frontend" / "public" / "models" / "signs"


def main() -> None:
    runs = sorted(p for p in (ML_DIR / "runs").iterdir() if (p / "model.onnx").is_file())
    run = Path(sys.argv[1]) if len(sys.argv) > 1 else runs[-1]
    config = json.loads((run / "config.json").read_text(encoding="utf-8"))
    config["runId"] = run.name
    # Human-readable labels so the browser doesn't need the backend to show/speak a sign.
    vocab = json.loads((ML_DIR / "vocabulary.json").read_text(encoding="utf-8"))["signs"]
    names = {v["id"]: v["label"] for v in vocab}
    config["labels"] = {c: names.get(c, c) for c in config["classes"]}
    DEST.mkdir(parents=True, exist_ok=True)
    shutil.copy2(run / "model.onnx", DEST / "model.onnx")
    (DEST / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    report = json.loads((run / "report.json").read_text(encoding="utf-8"))
    acc = report["test"]["accuracy"] if report.get("test") else None
    print(f"published {run.name} ({len(config['classes'])} classes, test acc {acc}) -> {DEST}")


if __name__ == "__main__":
    main()
