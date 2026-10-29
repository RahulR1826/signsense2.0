"""Export a trained model to ONNX for the browser and check it matches PyTorch."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch


class _WithEmbedding(torch.nn.Module):
    """Two outputs: class logits and the pooled representation (personal-sign matching, 'My signs')."""

    def __init__(self, model: torch.nn.Module):
        super().__init__()
        self.model = model

    def forward(self, x: torch.Tensor):
        e = self.model.features(x)
        return self.model.head(e), e


def export_onnx(model: torch.nn.Module, path: Path, sample: np.ndarray) -> float:
    """Export with a dynamic batch axis; outputs `logits` and `embedding`. Returns max |onnx - torch| on logits."""
    x = torch.from_numpy(sample)
    torch.onnx.export(
        _WithEmbedding(model).eval(),
        (x[:1],),
        str(path),
        input_names=["features"],
        output_names=["logits", "embedding"],
        dynamic_axes={"features": {0: "batch"}, "logits": {0: "batch"}, "embedding": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    import onnxruntime as ort

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    onnx_out = session.run(["logits"], {"features": sample})[0]
    with torch.no_grad():
        torch_out = model(x).numpy()
    return float(np.abs(onnx_out - torch_out).max())
