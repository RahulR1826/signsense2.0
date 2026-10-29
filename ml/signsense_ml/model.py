"""Sign classifiers over [batch, WINDOW, FEATURE_DIM] landmark features. Small enough for the browser."""

from __future__ import annotations

import torch
from torch import nn


class AttentionPool(nn.Module):
    def __init__(self, dim: int):
        super().__init__()
        self.score = nn.Linear(dim, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # [B, T, D] -> [B, D]
        w = torch.softmax(self.score(x), dim=1)
        return (w * x).sum(dim=1)


def with_motion(x: torch.Tensor) -> torch.Tensor:
    """Append frame-to-frame differences (velocity); computed inside the model so ONNX includes it."""
    d = x[:, 1:] - x[:, :-1]
    d = torch.cat([torch.zeros_like(x[:, :1]), d], dim=1)
    return torch.cat([x, d], dim=-1)


class SignGRU(nn.Module):
    """Baseline: projection -> 2-layer bidirectional GRU -> attention pooling -> classes."""

    def __init__(self, feature_dim: int, num_classes: int, hidden: int = 192, dropout: float = 0.3):
        super().__init__()
        self.proj = nn.Sequential(
            nn.Linear(feature_dim * 2, hidden), nn.LayerNorm(hidden), nn.GELU(), nn.Dropout(dropout)
        )
        self.gru = nn.GRU(hidden, hidden, num_layers=2, batch_first=True, bidirectional=True, dropout=dropout)
        self.pool = AttentionPool(hidden * 2)
        self.head = nn.Sequential(nn.LayerNorm(hidden * 2), nn.Dropout(dropout), nn.Linear(hidden * 2, num_classes))

    def features(self, x: torch.Tensor) -> torch.Tensor:
        """Pooled sequence representation (the classifier's input); used as a sign 'fingerprint'."""
        h = self.proj(with_motion(x))
        h, _ = self.gru(h)
        return self.pool(h)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(x))


class SignCNN(nn.Module):
    """Alternative: temporal 1D convolutions (fast in the browser) -> attention pooling."""

    def __init__(self, feature_dim: int, num_classes: int, hidden: int = 192, dropout: float = 0.3):
        super().__init__()
        self.proj = nn.Sequential(nn.Linear(feature_dim * 2, hidden), nn.LayerNorm(hidden), nn.GELU())
        layers = []
        for dilation in (1, 2, 4, 1):
            layers += [
                nn.Conv1d(hidden, hidden, kernel_size=5, padding=2 * dilation, dilation=dilation),
                nn.BatchNorm1d(hidden),
                nn.GELU(),
                nn.Dropout(dropout),
            ]
        self.conv = nn.Sequential(*layers)
        self.pool = AttentionPool(hidden)
        self.head = nn.Sequential(nn.LayerNorm(hidden), nn.Dropout(dropout), nn.Linear(hidden, num_classes))

    def features(self, x: torch.Tensor) -> torch.Tensor:
        """Pooled sequence representation (the classifier's input); used as a sign 'fingerprint'."""
        h = self.proj(with_motion(x))
        h = self.conv(h.transpose(1, 2)).transpose(1, 2) + h
        return self.pool(h)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(x))


MODELS = {"gru": SignGRU, "cnn": SignCNN}
